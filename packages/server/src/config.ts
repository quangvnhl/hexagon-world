import { CONFIG } from "@hexagon/shared";

/**
 * Hằng số cấu hình cho SERVER AUTHORITATIVE (Pha 2).
 *
 * Ghi chú thiết kế:
 *  - TICK_RATE = 24 Hz: đủ mượt cho .io game, nhẹ băng thông. dt cố định = 1/24.
 *  - MAX_PLAYERS = 8 ghế NGƯỜI. Còn lại lấp bằng bot (CONFIG.BOT_COUNT = 20) để
 *    một người chơi lẻ vẫn có ~20 đối thủ. Tổng thực thể = MAX_PLAYERS + BOT_COUNT.
 *  - BOT_COUNT lấy thẳng từ CONFIG dùng chung (không hardcode).
 */
export const TICK_RATE = 24;

/** Bước thời gian cố định mỗi tick (giây). */
export const DT = 1 / TICK_RATE;

/** Số ghế NGƯỜI tối đa (mỗi kết nối chiếm 1 ghế). */
export const MAX_PLAYERS = 8;

/** Số bot lấp phần còn lại của phòng (từ config dùng chung). Không dùng cho phòng online
 *  (online CHỈ người thật) — giữ export cho tương thích/test. */
export const BOT_COUNT = CONFIG.BOT_COUNT;

/** Phòng ONLINE KHÔNG dùng bot: chỉ người thật đấu nhau. */
export const ONLINE_BOTS = 3;

/** Số người THẬT tối thiểu để BẮT ĐẦU một ván online. Chưa đủ → phòng ở trạng thái CHỜ. */
export const MIN_PLAYERS = 1;

/**
 * Bán kính Area-of-Interest cho snapshot entity (world units).
 * Camera rộng nhất hiện nhìn khoảng vài chục world units; 60 chừa đủ vùng đệm cho interpolation.
 * Có thể tinh chỉnh theo deployment bằng ENTITY_AOI_RADIUS mà không cần build lại image.
 */
function positiveNumberFromEnv(name: string, fallback: number): number {
  const raw = process.env[name];
  if (!raw) return fallback;
  const value = Number(raw);
  return Number.isFinite(value) && value > 0 ? value : fallback;
}

export const ENTITY_AOI_RADIUS = positiveNumberFromEnv("ENTITY_AOI_RADIUS", 60);

/** Cổng WebSocket mặc định nếu không đặt biến môi trường PORT. */
export const DEFAULT_PORT = 8910;
