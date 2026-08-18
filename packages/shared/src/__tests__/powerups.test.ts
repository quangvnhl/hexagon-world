import { describe, it, expect } from "vitest";
import { applyPowerups, POWERUP_TUNING } from "../campaign";
import { resolveMatchConfig, type MatchConfigInput } from "../match-config";
import { CONFIG } from "../config";

// E2 — power-up → modifier khởi tạo (doc 28 §E2). Hàm thuần, không chạm code chết/hồi sinh.

describe("applyPowerups", () => {
  const base: MatchConfigInput = { bots: { count: 6 }, win: { kind: "territory_pct", targetPct: 0.3 } };

  it("không chọn gì ⇒ config resolve TƯƠNG ĐƯƠNG gốc (bất biến)", () => {
    expect(resolveMatchConfig(applyPowerups(base, []))).toEqual(resolveMatchConfig(base));
  });

  it("head_start tăng startRadius đúng bonus", () => {
    const out = resolveMatchConfig(applyPowerups(base, ["head_start"]));
    expect(out.rules.startRadius).toBe(CONFIG.START_RADIUS + POWERUP_TUNING.headStartRadiusBonus);
  });

  it("speed nhân dải tốc độ nền theo factor", () => {
    const out = resolveMatchConfig(applyPowerups(base, ["speed"]));
    expect(out.rules.speed.min).toBeCloseTo(CONFIG.SPEED.BY_KING_PCT.MIN * POWERUP_TUNING.speedFactor);
    expect(out.rules.speed.max).toBeCloseTo(CONFIG.SPEED.BY_KING_PCT.MAX * POWERUP_TUNING.speedFactor);
  });

  it("extra_life cộng 1 mạng vào maxLives (E2b)", () => {
    const withLives: MatchConfigInput = { rules: { maxLives: 3 } };
    const out = resolveMatchConfig(applyPowerups(withLives, ["extra_life"]));
    expect(out.rules.maxLives).toBe(3 + POWERUP_TUNING.extraLifeBonus);
  });

  it("kết hợp head_start + speed áp cả hai, không đụng field khác", () => {
    const out = resolveMatchConfig(applyPowerups(base, ["head_start", "speed"]));
    expect(out.rules.startRadius).toBe(CONFIG.START_RADIUS + POWERUP_TUNING.headStartRadiusBonus);
    expect(out.rules.speed.min).toBeCloseTo(CONFIG.SPEED.BY_KING_PCT.MIN * POWERUP_TUNING.speedFactor);
    expect(out.win.kind).toBe("territory_pct");
    expect(out.bots.count).toBe(6);
  });

  it("không đột biến (mutate) config gốc", () => {
    const snapshot = JSON.stringify(base);
    applyPowerups(base, ["head_start", "speed"]);
    expect(JSON.stringify(base)).toBe(snapshot);
  });
});
