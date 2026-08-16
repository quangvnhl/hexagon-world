import { CONFIG, GAME_PROTOCOL_VERSION } from "@hexagon/shared";

/**
 * Hằng số cấu hình cho SERVER AUTHORITATIVE (Pha 2).
 *
 * Ghi chú thiết kế:
 *  - TICK_RATE = 24 Hz: đủ mượt cho .io game, nhẹ băng thông. dt cố định = 1/24.
 *  - MAX_HUMAN_PLAYERS giới hạn ghế người thật trong mỗi room (tối đa 8).
 *  - Bot online chọn deterministic một capacity trong khoảng 12..16 theo room id.
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

/** Khoảng bot online là server build config, không phải deployment env. */
export const ONLINE_BOT_CAPACITY_MIN = 12;
export const ONLINE_BOT_CAPACITY_MAX = 16;

/** Deterministic per-room distribution without deployment/env drift. */
export function onlineBotCapacityForRoom(roomId: number): number {
  const stableId = Number.isFinite(roomId) ? Math.max(1, Math.floor(roomId)) : 1;
  const hash = Math.imul(stableId ^ 0x9e3779b9, 0x85ebca6b) >>> 0;
  return ONLINE_BOT_CAPACITY_MIN + hash % (ONLINE_BOT_CAPACITY_MAX - ONLINE_BOT_CAPACITY_MIN + 1);
}
export const ONLINE_BOT_JOIN_INTERVAL_MS = boundedIntegerFromEnv("ONLINE_BOT_JOIN_INTERVAL_MS", 1500, 100, 60000);
export const KING_ROOM_DURATION_SECONDS = boundedIntegerFromEnv("KING_ROOM_DURATION_SECONDS", 180, 1, 3600);
/** Giữ ghế trong thời gian ngắn khi socket rớt để client có thể nối lại đúng ván. */
export const LOBBY_RECONNECT_GRACE_MS = 30_000;
/** Chủ động phát hiện socket chết thay vì chờ TCP timeout của mobile browser/proxy. */
export const WS_HEARTBEAT_INTERVAL_MS = 5_000;

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

/* -------------------------------------------------------------------------- */
/* Pha 5 · B1 — chống gian lận (rate-limit đường ws). Mọi ngưỡng cấu hình env. */
/* -------------------------------------------------------------------------- */

/** Trần khung INPUT nhị phân mỗi giây / kết nối (token-bucket refill rate).
 *  Mặc định 48 ≈ 2× tick (24 Hz) để chịu burst ngắn của client hợp lệ. */
export const WS_INPUT_RATE_PER_SEC = boundedIntegerFromEnv("WS_INPUT_RATE_PER_SEC", 48, 1, 10000);

/** Sức chứa burst của token-bucket input (số token tối đa tích được). Mặc định = trần/giây. */
export const WS_INPUT_BURST = boundedIntegerFromEnv("WS_INPUT_BURST", WS_INPUT_RATE_PER_SEC, 1, 20000);

/** Số khung TEXT tối đa cho phép trong một cửa sổ trượt / kết nối. */
export const WS_TEXT_RATE_MAX = boundedIntegerFromEnv("WS_TEXT_RATE_MAX", 5, 1, 10000);

/** Độ dài cửa sổ trượt cho rate-limit text (ms). Mặc định 5 msg / 5 s. */
export const WS_TEXT_RATE_WINDOW_MS = boundedIntegerFromEnv("WS_TEXT_RATE_WINDOW_MS", 5000, 100, 600000);

/** Số lần vi phạm cửa sổ text liên tiếp trước khi ĐÓNG socket. */
export const WS_TEXT_FLOOD_STRIKES = boundedIntegerFromEnv("WS_TEXT_FLOOD_STRIKES", 3, 1, 1000);

/** Trần số kết nối ws đồng thời mỗi IP (chống cạn ghế). Vượt → từ chối kết nối mới. */
export const WS_MAX_CONN_PER_IP = boundedIntegerFromEnv("WS_MAX_CONN_PER_IP", 20, 1, 100000);
