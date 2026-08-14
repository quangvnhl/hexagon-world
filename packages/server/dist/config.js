"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.DEFAULT_PORT = exports.TERRITORY_AOI_HYSTERESIS = exports.TERRITORY_AOI_RADIUS = exports.SERVER_PROTOCOL_VERSION = exports.WS_BACKPRESSURE_BYTES = exports.ENTITY_AOI_RADIUS = exports.MIN_PLAYERS = exports.LOBBY_RECONNECT_GRACE_MS = exports.KING_ROOM_DURATION_SECONDS = exports.ONLINE_BOT_JOIN_INTERVAL_MS = exports.ONLINE_BOT_CAPACITY_MAX = exports.ONLINE_BOT_CAPACITY_MIN = exports.BOT_COUNT = exports.MAX_HUMAN_PLAYERS = exports.DT = exports.TICK_RATE = void 0;
exports.onlineBotCapacityForRoom = onlineBotCapacityForRoom;
const shared_1 = require("@hexagon/shared");
exports.TICK_RATE = 24;
exports.DT = 1 / exports.TICK_RATE;
function boundedIntegerFromEnv(name, fallback, min, max) {
    const value = Number(process.env[name] ?? fallback);
    if (!Number.isFinite(value))
        return fallback;
    return Math.min(max, Math.max(min, Math.round(value)));
}
exports.MAX_HUMAN_PLAYERS = boundedIntegerFromEnv("MAX_ONLINE_PLAYERS", 8, 1, 8);
exports.BOT_COUNT = shared_1.CONFIG.BOT_COUNT;
exports.ONLINE_BOT_CAPACITY_MIN = 12;
exports.ONLINE_BOT_CAPACITY_MAX = 16;
function onlineBotCapacityForRoom(roomId) {
    const stableId = Number.isFinite(roomId) ? Math.max(1, Math.floor(roomId)) : 1;
    const hash = Math.imul(stableId ^ 0x9e3779b9, 0x85ebca6b) >>> 0;
    return exports.ONLINE_BOT_CAPACITY_MIN + hash % (exports.ONLINE_BOT_CAPACITY_MAX - exports.ONLINE_BOT_CAPACITY_MIN + 1);
}
exports.ONLINE_BOT_JOIN_INTERVAL_MS = boundedIntegerFromEnv("ONLINE_BOT_JOIN_INTERVAL_MS", 1500, 100, 60000);
exports.KING_ROOM_DURATION_SECONDS = boundedIntegerFromEnv("KING_ROOM_DURATION_SECONDS", 180, 1, 3600);
exports.LOBBY_RECONNECT_GRACE_MS = 15_000;
exports.MIN_PLAYERS = 1;
function positiveNumberFromEnv(name, fallback) {
    const raw = process.env[name];
    if (!raw)
        return fallback;
    const value = Number(raw);
    return Number.isFinite(value) && value > 0 ? value : fallback;
}
exports.ENTITY_AOI_RADIUS = positiveNumberFromEnv("ENTITY_AOI_RADIUS", 60);
exports.WS_BACKPRESSURE_BYTES = positiveNumberFromEnv("WS_BACKPRESSURE_BYTES", 262144);
exports.SERVER_PROTOCOL_VERSION = positiveNumberFromEnv("GAME_PROTOCOL_VERSION", shared_1.GAME_PROTOCOL_VERSION);
exports.TERRITORY_AOI_RADIUS = positiveNumberFromEnv("TERRITORY_AOI_RADIUS", 48);
exports.TERRITORY_AOI_HYSTERESIS = positiveNumberFromEnv("TERRITORY_AOI_HYSTERESIS", 10);
exports.DEFAULT_PORT = 8910;
//# sourceMappingURL=config.js.map