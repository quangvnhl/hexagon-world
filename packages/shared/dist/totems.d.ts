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
/** Tốc độ nền tăng tuyến tính từ MIN tới MAX khi tiến tới ngưỡng King. */
export declare function baseSpeedForPct(pct: number): number;
/** Slow là override cuối; speed Totem chỉ cộng khi không nằm trong vùng Slow địch. */
export declare function effectiveSpeedWithTotems(pct: number, speedTotemCount: number, insideEnemySlowZone: boolean): number;
/** Sinh Totem ổn định theo seed, tránh tường, spawn ban đầu và các Totem khác. */
export declare function createTotems(playable: Iterable<HexKey>, seed?: number, excludedSpawns?: readonly Axial[]): TotemState[];
