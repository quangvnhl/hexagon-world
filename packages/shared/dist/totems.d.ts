import { type Axial, type HexKey } from "./hex";
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
/** Đường cong tốc độ nền (min→max). Default = CONFIG ⇒ hành vi cũ y hệt. */
export interface SpeedCurveConfig {
    min: number;
    max: number;
    /** Ngưỡng % để đạt tốc độ max (mốc King). */
    kingPct: number;
}
/** Tốc độ nền tăng tuyến tính từ min tới max khi tiến tới ngưỡng King.
 *  `curve` mặc định = CONFIG ⇒ gọi `baseSpeedForPct(pct)` cho ra kết quả cũ y hệt. */
export declare function baseSpeedForPct(pct: number, curve?: SpeedCurveConfig): number;
/** Cấu hình tốc độ hiệu dụng (đường cong nền + bonus Speed Totem + override Slow). */
export interface EffectiveSpeedConfig {
    curve: SpeedCurveConfig;
    /** Cộng thêm mỗi Speed Totem sở hữu (TOTEMS.SPEED.BONUS_PER_TOTEM). */
    speedBonus: number;
    /** Tốc độ bị ép khi nằm trong vùng Slow của địch (TOTEMS.SLOW.ENEMY_SPEED). */
    slowEnemySpeed: number;
}
/** Slow là override cuối; speed Totem chỉ cộng khi không nằm trong vùng Slow địch.
 *  `cfg` mặc định = CONFIG ⇒ gọi 3 tham số cho ra kết quả cũ y hệt. */
export declare function effectiveSpeedWithTotems(pct: number, speedTotemCount: number, insideEnemySlowZone: boolean, cfg?: EffectiveSpeedConfig): number;
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
/** Sinh Totem ổn định theo seed, tránh tường, spawn ban đầu và các Totem khác.
 *  `cfg` mặc định = CONFIG ⇒ giữ NGUYÊN determinism (số lượng + vị trí theo seed). */
export declare function createTotems(playable: Iterable<HexKey>, seed?: number, excludedSpawns?: readonly Axial[], cfg?: Partial<CreateTotemsConfig>): TotemState[];
