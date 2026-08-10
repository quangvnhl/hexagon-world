import { HexKey } from "./hex";
/** Bán kính ngoại tiếp (tâm → đỉnh). */
export declare const ARENA_R: 60;
/** Bán kính nội tiếp (tâm → cạnh) = khoảng cách từ tâm tới mỗi tường. */
export declare const ARENA_INRADIUS: number;
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
 * Tập ô hợp lệ: mọi hex có TÂM nằm trong sân, nới thêm `margin` world units để tạo
 * vành ô "biên ngoài" (cho flood fill) và đảm bảo vị trí clamp luôn rơi vào ô hợp lệ.
 */
export declare function mapArena(margin: number): Set<HexKey>;
