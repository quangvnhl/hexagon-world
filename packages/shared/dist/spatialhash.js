"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.SpatialHash = void 0;
class SpatialHash {
    constructor(cellSize) {
        this.cellSize = cellSize;
        this.buckets = new Map();
        this.items = [];
        this.inv = 1 / cellSize;
    }
    clear() {
        this.buckets.clear();
        this.items.length = 0;
    }
    bucketKey(bx, by) {
        // Gộp 2 chỉ số bucket thành 1 khoá số (offset để chịu số âm). Đủ chỗ cho |bucket| < 2^15.
        return (bx + 0x8000) * 0x10000 + (by + 0x8000);
    }
    insert(item) {
        const bx = Math.floor(item.x * this.inv);
        const by = Math.floor(item.y * this.inv);
        const k = this.bucketKey(bx, by);
        const arr = this.buckets.get(k);
        if (arr)
            arr.push(item);
        else
            this.buckets.set(k, [item]);
        this.items.push(item);
    }
    /** Mọi item trong bán kính `r` quanh (x,y) (quét các bucket phủ r). */
    query(x, y, r) {
        const out = [];
        const r2 = r * r;
        const minbx = Math.floor((x - r) * this.inv);
        const maxbx = Math.floor((x + r) * this.inv);
        const minby = Math.floor((y - r) * this.inv);
        const maxby = Math.floor((y + r) * this.inv);
        for (let bx = minbx; bx <= maxbx; bx++) {
            for (let by = minby; by <= maxby; by++) {
                const arr = this.buckets.get(this.bucketKey(bx, by));
                if (!arr)
                    continue;
                for (const it of arr) {
                    const dx = it.x - x;
                    const dy = it.y - y;
                    if (dx * dx + dy * dy <= r2)
                        out.push(it);
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
    forEachPair(r, cb) {
        const r2 = r * r;
        const seen = new Set();
        for (const a of this.items) {
            const near = this.query(a.x, a.y, r);
            for (const b of near) {
                if (b === a || seen.has(b))
                    continue;
                const dx = a.x - b.x;
                const dy = a.y - b.y;
                if (dx * dx + dy * dy <= r2)
                    cb(a, b);
            }
            seen.add(a);
        }
    }
}
exports.SpatialHash = SpatialHash;
