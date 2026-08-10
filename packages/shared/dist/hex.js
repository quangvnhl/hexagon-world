"use strict";
// Toán học lưới lục giác — pointy-top, toạ độ axial (q, r).
// Không import Three/React ở đây (để sau bê sang packages/shared).
// Tham chiếu: Red Blob Games "Hexagonal Grids".
Object.defineProperty(exports, "__esModule", { value: true });
exports.DIRECTIONS = void 0;
exports.key = key;
exports.keyOf = keyOf;
exports.parseKey = parseKey;
exports.neighbor = neighbor;
exports.neighbors = neighbors;
exports.opposite = opposite;
exports.cubeDistance = cubeDistance;
exports.axialToPixel = axialToPixel;
exports.pixelToAxialFractional = pixelToAxialFractional;
exports.roundCube = roundCube;
exports.cubeRound = cubeRound;
exports.hexLinedraw = hexLinedraw;
exports.pixelToAxial = pixelToAxial;
exports.mapRect = mapRect;
exports.mapCells = mapCells;
exports.dirFromVector = dirFromVector;
function key(q, r) {
    return q + "," + r;
}
function keyOf(a) {
    return key(a.q, a.r);
}
function parseKey(k) {
    const i = k.indexOf(",");
    return { q: Number(k.slice(0, i)), r: Number(k.slice(i + 1)) };
}
// 6 hướng láng giềng (pointy-top). Chỉ số 0..5.
exports.DIRECTIONS = [
    { q: 1, r: 0 },
    { q: 1, r: -1 },
    { q: 0, r: -1 },
    { q: -1, r: 0 },
    { q: -1, r: 1 },
    { q: 0, r: 1 },
];
function neighbor(a, dir) {
    const d = exports.DIRECTIONS[((dir % 6) + 6) % 6];
    return { q: a.q + d.q, r: a.r + d.r };
}
function neighbors(a) {
    return exports.DIRECTIONS.map((d) => ({ q: a.q + d.q, r: a.r + d.r }));
}
/** Hướng ngược lại (quay đầu 180°). */
function opposite(dir) {
    return (dir + 3) % 6;
}
// --- Cube distance ---
function cubeDistance(a, b) {
    const ax = a.q;
    const az = a.r;
    const ay = -ax - az;
    const bx = b.q;
    const bz = b.r;
    const by = -bx - bz;
    return (Math.abs(ax - bx) + Math.abs(ay - by) + Math.abs(az - bz)) / 2;
}
const SQRT3 = Math.sqrt(3);
/** Axial → pixel (pointy-top). Trả về toạ độ mặt phẳng (x, y). */
function axialToPixel(a, size) {
    const x = size * (SQRT3 * a.q + (SQRT3 / 2) * a.r);
    const y = size * (1.5 * a.r);
    return { x, y };
}
/** Pixel → axial (chưa làm tròn). */
function pixelToAxialFractional(x, y, size) {
    const q = ((SQRT3 / 3) * x - (1 / 3) * y) / size;
    const r = ((2 / 3) * y) / size;
    return { q, r };
}
/** Làm tròn toạ độ cube (x,y,z) về ô gần nhất, giữ x+y+z=0. */
function roundCube(x, y, z) {
    let rx = Math.round(x);
    let ry = Math.round(y);
    let rz = Math.round(z);
    const dx = Math.abs(rx - x);
    const dy = Math.abs(ry - y);
    const dz = Math.abs(rz - z);
    if (dx > dy && dx > dz) {
        rx = -ry - rz;
    }
    else if (dy > dz) {
        ry = -rx - rz;
    }
    else {
        rz = -rx - ry;
    }
    return { q: rx, r: rz };
}
/** Làm tròn toạ độ cube từ axial phân số (q, r). */
function cubeRound(q, r) {
    return roundCube(q, -q - r, r);
}
/** Danh sách ô trên đường thẳng hex từ a → b (gồm cả 2 đầu).
 *  Dùng để "vá" các ô bị bỏ qua khi di chuyển liên tục nhanh. */
function hexLinedraw(a, b) {
    const n = cubeDistance(a, b);
    if (n === 0)
        return [{ q: a.q, r: a.r }];
    const ax = a.q;
    const az = a.r;
    const ay = -ax - az;
    const bx = b.q;
    const bz = b.r;
    const by = -bx - bz;
    const out = [];
    for (let i = 0; i <= n; i++) {
        const t = i / n;
        out.push(roundCube(ax + (bx - ax) * t, ay + (by - ay) * t, az + (bz - az) * t));
    }
    return out;
}
function pixelToAxial(x, y, size) {
    const f = pixelToAxialFractional(x, y, size);
    return cubeRound(f.q, f.r);
}
/** Tập ô hợp lệ trong SÂN HÌNH CHỮ NHẬT: mọi hex có TÂM nằm trong
 *  [-halfW, halfW] × [-halfH, halfH] (world). Cho biên thẳng. */
function mapRect(halfW, halfH, size) {
    const cells = new Set();
    const rMax = Math.ceil(halfH / (1.5 * size)) + 1;
    const qMax = Math.ceil(halfW / (SQRT3 * size)) + rMax + 1;
    for (let r = -rMax; r <= rMax; r++) {
        for (let q = -qMax; q <= qMax; q++) {
            const p = axialToPixel({ q, r }, size);
            if (Math.abs(p.x) <= halfW && Math.abs(p.y) <= halfH) {
                cells.add(key(q, r));
            }
        }
    }
    return cells;
}
/** Tập ô hợp lệ của bản đồ lục giác bán kính `radius` quanh tâm (0,0). */
function mapCells(radius) {
    const cells = new Set();
    for (let q = -radius; q <= radius; q++) {
        const rMin = Math.max(-radius, -q - radius);
        const rMax = Math.min(radius, -q + radius);
        for (let r = rMin; r <= rMax; r++) {
            cells.add(key(q, r));
        }
    }
    return cells;
}
/** Chọn chỉ số hướng (0..5) gần nhất với một vector (dx, dy) trên mặt phẳng.
 *  Lưu ý: trục y ở đây theo hệ world của axialToPixel (y tăng theo r). */
function dirFromVector(dx, dy) {
    let best = 0;
    let bestDot = -Infinity;
    for (let i = 0; i < 6; i++) {
        const p = axialToPixel(exports.DIRECTIONS[i], 1);
        const len = Math.hypot(p.x, p.y) || 1;
        const dot = (p.x / len) * dx + (p.y / len) * dy;
        if (dot > bestDot) {
            bestDot = dot;
            best = i;
        }
    }
    return best;
}
