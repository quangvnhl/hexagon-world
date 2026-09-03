import { describe, expect, it, vi } from "vitest";
import { ForbiddenException, BadRequestException } from "@nestjs/common";
import { CampaignController } from "../src/campaign/campaign.controller";
import type { SessionService } from "../src/auth/session.service";
import type { SupabaseService } from "../src/database/supabase.service";

// L2/L3 — CampaignController đọc cấp từ DB (campaign_levels); unlock bằng isUnlockedIn; thưởng từ DB.

const PLAYER = { id: "player-1", platform: "web" };
function sessions() { return { resolve: vi.fn(async () => PLAYER) } as unknown as SessionService; }

const LEVELS = [
  { id: "c1", sort_order: 1, name: "Khởi đầu", config: {}, powerups: ["head_start"], unlock_requires: null, rewards: { coin: 50, xp: 40, energy: 0 } },
  { id: "c2", sort_order: 2, name: "Cầm cự", config: {}, powerups: [], unlock_requires: "c1", rewards: { coin: 60, xp: 55, energy: 0 } },
];

/** Builder tối giản: select/eq/order trả chính nó; then ⇒ {data: listData}; single ⇒ {data: singleData}. */
function builder(listData: unknown, singleData: unknown = null) {
  const b: Record<string, unknown> = {};
  b.select = () => b; b.eq = () => b; b.order = () => b;
  b.single = async () => ({ data: singleData, error: null });
  b.then = (res: (v: { data: unknown; error: null }) => unknown) => Promise.resolve({ data: listData, error: null }).then(res);
  return b;
}

/** Mock db theo bảng: from(table) → builder tương ứng. */
function db(map: Record<string, { list?: unknown; single?: unknown }>, rpc = vi.fn(async () => ({}))) {
  return { rpc, from: (t: string) => builder(map[t]?.list ?? [], map[t]?.single ?? null) } as unknown as SupabaseService;
}

describe("CampaignController.start", () => {
  it("cấp KHÓA (chưa qua cấp trước) ⇒ ForbiddenException, KHÔNG gọi RPC", async () => {
    const rpc = vi.fn();
    const d = db({ campaign_levels: { list: LEVELS }, player_level_progress: { list: [] } }, rpc);
    const c = new CampaignController(sessions(), d);
    await expect(c.start({} as never, { levelId: "c2", idempotencyKey: "k1" })).rejects.toBeInstanceOf(ForbiddenException);
    expect(rpc).not.toHaveBeenCalled();
  });

  it("cấp MỞ (requires=null) ⇒ gọi start_campaign_level đúng tham số", async () => {
    const rpc = vi.fn(async () => ({ playId: "p1", energy: {} }));
    const d = db({ campaign_levels: { list: LEVELS }, player_level_progress: { list: [] } }, rpc);
    const c = new CampaignController(sessions(), d);
    await c.start({} as never, { levelId: "c1", idempotencyKey: "k1" });
    expect(rpc).toHaveBeenCalledWith("start_campaign_level", { p_player_id: PLAYER.id, p_level_id: "c1", p_idempotency_key: "k1" });
  });

  it("cấp không tồn tại trong DB ⇒ BadRequest", async () => {
    const d = db({ campaign_levels: { list: LEVELS }, player_level_progress: { list: [] } });
    const c = new CampaignController(sessions(), d);
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
    const c = new CampaignController(sessions(), db({}, rpc));
    await expect(c.complete({} as never, { playId: "p1" })).rejects.toBeInstanceOf(BadRequestException);
    expect(rpc).not.toHaveBeenCalled();
  });

  it("KHÔNG cấp thưởng khi mục tiêu chưa đạt, dù client gửi dữ kiện đẹp cho mục tiêu KHÁC", async () => {
    const rpc = vi.fn();
    const d = db({
      campaign_plays: { single: play(30) },
      campaign_levels: { single: LEVEL_TERRITORY },
    }, rpc);
    const c = new CampaignController(sessions(), d);
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
    const c = new CampaignController(sessions(), d);
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
    await expect(new CampaignController(sessions(), early).complete({} as never, {
      playId: "p1", facts: { deaths: 0, territoryPct: 99, totemsCaptured: 0, kingHeldSec: 0 },
    })).rejects.toBeInstanceOf(BadRequestException);
    expect(rpc).not.toHaveBeenCalled();

    // Đã 90 giây ⇒ đạt.
    const late = db({ campaign_plays: { single: play(90) }, campaign_levels: { single: level } }, rpc);
    await new CampaignController(sessions(), late).complete({} as never, {
      playId: "p1", facts: { deaths: 0, territoryPct: 12, totemsCaptured: 0, kingHeldSec: 0 },
    });
    expect(rpc).toHaveBeenCalledTimes(1);
  });

  it("play không thuộc người chơi / không tồn tại ⇒ BadRequest", async () => {
    const rpc = vi.fn();
    const d = db({ campaign_plays: { single: null }, campaign_levels: { single: LEVEL_TERRITORY } }, rpc);
    const c = new CampaignController(sessions(), d);
    await expect(c.complete({} as never, {
      playId: "p1", facts: { deaths: 0, territoryPct: 99, totemsCaptured: 0, kingHeldSec: 0 },
    })).rejects.toBeInstanceOf(BadRequestException);
    expect(rpc).not.toHaveBeenCalled();
  });
});
