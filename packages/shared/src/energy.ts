// Năng lượng — công thức HỒI LƯỜI (lazy regen) THUẦN (doc 28 §E3).
//
// Nguồn AUTHORITATIVE là RPC Postgres `read_energy`/`spend_energy` (server, chống gian lận).
// File này là BẢN SAO THUẦN cho client hiển thị thanh + đếm ngược tới điểm hồi kế, và là "spec"
// để đối chiếu logic SQL trong test. Cả hai PHẢI cùng công thức:
//
//   current = stored >= max ? stored : min(max, stored + floor((now - lastRefill) / interval))
//
// HỒI chỉ LẤP TỚI trần, và KHÔNG BAO GIỜ kéo xuống số đang có. Vế `stored >= max ? stored` là bắt
// buộc kể từ migration 202609090001: MUA năng lượng bằng coin được phép vượt trần (doc 37 Việc 9,
// chủ dự án chốt phương án B), nên `energy_current` có thể LỚN HƠN `max`. Công thức cũ ghi ở đây
// là `min(max, ...)` — nó kẹp phần vượt xuống, tức xoá mất số điểm người chơi ĐÃ TRẢ TIỀN.
//
// `nextAtMs` = thời điểm điểm năng lượng KẾ TIẾP xuất hiện; `null` khi đang ở hoặc trên trần.

/** Tham số kinh tế năng lượng (khớp bảng `energy_rules`). CHỐT P2: max 50, hồi 1 điểm/180s. */
export interface EnergyRules {
  energyMax: number;
  regenIntervalSeconds: number;
}

export const DEFAULT_ENERGY_RULES: EnergyRules = {
  energyMax: 50,
  regenIntervalSeconds: 180,
};

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
export function computeEnergy(
  stored: number,
  lastRefillMs: number,
  nowMs: number,
  rules: EnergyRules = DEFAULT_ENERGY_RULES,
): EnergyView {
  const max = rules.energyMax;
  const intervalMs = rules.regenIntervalSeconds * 1000;
  const base = { max, regenIntervalSeconds: rules.regenIntervalSeconds };

  // Ở hoặc TRÊN trần: đứng yên, giữ nguyên `stored`. Trả `max` ở đây là kẹp mất phần đã mua.
  if (stored >= max) return { current: stored, nextAtMs: null, ...base };
  if (intervalMs <= 0) return { current: Math.max(stored, max), nextAtMs: null, ...base };

  const elapsed = Math.max(0, nowMs - lastRefillMs);
  const gained = Math.floor(elapsed / intervalMs);
  const current = Math.min(max, stored + gained);
  if (current >= max) return { current: max, nextAtMs: null, ...base };
  // Điểm kế xuất hiện khi qua thêm 1 khoảng interval kể từ mốc điểm vừa hồi gần nhất.
  const nextAtMs = lastRefillMs + (gained + 1) * intervalMs;
  return { current, nextAtMs, ...base };
}
