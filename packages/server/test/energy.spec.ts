import { describe, expect, it, vi } from "vitest";
import { EnergyController } from "../src/energy/energy.controller";
import type { SessionService } from "../src/auth/session.service";
import type { SupabaseService } from "../src/database/supabase.service";

// E3 — EnergyController: mỏng, chỉ resolve player rồi ủy quyền RPC read_energy (server tính hồi lười).

describe("EnergyController", () => {
  it("GET /v1/energy trả trạng thái từ RPC read_energy đúng player", async () => {
    const status = { current: 42, max: 50, regen_interval_seconds: 180, next_at: "2026-08-18T00:03:00Z" };
    const sessions = { resolve: vi.fn(async () => ({ id: "player-1", platform: "web" })) } as unknown as SessionService;
    const rpc = vi.fn(async () => status);
    const db = { rpc } as unknown as SupabaseService;

    const controller = new EnergyController(sessions, db);
    const result = await controller.energy({} as never);

    expect(result).toEqual(status);
    expect(rpc).toHaveBeenCalledWith("read_energy", { p_player_id: "player-1" });
  });
});
