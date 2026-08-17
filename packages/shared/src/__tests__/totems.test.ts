import { describe, expect, it } from "vitest";
import { CONFIG } from "../config";
import { axialToPixel, keyOf } from "../hex";
import { GameState } from "../state";
import {
  baseSpeedForPct,
  createTotems,
  effectiveSpeedWithTotems,
} from "../totems";

describe("speed curve", () => {
  it("clamp MIN/MAX và nội suy theo phần trăm King", () => {
    const { MIN, MAX } = CONFIG.SPEED.BY_KING_PCT;
    expect(baseSpeedForPct(-10)).toBe(MIN);
    expect(baseSpeedForPct(0)).toBe(MIN);
    expect(baseSpeedForPct(CONFIG.KING_PCT / 2)).toBe((MIN + MAX) / 2);
    expect(baseSpeedForPct(CONFIG.KING_PCT)).toBe(MAX);
    expect(baseSpeedForPct(CONFIG.KING_PCT * 2)).toBe(MAX);
  });

  it("cộng đúng bonus Speed Totem và Slow override sau cùng", () => {
    const pct = CONFIG.KING_PCT / 2;
    expect(effectiveSpeedWithTotems(pct, 2, false)).toBe(
      baseSpeedForPct(pct) + CONFIG.TOTEMS.SPEED.BONUS_PER_TOTEM * 2,
    );
    expect(effectiveSpeedWithTotems(pct, 99, true)).toBe(CONFIG.TOTEMS.SLOW.ENEMY_SPEED);
  });
});

describe("Totem authoritative state", () => {
  it("sinh đủ Totem deterministic, đúng khoảng cách tối thiểu", () => {
    const g = new GameState({ config: { bots: { count: 0 }, seed: 12345 } });
    const a = createTotems(g.playable, 12345);
    const b = createTotems(g.playable, 12345);
    expect(a).toEqual(b);
    expect(a).toHaveLength(
      CONFIG.TOTEMS.SPEED.COUNT + CONFIG.TOTEMS.SLOW.COUNT + CONFIG.TOTEMS.RADAR.COUNT,
    );
    for (let i = 0; i < a.length; i++) {
      for (let j = i + 1; j < a.length; j++) {
        const p = axialToPixel(a[i], CONFIG.HEX_SIZE);
        const q = axialToPixel(a[j], CONFIG.HEX_SIZE);
        expect(Math.hypot(p.x - q.x, p.y - q.y)).toBeGreaterThanOrEqual(
          CONFIG.TOTEMS.MIN_SPAWN_DISTANCE,
        );
      }
    }
  });

  it("capture rồi cướp Totem reconcile owner/count đúng một lần theo territory revision", () => {
    const g = new GameState({ config: { bots: { count: 1 }, seed: 7 } });
    const speed = g.totemStates().find((item) => item.kind === "speed")!;
    const startRevision = g.totemRevision;

    g.applyTerritory([{ q: speed.q, r: speed.r, owner: 0, kind: 0 }]);
    expect(g.totemStates().find((item) => item.id === speed.id)!.ownerId).toBe(0);
    expect(g.speedTotemCountFor(0)).toBe(1);
    expect(g.effectiveSpeedFor(0)).toBeCloseTo(
      baseSpeedForPct(g.pctOf(0)) + CONFIG.TOTEMS.SPEED.BONUS_PER_TOTEM,
    );
    expect(g.totemRevision).toBe(startRevision + 1);

    // Keyframe giống hệt bump territoryRevision nhưng không bump totemRevision.
    const ownedRevision = g.totemRevision;
    g.applyTerritory([{ q: speed.q, r: speed.r, owner: 0, kind: 0 }]);
    expect(g.totemRevision).toBe(ownedRevision);

    g.applyTerritory([{ q: speed.q, r: speed.r, owner: 1, kind: 0 }]);
    expect(g.speedTotemCountFor(0)).toBe(0);
    expect(g.speedTotemCountFor(1)).toBe(1);
    expect(g.totemStates().find((item) => item.id === speed.id)!.ownerId).toBe(1);
  });

  it("chết giải phóng lãnh thổ làm Totem trở về trung lập", () => {
    const g = new GameState({ config: { bots: { count: 0 }, seed: 9 } });
    const radar = g.totemStates().find((item) => item.kind === "radar")!;
    g.owned = new Set([keyOf(radar)]);
    expect(g.radarActiveFor(0)).toBe(true);

    g.die();
    expect(g.radarActiveFor(0)).toBe(false);
    expect(g.totemStates().find((item) => item.id === radar.id)!.ownerId).toBe(-1);
  });

  it("S2: rules mặc định ⇒ Totem GameState giống hệt createTotems bản cũ (vị trí + số lượng)", () => {
    const seed = 4242;
    const g = new GameState({ config: { bots: { count: 0 }, seed } });
    // Đường default cũ (đọc thẳng CONFIG). So VỊ TRÍ + số lượng → chứng minh threading rules
    // KHÔNG đổi determinism khi dùng mặc định.
    const legacy = createTotems(g.playable, seed);
    const strip = (t: { id: number; kind: string; q: number; r: number }) => ({
      id: t.id, kind: t.kind, q: t.q, r: t.r,
    });
    expect(g.totemStates().map(strip)).toEqual(legacy.map(strip));
  });

  it("S2: totemsEnabled:false ⇒ GameState không sinh Totem nào", () => {
    const g = new GameState({
      config: { bots: { count: 0 }, seed: 3, rules: { totemsEnabled: false } },
    });
    expect(g.totemStates()).toHaveLength(0);
  });

  it("S2: createTotems nhận override số lượng + enabled:false", () => {
    const g = new GameState({ config: { bots: { count: 0 }, seed: 5 } });
    expect(createTotems(g.playable, 5, [], { enabled: false })).toHaveLength(0);
    const few = createTotems(g.playable, 5, [], {
      speedCount: 2, slowCount: 1, radarCount: 0,
    });
    expect(few).toHaveLength(3);
    expect(few.filter((t) => t.kind === "speed")).toHaveLength(2);
  });

  it("S2: nhân đôi speed.max (min=0) ⇒ tốc độ nền nhân đôi; totemsEnabled:false", () => {
    const mk = (max: number) =>
      new GameState({
        config: {
          bots: { count: 0 }, seed: 2,
          rules: { speed: { min: 0, max }, totemsEnabled: false },
        },
      });
    const slow = mk(6).effectiveSpeedFor(0);
    const fast = mk(12).effectiveSpeedFor(0);
    expect(slow).toBeGreaterThan(0);
    expect(fast).toBeCloseTo(slow * 2);
  });

  it("S2: override speed (min=max) ⇒ effectiveSpeed cố định bất kể pct", () => {
    const g = new GameState({
      config: {
        bots: { count: 0 }, seed: 1,
        rules: { speed: { min: 10, max: 10 }, totemsEnabled: false },
      },
    });
    expect(g.effectiveSpeedFor(0)).toBe(10);
  });

  it("enemy Slow override, own Slow miễn nhiễm và rời radius khôi phục tốc độ", () => {
    const g = new GameState({ config: { bots: { count: 1 }, seed: 11 } });
    const slow = g.totemStates().find((item) => item.kind === "slow")!;
    g.applyTerritory([{ q: slow.q, r: slow.r, owner: 1, kind: 0 }]);
    const p = axialToPixel(slow, CONFIG.HEX_SIZE);
    g.players[0].pos = { ...p };
    g.players[1].pos = { ...p };

    expect(g.insideEnemySlowZoneFor(0)).toBe(true);
    expect(g.effectiveSpeedFor(0)).toBe(CONFIG.TOTEMS.SLOW.ENEMY_SPEED);
    expect(g.insideEnemySlowZoneFor(1)).toBe(false);
    expect(g.effectiveSpeedFor(1)).toBeGreaterThan(CONFIG.TOTEMS.SLOW.ENEMY_SPEED);

    g.players[0].pos = { x: p.x + CONFIG.TOTEMS.SLOW.RADIUS + 0.01, y: p.y };
    expect(g.insideEnemySlowZoneFor(0)).toBe(false);
    expect(g.effectiveSpeedFor(0)).toBe(baseSpeedForPct(g.pctOf(0)));
  });
});
