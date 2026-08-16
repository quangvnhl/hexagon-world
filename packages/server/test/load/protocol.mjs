/**
 * protocol.mjs — bản sao TỰ CHỨA của wire-protocol dùng cho harness load/soak.
 *
 * NGUỒN SỰ THẬT: packages/shared/src/protocol.ts (v5) + protocol-version.ts.
 * Chỉ tái hiện đúng những khung harness cần: mã hoá INPUT (client→server) và giải mã
 * đủ để XÁC NHẬN SỐNG (SNAPSHOT/TERRITORY server→client) + control JSON.
 *
 * Cố tình KHÔNG import @hexagon/shared để harness chạy được bằng `node` thuần, không cần
 * build TS. Nếu protocol.ts đổi layout thì PHẢI cập nhật file này (xem README §"Bảo trì").
 */

export const GAME_PROTOCOL_VERSION = 5;

/** Byte tag đầu của mỗi binary frame (khớp TAG trong protocol.ts). */
export const TAG = {
  INPUT: 2,
  SNAPSHOT: 102,
  TERRITORY: 103,
  TERRITORY_DELTA: 104,
  TERRITORY_MINIMAP: 105,
};

export const FLAG = {
  ALIVE: 1 << 0,
  HAS_TRAIL: 1 << 1,
  RADAR_ACTIVE: 1 << 2,
};

// ---- INPUT (client → server) ---------------------------------------------
// Layout (9 bytes, little-endian): u8 tag(2) | u32 seq | f32 heading
export const INPUT_BYTES = 9;

/** @returns {Buffer} khung input nhị phân sẵn sàng gửi qua ws (binary frame). */
export function encodeInput(seq, heading) {
  const buf = Buffer.allocUnsafe(INPUT_BYTES);
  buf.writeUInt8(TAG.INPUT, 0);
  buf.writeUInt32LE(seq >>> 0, 1);
  buf.writeFloatLE(heading, 5);
  return buf;
}

// ---- SNAPSHOT (server → client) — chỉ đọc HEADER để xác nhận sống -----------
// Header (15 bytes): u8 tag(102) | u32 tick | u32 ackSeq | u16 selfPrep
//                    | u16 kingRemaining(ds) | u16 count
export const SNAPSHOT_HEADER = 15;
export const SNAPSHOT_ENTITY = 24;

/**
 * Đọc nhẹ header snapshot: đủ cho harness (tick, ackSeq, số entity, selfPrep).
 * KHÔNG giải mã toàn bộ entity để giữ overhead client ảo thấp.
 */
export function peekSnapshot(data) {
  const buf = asBuffer(data);
  if (buf.length < SNAPSHOT_HEADER || buf.readUInt8(0) !== TAG.SNAPSHOT) return null;
  return {
    tick: buf.readUInt32LE(1),
    ackSeq: buf.readUInt32LE(5),
    selfPrep: buf.readUInt16LE(9),
    kingRemaining: buf.readUInt16LE(11) / 10,
    count: buf.readUInt16LE(13),
    bytes: buf.length,
  };
}

/** Đọc cờ radar của entity CHÍNH client (id == playerId) trong snapshot, nếu có. */
export function readSelfRadar(data, playerId) {
  const buf = asBuffer(data);
  if (buf.length < SNAPSHOT_HEADER || buf.readUInt8(0) !== TAG.SNAPSHOT) return false;
  const n = buf.readUInt16LE(13);
  let o = SNAPSHOT_HEADER;
  for (let i = 0; i < n && o + SNAPSHOT_ENTITY <= buf.length; i++) {
    if (buf.readUInt8(o) === (playerId & 0xff)) {
      return (buf.readUInt8(o + 1) & FLAG.RADAR_ACTIVE) !== 0;
    }
    o += SNAPSHOT_ENTITY;
  }
  return false;
}

/** Tag của một binary frame (để phân loại snapshot / territory / minimap). */
export function peekTag(data) {
  const buf = asBuffer(data);
  return buf.length > 0 ? buf.readUInt8(0) : -1;
}

// ---- Control (JSON, text frame) -------------------------------------------
export function encodeControl(msg) {
  return JSON.stringify(msg);
}

export function decodeControl(text) {
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

function asBuffer(data) {
  if (Buffer.isBuffer(data)) return data;
  if (data instanceof ArrayBuffer) return Buffer.from(data);
  if (ArrayBuffer.isView(data)) return Buffer.from(data.buffer, data.byteOffset, data.byteLength);
  return Buffer.from(data);
}
