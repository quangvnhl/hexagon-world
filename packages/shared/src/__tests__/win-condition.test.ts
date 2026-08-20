import { describe, expect, it } from "vitest";
import { GameState } from "../state";

// S3 (.implements/27-phase1-modes-impl.md): cắm 3 evaluator WinCondition vào checkWin.
// Chủ thể đánh giá = NGƯỜI chơi (entity 0). Mỗi kind: 1 ca ĐẠT + 1 ca CHƯA ĐẠT, bơm trạng
// thái trực tiếp (deterministic, không phụ thuộc mô phỏng ngẫu nhiên).

describe("WinCondition: territory_pct", () => {
  it("ĐẠT: chủ thể nắm ≥ targetPct ⇒ won", () => {
    const g = new GameState({
      // targetPct là PHÂN SỐ 0–1 → 0.10 = 10%.
      config: { win: { kind: "territory_pct", targetPct: 0.10 }, bots: { count: 0 } },
    });
    const cells = [...g.playable];
    g.owned = new Set(cells.slice(0, Math.ceil(cells.length * 0.12))); // ~12% ≥ 10%
    g.update(1 / 24);
    expect(g.won).toBe(true);
    expect(g.winnerId).toBe(0);
  });

  it("CHƯA ĐẠT: dưới targetPct ⇒ không won", () => {
    const g = new GameState({
      config: { win: { kind: "territory_pct", targetPct: 0.50 }, bots: { count: 0 } }, // 50%
    });
    const cells = [...g.playable];
    g.owned = new Set(cells.slice(0, Math.floor(cells.length * 0.10))); // ~10% < 50%
    g.update(1 / 24);
    expect(g.won).toBe(false);
  });
});

describe("WinCondition: survive", () => {
  it("ĐẠT: hết durationSec mà chủ thể còn sống ⇒ won", () => {
    const g = new GameState({
      config: { win: { kind: "survive", durationSec: 1 }, bots: { count: 0 } },
    });
    // prepTime mặc định 3s > 1s ⇒ chủ thể vẫn trong prep (còn sống) khi hết giờ.
    for (let i = 0; i < 30; i++) g.update(1 / 24); // ~1.25s > 1s
    expect(g.won).toBe(true);
    expect(g.winnerId).toBe(0);
  });

  it("CHƯA ĐẠT: còn đang đếm ngược ⇒ không won", () => {
    const g = new GameState({
      config: { win: { kind: "survive", durationSec: 5 }, bots: { count: 0 } },
    });
    g.update(0.5);
    expect(g.won).toBe(false);
  });

  it("KHÔNG ĐẠT: chủ thể đã chết khi hết giờ ⇒ không won", () => {
    const g = new GameState({
      config: { win: { kind: "survive", durationSec: 1 }, bots: { count: 0 } },
    });
    g.die(); // người chơi chết, không tự hồi sinh
    for (let i = 0; i < 30; i++) g.update(1 / 24);
    expect(g.won).toBe(false);
  });
});

describe("WinCondition: capture_totems", () => {
  it("ĐẠT: chủ thể thu ≥ totemGoal Totem ⇒ won", () => {
    const g = new GameState({
      config: { win: { kind: "capture_totems", totemGoal: 2 }, bots: { count: 0 } },
    });
    const totems = g.totemStates().slice(0, 2);
    g.applyTerritory(totems.map((t) => ({ q: t.q, r: t.r, owner: 0, kind: 0 })));
    g.update(1 / 24);
    expect(g.players[0].totemsCaptured).toBeGreaterThanOrEqual(2);
    expect(g.won).toBe(true);
    expect(g.winnerId).toBe(0);
  });

  it("CHƯA ĐẠT: thu ít hơn totemGoal ⇒ không won", () => {
    const g = new GameState({
      config: { win: { kind: "capture_totems", totemGoal: 5 }, bots: { count: 0 } },
    });
    const totems = g.totemStates().slice(0, 2);
    g.applyTerritory(totems.map((t) => ({ q: t.q, r: t.r, owner: 0, kind: 0 })));
    g.update(1 / 24);
    expect(g.players[0].totemsCaptured).toBe(2);
    expect(g.won).toBe(false);
  });
});

describe("King gate (doc 34 A)", () => {
  it("kingEnabled=false ⇒ KHÔNG lên King dù đủ %, roomLocked=false", () => {
    const g = new GameState({
      config: { win: { kind: "territory_pct", targetPct: 0.9 }, rules: { kingEnabled: false }, bots: { count: 0 } },
    });
    const cells = [...g.playable];
    g.owned = new Set(cells.slice(0, Math.ceil(cells.length * 0.5))); // 50% ≫ kingPct 20%
    expect(g.isKing).toBe(false);
    expect(g.kingId()).toBe(-1);
    expect(g.roomLocked()).toBe(false);
  });

  it("kingEnabled mặc định (true) ⇒ đủ % thì lên King", () => {
    const g = new GameState({ config: { win: { kind: "king_hold", kingPct: 20 }, bots: { count: 0 } } });
    const cells = [...g.playable];
    g.owned = new Set(cells.slice(0, Math.ceil(cells.length * 0.3))); // ~30% ≥ 20%
    expect(g.isKing).toBe(true);
  });
});
