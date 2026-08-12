"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.TERRITORY_CELL = exports.TERRITORY_HEADER = exports.FLAG = exports.SNAPSHOT_ENTITY = exports.SNAPSHOT_HEADER = exports.INPUT_BYTES = exports.encodeControl = exports.TAG = void 0;
exports.decodeControl = decodeControl;
exports.encodeInput = encodeInput;
exports.decodeInput = decodeInput;
exports.encodeSnapshot = encodeSnapshot;
exports.decodeSnapshot = decodeSnapshot;
exports.encodeTerritory = encodeTerritory;
exports.decodeTerritory = decodeTerritory;
exports.peekTag = peekTag;
/** Byte tag đầu tiên của mỗi *binary frame*. */
exports.TAG = {
    INPUT: 2,
    SNAPSHOT: 102,
    TERRITORY: 103,
};
const encodeControl = (m) => JSON.stringify(m);
exports.encodeControl = encodeControl;
function decodeControl(s) {
    try {
        return JSON.parse(s);
    }
    catch {
        return null;
    }
}
// ---- INPUT (client → server, binary) --------------------------------------
// Layout (9 bytes, little-endian): u8 tag(2) | u32 seq | f32 heading
exports.INPUT_BYTES = 9;
function encodeInput(seq, heading) {
    const buf = new ArrayBuffer(exports.INPUT_BYTES);
    const dv = new DataView(buf);
    dv.setUint8(0, exports.TAG.INPUT);
    dv.setUint32(1, seq >>> 0, true);
    dv.setFloat32(5, heading, true);
    return buf;
}
function decodeInput(buf) {
    const dv = toDataView(buf);
    if (dv.byteLength < exports.INPUT_BYTES || dv.getUint8(0) !== exports.TAG.INPUT)
        return null;
    return { seq: dv.getUint32(1, true), heading: dv.getFloat32(5, true) };
}
// ---- SNAPSHOT (server → client, binary) -----------------------------------
// Header (15 bytes): u8 tag(102) | u32 tick | u32 ackSeq | u16 selfPrep(ms)
//                    | u16 kingHold(deciseconds) | u16 count
//   selfPrep = số ms chuẩn bị còn lại của CHÍNH client nhận (0 nếu đang chơi/chết) →
//   client hiện đếm ngược "3,2,1" và biết vì sao chưa di chuyển được.
//   kingHold = số 0.1-giây (deciseconds) còn phải giữ ngôi KING để thắng, do server tính
//   (client không chạy mô phỏng nên phải nhận số này để đếm ngược đồng hồ 3 phút).
// Mỗi entity (20 bytes): u8 id | u8 flags | u8 colorIndex | u8 shapeIndex
//                        | f32 x | f32 y | f32 heading | u16 score
//                        | u8 trailPatternIndex | u8 _pad
exports.SNAPSHOT_HEADER = 15;
exports.SNAPSHOT_ENTITY = 20;
/** Bit cờ của mỗi entity trong snapshot. */
exports.FLAG = {
    ALIVE: 1 << 0,
    HAS_TRAIL: 1 << 1,
};
function encodeSnapshot(s) {
    const n = s.entities.length;
    const buf = new ArrayBuffer(exports.SNAPSHOT_HEADER + n * exports.SNAPSHOT_ENTITY);
    const dv = new DataView(buf);
    dv.setUint8(0, exports.TAG.SNAPSHOT);
    dv.setUint32(1, s.tick >>> 0, true);
    dv.setUint32(5, s.ackSeq >>> 0, true);
    dv.setUint16(9, Math.min(0xffff, Math.max(0, s.selfPrep | 0)), true);
    const kingDs = Math.round((s.kingHold ?? 0) * 10);
    dv.setUint16(11, Math.min(0xffff, Math.max(0, kingDs)), true);
    dv.setUint16(13, n, true);
    let o = exports.SNAPSHOT_HEADER;
    for (const e of s.entities) {
        let flags = 0;
        if (e.alive)
            flags |= exports.FLAG.ALIVE;
        if (e.hasTrail)
            flags |= exports.FLAG.HAS_TRAIL;
        dv.setUint8(o, e.id & 0xff);
        dv.setUint8(o + 1, flags);
        dv.setUint8(o + 2, e.colorIndex & 0xff);
        dv.setUint8(o + 3, e.shapeIndex & 0xff);
        dv.setFloat32(o + 4, e.x, true);
        dv.setFloat32(o + 8, e.y, true);
        dv.setFloat32(o + 12, e.heading, true);
        dv.setUint16(o + 16, Math.min(0xffff, Math.max(0, e.score | 0)), true);
        dv.setUint8(o + 18, e.trailPatternIndex & 0xff);
        dv.setUint8(o + 19, 0);
        o += exports.SNAPSHOT_ENTITY;
    }
    return buf;
}
function decodeSnapshot(buf) {
    const dv = toDataView(buf);
    if (dv.byteLength < exports.SNAPSHOT_HEADER || dv.getUint8(0) !== exports.TAG.SNAPSHOT)
        return null;
    const tick = dv.getUint32(1, true);
    const ackSeq = dv.getUint32(5, true);
    const selfPrep = dv.getUint16(9, true);
    const kingHold = dv.getUint16(11, true) / 10;
    const n = dv.getUint16(13, true);
    if (dv.byteLength < exports.SNAPSHOT_HEADER + n * exports.SNAPSHOT_ENTITY)
        return null;
    const entities = [];
    let o = exports.SNAPSHOT_HEADER;
    for (let i = 0; i < n; i++) {
        const flags = dv.getUint8(o + 1);
        entities.push({
            id: dv.getUint8(o),
            alive: (flags & exports.FLAG.ALIVE) !== 0,
            hasTrail: (flags & exports.FLAG.HAS_TRAIL) !== 0,
            colorIndex: dv.getUint8(o + 2),
            shapeIndex: dv.getUint8(o + 3),
            x: dv.getFloat32(o + 4, true),
            y: dv.getFloat32(o + 8, true),
            heading: dv.getFloat32(o + 12, true),
            score: dv.getUint16(o + 16, true),
            trailPatternIndex: dv.getUint8(o + 18),
        });
        o += exports.SNAPSHOT_ENTITY;
    }
    return { tick, ackSeq, selfPrep, kingHold, entities };
}
// ---- TERRITORY keyframe (server → client, binary) -------------------------
// Đồng bộ LÃNH THỔ theo ô cho chế độ online (Pha 2 gửi FULL keyframe, throttle vài Hz;
// delta compression + AoI để Pha 3). Cho phép client dựng lại lưới đất/đuôi để render
// y hệt chơi đơn.
// Header (7 bytes): u8 tag(103) | u32 tick | u16 count
// Mỗi ô (6 bytes): i16 q | i16 r | u8 owner | u8 kind (0=đất owned, 1=đuôi trail)
exports.TERRITORY_HEADER = 7;
exports.TERRITORY_CELL = 6;
function encodeTerritory(tick, cells) {
    const n = cells.length;
    const buf = new ArrayBuffer(exports.TERRITORY_HEADER + n * exports.TERRITORY_CELL);
    const dv = new DataView(buf);
    dv.setUint8(0, exports.TAG.TERRITORY);
    dv.setUint32(1, tick >>> 0, true);
    dv.setUint16(5, n, true);
    let o = exports.TERRITORY_HEADER;
    for (const c of cells) {
        dv.setInt16(o, c.q, true);
        dv.setInt16(o + 2, c.r, true);
        dv.setUint8(o + 4, c.owner & 0xff);
        dv.setUint8(o + 5, c.kind & 0xff);
        o += exports.TERRITORY_CELL;
    }
    return buf;
}
function decodeTerritory(buf) {
    const dv = toDataView(buf);
    if (dv.byteLength < exports.TERRITORY_HEADER || dv.getUint8(0) !== exports.TAG.TERRITORY)
        return null;
    const tick = dv.getUint32(1, true);
    const n = dv.getUint16(5, true);
    if (dv.byteLength < exports.TERRITORY_HEADER + n * exports.TERRITORY_CELL)
        return null;
    const cells = [];
    let o = exports.TERRITORY_HEADER;
    for (let i = 0; i < n; i++) {
        cells.push({
            q: dv.getInt16(o, true),
            r: dv.getInt16(o + 2, true),
            owner: dv.getUint8(o + 4),
            kind: (dv.getUint8(o + 5) === 1 ? 1 : 0),
        });
        o += exports.TERRITORY_CELL;
    }
    return { tick, cells };
}
/** Byte tag đầu của một *binary frame* (để phân loại INPUT/SNAPSHOT/TERRITORY). */
function peekTag(buf) {
    const dv = toDataView(buf);
    return dv.byteLength > 0 ? dv.getUint8(0) : -1;
}
function toDataView(buf) {
    return buf instanceof Uint8Array
        ? new DataView(buf.buffer, buf.byteOffset, buf.byteLength)
        : new DataView(buf);
}
