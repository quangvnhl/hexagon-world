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

describe("CampaignController.complete", () => {
  it("objectiveMet=false ⇒ BadRequest, không thưởng", async () => {
    const rpc = vi.fn();
    const d = db({}, rpc);
    const c = new CampaignController(sessions(), d);
    await expect(c.complete({} as never, { playId: "p1", objectiveMet: false })).rejects.toBeInstanceOf(BadRequestException);
    expect(rpc).not.toHaveBeenCalled();
  });

  it("thưởng lấy từ DB cấp, kẹp sao về 3", async () => {
    const rpc = vi.fn(async () => ({}));
    const rewards = { coin: 50, xp: 40, energy: 0 };
    const d = db({
      campaign_plays: { single: { id: "p1", level_id: "c1", completed_at: null } },
      campaign_levels: { single: { rewards } },
    }, rpc);
    const c = new CampaignController(sessions(), d);
    await c.complete({} as never, { playId: "p1", objectiveMet: true, stars: 99, score: 500 });
    const call = rpc.mock.calls[0][1] as { p_rewards: unknown; p_stars: number };
    expect(call.p_rewards).toEqual(rewards);
    expect(call.p_stars).toBe(3);
  });
});
