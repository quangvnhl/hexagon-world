/**
 * Protocol mạng (Pha 2) — DÙNG CHUNG client + server.
 *
 * Hai kênh:
 *  - **Điều khiển** (JOIN/WELCOME/EVENT/PING/PONG): JSON qua *text frame* — hiếm, cần
 *    linh hoạt, không phải hot-path.
 *  - **Hot-path** (INPUT client→server, SNAPSHOT server→client): NHỊ PHÂN qua
 *    *binary frame* (ArrayBuffer) dùng `DataView` — gửi 20–30 Hz nên phải gọn.
 *
 * Server là AUTHORITATIVE: client chỉ gửi Ý ĐỊNH (heading), không gửi vị trí. Snapshot
 * kèm `ackSeq` = seq input cuối server đã áp cho client đó → dùng cho reconciliation.
 *
 * Ghi chú phạm vi: snapshot Pha 2 chỉ mang trạng thái THỰC THỂ (vị trí/heading/score) —
 * đủ cho prediction/interpolation + va chạm. Đồng bộ delta LÃNH THỔ theo ô là Pha 3
 * (delta compression + AoI, xem 06-multiplayer-netcode).
 */
import type { DeathCause } from "./state";

/** Byte tag đầu tiên của mỗi *binary frame*. */
export const TAG = {
  INPUT: 2,
  SNAPSHOT: 102,
  TERRITORY: 103,
} as const;

// ---- Điều khiển (JSON, text frame) ----------------------------------------

export type C2SControl =
  | { t: "join"; name: string }
  | { t: "ping"; time: number }
  | { t: "revive" };

export type S2CControl =
  | {
      t: "welcome";
      playerId: number;
      arenaRadius: number;
      hexSize: number;
      tickRate: number;
      seed: number;
      /** Số ghế người + số bot của PHÒNG (authoritative) → client dựng view khớp đúng. */
      maxPlayers: number;
      botCount: number;
    }
  | { t: "pong"; time: number }
  | {
      /** Trạng thái PHÒNG CHỜ (online): số người thật hiện có / số cần để bắt đầu.
       *  started=false → đang chờ (client hiện màn "chờ người chơi"); true → đã vào trận. */
      t: "lobby";
      present: number;
      needed: number;
      started: boolean;
    }
  | {
      /** Danh sách TÊN người chơi theo ghế (id → name) → client hiển thị đúng tên. */
      t: "roster";
      players: { id: number; name: string }[];
    }
  | { t: "event"; kind: "death"; id: number; cause: DeathCause; killerId: number }
  | { t: "event"; kind: "win"; winnerId: number }
  | { t: "event"; kind: "king"; kingId: number };

export const encodeControl = (m: C2SControl | S2CControl): string =>
  JSON.stringify(m);

export function decodeControl<T = C2SControl | S2CControl>(s: string): T | null {
  try {
    return JSON.parse(s) as T;
  } catch {
    return null;
  }
}

// ---- INPUT (client → server, binary) --------------------------------------
// Layout (9 bytes, little-endian): u8 tag(2) | u32 seq | f32 heading
export const INPUT_BYTES = 9;

export function encodeInput(seq: number, heading: number): ArrayBuffer {
  const buf = new ArrayBuffer(INPUT_BYTES);
  const dv = new DataView(buf);
  dv.setUint8(0, TAG.INPUT);
  dv.setUint32(1, seq >>> 0, true);
  dv.setFloat32(5, heading, true);
  return buf;
}

export interface InputMsg {
  seq: number;
  heading: number;
}

export function decodeInput(buf: ArrayBuffer | Uint8Array): InputMsg | null {
  const dv = toDataView(buf);
  if (dv.byteLength < INPUT_BYTES || dv.getUint8(0) !== TAG.INPUT) return null;
  return { seq: dv.getUint32(1, true), heading: dv.getFloat32(5, true) };
}

// ---- SNAPSHOT (server → client, binary) -----------------------------------
// Header (15 bytes): u8 tag(102) | u32 tick | u32 ackSeq | u16 selfPrep(ms)
//                    | u16 kingHold(deciseconds) | u16 count
//   selfPrep = số ms chuẩn bị còn lại của CHÍNH client nhận (0 nếu đang chơi/chết) →
//   client hiện đếm ngược "3,2,1" và biết vì sao chưa di chuyển được.
//   kingHold = số 0.1-giây (deciseconds) còn phải giữ ngôi KING để thắng, do server tính
//   (client không chạy mô phỏng nên phải nhận số này để đếm ngược đồng hồ 3 phút).
// Mỗi entity (20 bytes): u8 id | u8 flags | u8 colorIndex | u8 _pad
//                        | f32 x | f32 y | f32 heading | u16 score | u16 _pad
export const SNAPSHOT_HEADER = 15;
export const SNAPSHOT_ENTITY = 20;

/** Bit cờ của mỗi entity trong snapshot. */
export const FLAG = {
  ALIVE: 1 << 0,
  HAS_TRAIL: 1 << 1,
} as const;

export interface EntitySnap {
  id: number;
  alive: boolean;
  hasTrail: boolean;
  colorIndex: number;
  x: number;
  y: number;
  heading: number;
  /** Số ô đất (playable) đang sở hữu — cho HUD/xếp hạng. */
  score: number;
}

export interface Snapshot {
  tick: number;
  /** Seq input cuối server đã áp cho client nhận snapshot này (reconciliation). */
  ackSeq: number;
  /** Ms chuẩn bị còn lại của CHÍNH client nhận (0 nếu đang chơi/chết). */
  selfPrep: number;
  /** Giây còn phải giữ ngôi KING để thắng (do server tính; 0/đầy khi chưa có KING).
   *  Bỏ trống khi mã hoá → coi là 0. Truyền qua wire dưới dạng deciseconds. */
  kingHold?: number;
  entities: EntitySnap[];
}

export function encodeSnapshot(s: Snapshot): ArrayBuffer {
  const n = s.entities.length;
  const buf = new ArrayBuffer(SNAPSHOT_HEADER + n * SNAPSHOT_ENTITY);
  const dv = new DataView(buf);
  dv.setUint8(0, TAG.SNAPSHOT);
  dv.setUint32(1, s.tick >>> 0, true);
  dv.setUint32(5, s.ackSeq >>> 0, true);
  dv.setUint16(9, Math.min(0xffff, Math.max(0, s.selfPrep | 0)), true);
  const kingDs = Math.round((s.kingHold ?? 0) * 10);
  dv.setUint16(11, Math.min(0xffff, Math.max(0, kingDs)), true);
  dv.setUint16(13, n, true);
  let o = SNAPSHOT_HEADER;
  for (const e of s.entities) {
    let flags = 0;
    if (e.alive) flags |= FLAG.ALIVE;
    if (e.hasTrail) flags |= FLAG.HAS_TRAIL;
    dv.setUint8(o, e.id & 0xff);
    dv.setUint8(o + 1, flags);
    dv.setUint8(o + 2, e.colorIndex & 0xff);
    dv.setUint8(o + 3, 0);
    dv.setFloat32(o + 4, e.x, true);
    dv.setFloat32(o + 8, e.y, true);
    dv.setFloat32(o + 12, e.heading, true);
    dv.setUint16(o + 16, Math.min(0xffff, Math.max(0, e.score | 0)), true);
    dv.setUint16(o + 18, 0, true);
    o += SNAPSHOT_ENTITY;
  }
  return buf;
}

export function decodeSnapshot(buf: ArrayBuffer | Uint8Array): Snapshot | null {
  const dv = toDataView(buf);
  if (dv.byteLength < SNAPSHOT_HEADER || dv.getUint8(0) !== TAG.SNAPSHOT)
    return null;
  const tick = dv.getUint32(1, true);
  const ackSeq = dv.getUint32(5, true);
  const selfPrep = dv.getUint16(9, true);
  const kingHold = dv.getUint16(11, true) / 10;
  const n = dv.getUint16(13, true);
  if (dv.byteLength < SNAPSHOT_HEADER + n * SNAPSHOT_ENTITY) return null;
  const entities: EntitySnap[] = [];
  let o = SNAPSHOT_HEADER;
  for (let i = 0; i < n; i++) {
    const flags = dv.getUint8(o + 1);
    entities.push({
      id: dv.getUint8(o),
      alive: (flags & FLAG.ALIVE) !== 0,
      hasTrail: (flags & FLAG.HAS_TRAIL) !== 0,
      colorIndex: dv.getUint8(o + 2),
      x: dv.getFloat32(o + 4, true),
      y: dv.getFloat32(o + 8, true),
      heading: dv.getFloat32(o + 12, true),
      score: dv.getUint16(o + 16, true),
    });
    o += SNAPSHOT_ENTITY;
  }
  return { tick, ackSeq, selfPrep, kingHold, entities };
}

// ---- TERRITORY keyframe (server → client, binary) -------------------------
// Đồng bộ LÃNH THỔ theo ô cho chế độ online (Pha 2 gửi FULL keyframe, throttle vài Hz;
// delta compression + AoI để Pha 3). Cho phép client dựng lại lưới đất/đuôi để render
// y hệt chơi đơn.
// Header (7 bytes): u8 tag(103) | u32 tick | u16 count
// Mỗi ô (6 bytes): i16 q | i16 r | u8 owner | u8 kind (0=đất owned, 1=đuôi trail)
export const TERRITORY_HEADER = 7;
export const TERRITORY_CELL = 6;

/** Một ô lãnh thổ trên wire. `kind`: 0 = đất (owned), 1 = đuôi (trail). */
export interface TerritoryCell {
  q: number;
  r: number;
  owner: number;
  kind: 0 | 1;
}

export interface TerritoryKeyframe {
  tick: number;
  cells: TerritoryCell[];
}

export function encodeTerritory(tick: number, cells: TerritoryCell[]): ArrayBuffer {
  const n = cells.length;
  const buf = new ArrayBuffer(TERRITORY_HEADER + n * TERRITORY_CELL);
  const dv = new DataView(buf);
  dv.setUint8(0, TAG.TERRITORY);
  dv.setUint32(1, tick >>> 0, true);
  dv.setUint16(5, n, true);
  let o = TERRITORY_HEADER;
  for (const c of cells) {
    dv.setInt16(o, c.q, true);
    dv.setInt16(o + 2, c.r, true);
    dv.setUint8(o + 4, c.owner & 0xff);
    dv.setUint8(o + 5, c.kind & 0xff);
    o += TERRITORY_CELL;
  }
  return buf;
}

export function decodeTerritory(
  buf: ArrayBuffer | Uint8Array
): TerritoryKeyframe | null {
  const dv = toDataView(buf);
  if (dv.byteLength < TERRITORY_HEADER || dv.getUint8(0) !== TAG.TERRITORY)
    return null;
  const tick = dv.getUint32(1, true);
  const n = dv.getUint16(5, true);
  if (dv.byteLength < TERRITORY_HEADER + n * TERRITORY_CELL) return null;
  const cells: TerritoryCell[] = [];
  let o = TERRITORY_HEADER;
  for (let i = 0; i < n; i++) {
    cells.push({
      q: dv.getInt16(o, true),
      r: dv.getInt16(o + 2, true),
      owner: dv.getUint8(o + 4),
      kind: (dv.getUint8(o + 5) === 1 ? 1 : 0) as 0 | 1,
    });
    o += TERRITORY_CELL;
  }
  return { tick, cells };
}

/** Byte tag đầu của một *binary frame* (để phân loại INPUT/SNAPSHOT/TERRITORY). */
export function peekTag(buf: ArrayBuffer | Uint8Array): number {
  const dv = toDataView(buf);
  return dv.byteLength > 0 ? dv.getUint8(0) : -1;
}

function toDataView(buf: ArrayBuffer | Uint8Array): DataView {
  return buf instanceof Uint8Array
    ? new DataView(buf.buffer, buf.byteOffset, buf.byteLength)
    : new DataView(buf);
}
