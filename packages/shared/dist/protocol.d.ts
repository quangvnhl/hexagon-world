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
export declare const TAG: {
    readonly INPUT: 2;
    readonly SNAPSHOT: 102;
    readonly TERRITORY: 103;
};
export type C2SControl = {
    t: "join";
    name: string;
} | {
    t: "ping";
    time: number;
} | {
    t: "revive";
};
export type S2CControl = {
    t: "welcome";
    playerId: number;
    arenaRadius: number;
    hexSize: number;
    tickRate: number;
    seed: number;
    /** Số ghế người + số bot của PHÒNG (authoritative) → client dựng view khớp đúng. */
    maxPlayers: number;
    botCount: number;
} | {
    t: "pong";
    time: number;
} | {
    /** Trạng thái PHÒNG CHỜ (online): số người thật hiện có / số cần để bắt đầu.
     *  started=false → đang chờ (client hiện màn "chờ người chơi"); true → đã vào trận. */
    t: "lobby";
    present: number;
    needed: number;
    started: boolean;
} | {
    /** Danh sách TÊN người chơi theo ghế (id → name) → client hiển thị đúng tên. */
    t: "roster";
    players: {
        id: number;
        name: string;
    }[];
} | {
    t: "event";
    kind: "death";
    id: number;
    cause: DeathCause;
    killerId: number;
} | {
    t: "event";
    kind: "win";
    winnerId: number;
} | {
    t: "event";
    kind: "king";
    kingId: number;
};
export declare const encodeControl: (m: C2SControl | S2CControl) => string;
export declare function decodeControl<T = C2SControl | S2CControl>(s: string): T | null;
export declare const INPUT_BYTES = 9;
export declare function encodeInput(seq: number, heading: number): ArrayBuffer;
export interface InputMsg {
    seq: number;
    heading: number;
}
export declare function decodeInput(buf: ArrayBuffer | Uint8Array): InputMsg | null;
export declare const SNAPSHOT_HEADER = 13;
export declare const SNAPSHOT_ENTITY = 20;
/** Bit cờ của mỗi entity trong snapshot. */
export declare const FLAG: {
    readonly ALIVE: number;
    readonly HAS_TRAIL: number;
};
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
    entities: EntitySnap[];
}
export declare function encodeSnapshot(s: Snapshot): ArrayBuffer;
export declare function decodeSnapshot(buf: ArrayBuffer | Uint8Array): Snapshot | null;
export declare const TERRITORY_HEADER = 7;
export declare const TERRITORY_CELL = 6;
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
export declare function encodeTerritory(tick: number, cells: TerritoryCell[]): ArrayBuffer;
export declare function decodeTerritory(buf: ArrayBuffer | Uint8Array): TerritoryKeyframe | null;
/** Byte tag đầu của một *binary frame* (để phân loại INPUT/SNAPSHOT/TERRITORY). */
export declare function peekTag(buf: ArrayBuffer | Uint8Array): number;
