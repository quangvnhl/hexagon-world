import { describe, expect, it, vi } from "vitest";
import { BadRequestException } from "@nestjs/common";
import { makeEvent, type AnalyticsContext, type AnalyticsEvent } from "@hexagon/shared";
import { AnalyticsController, BatchRateLimiter, MAX_EVENTS_PER_BATCH, toRow } from "../src/analytics/analytics.controller";
import type { SessionService } from "../src/auth/session.service";
import type { SupabaseService } from "../src/database/supabase.service";

// doc 35 §A1 — POST /v1/events. Điều được bảo vệ ở đây: một sự kiện hỏng không giết cả lô,
// server không tin props/player_id của client, và guest vẫn gửi được sự kiện.

const CTX: AnalyticsContext = { sessionId: "s-1", anonId: "a-1", platform: "telegram", buildId: "b1" };

function req(ip = "1.2.3.4") { return { ip, socket: {}, headers: {}, cookies: {} } as never; }

/** Session giả: `player` = null nghĩa là khách (resolve ném lỗi như thật). */
function sessions(player: { id: string } | null) {
  return {
    resolve: vi.fn(async () => {
      if (!player) throw new Error("missing_session");
      return { id: player.id, displayName: "x", platform: "telegram" };
    }),
  } as unknown as SessionService;
}

/** DB giả: ghi lại các hàng được upsert để test soi nội dung thật sự đi vào bảng. */
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

function ev(over: Partial<AnalyticsEvent> = {}, now = 1_700_000_000_000): AnalyticsEvent {
  return { ...makeEvent("app_open", {}, CTX, now), ...over };
}

describe("AnalyticsController.ingest", () => {
  it("client KHÔNG giả mạo được sự kiện tiền/tài nguyên của server (lát a1.4)", async () => {
    const d = db();
    const c = new AnalyticsController(sessions({ id: "p1" }), d.service);
    // Lô trộn: một sự kiện hợp lệ + ba sự kiện chỉ-server. Ba cái sau bị bỏ RIÊNG, cái đầu vẫn
    // vào bảng — nếu giết cả lô thì client sẽ đệm rồi gửi lại mãi và mất toàn bộ sự kiện về sau.
    const out = await c.ingest(req(), {
      events: [
        ev({ name: "app_open" }),
        ev({ name: "purchase_fulfilled", eventId: "e-1" }),
        ev({ name: "energy_grant", eventId: "e-2" }),
        ev({ name: "energy_spend", eventId: "e-3" }),
      ],
    });
    expect(out).toEqual({ accepted: 1, rejected: 3 });
    expect(d.upserts[0].rows.map((r) => r.name)).toEqual(["app_open"]);
  });

  it("khách (không session) vẫn gửi được — player_id null, KHÔNG ném lỗi", async () => {
    const d = db();
    const c = new AnalyticsController(sessions(null), d.service);
    const out = await c.ingest(req(), { events: [ev()] });
    expect(out).toEqual({ accepted: 1, rejected: 0 });
    expect(d.upserts[0].rows[0].player_id).toBeNull();
  });

  it("player_id lấy từ SESSION, không lấy từ body — không ai gắn sự kiện cho người khác được", async () => {
    const d = db();
    const c = new AnalyticsController(sessions({ id: "player-thật" }), d.service);
    await c.ingest(req(), { events: [{ ...ev(), playerId: "player-giả" } as never] });
    expect(d.upserts[0].rows[0].player_id).toBe("player-thật");
  });

  it("một sự kiện hỏng KHÔNG giết cả lô — ghi phần hợp lệ, đếm phần bỏ", async () => {
    const d = db();
    const c = new AnalyticsController(sessions(null), d.service);
    const out = await c.ingest(req(), {
      events: [ev(), { rác: true }, ev({ name: "tên_không_có_trong_union" as never })],
    });
    expect(out).toEqual({ accepted: 1, rejected: 2 });
    expect(d.upserts[0].rows).toHaveLength(1);
  });

  it("props bị lọc LẠI ở server: khoá PII bị bỏ dù client đã gửi lên", async () => {
    const d = db();
    const c = new AnalyticsController(sessions(null), d.service);
    // Cố ý dựng thẳng object (không qua makeEvent) để mô phỏng client sửa payload.
    const bad = { ...ev(), props: { email: "a@b.c", initData: "x", step: 2 } };
    await c.ingest(req(), { events: [bad as never] });
    expect(d.upserts[0].rows[0].props).toEqual({ step: 2 });
  });

  it("ts ở TƯƠNG LAI xa (đồng hồ sai / bịa dữ liệu) ⇒ bỏ", async () => {
    const d = db();
    const c = new AnalyticsController(sessions(null), d.service);
    const out = await c.ingest(req(), { events: [ev({ ts: Date.now() + 30 * 24 * 3600_000 })] });
    expect(out).toEqual({ accepted: 0, rejected: 1 });
    expect(d.upserts).toHaveLength(0);
  });

  it("ts ở QUÁ KHỨ (lô đệm khi offline) vẫn được nhận", async () => {
    const d = db();
    const c = new AnalyticsController(sessions(null), d.service);
    const out = await c.ingest(req(), { events: [ev({ ts: Date.now() - 10 * 24 * 3600_000 })] });
    expect(out).toEqual({ accepted: 1, rejected: 0 });
  });

  it("khử trùng theo (event_id, occurred_at) — upsert bỏ qua bản trùng", async () => {
    const d = db();
    const c = new AnalyticsController(sessions(null), d.service);
    await c.ingest(req(), { events: [ev()] });
    expect(d.upserts[0].opts).toEqual({ onConflict: "event_id,occurred_at", ignoreDuplicates: true });
  });

  it("lô rỗng ⇒ không chạm database", async () => {
    const d = db();
    const c = new AnalyticsController(sessions(null), d.service);
    expect(await c.ingest(req(), { events: [] })).toEqual({ accepted: 0, rejected: 0 });
    expect(d.upserts).toHaveLength(0);
  });

  it("body thiếu mảng events ⇒ BadRequest", async () => {
    const c = new AnalyticsController(sessions(null), db().service);
    await expect(c.ingest(req(), {})).rejects.toBeInstanceOf(BadRequestException);
  });

  it("lô vượt trần ⇒ BadRequest, không ghi gì", async () => {
    const d = db();
    const c = new AnalyticsController(sessions(null), d.service);
    const big = Array.from({ length: MAX_EVENTS_PER_BATCH + 1 }, () => ev());
    await expect(c.ingest(req(), { events: big })).rejects.toBeInstanceOf(BadRequestException);
    expect(d.upserts).toHaveLength(0);
  });

  it("toàn bộ sự kiện đều hỏng ⇒ không chạm database, vẫn trả 200 để client xoá đệm", async () => {
    const d = db();
    const c = new AnalyticsController(sessions(null), d.service);
    const out = await c.ingest(req(), { events: [{ a: 1 }, { b: 2 }] });
    expect(out).toEqual({ accepted: 0, rejected: 2 });
    expect(d.upserts).toHaveLength(0);
  });
});

describe("toRow", () => {
  it("đổi ts (epoch ms) thành occurred_at ISO — đúng khoá phân mảnh của bảng", () => {
    const row = toRow(ev({ ts: 1_700_000_000_000 }), null);
    expect(row.occurred_at).toBe(new Date(1_700_000_000_000).toISOString());
  });
});

describe("BatchRateLimiter", () => {
  it("quá trần trong cửa sổ ⇒ chặn; IP khác KHÔNG bị vạ lây", () => {
    const rl = new BatchRateLimiter(2, 60_000);
    expect(rl.allow("ip-a", 0)).toBe(true);
    expect(rl.allow("ip-a", 1)).toBe(true);
    expect(rl.allow("ip-a", 2)).toBe(false);
    expect(rl.allow("ip-b", 2)).toBe(true);
  });

  it("qua cửa sổ thì hồi lại", () => {
    const rl = new BatchRateLimiter(1, 1000);
    expect(rl.allow("ip", 0)).toBe(true);
    expect(rl.allow("ip", 500)).toBe(false);
    expect(rl.allow("ip", 1_600)).toBe(true);
  });
});
