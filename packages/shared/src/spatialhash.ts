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

export class SpatialHash<T extends Point> {
  private buckets = new Map<number, T[]>();
  private items: T[] = [];
  private readonly inv: number;

  constructor(private readonly cellSize: number) {
    this.inv = 1 / cellSize;
  }

  clear(): void {
    this.buckets.clear();
    this.items.length = 0;
  }

  private bucketKey(bx: number, by: number): number {
    // Gộp 2 chỉ số bucket thành 1 khoá số (offset để chịu số âm). Đủ chỗ cho |bucket| < 2^15.
    return (bx + 0x8000) * 0x10000 + (by + 0x8000);
  }

  insert(item: T): void {
    const bx = Math.floor(item.x * this.inv);
    const by = Math.floor(item.y * this.inv);
    const k = this.bucketKey(bx, by);
    const arr = this.buckets.get(k);
    if (arr) arr.push(item);
    else this.buckets.set(k, [item]);
    this.items.push(item);
  }

  /** Mọi item trong bán kính `r` quanh (x,y) (quét các bucket phủ r). */
  query(x: number, y: number, r: number): T[] {
    const out: T[] = [];
    const r2 = r * r;
    const minbx = Math.floor((x - r) * this.inv);
    const maxbx = Math.floor((x + r) * this.inv);
    const minby = Math.floor((y - r) * this.inv);
    const maxby = Math.floor((y + r) * this.inv);
    for (let bx = minbx; bx <= maxbx; bx++) {
      for (let by = minby; by <= maxby; by++) {
        const arr = this.buckets.get(this.bucketKey(bx, by));
        if (!arr) continue;
        for (const it of arr) {
          const dx = it.x - x;
          const dy = it.y - y;
          if (dx * dx + dy * dy <= r2) out.push(it);
        }
      }
    }
    return out;
  }

  /**
   * Duyệt mọi CẶP item khác nhau cách nhau ≤ r đúng MỘT lần. Cần `cellSize >= r`.
   * Cặp không trùng lặp nhờ chỉ ghép với item ở bucket "phía sau" hoặc cùng bucket có
   * chỉ số lớn hơn — nhưng để đơn giản & tất định, ta gom ứng viên rồi để caller lọc
   * theo id. Ở đây khử trùng bằng con trỏ tham chiếu (Set) là đủ cho n nhỏ mỗi bucket.
   */
  forEachPair(r: number, cb: (a: T, b: T) => void): void {
    const r2 = r * r;
    const seen = new Set<T>();
    for (const a of this.items) {
      const near = this.query(a.x, a.y, r);
      for (const b of near) {
        if (b === a || seen.has(b)) continue;
        const dx = a.x - b.x;
        const dy = a.y - b.y;
        if (dx * dx + dy * dy <= r2) cb(a, b);
      }
      seen.add(a);
    }
  }
}
