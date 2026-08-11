"use strict";
// Hình học SÂN CHƠI hình LỤC GIÁC (flat-top) + va chạm tường tổng quát.
// Thuần TypeScript, deterministic (chỉ phụ thuộc config) — dùng lại được trên server.
//
// Sân là lục giác đều tâm (0,0), bán kính ngoại tiếp R = CONFIG.ARENA_RADIUS.
// Biên gồm 6 tường; vùng chơi = giao của 6 nửa mặt phẳng { p : p·n_k ≤ inradius }.
// Vì lồi, việc "clamp về trong" và "trượt dọc tường" đều tổng quát cho mọi pháp tuyến.
Object.defineProperty(exports, "__esModule", { value: true });
exports.WALLS = exports.WALL_LIMIT = exports.WALL_R = exports.ARENA_INRADIUS = exports.ARENA_R = void 0;
exports.insideArena = insideArena;
exports.clampInside = clampInside;
exports.slideMove = slideMove;
exports.mapArena = mapArena;
const config_1 = require("./config");
const hex_1 = require("./hex");
const SQRT3 = Math.sqrt(3);
/** Bán kính ngoại tiếp HÌNH HỌC (tâm → đỉnh) của sân. Dùng cho render/minimap/HUD. */
exports.ARENA_R = config_1.CONFIG.ARENA_RADIUS;
/** Bán kính nội tiếp HÌNH HỌC (tâm → cạnh). */
exports.ARENA_INRADIUS = (exports.ARENA_R * SQRT3) / 2;
/** Bán kính ngoại tiếp của BIÊN VA CHẠM (đã co theo WALL_SCALE) — dùng vẽ line đỏ debug. */
exports.WALL_R = exports.ARENA_R * config_1.CONFIG.WALL_SCALE;
/** Khoảng cách tâm → TƯỜNG VA CHẠM thật (inradius đã co). `clampInside`/`slideMove`/
 *  `insideArena` (và qua đó cả vùng ô hợp lệ) đều dùng giá trị này → biên vật lý trùng
 *  đường line đỏ. */
exports.WALL_LIMIT = exports.ARENA_INRADIUS * config_1.CONFIG.WALL_SCALE;
/** 6 tường của lục giác flat-top: pháp tuyến tại 30°, 90°, …, 330°. */
exports.WALLS = Array.from({ length: 6 }, (_, k) => {
    const ang = Math.PI / 6 + k * (Math.PI / 3);
    return { nx: Math.cos(ang), ny: Math.sin(ang) };
});
/** Điểm (x,y) có nằm trong sân không (nới/thu biên bằng `slack`). */
function insideArena(x, y, slack = 0) {
    const lim = exports.WALL_LIMIT + slack;
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
            const d = x * w.nx + y * w.ny - exports.WALL_LIMIT;
            if (d > 0) {
                x -= d * w.nx;
                y -= d * w.ny;
            }
        }
    }
    return { x, y };
}
/**
 * Di chuyển từ `(x,y)` theo `heading` một đoạn `dist`, TRƯỢT dọc tường ở tốc độ ĐẦY
 * ĐỦ (không chậm/đứng khi men theo biên) rồi đảm bảo điểm cuối nằm TRONG sân.
 *
 * Cách làm: bước "move-then-clamp" (dịch rồi kéo về trong lục giác) tự khử thành phần
 * pháp tuyến → phần còn lại là trượt DỌC tường; nhưng nó bị NGẮN lại (chậm) khi đâm
 * chếch. Ở đây, khi tường cắt bớt bước mà vẫn còn thành phần trượt đáng kể, ta KÉO DÀI
 * phần trượt về đủ `dist` (giữ nguyên tốc độ), rồi clamp lần nữa cho chắc trong sân.
 * Đâm gần VUÔNG GÓC hoặc ép đúng GÓC lồi (trượt quá ít) thì giữ bước đã clamp (đứng/nhích
 * nhẹ) — tránh "văng" ngang. `blocked` = bước bị tường cắt bớt (đang áp biên).
 */
function slideMove(x, y, heading, dist) {
    const vx0 = Math.cos(heading);
    const vy0 = Math.sin(heading);
    // Các tường mà bước dự định sẽ VƯỢT (điểm đích ra ngoài & vận tốc hướng ra).
    const active = [];
    for (let k = 0; k < exports.WALLS.length; k++) {
        const w = exports.WALLS[k];
        const dest = (x + vx0 * dist) * w.nx + (y + vy0 * dist) * w.ny - exports.WALL_LIMIT;
        if (dest > 0 && vx0 * w.nx + vy0 * w.ny > 0)
            active.push(k);
    }
    if (active.length === 0) {
        const c = clampInside(x + vx0 * dist, y + vy0 * dist);
        return { x: c.x, y: c.y, blocked: false };
    }
    // Bỏ thành phần PHÁP TUYẾN của các tường đang chặn → vận tốc TRƯỢT dọc tường. Lặp 2
    // lần để hội tụ khi có 2 tường (gần đỉnh).
    let vx = vx0;
    let vy = vy0;
    for (let pass = 0; pass < 2; pass++) {
        for (const k of active) {
            const w = exports.WALLS[k];
            const vn = vx * w.nx + vy * w.ny;
            if (vn > 0) {
                vx -= vn * w.nx;
                vy -= vn * w.ny;
            }
        }
    }
    let len = Math.hypot(vx, vy);
    if (len <= 1e-4) {
        if (active.length === 1) {
            // Đâm gần VUÔNG GÓC vào MỘT tường → không tự có tiếp tuyến. Chọn tiếp tuyến (CCW)
            // của tường để VẪN TRƯỢT dọc biên (không đứng khựng / không dội lại). Chỉ cần con
            // trỏ lệch nhẹ là hướng trượt tự quyết định theo ý người chơi.
            const w = exports.WALLS[active[0]];
            vx = -w.ny;
            vy = w.nx;
            len = 1;
        }
        else {
            // Ép đúng GÓC LỒI (≥2 tường ngược nhau) → không hướng thoát → đứng lại.
            return { x, y, blocked: true };
        }
    }
    // Chuẩn hoá → trượt ở TỐC ĐỘ ĐẦY ĐỦ; clamp cho chắc trong sân.
    vx /= len;
    vy /= len;
    const c = clampInside(x + vx * dist, y + vy * dist);
    return { x: c.x, y: c.y, blocked: true };
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
