"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.baseSpeedForPct = baseSpeedForPct;
exports.effectiveSpeedWithTotems = effectiveSpeedWithTotems;
exports.createTotems = createTotems;
const config_1 = require("./config");
const hex_1 = require("./hex");
const arena_1 = require("./arena");
const clamp01 = (value) => Math.max(0, Math.min(1, value));
/** Tốc độ nền tăng tuyến tính từ MIN tới MAX khi tiến tới ngưỡng King. */
function baseSpeedForPct(pct) {
    const { MIN, MAX } = config_1.CONFIG.SPEED.BY_KING_PCT;
    const t = clamp01((Number.isFinite(pct) ? pct : 0) / config_1.CONFIG.KING_PCT);
    return MIN + (MAX - MIN) * t;
}
/** Slow là override cuối; speed Totem chỉ cộng khi không nằm trong vùng Slow địch. */
function effectiveSpeedWithTotems(pct, speedTotemCount, insideEnemySlowZone) {
    if (insideEnemySlowZone)
        return config_1.CONFIG.TOTEMS.SLOW.ENEMY_SPEED;
    return baseSpeedForPct(pct) +
        Math.max(0, Math.floor(speedTotemCount)) * config_1.CONFIG.TOTEMS.SPEED.BONUS_PER_TOTEM;
}
function seededRandom(seed) {
    let state = seed >>> 0;
    return () => {
        state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
        return state / 0x100000000;
    };
}
/** Sinh Totem ổn định theo seed, tránh tường, spawn ban đầu và các Totem khác. */
function createTotems(playable, seed = 0, excludedSpawns = []) {
    const random = seededRandom(seed);
    const candidates = [...playable].sort().map(hex_1.parseKey).filter((cell) => {
        const p = (0, hex_1.axialToPixel)(cell, config_1.CONFIG.HEX_SIZE);
        if (!(0, arena_1.insideArena)(p.x, p.y, -config_1.CONFIG.TOTEMS.SPAWN_CLEARANCE))
            return false;
        return excludedSpawns.every((spawn) => {
            const s = (0, hex_1.axialToPixel)(spawn, config_1.CONFIG.HEX_SIZE);
            return Math.hypot(p.x - s.x, p.y - s.y) >= config_1.CONFIG.TOTEMS.SPAWN_CLEARANCE;
        });
    });
    for (let i = candidates.length - 1; i > 0; i--) {
        const j = Math.floor(random() * (i + 1));
        [candidates[i], candidates[j]] = [candidates[j], candidates[i]];
    }
    const kinds = [
        ...new Array(config_1.CONFIG.TOTEMS.SPEED.COUNT).fill("speed"),
        ...new Array(config_1.CONFIG.TOTEMS.SLOW.COUNT).fill("slow"),
        ...new Array(config_1.CONFIG.TOTEMS.RADAR.COUNT).fill("radar"),
    ];
    const out = [];
    for (const kind of kinds) {
        const index = candidates.findIndex((candidate) => {
            const p = (0, hex_1.axialToPixel)(candidate, config_1.CONFIG.HEX_SIZE);
            return out.every((item) => {
                const other = (0, hex_1.axialToPixel)(item, config_1.CONFIG.HEX_SIZE);
                return Math.hypot(p.x - other.x, p.y - other.y) >= config_1.CONFIG.TOTEMS.MIN_SPAWN_DISTANCE;
            });
        });
        if (index < 0)
            break;
        const [cell] = candidates.splice(index, 1);
        out.push({ id: out.length, kind, q: cell.q, r: cell.r, ownerId: -1 });
    }
    return out;
}
