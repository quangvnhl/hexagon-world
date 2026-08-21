import { HexKey } from "./hex";
export interface Wall {
    /** Pháp tuyến đơn vị hướng RA NGOÀI. */
    nx: number;
    ny: number;
}
/** 6 tường của lục giác flat-top: pháp tuyến tại 30°, 90°, …, 330°. ĐỘC LẬP với bán kính. */
export declare const WALLS: Wall[];
/**
 * Hình học + va chạm của MỘT sân lục giác. Mọi hàm vật lý chạy mỗi tick (`clampInside`,
 * `slideMove`, `insideArena`) đọc theo bán kính/biên của instance này ⇒ mỗi ván có sân riêng.
 */
export declare class ArenaGeometry {
    /** Bán kính ngoại tiếp HÌNH HỌC (tâm → đỉnh) — render/minimap/HUD. */
    readonly arenaR: number;
    /** Bán kính nội tiếp HÌNH HỌC (tâm → cạnh). */
    readonly inradius: number;
    /** Bán kính ngoại tiếp của BIÊN VA CHẠM (đã co theo wallScale) — vẽ line đỏ debug. */
    readonly wallR: number;
    /** Khoảng cách tâm → TƯỜNG VA CHẠM thật (inradius đã co). Nguồn duy nhất cho biên vật lý. */
    readonly wallLimit: number;
    readonly hexSize: number;
    readonly walls: Wall[];
    constructor(radius?: number, wallScale?: number, hexSize?: number);
    /** Điểm (x,y) có nằm trong sân không (nới/thu biên bằng `slack`). */
    insideArena(x: number, y: number, slack?: number): boolean;
    /** Kéo điểm trở về TRONG lục giác lồi (chiếu lên các nửa mặt phẳng bị vi phạm). `inset` co biên
     *  va chạm vào trong (bán kính THÂN nhân vật) → tâm dừng cách tường ≥ inset. */
    clampInside(x: number, y: number, inset?: number): {
        x: number;
        y: number;
    };
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
    slideMove(x: number, y: number, heading: number, dist: number, inset?: number): {
        x: number;
        y: number;
        blocked: boolean;
    };
    /**
     * Tập ô hợp lệ: mọi hex có TÂM nằm trong sân, nới thêm `margin` world units để tạo
     * vành ô "biên ngoài" (cho flood fill) và đảm bảo vị trí clamp luôn rơi vào ô hợp lệ.
     */
    mapArena(margin: number): Set<HexKey>;
}
/** Sân MẶC ĐỊNH dựng từ CONFIG — dùng cho render/debug/net (single-player & client-view). */
export declare const DEFAULT_ARENA: ArenaGeometry;
/** Bán kính ngoại tiếp HÌNH HỌC (tâm → đỉnh) của sân mặc định. Dùng cho render/minimap/HUD. */
export declare const ARENA_R: number;
/** Bán kính nội tiếp HÌNH HỌC (tâm → cạnh) của sân mặc định. */
export declare const ARENA_INRADIUS: number;
/** Bán kính ngoại tiếp của BIÊN VA CHẠM sân mặc định (đã co theo WALL_SCALE). */
export declare const WALL_R: number;
/** Khoảng cách tâm → TƯỜNG VA CHẠM thật của sân mặc định. */
export declare const WALL_LIMIT: number;
/** [shim] `insideArena` trên sân mặc định. */
export declare function insideArena(x: number, y: number, slack?: number): boolean;
/** [shim] `clampInside` trên sân mặc định. */
export declare function clampInside(x: number, y: number): {
    x: number;
    y: number;
};
/** [shim] `slideMove` trên sân mặc định. */
export declare function slideMove(x: number, y: number, heading: number, dist: number): {
    x: number;
    y: number;
    blocked: boolean;
};
/** [shim] `mapArena` trên sân mặc định. */
export declare function mapArena(margin: number): Set<HexKey>;
