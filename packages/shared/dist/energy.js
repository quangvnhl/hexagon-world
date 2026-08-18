"use strict";
// Năng lượng — công thức HỒI LƯỜI (lazy regen) THUẦN (doc 28 §E3).
//
// Nguồn AUTHORITATIVE là RPC Postgres `read_energy`/`spend_energy` (server, chống gian lận).
// File này là BẢN SAO THUẦN cho client hiển thị thanh + đếm ngược tới điểm hồi kế, và là "spec"
// để đối chiếu logic SQL trong test. Cả hai PHẢI cùng công thức:
//
//   current = min(max, stored + floor((now - lastRefill) / interval))
//
// Khi đạt `max`, đồng hồ hồi coi như dừng (không tích lũy quá max). `nextAtMs` = thời điểm điểm
// năng lượng KẾ TIẾP xuất hiện (null nếu đã đầy).
Object.defineProperty(exports, "__esModule", { value: true });
exports.DEFAULT_ENERGY_RULES = void 0;
exports.computeEnergy = computeEnergy;
exports.DEFAULT_ENERGY_RULES = {
    energyMax: 50,
    regenIntervalSeconds: 180,
};
/**
 * Tính năng lượng hiện tại từ trạng thái đã lưu, THUẦN (không side-effect).
 * @param stored `energy_current` đã lưu ở mốc `lastRefillMs`.
 * @param lastRefillMs mốc `last_refill_at` (ms epoch).
 * @param nowMs thời điểm hiện tại (ms epoch).
 */
function computeEnergy(stored, lastRefillMs, nowMs, rules = exports.DEFAULT_ENERGY_RULES) {
    const max = rules.energyMax;
    const intervalMs = rules.regenIntervalSeconds * 1000;
    const base = { max, regenIntervalSeconds: rules.regenIntervalSeconds };
    if (stored >= max)
        return { current: max, nextAtMs: null, ...base };
    if (intervalMs <= 0)
        return { current: max, nextAtMs: null, ...base };
    const elapsed = Math.max(0, nowMs - lastRefillMs);
    const gained = Math.floor(elapsed / intervalMs);
    const current = Math.min(max, stored + gained);
    if (current >= max)
        return { current: max, nextAtMs: null, ...base };
    // Điểm kế xuất hiện khi qua thêm 1 khoảng interval kể từ mốc điểm vừa hồi gần nhất.
    const nextAtMs = lastRefillMs + (gained + 1) * intervalMs;
    return { current, nextAtMs, ...base };
}
