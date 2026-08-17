import { describe, it, expect } from "vitest";
import { GameState } from "../state";
import { CONFIG } from "../config";

// S1 (.implements/27-phase1-modes-impl.md): mode Luyện tập = win.kind "none" (endless) +
// số bot chỉnh được (kể cả 0). Test này chỉ phủ 2 trục an toàn của S1, KHÔNG đụng logic
// checkWin/resolveMatchConfig có sẵn (đã hỗ trợ "none" từ P0).

describe("GameState: Practice preset (win.kind = \"none\")", () => {
  it("bots.count = 0 ⇒ chỉ còn ghế người (players.length === humanCount)", () => {
    const g = new GameState({ config: { win: { kind: "none" }, bots: { count: 0 } } });
    expect(g.players.length).toBe(g.humanCount);
    expect(g.players.length).toBe(1);
  });

  it("chạy quá CONFIG.WIN_HOLD_TIME giây ⇒ không bao giờ set won", () => {
    const g = new GameState({ config: { win: { kind: "none" }, bots: { count: 0 } } });
    g.update(CONFIG.WIN_HOLD_TIME + 10);
    expect(g.won).toBe(false);
  });
});
