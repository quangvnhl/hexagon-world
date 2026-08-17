import { describe, it, expect } from "vitest";
import { practiceConfig, tournamentConfig, resolveMatchConfig } from "../match-config";
import { CONFIG } from "../config";

// Preset theo MODE (doc 25 §1.1) — S1 (Practice) + S6 (Tournament).

describe("practiceConfig", () => {
  it("mặc định = endless (win.kind none), số bot default", () => {
    const c = resolveMatchConfig(practiceConfig());
    expect(c.win.kind).toBe("none");
    expect(c.bots.count).toBe(CONFIG.BOT_COUNT);
  });

  it("chỉnh được số bot (kể cả 0)", () => {
    expect(resolveMatchConfig(practiceConfig({ botCount: 0 })).bots.count).toBe(0);
    expect(resolveMatchConfig(practiceConfig({ botCount: 7 })).bots.count).toBe(7);
  });
});

describe("tournamentConfig", () => {
  it("mặc định = king_hold, winHoldTime default", () => {
    const c = resolveMatchConfig(tournamentConfig());
    expect(c.win.kind).toBe("king_hold");
    expect(c.win.winHoldTime).toBe(CONFIG.WIN_HOLD_TIME);
  });

  it("nhận winHoldTime + số bot tuỳ biến", () => {
    const c = resolveMatchConfig(tournamentConfig({ botCount: 5, winHoldTime: 42 }));
    expect(c.win.kind).toBe("king_hold");
    expect(c.win.winHoldTime).toBe(42);
    expect(c.bots.count).toBe(5);
  });
});
