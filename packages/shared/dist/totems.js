"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.baseSpeedForPct = baseSpeedForPct;
exports.effectiveSpeedWithTotems = effectiveSpeedWithTotems;
exports.createTotems = createTotems;
const config_1 = require("./config");
const hex_1 = require("./hex");
const arena_1 = require("./arena");
const clamp01 = (value) => Math.max(0, Math.min(1, value));
const DEFAULT_SPEED_CURVE = {
    min: config_1.CONFIG.SPEED.BY_KING_PCT.MIN,
    max: config_1.CONFIG.SPEED.BY_KING_PCT.MAX,
    kingPct: config_1.CONFIG.KING_PCT,
};
/** Tốc độ nền tăng tuyến tính từ min tới max khi tiến tới ngưỡng King.
 *  `curve` mặc định = CONFIG ⇒ gọi `baseSpeedForPct(pct)` cho ra kết quả cũ y hệt. */
function baseSpeedForPct(pct, curve = DEFAULT_SPEED_CURVE) {
    const t = clamp01((Number.isFinite(pct) ? pct : 0) / curve.kingPct);
    return curve.min + (curve.max - curve.min) * t;
}
const DEFAULT_EFFECTIVE_SPEED = {
    curve: DEFAULT_SPEED_CURVE,
    speedBonus: config_1.CONFIG.TOTEMS.SPEED.BONUS_PER_TOTEM,
    slowEnemySpeed: config_1.CONFIG.TOTEMS.SLOW.ENEMY_SPEED,
};
/** Slow là override cuối; speed Totem chỉ cộng khi không nằm trong vùng Slow địch.
 *  `cfg` mặc định = CONFIG ⇒ gọi 3 tham số cho ra kết quả cũ y hệt. */
function effectiveSpeedWithTotems(pct, speedTotemCount, insideEnemySlowZone, cfg = DEFAULT_EFFECTIVE_SPEED) {
    if (insideEnemySlowZone)
        return cfg.slowEnemySpeed;
    return baseSpeedForPct(pct, cfg.curve) +
        Math.max(0, Math.floor(speedTotemCount)) * cfg.speedBonus;
}
function seededRandom(seed) {
    let state = seed >>> 0;
    return () => {
        state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
        return state / 0x100000000;
    };
}
const DEFAULT_CREATE_TOTEMS = {
    hexSize: config_1.CONFIG.HEX_SIZE,
    speedCount: config_1.CONFIG.TOTEMS.SPEED.COUNT,
    slowCount: config_1.CONFIG.TOTEMS.SLOW.COUNT,
    radarCount: config_1.CONFIG.TOTEMS.RADAR.COUNT,
    minSpawnDistance: config_1.CONFIG.TOTEMS.MIN_SPAWN_DISTANCE,
    spawnClearance: config_1.CONFIG.TOTEMS.SPAWN_CLEARANCE,
    enabled: true,
    insideArena: arena_1.insideArena,
};
/** Sinh Totem ổn định theo seed, tránh tường, spawn ban đầu và các Totem khác.
 *  `cfg` mặc định = CONFIG ⇒ giữ NGUYÊN determinism (số lượng + vị trí theo seed). */
function createTotems(playable, seed = 0, excludedSpawns = [], cfg = {}) {
    const { hexSize, speedCount, slowCount, radarCount, minSpawnDistance, spawnClearance, enabled, insideArena: inside, } = { ...DEFAULT_CREATE_TOTEMS, ...cfg };
    if (!enabled)
        return [];
    const random = seededRandom(seed);
    const candidates = [...playable].sort().map(hex_1.parseKey).filter((cell) => {
        const p = (0, hex_1.axialToPixel)(cell, hexSize);
        if (!inside(p.x, p.y, -spawnClearance))
            return false;
        return excludedSpawns.every((spawn) => {
            const s = (0, hex_1.axialToPixel)(spawn, hexSize);
            return Math.hypot(p.x - s.x, p.y - s.y) >= spawnClearance;
        });
    });
    for (let i = candidates.length - 1; i > 0; i--) {
        const j = Math.floor(random() * (i + 1));
        [candidates[i], candidates[j]] = [candidates[j], candidates[i]];
    }
    const kinds = [
        ...new Array(speedCount).fill("speed"),
        ...new Array(slowCount).fill("slow"),
        ...new Array(radarCount).fill("radar"),
    ];
    const out = [];
    for (const kind of kinds) {
        const index = candidates.findIndex((candidate) => {
            const p = (0, hex_1.axialToPixel)(candidate, hexSize);
            return out.every((item) => {
                const other = (0, hex_1.axialToPixel)(item, hexSize);
                return Math.hypot(p.x - other.x, p.y - other.y) >= minSpawnDistance;
            });
        });
        if (index < 0)
            break;
        const [cell] = candidates.splice(index, 1);
        out.push({ id: out.length, kind, q: cell.q, r: cell.r, ownerId: -1 });
    }
    return out;
}
