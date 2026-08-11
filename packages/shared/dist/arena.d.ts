import { HexKey } from "./hex";
/** Bán kính ngoại tiếp HÌNH HỌC (tâm → đỉnh) của sân. Dùng cho render/minimap/HUD. */
export declare const ARENA_R: 130;
/** Bán kính nội tiếp HÌNH HỌC (tâm → cạnh). */
export declare const ARENA_INRADIUS: number;
/** Bán kính ngoại tiếp của BIÊN VA CHẠM (đã co theo WALL_SCALE) — dùng vẽ line đỏ debug. */
export declare const WALL_R: number;
/** Khoảng cách tâm → TƯỜNG VA CHẠM thật (inradius đã co). `clampInside`/`slideMove`/
 *  `insideArena` (và qua đó cả vùng ô hợp lệ) đều dùng giá trị này → biên vật lý trùng
 *  đường line đỏ. */
export declare const WALL_LIMIT: number;
export interface Wall {
    /** Pháp tuyến đơn vị hướng RA NGOÀI. */
    nx: number;
    ny: number;
}
/** 6 tường của lục giác flat-top: pháp tuyến tại 30°, 90°, …, 330°. */
export declare const WALLS: Wall[];
/** Điểm (x,y) có nằm trong sân không (nới/thu biên bằng `slack`). */
export declare function insideArena(x: number, y: number, slack?: number): boolean;
/** Kéo điểm trở về TRONG lục giác lồi (chiếu lên các nửa mặt phẳng bị vi phạm). */
export declare function clampInside(x: number, y: number): {
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
export declare function slideMove(x: number, y: number, heading: number, dist: number): {
    x: number;
    y: number;
    blocked: boolean;
};
/**
 * Tập ô hợp lệ: mọi hex có TÂM nằm trong sân, nới thêm `margin` world units để tạo
 * vành ô "biên ngoài" (cho flood fill) và đảm bảo vị trí clamp luôn rơi vào ô hợp lệ.
 */
export declare function mapArena(margin: number): Set<HexKey>;
