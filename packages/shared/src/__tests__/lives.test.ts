import { describe, it, expect } from "vitest";
import { GameState } from "../state";
import { applyPowerups, POWERUP_TUNING } from "../campaign";
import { resolveMatchConfig } from "../match-config";

// E2b — mạng phụ + trạng thái `lost` (doc 28 §E2b). maxLives=0 ⇒ vô hạn (bất biến).

describe("GameState maxLives / lost", () => {
  it("maxLives=0 (mặc định): chết nhiều lần vẫn KHÔNG thua (bất biến)", () => {
    const g = new GameState({ config: { bots: { count: 0 } } });
    for (let i = 0; i < 5; i++) g.die();
    g.update(0.001);
    expect(g.lost).toBe(false);
    expect(g.human.deaths).toBe(5);
  });

  it("maxLives=2: chết đủ 2 lần ⇒ lost=true, lostId = chủ thể (self)", () => {
    const g = new GameState({ config: { bots: { count: 0 }, rules: { maxLives: 2 } } });
    g.die();
    g.update(0.001);
    expect(g.lost).toBe(false); // mới 1 mạng
    g.die();
    g.update(0.001);
    expect(g.lost).toBe(true);
    expect(g.lostId).toBe(g.human.id);
  });

  it("đã thua ⇒ update đóng băng + revive/canRevive bị chặn", () => {
    const g = new GameState({ config: { bots: { count: 0 }, rules: { maxLives: 1 } } });
    g.die();
    g.update(0.001);
    expect(g.lost).toBe(true);
    expect(g.canRevive()).toBe(false);
    expect(g.revive()).toBe(false);
  });

  it("restart xoá trạng thái thua", () => {
    const g = new GameState({ config: { bots: { count: 0 }, rules: { maxLives: 1 } } });
    g.die();
    g.update(0.001);
    expect(g.lost).toBe(true);
    g.restart();
    expect(g.lost).toBe(false);
    expect(g.lostId).toBe(-1);
    expect(g.human.deaths).toBe(0);
  });

  it("power-up extra_life cộng 1 mạng vào maxLives của cấp", () => {
    const base = { rules: { maxLives: 3 } };
    const out = resolveMatchConfig(applyPowerups(base, ["extra_life"]));
    expect(out.rules.maxLives).toBe(3 + POWERUP_TUNING.extraLifeBonus);
  });
});
