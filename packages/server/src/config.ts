import { CONFIG, GAME_PROTOCOL_VERSION } from "@hexagon/shared";

/**
 * Hằng số cấu hình cho SERVER AUTHORITATIVE (Pha 2).
 *
 * Ghi chú thiết kế:
 *  - TICK_RATE = 24 Hz: đủ mượt cho .io game, nhẹ băng thông. dt cố định = 1/24.
 *  - MAX_HUMAN_PLAYERS giới hạn ghế người thật trong mỗi room (tối đa 8).
 *  - MAX_PLAYERS là số bot mục tiêu cố định của room, clamp trong 12..16.
 *  - BOT_COUNT giữ lại làm sức chứa bot mặc định cho mô phỏng và tương thích test cũ.
 */
export const TICK_RATE = 24;

/** Bước thời gian cố định mỗi tick (giây). */
export const DT = 1 / TICK_RATE;

/** Số ghế NGƯỜI tối đa (mỗi kết nối chiếm 1 ghế). */
function boundedIntegerFromEnv(name: string, fallback: number, min: number, max: number): number {
  const value = Number(process.env[name] ?? fallback);
  if (!Number.isFinite(value)) return fallback;
  return Math.min(max, Math.max(min, Math.round(value)));
}

export const MAX_HUMAN_PLAYERS = boundedIntegerFromEnv("MAX_ONLINE_PLAYERS", 8, 1, 8);

/** Sức chứa bot mặc định của GameState; room online truyền mục tiêu bot riêng. */
export const BOT_COUNT = CONFIG.BOT_COUNT;

/**
 * Số bot mục tiêu cố định của mỗi room online. `ONLINE_BOTS` là fallback tương
 * thích deployment cũ; cấu hình mới dùng `MAX_PLAYERS` và luôn nằm trong 12..16.
 */
export const MAX_PLAYERS = boundedIntegerFromEnv(
  "MAX_PLAYERS",
  boundedIntegerFromEnv("ONLINE_BOTS", 12, 12, 16),
  12,
  16,
);
export const ONLINE_BOTS = MAX_PLAYERS;
export const ONLINE_BOT_JOIN_INTERVAL_MS = boundedIntegerFromEnv("ONLINE_BOT_JOIN_INTERVAL_MS", 1500, 100, 60000);
export const KING_ROOM_DURATION_SECONDS = boundedIntegerFromEnv("KING_ROOM_DURATION_SECONDS", 180, 1, 3600);

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

/** Hot-path frames are coalesced while a socket has this many unsent bytes. */
export const WS_BACKPRESSURE_BYTES = positiveNumberFromEnv("WS_BACKPRESSURE_BYTES", 262144);
export const SERVER_PROTOCOL_VERSION = positiveNumberFromEnv("GAME_PROTOCOL_VERSION", GAME_PROTOCOL_VERSION);
export const TERRITORY_AOI_RADIUS = positiveNumberFromEnv("TERRITORY_AOI_RADIUS", 48);
export const TERRITORY_AOI_HYSTERESIS = positiveNumberFromEnv("TERRITORY_AOI_HYSTERESIS", 10);

/** Cổng WebSocket mặc định nếu không đặt biến môi trường PORT. */
export const DEFAULT_PORT = 8910;
