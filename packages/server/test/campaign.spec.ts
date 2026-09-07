import { describe, expect, it, vi } from "vitest";
import { ForbiddenException, BadRequestException } from "@nestjs/common";
import {
  COMPLETE_CALLS_PER_MINUTE,
  DAILY_COMPLETIONS_PER_LEVEL,
  MAX_PLAY_SECONDS,
  checkElapsed,
  hexArea,
  maxAttainableSpeed,
  minPlausibleSeconds,
} from "../src/campaign/campaign-sanity";
import { CampaignController } from "../src/campaign/campaign.controller";
import type { SessionService } from "../src/auth/session.service";
import type { SupabaseService } from "../src/database/supabase.service";
import type { ServerAnalyticsService } from "../src/analytics/server-analytics.service";

/** Đo đạc giả (lát a1.4). Ghi lại sự kiện để test khẳng định được, và không bao giờ ném — đúng
 *  hợp đồng của `ServerAnalyticsService`: một phép đo hỏng không được làm hỏng nghiệp vụ. */
function analyticsStub() {
  const events: { name: string; props?: Record<string, unknown> }[] = [];
  const service = {
    emit: async (e: { name: string; props?: Record<string, unknown> }) => { events.push(e); return true; },
    emitMany: async (list: { name: string; props?: Record<string, unknown> }[]) => { events.push(...list); return true; },
  } as unknown as ServerAnalyticsService;
  return { service, events };
}

// L2/L3 — CampaignController đọc cấp từ DB (campaign_levels); unlock bằng isUnlockedIn; thưởng từ DB.

const PLAYER = { id: "player-1", platform: "web" };
function sessions() { return { resolve: vi.fn(async () => PLAYER) } as unknown as SessionService; }

const LEVELS = [
  { id: "c1", sort_order: 1, name: "Khởi đầu", config: {}, powerups: ["head_start"], unlock_requires: null, rewards: { coin: 50, xp: 40, energy: 0 } },
  { id: "c2", sort_order: 2, name: "Cầm cự", config: {}, powerups: [], unlock_requires: "c1", rewards: { coin: 60, xp: 55, energy: 0 } },
];

/**
 * Builder tối giản: select/eq/order/gte/lt trả chính nó; then ⇒ {data: listData};
 * single ⇒ {data: singleData}; `count` phục vụ phép đếm `head: true` của lát a3.2.
 */
function builder(listData: unknown, singleData: unknown = null, count: number | null = null) {
  const b: Record<string, unknown> = {};
  b.select = () => b; b.eq = () => b; b.order = () => b; b.gte = () => b; b.lt = () => b; b.is = () => b;
  b.single = async () => ({ data: singleData, error: null });
  b.maybeSingle = async () => ({ data: singleData, error: null });
  b.then = (res: (v: { data: unknown; error: null; count: number | null }) => unknown) =>
    Promise.resolve({ data: listData, error: null, count }).then(res);
  return b;
}

/** Mock db theo bảng: from(table) → builder tương ứng. */
function db(map: Record<string, { list?: unknown; single?: unknown; count?: number }>, rpc = vi.fn(async () => ({}))) {
  return {
    rpc,
    from: (t: string) => builder(map[t]?.list ?? [], map[t]?.single ?? null, map[t]?.count ?? null),
  } as unknown as SupabaseService;
}

describe("CampaignController.start", () => {
  it("cấp KHÓA (chưa qua cấp trước) ⇒ ForbiddenException, KHÔNG gọi RPC", async () => {
    const rpc = vi.fn();
    const d = db({ campaign_levels: { list: LEVELS }, player_level_progress: { list: [] } }, rpc);
    const c = new CampaignController(sessions(), d, analyticsStub().service);
    await expect(c.start({} as never, { levelId: "c2", idempotencyKey: "k1" })).rejects.toBeInstanceOf(ForbiddenException);
    expect(rpc).not.toHaveBeenCalled();
  });

  it("cấp MỞ (requires=null) ⇒ gọi start_campaign_level đúng tham số", async () => {
    const rpc = vi.fn(async () => ({ playId: "p1", energy: {} }));
    const d = db({ campaign_levels: { list: LEVELS }, player_level_progress: { list: [] } }, rpc);
    const c = new CampaignController(sessions(), d, analyticsStub().service);
    await c.start({} as never, { levelId: "c1", idempotencyKey: "k1" });
    expect(rpc).toHaveBeenCalledWith("start_campaign_level", { p_player_id: PLAYER.id, p_level_id: "c1", p_idempotency_key: "k1" });
  });

  it("cấp không tồn tại trong DB ⇒ BadRequest", async () => {
    const d = db({ campaign_levels: { list: LEVELS }, player_level_progress: { list: [] } });
    const c = new CampaignController(sessions(), d, analyticsStub().service);
    await expect(c.start({} as never, { levelId: "cX", idempotencyKey: "k1" })).rejects.toBeInstanceOf(BadRequestException);
  });
});

// doc 35 §A3 lớp 1 — endpoint KHÔNG còn nhận `objectiveMet`/`stars`/`score` của client.
// Server đo thời gian từ `campaign_plays.created_at` và tự chấm bằng `evaluateCampaignOutcome`.
describe("CampaignController.complete", () => {
  const LEVEL_TERRITORY = { config: { rules: { maxLives: 0 }, win: { kind: "territory_pct", targetPct: 0.3 } }, rewards: { coin: 50, xp: 40, energy: 0 } };

  /** play bắt đầu cách đây `agoSec` giây. */
  function play(agoSec: number) {
    return { id: "p1", level_id: "c1", created_at: new Date(Date.now() - agoSec * 1000).toISOString(), completed_at: null };
  }

  it("thiếu `facts` ⇒ BadRequest, không thưởng (client cũ bị từ chối)", async () => {
    const rpc = vi.fn();
    const c = new CampaignController(sessions(), db({}, rpc), analyticsStub().service);
    await expect(c.complete({} as never, { playId: "p1" })).rejects.toBeInstanceOf(BadRequestException);
    expect(rpc).not.toHaveBeenCalled();
  });

  it("KHÔNG cấp thưởng khi mục tiêu chưa đạt, dù client gửi dữ kiện đẹp cho mục tiêu KHÁC", async () => {
    const rpc = vi.fn();
    const d = db({
      campaign_plays: { single: play(30) },
      campaign_levels: { single: LEVEL_TERRITORY },
    }, rpc);
    const c = new CampaignController(sessions(), d, analyticsStub().service);
    // Cấp yêu cầu 30% lãnh thổ; client mới đạt 10% nhưng khai thu 99 totem + giữ King lâu.
    await expect(c.complete({} as never, {
      playId: "p1",
      facts: { deaths: 0, territoryPct: 10, totemsCaptured: 99, kingHeldSec: 9999 },
    })).rejects.toBeInstanceOf(BadRequestException);
    expect(rpc).not.toHaveBeenCalled();
  });

  it("đạt mục tiêu ⇒ SAO và ĐIỂM do server tự tính, thưởng lấy từ DB", async () => {
    const rpc = vi.fn(async () => ({}));
    const d = db({
      campaign_plays: { single: play(30) },
      campaign_levels: { single: LEVEL_TERRITORY },
    }, rpc);
    const c = new CampaignController(sessions(), d, analyticsStub().service);
    await c.complete({} as never, { playId: "p1", facts: { deaths: 1, territoryPct: 45, totemsCaptured: 0, kingHeldSec: 0 } });
    const call = rpc.mock.calls[0][1] as { p_rewards: unknown; p_stars: number; p_score: number };
    expect(call.p_rewards).toEqual(LEVEL_TERRITORY.rewards);
    expect(call.p_stars).toBe(2); // 1 lần chết ⇒ 2 sao (server suy, không nhận từ client)
    expect(call.p_score).toBe(450); // 45% × 10
  });

  it("objective `survive`: chấm bằng thời gian SERVER đo, không tin client", async () => {
    const level = { config: { rules: { maxLives: 0 }, win: { kind: "survive", durationSec: 60 } }, rewards: { coin: 10, xp: 10, energy: 0 } };
    const rpc = vi.fn(async () => ({}));
    // Mới bắt đầu 5 giây trước ⇒ không thể "sống sót 60s", bất kể client khai gì.
    const early = db({ campaign_plays: { single: play(5) }, campaign_levels: { single: level } }, rpc);
    await expect(new CampaignController(sessions(), early, analyticsStub().service).complete({} as never, {
      playId: "p1", facts: { deaths: 0, territoryPct: 99, totemsCaptured: 0, kingHeldSec: 0 },
    })).rejects.toBeInstanceOf(BadRequestException);
    expect(rpc).not.toHaveBeenCalled();

    // Đã 90 giây ⇒ đạt.
    const late = db({ campaign_plays: { single: play(90) }, campaign_levels: { single: level } }, rpc);
    await new CampaignController(sessions(), late, analyticsStub().service).complete({} as never, {
      playId: "p1", facts: { deaths: 0, territoryPct: 12, totemsCaptured: 0, kingHeldSec: 0 },
    });
    expect(rpc).toHaveBeenCalledTimes(1);
  });

  it("play không thuộc người chơi / không tồn tại ⇒ BadRequest", async () => {
    const rpc = vi.fn();
    const d = db({ campaign_plays: { single: null }, campaign_levels: { single: LEVEL_TERRITORY } }, rpc);
    const c = new CampaignController(sessions(), d, analyticsStub().service);
    await expect(c.complete({} as never, {
      playId: "p1", facts: { deaths: 0, territoryPct: 99, totemsCaptured: 0, kingHeldSec: 0 },
    })).rejects.toBeInstanceOf(BadRequestException);
    expect(rpc).not.toHaveBeenCalled();
  });
});

// ---- Lát a3.2: chặn kết quả PHI LÝ (doc 35 §A3 lớp 2) ----------------------------------------
//
// Lớp 1 (a3.1) đã bỏ việc nhận `stars`/`objectiveMet` từ client, nhưng server vẫn chấm trên dữ kiện
// THÔ do client khai. Lớp này thêm thứ duy nhất client không nói dối được: thời gian, do server đo.
//
// Rủi ro cần canh ở đây KHÔNG chỉ là "để lọt gian lận" mà còn là **từ chối oan** (doc 35 §9 #6):
// người chơi bị chặn nhầm sẽ mất năng lượng mỗi lượt và không bao giờ mở khoá được cấp kế tiếp.

describe("campaign-sanity — phép đo thuần", () => {
  it("hexArea: 0 cho bán kính <= 0, tăng theo bình phương bán kính", () => {
    expect(hexArea(0)).toBe(0);
    expect(hexArea(-5)).toBe(0);
    expect(hexArea(2) / hexArea(1)).toBeCloseTo(4, 6);
  });

  it("tốc độ trần CỘNG toàn bộ bonus totem — cận trên càng rộng càng khó từ chối oan", () => {
    const withTotems = maxAttainableSpeed({ rules: { speed: { min: 5, max: 7 }, totemsEnabled: true } });
    const without = maxAttainableSpeed({ rules: { speed: { min: 5, max: 7 }, totemsEnabled: false } });
    expect(withTotems).toBeGreaterThan(without);
    expect(without).toBeCloseTo(7, 6);
  });

  it("mục tiêu càng lớn ⇒ cận thời gian càng lớn; bản đồ càng rộng ⇒ càng lớn", () => {
    const small = minPlausibleSeconds({ win: { kind: "territory_pct", targetPct: 0.1 } });
    const big = minPlausibleSeconds({ win: { kind: "territory_pct", targetPct: 0.6 } });
    expect(big).toBeGreaterThan(small);
    const wide = minPlausibleSeconds({ map: { radius: 300 }, win: { kind: "territory_pct", targetPct: 0.3 } });
    const narrow = minPlausibleSeconds({ map: { radius: 50 }, win: { kind: "territory_pct", targetPct: 0.3 } });
    expect(wide).toBeGreaterThan(narrow);
  });

  it("đọc mục tiêu GIỐNG HỆT evaluator: thiếu targetPct thì lùi về kingPct", () => {
    // Lệch chỗ này là chặn nhầm ngưỡng — đúng loại lỗi mà chú thích trong `evaluateCampaignOutcome`
    // đã cảnh báo (client tuyên bố thắng còn server từ chối mọi lần nộp).
    const viaTarget = minPlausibleSeconds({ win: { kind: "territory_pct", targetPct: 0.4 } });
    const viaKingPct = minPlausibleSeconds({ win: { kind: "territory_pct", kingPct: 40 } });
    expect(viaTarget).toBeCloseTo(viaKingPct, 6);
  });

  it("không suy ra được cận ⇒ trả 0 và KHÔNG chặn gì", () => {
    expect(minPlausibleSeconds({ win: { kind: "none" } })).toBe(0);
    expect(checkElapsed({ win: { kind: "none" } }, 0).ok).toBe(true);
  });

  it("mốc thời gian hỏng ⇒ KHÔNG chặn (không biết thì không đoán)", () => {
    expect(checkElapsed({ win: { kind: "territory_pct", targetPct: 0.3 } }, Number.NaN).ok).toBe(true);
  });

  it("lượt chơi quá cũ ⇒ chặn với mã riêng, không lẫn với gian lận tốc độ", () => {
    const v = checkElapsed({ win: { kind: "territory_pct", targetPct: 0.3 } }, MAX_PLAY_SECONDS + 1);
    expect(v.ok).toBe(false);
    expect(v.code).toBe("play_too_old");
  });

  it("cận rộng tới mức người chơi THẬT không thể chạm: 30s cho cấp 30% đất vẫn qua", () => {
    // Đây là bài kiểm chống-từ-chối-oan. Nếu một ngày nào đó có người siết hằng số và làm test này
    // đỏ, thì thứ vừa bị siết là chính người chơi thật.
    expect(checkElapsed({ win: { kind: "territory_pct", targetPct: 0.3 } }, 30).ok).toBe(true);
  });
});

describe("CampaignController.complete — lớp chặn phi lý", () => {
  const LEVEL = { config: { rules: { maxLives: 0 }, win: { kind: "territory_pct", targetPct: 0.3 } }, rewards: { coin: 50, xp: 40, energy: 0 } };
  const WIN_FACTS = { deaths: 0, territoryPct: 90, totemsCaptured: 0, kingHeldSec: 0 };
  function play(agoSec: number, completedAt: string | null = null) {
    return { id: "p1", level_id: "c1", created_at: new Date(Date.now() - agoSec * 1000).toISOString(), completed_at: completedAt };
  }

  it("elapsed ~0 mà khai chiếm 90% đất ⇒ TỪ CHỐI, KHÔNG gọi RPC cấp thưởng", async () => {
    // Đây chính là DoD của doc 35 §A3: "request giả objectiveMet=true với elapsed=0 bị từ chối".
    const rpc = vi.fn(async () => ({}));
    const d = db({ campaign_plays: { single: play(0.2) }, campaign_levels: { single: LEVEL } }, rpc);
    const c = new CampaignController(sessions(), d, analyticsStub().service);
    await expect(c.complete({} as never, { playId: "p1", facts: WIN_FACTS })).rejects.toBeInstanceOf(ForbiddenException);
    expect(rpc).not.toHaveBeenCalled();
  });

  it("lỗi trả về mang mã máy đọc được + số liệu để chẩn đoán báo cáo của người chơi thật", async () => {
    const d = db({ campaign_plays: { single: play(0.2) }, campaign_levels: { single: LEVEL } });
    const c = new CampaignController(sessions(), d, analyticsStub().service);
    await expect(c.complete({} as never, { playId: "p1", facts: WIN_FACTS }))
      .rejects.toMatchObject({ response: { code: "completed_too_fast", retryable: false } });
  });

  it("lượt chơi bình thường (30 giây) KHÔNG bị chặn", async () => {
    const rpc = vi.fn(async () => ({}));
    const d = db({ campaign_plays: { single: play(30) }, campaign_levels: { single: LEVEL } }, rpc);
    await new CampaignController(sessions(), d, analyticsStub().service)
      .complete({} as never, { playId: "p1", facts: WIN_FACTS });
    expect(rpc).toHaveBeenCalledTimes(1);
  });

  it("lượt chơi THẤT BẠI thật nhận đúng lý do 'chưa đạt', không phải cáo buộc gian lận", async () => {
    // Thứ tự kiểm quan trọng: evaluator chạy trước lớp chặn. Một người mới sống 5 giây trong cấp
    // cần 60 giây phải được nói "chưa đạt mục tiêu".
    const level = { config: { rules: { maxLives: 0 }, win: { kind: "survive", durationSec: 60 } }, rewards: { coin: 10, xp: 10, energy: 0 } };
    const d = db({ campaign_plays: { single: play(5) }, campaign_levels: { single: level } });
    await expect(new CampaignController(sessions(), d, analyticsStub().service)
      .complete({} as never, { playId: "p1", facts: { deaths: 0, territoryPct: 99, totemsCaptured: 0, kingHeldSec: 0 } }))
      .rejects.toBeInstanceOf(BadRequestException);
  });

  it("chạm trần hoàn thành/ngày ⇒ TỪ CHỐI với retryable=true (mai lại được)", async () => {
    const rpc = vi.fn(async () => ({}));
    const d = db({
      campaign_plays: { single: play(30), count: DAILY_COMPLETIONS_PER_LEVEL },
      campaign_levels: { single: LEVEL },
    }, rpc);
    await expect(new CampaignController(sessions(), d, analyticsStub().service)
      .complete({} as never, { playId: "p1", facts: WIN_FACTS }))
      .rejects.toMatchObject({ response: { code: "daily_level_cap", retryable: true } });
    expect(rpc).not.toHaveBeenCalled();
  });

  it("dưới trần ⇒ vẫn cấp thưởng bình thường", async () => {
    const rpc = vi.fn(async () => ({}));
    const d = db({
      campaign_plays: { single: play(30), count: DAILY_COMPLETIONS_PER_LEVEL - 1 },
      campaign_levels: { single: LEVEL },
    }, rpc);
    await new CampaignController(sessions(), d, analyticsStub().service)
      .complete({} as never, { playId: "p1", facts: WIN_FACTS });
    expect(rpc).toHaveBeenCalledTimes(1);
  });

  it("nộp LẠI lượt đã hoàn thành KHÔNG bị tính vào trần — thử lại sau lỗi mạng không phải hình phạt", async () => {
    const rpc = vi.fn(async () => ({}));
    const d = db({
      // Đã ở trần, nhưng lượt này đã `completed_at` ⇒ RPC vốn idempotent, phải cho qua.
      campaign_plays: { single: play(30, new Date().toISOString()), count: DAILY_COMPLETIONS_PER_LEVEL + 5 },
      campaign_levels: { single: LEVEL },
    }, rpc);
    await new CampaignController(sessions(), d, analyticsStub().service)
      .complete({} as never, { playId: "p1", facts: WIN_FACTS });
    expect(rpc).toHaveBeenCalledTimes(1);
  });

  it("đếm trần HỎNG ⇒ cho qua, KHÔNG chặn — nghiêng về phía người chơi", async () => {
    // Ngược hướng với hạn mức Ops API (ở đó hỏng thì đóng). Chặn nhầm một người vận hành chỉ gây
    // phiền; chặn nhầm người chơi là lấy mất năng lượng và khoá đường mở cấp kế tiếp.
    const rpc = vi.fn(async () => ({}));
    const boom = {
      rpc,
      from: (t: string) => {
        // Dùng đúng builder thật rồi CHỈ làm hỏng `gte` — nhánh mà phép đếm trần đi qua. Tra lượt
        // chơi vẫn chạy bình thường, nên test này cô lập đúng một chỗ hỏng.
        const b = builder([], t === "campaign_plays" ? play(30) : LEVEL) as Record<string, unknown>;
        b.gte = () => { throw new Error("db down"); };
        return b;
      },
    } as unknown as SupabaseService;
    await new CampaignController(sessions(), boom, analyticsStub().service)
      .complete({} as never, { playId: "p1", facts: WIN_FACTS });
    expect(rpc).toHaveBeenCalledTimes(1);
  });

  it("gửi quá nhanh ⇒ rate-limit theo NGƯỜI CHƠI, chặn trước mọi truy vấn database", async () => {
    const from = vi.fn(() => builder([], null));
    const d = { rpc: vi.fn(), from } as unknown as SupabaseService;
    const c = new CampaignController(sessions(), d, analyticsStub().service);
    // Vượt trần trong cùng một phút.
    for (let i = 0; i < COMPLETE_CALLS_PER_MINUTE; i++) {
      await c.complete({} as never, { playId: "p1", facts: WIN_FACTS }).catch(() => undefined);
    }
    const before = from.mock.calls.length;
    await expect(c.complete({} as never, { playId: "p1", facts: WIN_FACTS }))
      .rejects.toMatchObject({ response: { code: "rate_limited", retryable: true } });
    // Không một truy vấn nào được phát thêm: đây là điểm của lớp này.
    expect(from.mock.calls.length).toBe(before);
  });
});
