"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.DEFAULT_PORT = exports.ENTITY_AOI_RADIUS = exports.MIN_PLAYERS = exports.ONLINE_BOTS = exports.BOT_COUNT = exports.MAX_PLAYERS = exports.DT = exports.TICK_RATE = void 0;
const shared_1 = require("@hexagon/shared");
exports.TICK_RATE = 24;
exports.DT = 1 / exports.TICK_RATE;
exports.MAX_PLAYERS = 8;
exports.BOT_COUNT = shared_1.CONFIG.BOT_COUNT;
exports.ONLINE_BOTS = 3;
exports.MIN_PLAYERS = 1;
function positiveNumberFromEnv(name, fallback) {
    const raw = process.env[name];
    if (!raw)
        return fallback;
    const value = Number(raw);
    return Number.isFinite(value) && value > 0 ? value : fallback;
}
exports.ENTITY_AOI_RADIUS = positiveNumberFromEnv("ENTITY_AOI_RADIUS", 60);
exports.DEFAULT_PORT = 8910;
//# sourceMappingURL=config.js.map