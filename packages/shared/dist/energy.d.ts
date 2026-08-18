/** Tham số kinh tế năng lượng (khớp bảng `energy_rules`). CHỐT P2: max 50, hồi 1 điểm/180s. */
export interface EnergyRules {
    energyMax: number;
    regenIntervalSeconds: number;
}
export declare const DEFAULT_ENERGY_RULES: EnergyRules;
export interface EnergyView {
    /** Năng lượng hiện tại (đã cộng phần hồi lười). */
    current: number;
    max: number;
    regenIntervalSeconds: number;
    /** Mốc thời gian (ms epoch) điểm năng lượng kế tiếp xuất hiện; `null` nếu đã đầy. */
    nextAtMs: number | null;
}
/**
 * Tính năng lượng hiện tại từ trạng thái đã lưu, THUẦN (không side-effect).
 * @param stored `energy_current` đã lưu ở mốc `lastRefillMs`.
 * @param lastRefillMs mốc `last_refill_at` (ms epoch).
 * @param nowMs thời điểm hiện tại (ms epoch).
 */
export declare function computeEnergy(stored: number, lastRefillMs: number, nowMs: number, rules?: EnergyRules): EnergyView;
