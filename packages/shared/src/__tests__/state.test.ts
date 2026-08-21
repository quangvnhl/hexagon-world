import { describe, it, expect } from "vitest";
import { GameState } from "../state";
import { CONFIG } from "../config";
import { axialToPixel, pixelToAxial, key, parseKey } from "../hex";
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

describe("GameState: ô chướng ngại KHÔNG còn collider di chuyển (doc 34)", () => {
  it("đâm thẳng vào obstacle → ĐI XUYÊN (chỉ còn barrier flood-fill, không chặn di chuyển)", () => {
    // Obstacle ngay bên phải; người chơi lao thẳng sang phải. Không còn collider ô ⇒ đi qua được.
    const g = new GameState({ spawnAt: { q: 0, r: 0 }, config: { bots: { count: 0 }, map: { obstacles: [key(3, 0)] } } });
    skipPrep(g);
    const e = g.players[0];
    e.phase = "playing";
    e.targetHeading = 0; e.heading = 0; // sang phải, thẳng vào obstacle
    let everInside = false;
    for (let i = 0; i < 200; i++) {
      g.update(1 / 60);
      const hex = pixelToAxial(e.pos.x, e.pos.y, CONFIG.HEX_SIZE);
      if (key(hex.q, hex.r) === key(3, 0)) everInside = true;
    }
    expect(everInside).toBe(true); // đi qua ô obstacle được (collider ô đã gỡ)
  });
});

describe("GameState: bot đồng minh + cứ điểm (doc 34 B)", () => {
  it("bot đồng minh CHỒNG ô nhau KHÔNG chết", () => {
    const g = new GameState({ humanCount: 1, config: { bots: { count: 2 }, rules: { botsAllied: true }, win: { kind: "none" } } });
    const b1 = g.players[1], b2 = g.players[2];
    const p = axialToPixel({ q: 5, r: 0 }, CONFIG.HEX_SIZE);
    for (const b of [b1, b2]) { b.phase = "playing"; b.pos = { ...p }; b.currentHex = { q: 5, r: 0 }; }
    g.update(0);
    expect(b1.phase).toBe("playing");
    expect(b2.phase).toBe("playing");
  });

  it("cứ điểm: tổng bot = Σ botCount (bỏ bots.count)", () => {
    const g = new GameState({ config: { bots: { count: 99 }, win: { kind: "none" }, map: { strongholds: [{ q: 6, r: 0, botCount: 2 }, { q: -6, r: 0, botCount: 1 }] } } });
    expect(g.players.filter((e) => e.isBot).length).toBe(3);
    expect(g.players[1].strongholdIndex).toBe(0);
    expect(g.players[3].strongholdIndex).toBe(1);
  });

  it("chiếm ô cứ điểm ⇒ captured + bot của nó ngừng hồi sinh", () => {
    const g = new GameState({ config: { bots: { count: 0 }, win: { kind: "none" }, map: { strongholds: [{ q: 6, r: 0, botCount: 2 }] } } });
    const bot = g.players[1];
    g.applyTerritory([{ q: 6, r: 0, owner: 0, kind: 0 }]);
    g.update(0);
    expect(g.capturedStrongholds.has(0)).toBe(true);
    // botCanRespawn (gián tiếp): kill bot rồi chạy quá RESPAWN_DELAY → vẫn dead.
    g.kill(bot);
    for (let i = 0; i < Math.ceil((CONFIG.BOT.RESPAWN_DELAY + 1) * 60); i++) g.update(1 / 60);
    expect(bot.phase).toBe("dead");
  });
});

describe("GameState: tường BIÊN admin vẽ (doc 34 D)", () => {
  it("đâm thẳng vào biên dọc x=3 → KHÔNG băng qua", () => {
    const g = new GameState({ spawnAt: { q: 0, r: 0 }, config: { bots: { count: 0 }, map: { boundaries: [{ id: "w", points: [[3, -5], [3, 5]] }] } } });
    skipPrep(g);
    const e = g.players[0];
    e.phase = "playing"; e.targetHeading = 0; e.heading = 0;
    let crossed = false;
    for (let i = 0; i < 300; i++) { g.update(1 / 60); if (e.pos.x >= 3) crossed = true; }
    expect(crossed).toBe(false); // dừng trước tường, không xuyên qua
  });
});

describe("GameState: Bot đồng đội — giết bot không chiếm đất (doc 34)", () => {
  it("giết bot đồng đội ⇒ đất KHÔNG về người chơi (về đồng đội), b.owned rỗng", () => {
    const g = new GameState({ humanCount: 1, config: { bots: { count: 2 }, rules: { botsAllied: true }, win: { kind: "none" } } });
    const human = g.players[0], b1 = g.players[1];
    const cells = [...b1.owned];
    expect(cells.length).toBeGreaterThan(0);
    g.kill(b1, human, "cut");
    for (const k of cells) expect(g.cellOwnerId(k)).not.toBe(human.id); // KHÔNG về người chơi
    expect(b1.owned.size).toBe(0);
  });

  it("sameTeam: bot↔bot cùng đội khi botsAllied; người chơi khác đội", () => {
    const g = new GameState({ config: { bots: { count: 2 }, rules: { botsAllied: true } } });
    expect(g.sameTeam(1, 2)).toBe(true);
    expect(g.sameTeam(0, 1)).toBe(false);
    const g2 = new GameState({ config: { bots: { count: 2 }, rules: { botsAllied: false } } });
    expect(g2.sameTeam(1, 2)).toBe(false);
  });
});

describe("GameState: Campaign THUA khi hết chỗ hồi sinh (doc)", () => {
  it("bản đồ bị chiếm hết ⇒ người chơi chết + không còn ô hồi sinh ⇒ lost", () => {
    const g = new GameState({ config: { bots: { count: 1 }, rules: { maxLives: 3 }, map: { radius: 10 }, win: { kind: "none" } } });
    // Chiếm TOÀN BỘ playable bằng bot (id 1) → không còn ô trống hợp lệ để hồi sinh.
    g.applyTerritory([...g.playable].map((k) => { const { q, r } = parseKey(k); return { q, r, owner: 1, kind: 0 as const }; }));
    g.die();          // người chơi chết (không còn đất riêng để giải phóng)
    g.update(0);
    expect(g.lost).toBe(true);
    expect(g.lostId).toBe(0);
    expect(g.lostReason).toBe("no_space"); // lý do RIÊNG (không phải "hết mạng")
  });

  it("hết mạng bình thường ⇒ lostReason = 'lives'", () => {
    const g = new GameState({ spawnAt: { q: 0, r: 0 }, config: { bots: { count: 0 }, rules: { maxLives: 1 }, win: { kind: "none" } } });
    g.die();          // chết lần 1 = hết mạng (maxLives 1)
    g.update(0);
    expect(g.lost).toBe(true);
    expect(g.lostReason).toBe("lives");
  });
});

describe("GameState: doc 34 hoàn thiện (cứ điểm động + totem/thống kê theo đội)", () => {
  it("cứ điểm bị chiếm rồi ĐỘI BOT chiếm lại ⇒ bỏ captured (bot hồi sinh trở lại)", () => {
    const g = new GameState({ config: { bots: { count: 0 }, win: { kind: "none" }, map: { strongholds: [{ q: 6, r: 0, botCount: 1 }] } } });
    g.applyTerritory([{ q: 6, r: 0, owner: 0, kind: 0 }]); // người chơi chiếm ô cứ điểm
    g.update(0);
    expect(g.capturedStrongholds.has(0)).toBe(true);
    g.applyTerritory([{ q: 6, r: 0, owner: 1, kind: 0 }]); // đội bot (id 1) chiếm LẠI
    g.update(0);
    expect(g.capturedStrongholds.has(0)).toBe(false);
  });

  it("cấp độ có cứ điểm: bot VẪN hồi sinh dù phòng có KING (không bị khoá)", () => {
    const g = new GameState({ config: { bots: { count: 0 }, rules: { kingEnabled: true }, win: { kind: "none", kingPct: 1 }, map: { radius: 8, strongholds: [{ q: 4, r: 0, botCount: 1 }] } } });
    const bot = g.players[1];
    expect(g.roomLocked()).toBe(true);   // người chơi/bot vượt kingPct=1 ⇒ có KING
    expect(bot.strongholdIndex).toBe(0);
    expect(g.playable.has("4,0")).toBe(true); // ô cứ điểm hợp lệ ⇒ strongholdSpawnHex trả về nó
    g.kill(bot);
    for (let i = 0; i < Math.ceil((CONFIG.BOT.RESPAWN_DELAY + 1) * 60); i++) g.update(1 / 60);
    expect(bot.alive).toBe(true);        // hồi sinh dù roomLocked (vì có cứ điểm)
  });

  it("totem tốc độ của MỘT bot đồng đội áp cho CẢ ĐỘI (không cho người chơi)", () => {
    const g = new GameState({ humanCount: 1, config: { bots: { count: 2 }, rules: { botsAllied: true }, win: { kind: "none" }, map: { totems: [{ kind: "speed", q: 0, r: 0 }] } } });
    g.applyTerritory([{ q: 0, r: 0, owner: 1, kind: 0 }]); // bot id1 sở hữu ô totem
    expect(g.speedTotemCountFor(1)).toBe(1);
    expect(g.speedTotemCountFor(2)).toBe(1); // đồng đội cũng được cộng
    expect(g.speedTotemCountFor(0)).toBe(0); // người chơi khác đội → không
  });

  it("scores GỘP bot đồng đội thành MỘT dòng, pct = tổng diện tích đội", () => {
    const g = new GameState({ humanCount: 1, config: { bots: { count: 3 }, rules: { botsAllied: true }, win: { kind: "none" } } });
    const s = g.scores();
    expect(s.length).toBe(2); // 1 người chơi + 1 đội bot
    const botRow = s.find((r) => r.name === "Đội Bot");
    expect(botRow).toBeTruthy();
    let sum = 0;
    for (const e of g.players) if (e.isBot) sum += g.pctOf(e.id);
    expect(botRow!.pct).toBeCloseTo(sum, 5);
  });
});
