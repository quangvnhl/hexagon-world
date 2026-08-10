/**
 * Spatial hashing (Pha 2) — chia mặt phẳng liên tục thành lưới ô vuông cạnh `cellSize`,
 * gom thực thể theo bucket để truy vấn lân cận O(1) trung bình thay vì O(n²).
 *
 * Dùng cho **broad-phase va chạm ĐẦU**: mỗi tick đưa đầu mọi thực thể vào hash rồi lấy
 * các CẶP ứng viên trong bán kính `r` (chỉ quét 3×3 bucket quanh mỗi thực thể). Với
 * `cellSize = r`, mọi cặp cách nhau ≤ r chắc chắn rơi vào vùng 3×3 → không bỏ sót.
 *
 * (Va chạm CẮT ĐUÔI đã là O(1) qua `cellTrail: Map<HexKey,id>` — bản thân đó cũng là một
 * dạng hash không gian theo Ô. Module này bổ sung hash theo TOẠ ĐỘ liên tục.)
 */
export interface Point {
    x: number;
    y: number;
}
export declare class SpatialHash<T extends Point> {
    private readonly cellSize;
    private buckets;
    private items;
    private readonly inv;
    constructor(cellSize: number);
    clear(): void;
    private bucketKey;
    insert(item: T): void;
    /** Mọi item trong bán kính `r` quanh (x,y) (quét các bucket phủ r). */
    query(x: number, y: number, r: number): T[];
    /**
     * Duyệt mọi CẶP item khác nhau cách nhau ≤ r đúng MỘT lần. Cần `cellSize >= r`.
     * Cặp không trùng lặp nhờ chỉ ghép với item ở bucket "phía sau" hoặc cùng bucket có
     * chỉ số lớn hơn — nhưng để đơn giản & tất định, ta gom ứng viên rồi để caller lọc
     * theo id. Ở đây khử trùng bằng con trỏ tham chiếu (Set) là đủ cho n nhỏ mỗi bucket.
     */
    forEachPair(r: number, cb: (a: T, b: T) => void): void;
}
