"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.DEFAULT_PORT = exports.MIN_PLAYERS = exports.ONLINE_BOTS = exports.BOT_COUNT = exports.MAX_PLAYERS = exports.DT = exports.TICK_RATE = void 0;
const shared_1 = require("@hexagon/shared");
exports.TICK_RATE = 24;
exports.DT = 1 / exports.TICK_RATE;
exports.MAX_PLAYERS = 8;
exports.BOT_COUNT = shared_1.CONFIG.BOT_COUNT;
exports.ONLINE_BOTS = 0;
exports.MIN_PLAYERS = 2;
exports.DEFAULT_PORT = 8787;
//# sourceMappingURL=config.js.map