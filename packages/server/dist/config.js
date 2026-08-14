"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.DEFAULT_PORT = exports.TERRITORY_AOI_HYSTERESIS = exports.TERRITORY_AOI_RADIUS = exports.SERVER_PROTOCOL_VERSION = exports.WS_BACKPRESSURE_BYTES = exports.ENTITY_AOI_RADIUS = exports.MIN_PLAYERS = exports.KING_ROOM_DURATION_SECONDS = exports.ONLINE_BOT_JOIN_INTERVAL_MS = exports.ONLINE_BOTS = exports.MAX_PLAYERS = exports.BOT_COUNT = exports.MAX_HUMAN_PLAYERS = exports.DT = exports.TICK_RATE = void 0;
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
exports.MAX_PLAYERS = boundedIntegerFromEnv("MAX_PLAYERS", boundedIntegerFromEnv("ONLINE_BOTS", 12, 12, 16), 12, 16);
exports.ONLINE_BOTS = exports.MAX_PLAYERS;
exports.ONLINE_BOT_JOIN_INTERVAL_MS = boundedIntegerFromEnv("ONLINE_BOT_JOIN_INTERVAL_MS", 1500, 100, 60000);
exports.KING_ROOM_DURATION_SECONDS = boundedIntegerFromEnv("KING_ROOM_DURATION_SECONDS", 180, 1, 3600);
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