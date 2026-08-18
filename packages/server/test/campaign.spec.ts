import { describe, expect, it, vi } from "vitest";
import { ForbiddenException, BadRequestException } from "@nestjs/common";
import { CAMPAIGN_LEVELS, levelById } from "@hexagon/shared";
import { CampaignController } from "../src/campaign/campaign.controller";
import type { SessionService } from "../src/auth/session.service";
import type { SupabaseService } from "../src/database/supabase.service";

// E4 — CampaignController: unlock kiểm bằng catalog shared; thưởng lấy từ catalog (không tin client).

const PLAYER = { id: "player-1", platform: "web" };
function sessions() { return { resolve: vi.fn(async () => PLAYER) } as unknown as SessionService; }

/** Builder Supabase tối giản: select/eq trả chính nó (thenable ⇒ await ra {data}); single() ⇒ {data}. */
function builder(data: unknown) {
  const b: Record<string, unknown> = {};
  b.select = () => b;
  b.eq = () => b;
  b.single = async () => ({ data, error: null });
  b.then = (res: (v: { data: unknown; error: null }) => unknown) => Promise.resolve({ data, error: null }).then(res);
  return b;
}

describe("CampaignController.start", () => {
  it("cấp KHÓA (chưa qua cấp trước) ⇒ ForbiddenException, KHÔNG gọi RPC", async () => {
    const locked = CAMPAIGN_LEVELS.find((l) => l.unlock.requires !== null)!;
    const rpc = vi.fn();
    const db = { from: () => builder([]), rpc } as unknown as SupabaseService; // progress rỗng
    const c = new CampaignController(sessions(), db);
    await expect(c.start({} as never, { levelId: locked.id, idempotencyKey: "k1" })).rejects.toBeInstanceOf(ForbiddenException);
    expect(rpc).not.toHaveBeenCalled();
  });

  it("cấp MỞ (requires=null) ⇒ gọi start_campaign_level đúng tham số", async () => {
    const first = CAMPAIGN_LEVELS[0];
    const rpc = vi.fn(async () => ({ playId: "p1", energy: {} }));
    const db = { from: () => builder([]), rpc } as unknown as SupabaseService;
    const c = new CampaignController(sessions(), db);
    await c.start({} as never, { levelId: first.id, idempotencyKey: "k1" });
    expect(rpc).toHaveBeenCalledWith("start_campaign_level", {
      p_player_id: PLAYER.id, p_level_id: first.id, p_idempotency_key: "k1",
    });
  });
});

describe("CampaignController.complete", () => {
  it("objectiveMet=false ⇒ BadRequest, không thưởng", async () => {
    const rpc = vi.fn();
    const db = { from: () => builder(null), rpc } as unknown as SupabaseService;
    const c = new CampaignController(sessions(), db);
    await expect(c.complete({} as never, { playId: "p1", objectiveMet: false })).rejects.toBeInstanceOf(BadRequestException);
    expect(rpc).not.toHaveBeenCalled();
  });

  it("thưởng lấy từ CATALOG, bỏ qua số client gửi", async () => {
    const first = CAMPAIGN_LEVELS[0];
    const rpc = vi.fn(async () => ({}));
    const db = { from: () => builder({ id: "p1", level_id: first.id, completed_at: null }), rpc } as unknown as SupabaseService;
    const c = new CampaignController(sessions(), db);
    await c.complete({} as never, { playId: "p1", objectiveMet: true, stars: 99, score: 500 });
    const call = rpc.mock.calls[0][1] as { p_rewards: unknown; p_stars: number };
    expect(call.p_rewards).toEqual(levelById(first.id)!.rewards);
    expect(call.p_stars).toBe(3); // 99 bị kẹp về 3
  });
});
