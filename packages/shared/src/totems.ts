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

/** Đường cong tốc độ nền (min→max). Default = CONFIG ⇒ hành vi cũ y hệt. */
export interface SpeedCurveConfig {
  min: number;
  max: number;
  /** Ngưỡng % để đạt tốc độ max (mốc King). */
  kingPct: number;
}

const DEFAULT_SPEED_CURVE: SpeedCurveConfig = {
  min: CONFIG.SPEED.BY_KING_PCT.MIN,
  max: CONFIG.SPEED.BY_KING_PCT.MAX,
  kingPct: CONFIG.KING_PCT,
};

/** Tốc độ nền tăng tuyến tính từ min tới max khi tiến tới ngưỡng King.
 *  `curve` mặc định = CONFIG ⇒ gọi `baseSpeedForPct(pct)` cho ra kết quả cũ y hệt. */
export function baseSpeedForPct(
  pct: number,
  curve: SpeedCurveConfig = DEFAULT_SPEED_CURVE,
): number {
  const t = clamp01((Number.isFinite(pct) ? pct : 0) / curve.kingPct);
  return curve.min + (curve.max - curve.min) * t;
}

/** Cấu hình tốc độ hiệu dụng (đường cong nền + bonus Speed Totem + override Slow). */
export interface EffectiveSpeedConfig {
  curve: SpeedCurveConfig;
  /** Cộng thêm mỗi Speed Totem sở hữu (TOTEMS.SPEED.BONUS_PER_TOTEM). */
  speedBonus: number;
  /** Tốc độ bị ép khi nằm trong vùng Slow của địch (TOTEMS.SLOW.ENEMY_SPEED). */
  slowEnemySpeed: number;
}

const DEFAULT_EFFECTIVE_SPEED: EffectiveSpeedConfig = {
  curve: DEFAULT_SPEED_CURVE,
  speedBonus: CONFIG.TOTEMS.SPEED.BONUS_PER_TOTEM,
  slowEnemySpeed: CONFIG.TOTEMS.SLOW.ENEMY_SPEED,
};

/** Slow là override cuối; speed Totem chỉ cộng khi không nằm trong vùng Slow địch.
 *  `cfg` mặc định = CONFIG ⇒ gọi 3 tham số cho ra kết quả cũ y hệt. */
export function effectiveSpeedWithTotems(
  pct: number,
  speedTotemCount: number,
  insideEnemySlowZone: boolean,
  cfg: EffectiveSpeedConfig = DEFAULT_EFFECTIVE_SPEED,
): number {
  if (insideEnemySlowZone) return cfg.slowEnemySpeed;
  return baseSpeedForPct(pct, cfg.curve) +
    Math.max(0, Math.floor(speedTotemCount)) * cfg.speedBonus;
}

function seededRandom(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
    return state / 0x100000000;
  };
}

/** Cấu hình sinh Totem. Mọi field mặc định = CONFIG ⇒ `createTotems(playable, seed)` sinh
 *  totem GIỐNG HỆT bản cũ (số lượng + vị trí) theo cùng seed. */
export interface CreateTotemsConfig {
  hexSize: number;
  speedCount: number;
  slowCount: number;
  radarCount: number;
  minSpawnDistance: number;
  spawnClearance: number;
  /** false ⇒ không sinh Totem nào (Luyện tập tắt totem). */
  enabled: boolean;
  /** Kiểm tra điểm nằm trong sân (per-instance arena). Default = sân mặc định (shim CONFIG). */
  insideArena: (x: number, y: number, slack: number) => boolean;
}

const DEFAULT_CREATE_TOTEMS: CreateTotemsConfig = {
  hexSize: CONFIG.HEX_SIZE,
  speedCount: CONFIG.TOTEMS.SPEED.COUNT,
  slowCount: CONFIG.TOTEMS.SLOW.COUNT,
  radarCount: CONFIG.TOTEMS.RADAR.COUNT,
  minSpawnDistance: CONFIG.TOTEMS.MIN_SPAWN_DISTANCE,
  spawnClearance: CONFIG.TOTEMS.SPAWN_CLEARANCE,
  enabled: true,
  insideArena,
};

/** Sinh Totem ổn định theo seed, tránh tường, spawn ban đầu và các Totem khác.
 *  `cfg` mặc định = CONFIG ⇒ giữ NGUYÊN determinism (số lượng + vị trí theo seed). */
export function createTotems(
  playable: Iterable<HexKey>,
  seed = 0,
  excludedSpawns: readonly Axial[] = [],
  cfg: Partial<CreateTotemsConfig> = {},
): TotemState[] {
  const {
    hexSize,
    speedCount,
    slowCount,
    radarCount,
    minSpawnDistance,
    spawnClearance,
    enabled,
    insideArena: inside,
  } = { ...DEFAULT_CREATE_TOTEMS, ...cfg };
  if (!enabled) return [];

  const random = seededRandom(seed);
  const candidates = [...playable].sort().map(parseKey).filter((cell) => {
    const p = axialToPixel(cell, hexSize);
    if (!inside(p.x, p.y, -spawnClearance)) return false;
    return excludedSpawns.every((spawn) => {
      const s = axialToPixel(spawn, hexSize);
      return Math.hypot(p.x - s.x, p.y - s.y) >= spawnClearance;
    });
  });
  for (let i = candidates.length - 1; i > 0; i--) {
    const j = Math.floor(random() * (i + 1));
    [candidates[i], candidates[j]] = [candidates[j], candidates[i]];
  }

  const kinds: TotemKind[] = [
    ...new Array(speedCount).fill("speed"),
    ...new Array(slowCount).fill("slow"),
    ...new Array(radarCount).fill("radar"),
  ];
  const out: TotemState[] = [];
  for (const kind of kinds) {
    const index = candidates.findIndex((candidate) => {
      const p = axialToPixel(candidate, hexSize);
      return out.every((item) => {
        const other = axialToPixel(item, hexSize);
        return Math.hypot(p.x - other.x, p.y - other.y) >= minSpawnDistance;
      });
    });
    if (index < 0) break;
    const [cell] = candidates.splice(index, 1);
    out.push({ id: out.length, kind, q: cell.q, r: cell.r, ownerId: -1 });
  }
  return out;
}
