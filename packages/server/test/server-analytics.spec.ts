import { describe, expect, it, vi } from "vitest";
import { SERVER_ONLY_EVENTS } from "@hexagon/shared";
import {
  ServerAnalyticsService,
  serverEventId,
  toIso,
  toServerRow,
} from "../src/analytics/server-analytics.service";
import { matchEndEvents } from "../src/matches/matches.controller";
import type { SupabaseService } from "../src/database/supabase.service";

// doc 35 §A1.4 — sự kiện do SERVER phát. Ba thứ được bảo vệ ở đây, và cả ba đều là loại lỗi
// KHÔNG tự lộ ra: báo cáo vẫn chạy, con số vẫn trông hợp lý, chỉ là sai.
//
//  1. Đo đạc hỏng không được làm hỏng giao dịch nghiệp vụ.
//  2. `event_id` phải tất định — gửi lại webhook không được nhân đôi doanh thu.
//  3. `occurred_at` phải lấy từ dữ kiện, không lấy từ đồng hồ, ở mọi chỗ có sẵn mốc thời gian.

/** DB giả: ghi lại hàng được upsert; `error` khác null để mô phỏng database hỏng. */
function db(error: { message: string } | null = null) {
  const upserts: { rows: Record<string, unknown>[]; opts: unknown }[] = [];
  const service = {
    from: () => ({
      upsert: async (rows: Record<string, unknown>[], opts: unknown) => {
        upserts.push({ rows, opts });
        return { error };
      },
    }),
  } as unknown as SupabaseService;
  return { service, upserts };
}

function boom() {
  return {
    from: () => ({ upsert: async () => { throw new Error("mat ket noi"); } }),
  } as unknown as SupabaseService;
}

describe("serverEventId — tất định", () => {
  it("cùng dữ kiện ⇒ cùng id, mọi lần gọi", () => {
    const a = serverEventId("purchase_fulfilled", ["charge-abc"]);
    const b = serverEventId("purchase_fulfilled", ["charge-abc"]);
    expect(a).toBe(b);
  });

  it("khác dữ kiện HOẶC khác tên sự kiện ⇒ khác id", () => {
    expect(serverEventId("purchase_fulfilled", ["c1"])).not.toBe(serverEventId("purchase_fulfilled", ["c2"]));
    // Cùng khoá nghiệp vụ nhưng khác loại sự kiện phải tách nhau, nếu không `campaign_level_complete`
    // và `energy_grant` của cùng một lượt chơi sẽ đè lên nhau và mất một cái.
    expect(serverEventId("campaign_level_complete", ["play-1"])).not.toBe(serverEventId("energy_grant", ["play-1"]));
  });

  it("có hình dạng UUID — dùng chung cột với event_id do client sinh", () => {
    expect(serverEventId("match_end", ["m1", "p1"])).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/);
  });

  it("KHÔNG chứa nguyên văn khoá nghiệp vụ (id đơn hàng không nên nằm trần trong bảng)", () => {
    expect(serverEventId("purchase_fulfilled", ["charge-secret-123"])).not.toContain("charge-secret");
  });
});

describe("toIso — mốc thời gian", () => {
  it("lấy mốc của dữ kiện khi có", () => {
    expect(toIso("2026-09-04T10:00:00.000Z", 999)).toBe("2026-09-04T10:00:00.000Z");
    expect(toIso(new Date(1_700_000_000_000), 999)).toBe(new Date(1_700_000_000_000).toISOString());
  });

  it("thiếu hoặc hỏng ⇒ giờ hiện tại, KHÔNG ném lỗi", () => {
    const now = 1_700_000_000_000;
    expect(toIso(null, now)).toBe(new Date(now).toISOString());
    expect(toIso("khong-phai-ngay", now)).toBe(new Date(now).toISOString());
    expect(toIso(new Date("hong"), now)).toBe(new Date(now).toISOString());
  });
});

describe("toServerRow", () => {
  it("luôn đánh dấu source=server và lọc PII khỏi props", () => {
    const row = toServerRow({
      name: "purchase_fulfilled",
      dedupe: ["c1"],
      playerId: "p1",
      props: { amount: 100, email: "a@b.c", displayName: "Ai Do" },
    });
    expect(row.source).toBe("server");
    // `sanitizeProps` chạy lại ở tầng này dù nơi gọi là code của chính mình.
    expect(row.props).toEqual({ amount: 100 });
  });

  it("platform chỉ nhận telegram/web — cột có check constraint", () => {
    expect(toServerRow({ name: "match_end", dedupe: ["x"], playerId: null, platform: "telegram" }).platform).toBe("telegram");
    expect(toServerRow({ name: "match_end", dedupe: ["x"], playerId: null, platform: "linh tinh" }).platform).toBe("web");
    expect(toServerRow({ name: "match_end", dedupe: ["x"], playerId: null }).platform).toBe("web");
  });
});

describe("ServerAnalyticsService — không bao giờ làm hỏng nghiệp vụ", () => {
  it("database trả lỗi ⇒ nuốt, KHÔNG ném", async () => {
    const svc = new ServerAnalyticsService(db({ message: "bang khong ton tai" }).service);
    await expect(svc.emit({ name: "match_end", dedupe: ["m"], playerId: "p" })).resolves.toBe(false);
  });

  it("database NÉM giữa chừng ⇒ vẫn nuốt", async () => {
    const svc = new ServerAnalyticsService(boom());
    await expect(svc.emit({ name: "purchase_fulfilled", dedupe: ["c"], playerId: "p" })).resolves.toBe(false);
    await expect(svc.emitMany([{ name: "match_end", dedupe: ["m"], playerId: "p" }])).resolves.toBe(false);
  });

  it("lô rỗng ⇒ không chạm database", async () => {
    const d = db();
    await new ServerAnalyticsService(d.service).emitMany([]);
    expect(d.upserts).toHaveLength(0);
  });

  it("ghi bằng ignoreDuplicates trên (event_id, occurred_at)", async () => {
    const d = db();
    await new ServerAnalyticsService(d.service).emit({ name: "match_end", dedupe: ["m"], playerId: "p" });
    expect(d.upserts[0].opts).toEqual({ onConflict: "event_id,occurred_at", ignoreDuplicates: true });
  });
});

// ---- match_end -----------------------------------------------------------------------------

const ENVELOPE = {
  eventId: "evt-1",
  matchId: "match-1",
  region: "ap",
  mode: "online",
  startedAt: "2026-09-04T10:00:00.000Z",
  endedAt: "2026-09-04T10:04:00.000Z",
  winnerPlayerId: "p1",
  players: [
    { participantKey: "k1", playerId: "p1", platform: "telegram", isGuest: false, kills: 3, deaths: 1, territoryCaptured: 22.5, deathCause: "", finalScore: 900, placement: 1 },
    { participantKey: "k2", playerId: "p2", platform: "web", isGuest: false, kills: 0, deaths: 2, territoryCaptured: 4, deathCause: "cut", finalScore: 120, placement: 2 },
  ],
};

describe("matchEndEvents", () => {
  it("mỗi người chơi một sự kiện, thắng/thua suy từ winnerPlayerId của server", () => {
    const events = matchEndEvents(ENVELOPE);
    expect(events).toHaveLength(2);
    expect(events[0].props?.won).toBe(true);
    expect(events[1].props?.won).toBe(false);
    expect(events[0].playerId).toBe("p1");
  });

  it("occurred_at lấy endedAt của envelope, KHÔNG lấy đồng hồ server", () => {
    // Node game gửi lại kết quả theo cấp số nhân khi control plane hỏng. Nếu mốc này là đồng hồ
    // thì mỗi lần gửi lại là một hàng mới, và unique (event_id, occurred_at) không cứu được.
    expect(matchEndEvents(ENVELOPE)[0].occurredAt).toBe("2026-09-04T10:04:00.000Z");
  });

  it("gửi lại cùng envelope ⇒ cùng event_id VÀ cùng occurred_at ⇒ khử trùng thật", () => {
    const a = matchEndEvents(ENVELOPE).map((e) => toServerRow(e));
    const b = matchEndEvents(ENVELOPE).map((e) => toServerRow(e));
    expect(a.map((r) => [r.event_id, r.occurred_at])).toEqual(b.map((r) => [r.event_id, r.occurred_at]));
  });

  it("hai người chơi trong CÙNG ván không được đụng id nhau", () => {
    const [a, b] = matchEndEvents(ENVELOPE).map((e) => toServerRow(e));
    expect(a.event_id).not.toBe(b.event_id);
  });

  it("bỏ khách và bỏ hàng thiếu playerId — không gắn được ai thì không đếm được gì", () => {
    const events = matchEndEvents({
      ...ENVELOPE,
      players: [
        { participantKey: "k1", playerId: "", isGuest: false },
        { participantKey: "k2", playerId: "p9", isGuest: true },
      ],
    });
    expect(events).toHaveLength(0);
  });

  it("envelope thiếu id ⇒ không phát gì, thay vì phát một sự kiện không khử trùng được", () => {
    expect(matchEndEvents({ ...ENVELOPE, eventId: undefined, matchId: undefined })).toHaveLength(0);
  });

  it("thời lượng tính từ startedAt/endedAt; mốc hỏng ⇒ null chứ không phải số bịa", () => {
    expect(matchEndEvents(ENVELOPE)[0].props?.duration_sec).toBe(240);
    expect(matchEndEvents({ ...ENVELOPE, startedAt: "hong" })[0].props?.duration_sec).toBe(null);
  });

  it("số liệu hỏng kiểu ⇒ 0, không đẩy NaN vào bảng", () => {
    const events = matchEndEvents({
      ...ENVELOPE,
      players: [{ participantKey: "k", playerId: "p1", kills: "ba" as unknown, finalScore: null }],
    });
    expect(events[0].props?.kills).toBe(0);
    expect(events[0].props?.final_score).toBe(0);
  });
});

describe("hợp đồng sự kiện chỉ-server", () => {
  it("ba tên tiền/tài nguyên nằm trong danh sách chặn client", () => {
    expect([...SERVER_ONLY_EVENTS].sort()).toEqual(["energy_grant", "energy_spend", "purchase_fulfilled"]);
  });
});

describe("ghi thật vào bảng", () => {
  it("emitMany ghi đúng số hàng, đều mang source=server", async () => {
    const d = db();
    const svc = new ServerAnalyticsService(d.service);
    await svc.emitMany(matchEndEvents(ENVELOPE));
    expect(d.upserts[0].rows).toHaveLength(2);
    expect(d.upserts[0].rows.every((r) => r.source === "server")).toBe(true);
  });

  it("emit KHÔNG await được ở nơi gọi mà vẫn an toàn (void + nuốt lỗi)", async () => {
    const svc = new ServerAnalyticsService(boom());
    const spy = vi.fn();
    // Mô phỏng đúng cách nơi gọi dùng: `void svc.emit(...)` rồi đi tiếp ngay.
    void svc.emit({ name: "energy_grant", dedupe: ["k"], playerId: "p" }).then(spy);
    await new Promise((r) => setTimeout(r, 0));
    expect(spy).toHaveBeenCalledWith(false);
  });
});
