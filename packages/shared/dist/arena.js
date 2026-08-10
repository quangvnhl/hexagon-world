"use strict";
// Hình học SÂN CHƠI hình LỤC GIÁC (flat-top) + va chạm tường tổng quát.
// Thuần TypeScript, deterministic (chỉ phụ thuộc config) — dùng lại được trên server.
//
// Sân là lục giác đều tâm (0,0), bán kính ngoại tiếp R = CONFIG.ARENA_RADIUS.
// Biên gồm 6 tường; vùng chơi = giao của 6 nửa mặt phẳng { p : p·n_k ≤ inradius }.
// Vì lồi, việc "clamp về trong" và "trượt dọc tường" đều tổng quát cho mọi pháp tuyến.
Object.defineProperty(exports, "__esModule", { value: true });
exports.WALLS = exports.ARENA_INRADIUS = exports.ARENA_R = void 0;
exports.insideArena = insideArena;
exports.clampInside = clampInside;
exports.mapArena = mapArena;
const config_1 = require("./config");
const hex_1 = require("./hex");
const SQRT3 = Math.sqrt(3);
/** Bán kính ngoại tiếp (tâm → đỉnh). */
exports.ARENA_R = config_1.CONFIG.ARENA_RADIUS;
/** Bán kính nội tiếp (tâm → cạnh) = khoảng cách từ tâm tới mỗi tường. */
exports.ARENA_INRADIUS = (exports.ARENA_R * SQRT3) / 2;
/** 6 tường của lục giác flat-top: pháp tuyến tại 30°, 90°, …, 330°. */
exports.WALLS = Array.from({ length: 6 }, (_, k) => {
    const ang = Math.PI / 6 + k * (Math.PI / 3);
    return { nx: Math.cos(ang), ny: Math.sin(ang) };
});
/** Điểm (x,y) có nằm trong sân không (nới/thu biên bằng `slack`). */
function insideArena(x, y, slack = 0) {
    const lim = exports.ARENA_INRADIUS + slack;
    for (const w of exports.WALLS) {
        if (x * w.nx + y * w.ny > lim)
            return false;
    }
    return true;
}
/** Kéo điểm trở về TRONG lục giác lồi (chiếu lên các nửa mặt phẳng bị vi phạm). */
function clampInside(x, y) {
    for (let pass = 0; pass < 2; pass++) {
        for (const w of exports.WALLS) {
            const d = x * w.nx + y * w.ny - exports.ARENA_INRADIUS;
            if (d > 0) {
                x -= d * w.nx;
                y -= d * w.ny;
            }
        }
    }
    return { x, y };
}
/**
 * Tập ô hợp lệ: mọi hex có TÂM nằm trong sân, nới thêm `margin` world units để tạo
 * vành ô "biên ngoài" (cho flood fill) và đảm bảo vị trí clamp luôn rơi vào ô hợp lệ.
 */
function mapArena(margin) {
    const size = config_1.CONFIG.HEX_SIZE;
    const reach = exports.ARENA_R + margin + 1;
    const rMax = Math.ceil(reach / (1.5 * size)) + 1;
    const qMax = Math.ceil(reach / (SQRT3 * size)) + rMax + 1;
    const cells = new Set();
    for (let r = -rMax; r <= rMax; r++) {
        for (let q = -qMax; q <= qMax; q++) {
            const p = (0, hex_1.axialToPixel)({ q, r }, size);
            if (insideArena(p.x, p.y, margin))
                cells.add((0, hex_1.key)(q, r));
        }
    }
    return cells;
}
