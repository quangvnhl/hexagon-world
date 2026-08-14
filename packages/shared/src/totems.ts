import { CONFIG } from "./config";
import { type Axial, type HexKey, axialToPixel, parseKey } from "./hex";
import { insideArena } from "./arena";

export type TotemKind = "speed" | "slow" | "radar";

export interface TotemState {
  readonly id: number;
  readonly kind: TotemKind;
  readonly q: number;
  readonly r: number;
  readonly ownerId: number;
}

export interface EntityGameplayModifiers {
  readonly effectiveSpeed: number;
  readonly speedTotemCount: number;
  readonly radarActive: boolean;
  readonly insideEnemySlowZone: boolean;
}

const clamp01 = (value: number): number => Math.max(0, Math.min(1, value));

/** Tốc độ nền tăng tuyến tính từ MIN tới MAX khi tiến tới ngưỡng King. */
export function baseSpeedForPct(pct: number): number {
  const { MIN, MAX } = CONFIG.SPEED.BY_KING_PCT;
  const t = clamp01((Number.isFinite(pct) ? pct : 0) / CONFIG.KING_PCT);
  return MIN + (MAX - MIN) * t;
}

/** Slow là override cuối; speed Totem chỉ cộng khi không nằm trong vùng Slow địch. */
export function effectiveSpeedWithTotems(
  pct: number,
  speedTotemCount: number,
  insideEnemySlowZone: boolean,
): number {
  if (insideEnemySlowZone) return CONFIG.TOTEMS.SLOW.ENEMY_SPEED;
  return baseSpeedForPct(pct) +
    Math.max(0, Math.floor(speedTotemCount)) * CONFIG.TOTEMS.SPEED.BONUS_PER_TOTEM;
}

function seededRandom(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
    return state / 0x100000000;
  };
}

/** Sinh Totem ổn định theo seed, tránh tường, spawn ban đầu và các Totem khác. */
export function createTotems(
  playable: Iterable<HexKey>,
  seed = 0,
  excludedSpawns: readonly Axial[] = [],
): TotemState[] {
  const random = seededRandom(seed);
  const candidates = [...playable].sort().map(parseKey).filter((cell) => {
    const p = axialToPixel(cell, CONFIG.HEX_SIZE);
    if (!insideArena(p.x, p.y, -CONFIG.TOTEMS.SPAWN_CLEARANCE)) return false;
    return excludedSpawns.every((spawn) => {
      const s = axialToPixel(spawn, CONFIG.HEX_SIZE);
      return Math.hypot(p.x - s.x, p.y - s.y) >= CONFIG.TOTEMS.SPAWN_CLEARANCE;
    });
  });
  for (let i = candidates.length - 1; i > 0; i--) {
    const j = Math.floor(random() * (i + 1));
    [candidates[i], candidates[j]] = [candidates[j], candidates[i]];
  }

  const kinds: TotemKind[] = [
    ...new Array(CONFIG.TOTEMS.SPEED.COUNT).fill("speed"),
    ...new Array(CONFIG.TOTEMS.SLOW.COUNT).fill("slow"),
    ...new Array(CONFIG.TOTEMS.RADAR.COUNT).fill("radar"),
  ];
  const out: TotemState[] = [];
  for (const kind of kinds) {
    const index = candidates.findIndex((candidate) => {
      const p = axialToPixel(candidate, CONFIG.HEX_SIZE);
      return out.every((item) => {
        const other = axialToPixel(item, CONFIG.HEX_SIZE);
        return Math.hypot(p.x - other.x, p.y - other.y) >= CONFIG.TOTEMS.MIN_SPAWN_DISTANCE;
      });
    });
    if (index < 0) break;
    const [cell] = candidates.splice(index, 1);
    out.push({ id: out.length, kind, q: cell.q, r: cell.r, ownerId: -1 });
  }
  return out;
}
