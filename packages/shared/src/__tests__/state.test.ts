import { describe, it, expect } from "vitest";
import { GameState } from "../state";
import { CONFIG } from "../config";
import { axialToPixel, key } from "../hex";
import { insideArena } from "../arena";

/** Cho game qua hết pha chuẩn bị (đứng yên 3s) để bắt đầu di chuyển. */
function skipPrep(g: GameState) {
  const steps = Math.ceil(CONFIG.PREP_TIME / (1 / 60)) + 2;
  for (let i = 0; i < steps; i++) g.update(1 / 60);
}

/** Đưa đầu người chơi tới tâm ô (q,r) qua API di chuyển liên tục.
 *  Dùng CONFIG.HEX_SIZE để đầu rơi ĐÚNG ô (q,r) bất kể kích thước hex. */
function go(g: GameState, q: number, r: number) {
  const p = axialToPixel({ q, r }, CONFIG.HEX_SIZE);
  g.moveTo(p.x, p.y);
}

describe("GameState: đi vòng khép kín → chiếm đất", () => {
  it("khép vòng quanh (1,0) → owned = 7, không chết, đuôi đã dọn", () => {
    const g = new GameState({ q: 0, r: 0 }, 0);
    g.owned = new Set([key(0, 0)]);
    for (const [q, r] of [
      [1, -1],
      [2, -1],
      [2, 0],
      [1, 1],
      [0, 1],
      [0, 0],
    ] as const) {
      go(g, q, r);
    }
    expect(g.deaths).toBe(0);
    expect(g.trailHexes.length).toBe(0);
    expect(g.trailPoints.length).toBe(0);
    expect(g.owned.has(key(1, 0))).toBe(true);
    expect(g.owned.size).toBe(7);
  });
});

describe("GameState: tự cắt đuôi → chết, rồi hồi sinh", () => {
  it("đâm vào đuôi của mình → chết, mất hết đất", () => {
    const g = new GameState({ q: 0, r: 0 }, 0);
    g.owned = new Set([key(0, 0)]);
    const before = g.deaths;
    for (const [q, r] of [
      [1, 0],
      [2, 0],
      [3, 0],
      [3, -1],
      [2, 0], // (2,0) đang là đuôi → cắt vào chính mình
    ] as const) {
      go(g, q, r);
    }
    expect(g.deaths).toBe(before + 1);
    expect(g.phase).toBe("dead");
    expect(g.owned.size).toBe(0);
    expect(g.trailHexes.length).toBe(0);
  });

  it("revive() → cụm 7 ô, vào lại pha chuẩn bị", () => {
    const g = new GameState({ q: 0, r: 0 }, 0);
    g.owned = new Set([key(0, 0)]);
    for (const [q, r] of [
      [1, 0],
      [2, 0],
      [3, 0],
      [3, -1],
      [2, 0],
    ] as const) {
      go(g, q, r);
    }
    expect(g.phase).toBe("dead");
    g.revive();
    expect(g.owned.size).toBe(7);
    expect(g.phase).toBe("prep");
  });
});

describe("GameState: chạm biên LỤC GIÁC → trượt mượt, không lọt/đứng", () => {
  it("tới sát biên khi còn sống rồi trượt dọc biên, không lọt ra ngoài", () => {
    const g = new GameState({ q: 0, r: 0 }, 0);
    g.setHeadingTarget(0.3); // chếch lên phải → ép vào 1 cạnh rồi trượt dọc cạnh
    skipPrep(g);

    let reached = false;
    for (let i = 0; i < 1500 && !reached; i++) {
      g.update(1 / 60);
      if (g.phase === "playing" && !insideArena(g.pos.x, g.pos.y, -0.8)) {
        reached = true;
      }
    }
    expect(reached).toBe(true);

    let movedTotal = 0;
    let insideOK = true;
    for (let j = 0; j < 20 && g.phase === "playing"; j++) {
      const a = { x: g.pos.x, y: g.pos.y };
      g.update(1 / 60);
      movedTotal += Math.hypot(g.pos.x - a.x, g.pos.y - a.y);
      if (!insideArena(g.pos.x, g.pos.y, 1e-6)) insideOK = false;
    }
    expect(movedTotal).toBeGreaterThan(0.05); // vẫn trượt, không đứng yên
    expect(insideOK).toBe(true); // không lọt ra ngoài lục giác
  });
});

describe("GameState: pha chuẩn bị đứng yên nhưng xoay được", () => {
  it("prep = đứng yên, chỉ xoay hướng; hết giờ → playing", () => {
    const g = new GameState({ q: 0, r: 0 }, 0);
    const p0 = { x: g.pos.x, y: g.pos.y };
    g.setHeadingTarget(1.2);
    for (let i = 0; i < 30; i++) g.update(1 / 60); // 0.5s trong pha prep

    expect(g.phase).toBe("prep");
    expect(Math.hypot(g.pos.x - p0.x, g.pos.y - p0.y)).toBeLessThan(1e-9);
    expect(Math.abs(g.heading)).toBeGreaterThan(0.05); // đã xoay

    skipPrep(g);
    expect(g.phase).toBe("playing");
  });
});

describe("GameState: bots khởi tạo & hoạt động (đa thực thể)", () => {
  it("3 bot → tổng 4 thực thể, mỗi thực thể 7 ô lúc đầu", () => {
    const g = new GameState(undefined, 3);
    expect(g.players.length).toBe(4);
    expect(g.players[0].isBot).toBe(false);
    expect(g.players.slice(1).every((e) => e.isBot)).toBe(true);
    expect(g.players.every((e) => e.owned.size === 7)).toBe(true);
    expect(g.scores().length).toBe(4);
  });

  it("qua ~600 frame → bot có hoạt động và mọi thực thể vẫn trong sân", () => {
    const g = new GameState(undefined, 3);
    const before = g.players.map((e) => ({ x: e.pos.x, y: e.pos.y }));
    for (let i = 0; i < 600; i++) g.update(1 / 60); // ~10s: qua prep + chơi

    const active = g.players
      .slice(1)
      .some(
        (e, idx) =>
          Math.hypot(
            e.pos.x - before[idx + 1].x,
            e.pos.y - before[idx + 1].y
          ) > 1 || e.deaths > 0
      );
    expect(active).toBe(true);
    expect(g.players.every((e) => insideArena(e.pos.x, e.pos.y, 1e-3))).toBe(
      true
    );
  });
});
