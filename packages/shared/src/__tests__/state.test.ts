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
    const g = new GameState({ spawnAt: { q: 0, r: 0 }, config: { bots: { count: 0 } } });
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
    const g = new GameState({ spawnAt: { q: 0, r: 0 }, config: { bots: { count: 0 } } });
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
    const g = new GameState({ spawnAt: { q: 0, r: 0 }, config: { bots: { count: 0 } } });
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
    const g = new GameState({ spawnAt: { q: 0, r: 0 }, config: { bots: { count: 0 } } });
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

  it("trượt dọc biên giữ TỐC ĐỘ đầy đủ (không bị chậm/kẹt khi men theo tường)", () => {
    const g = new GameState({ spawnAt: { q: 0, r: 0 }, config: { bots: { count: 0 } } });
    g.setHeadingTarget(0.35); // đâm chếch vào cạnh rồi trượt dọc
    skipPrep(g);
    // Chạy tới khi áp sát biên.
    for (let i = 0; i < 1500 && insideArena(g.pos.x, g.pos.y, -0.8); i++) {
      g.update(1 / 60);
    }
    // 30 frame trượt dọc biên: quãng đường/ frame gần bằng SPEED/60 (đầy đủ), không crawl.
    const full = g.effectiveSpeedFor(0) / 60;
    let moved = 0;
    let frames = 0;
    for (let j = 0; j < 30 && g.phase === "playing"; j++) {
      const a = { x: g.pos.x, y: g.pos.y };
      g.update(1 / 60);
      moved += Math.hypot(g.pos.x - a.x, g.pos.y - a.y);
      frames++;
    }
    // Trung bình ≥ 70% tốc độ tối đa → đang trượt full-speed dọc tường, không bị ghìm.
    expect(moved / frames).toBeGreaterThan(0.7 * full);
  });
});

describe("GameState: pha chuẩn bị đứng yên nhưng xoay được", () => {
  it("prep = đứng yên, chỉ xoay hướng; hết giờ → playing", () => {
    const g = new GameState({ spawnAt: { q: 0, r: 0 }, config: { bots: { count: 0 } } });
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
    const g = new GameState({ config: { bots: { count: 3 } } });
    expect(g.players.length).toBe(4);
    expect(g.players[0].isBot).toBe(false);
    expect(g.players.slice(1).every((e) => e.isBot)).toBe(true);
    expect(g.players.every((e) => e.owned.size === 7)).toBe(true);
    expect(g.scores().length).toBe(4);
  });

  it("qua ~600 frame → bot có hoạt động và mọi thực thể vẫn trong sân", () => {
    const g = new GameState({ config: { bots: { count: 3 } } });
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

describe("GameState: neutral head collisions", () => {
  it("kills players in the same neutral hex even when farther apart than KILL_RADIUS", () => {
    const g = new GameState({ humanCount: 2, config: { bots: { count: 0 } } });
    g.applyTerritory([
      { q: -10, r: 0, owner: 0, kind: 0 },
      { q: 10, r: 0, owner: 1, kind: 0 },
    ]);
    const [a, b] = g.players;
    a.phase = "playing";
    b.phase = "playing";
    a.pos = { x: -0.6, y: 0 };
    b.pos = { x: 0.6, y: 0 };
    a.currentHex = { q: 0, r: 0 };
    b.currentHex = { q: 0, r: 0 };
    expect(Math.hypot(a.pos.x - b.pos.x, a.pos.y - b.pos.y)).toBeGreaterThan(
      CONFIG.KILL_RADIUS
    );

    g.update(0);

    expect(a.phase).toBe("dead");
    expect(b.phase).toBe("dead");
    expect(a.deathCause).toBe("headMutual");
    expect(b.deathCause).toBe("headMutual");
  });

  it("does not use physical distance for heads in different neutral hexes", () => {
    const g = new GameState({ humanCount: 2, config: { bots: { count: 0 } } });
    g.applyTerritory([
      { q: -10, r: 0, owner: 0, kind: 0 },
      { q: 10, r: 0, owner: 1, kind: 0 },
    ]);
    const [a, b] = g.players;
    a.phase = "playing";
    b.phase = "playing";
    // Hai điểm nằm sát hai phía của ranh giới q=0/q=1, gần hơn KILL_RADIUS.
    a.pos = { x: 0.86, y: 0 };
    b.pos = { x: 0.87, y: 0 };
    a.currentHex = { q: 0, r: 0 };
    b.currentHex = { q: 1, r: 0 };
    expect(Math.hypot(a.pos.x - b.pos.x, a.pos.y - b.pos.y)).toBeLessThan(
      CONFIG.KILL_RADIUS
    );

    g.update(0);

    expect(a.phase).toBe("playing");
    expect(b.phase).toBe("playing");
  });

  it("kills both players before either one can be treated as a trail cutter", () => {
    const g = new GameState({ humanCount: 2, config: { bots: { count: 0 } } });
    const neutral = { q: 0, r: 0 };
    const neutralPoint = axialToPixel(neutral, CONFIG.HEX_SIZE);
    const approach = { q: 1, r: 0 };
    const approachPoint = axialToPixel(approach, CONFIG.HEX_SIZE);

    g.applyTerritory([
      { q: -10, r: 0, owner: 0, kind: 0 },
      { q: 10, r: 0, owner: 1, kind: 0 },
      { ...neutral, owner: 0, kind: 1 },
    ]);
    const [a, b] = g.players;
    a.phase = "playing";
    a.pos = { ...neutralPoint };
    a.currentHex = neutral;
    b.phase = "playing";
    b.pos = { ...approachPoint };
    b.currentHex = approach;

    (g as unknown as { stepEntity(e: typeof b, x: number, y: number): void })
      .stepEntity(b, neutralPoint.x, neutralPoint.y);

    expect(a.phase).toBe("dead");
    expect(b.phase).toBe("dead");
    expect(a.deathCause).toBe("headMutual");
    expect(b.deathCause).toBe("headMutual");
    expect(a.killerId).toBe(-1);
    expect(b.killerId).toBe(-1);
    expect(a.owned.size).toBe(0);
    expect(b.owned.size).toBe(0);
    expect(g.territoryCells()).toHaveLength(0);
  });

  it("kills every player in a three-player neutral collision group", () => {
    const g = new GameState({ humanCount: 3, config: { bots: { count: 0 } } });
    const neutralPoint = axialToPixel({ q: 0, r: 0 }, CONFIG.HEX_SIZE);
    g.applyTerritory([
      { q: -10, r: 0, owner: 0, kind: 0 },
      { q: 10, r: 0, owner: 1, kind: 0 },
      { q: 0, r: 10, owner: 2, kind: 0 },
    ]);
    for (const e of g.players) {
      e.phase = "playing";
      e.pos = { ...neutralPoint };
      e.currentHex = { q: 0, r: 0 };
    }

    g.update(0);

    expect(g.players.every((e) => e.phase === "dead")).toBe(true);
    expect(g.players.every((e) => e.deathCause === "headMutual")).toBe(true);
    expect(g.players.every((e) => e.owned.size === 0)).toBe(true);
    expect(g.territoryCells()).toHaveLength(0);
  });
});

describe("GameState: totem tác giả (map.totems — doc 32)", () => {
  it("dùng ĐÚNG totem tác giả, bỏ sinh ngẫu nhiên", () => {
    const g = new GameState({
      config: { bots: { count: 0 }, map: { totems: [
        { kind: "speed", q: 1, r: 0 },
        { kind: "slow", q: 0, r: 1 },
        { kind: "radar", q: -1, r: 0 },
      ] } },
    });
    const totems = g.totemStates();
    expect(totems).toHaveLength(3);
    expect(totems.map((t) => t.kind).sort()).toEqual(["radar", "slow", "speed"]);
    expect(totems.every((t) => t.ownerId === -1)).toBe(true);
    const at = (q: number, r: number) => totems.find((t) => t.q === q && t.r === r);
    expect(at(1, 0)?.kind).toBe("speed");
    expect(at(0, 1)?.kind).toBe("slow");
  });

  it("bỏ totem trùng ô và ô ngoài sân", () => {
    const g = new GameState({
      config: { bots: { count: 0 }, map: { radius: 10, totems: [
        { kind: "speed", q: 0, r: 0 },
        { kind: "slow", q: 0, r: 0 },       // trùng ô → bỏ
        { kind: "radar", q: 9999, r: 9999 }, // ngoài sân → bỏ
      ] } },
    });
    expect(g.totemStates()).toHaveLength(1);
  });

  it("vắng map.totems ⇒ giữ sinh ngẫu nhiên (bất biến)", () => {
    const withTotems = new GameState({ config: { bots: { count: 0 } } }).totemStates().length;
    expect(withTotems).toBeGreaterThan(0);
  });
});
