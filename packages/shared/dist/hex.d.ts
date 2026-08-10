export interface Axial {
    q: number;
    r: number;
}
export type HexKey = string;
export declare function key(q: number, r: number): HexKey;
export declare function keyOf(a: Axial): HexKey;
export declare function parseKey(k: HexKey): Axial;
export declare const DIRECTIONS: ReadonlyArray<Axial>;
export declare function neighbor(a: Axial, dir: number): Axial;
export declare function neighbors(a: Axial): Axial[];
/** Hướng ngược lại (quay đầu 180°). */
export declare function opposite(dir: number): number;
export declare function cubeDistance(a: Axial, b: Axial): number;
/** Axial → pixel (pointy-top). Trả về toạ độ mặt phẳng (x, y). */
export declare function axialToPixel(a: Axial, size: number): {
    x: number;
    y: number;
};
/** Pixel → axial (chưa làm tròn). */
export declare function pixelToAxialFractional(x: number, y: number, size: number): {
    q: number;
    r: number;
};
/** Làm tròn toạ độ cube (x,y,z) về ô gần nhất, giữ x+y+z=0. */
export declare function roundCube(x: number, y: number, z: number): Axial;
/** Làm tròn toạ độ cube từ axial phân số (q, r). */
export declare function cubeRound(q: number, r: number): Axial;
/** Danh sách ô trên đường thẳng hex từ a → b (gồm cả 2 đầu).
 *  Dùng để "vá" các ô bị bỏ qua khi di chuyển liên tục nhanh. */
export declare function hexLinedraw(a: Axial, b: Axial): Axial[];
export declare function pixelToAxial(x: number, y: number, size: number): Axial;
/** Tập ô hợp lệ trong SÂN HÌNH CHỮ NHẬT: mọi hex có TÂM nằm trong
 *  [-halfW, halfW] × [-halfH, halfH] (world). Cho biên thẳng. */
export declare function mapRect(halfW: number, halfH: number, size: number): Set<HexKey>;
/** Tập ô hợp lệ của bản đồ lục giác bán kính `radius` quanh tâm (0,0). */
export declare function mapCells(radius: number): Set<HexKey>;
/** Chọn chỉ số hướng (0..5) gần nhất với một vector (dx, dy) trên mặt phẳng.
 *  Lưu ý: trục y ở đây theo hệ world của axialToPixel (y tăng theo r). */
export declare function dirFromVector(dx: number, dy: number): number;
