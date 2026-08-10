import { describe, it, expect } from "vitest";
import { SpatialHash } from "../spatialhash";

interface P {
  id: number;
  x: number;
  y: number;
}

describe("SpatialHash.query", () => {
  it("trả về item trong bán kính, loại item ngoài", () => {
    const h = new SpatialHash<P>(5);
    h.insert({ id: 0, x: 0, y: 0 });
    h.insert({ id: 1, x: 3, y: 0 });
    h.insert({ id: 2, x: 100, y: 100 });
    const near = h.query(0, 0, 4).map((p) => p.id).sort();
    expect(near).toEqual([0, 1]);
  });

  it("clear() dọn sạch", () => {
    const h = new SpatialHash<P>(5);
    h.insert({ id: 0, x: 0, y: 0 });
    h.clear();
    expect(h.query(0, 0, 10)).toHaveLength(0);
  });

  it("hoạt động với toạ độ âm", () => {
    const h = new SpatialHash<P>(4);
    h.insert({ id: 0, x: -30, y: -30 });
    h.insert({ id: 1, x: -31, y: -29 });
    const near = h.query(-30, -30, 3).map((p) => p.id).sort();
    expect(near).toEqual([0, 1]);
  });
});

describe("SpatialHash.forEachPair khớp brute-force O(n²)", () => {
  // Bất biến then chốt: broad-phase phải sinh ĐÚNG tập cặp cách nhau ≤ r như quét lồng —
  // không bỏ sót cặp nào (nếu sót sẽ gây bỏ lỡ va chạm đầu trong GameState).
  const bruteForce = (pts: P[], r: number): string[] => {
    const out: string[] = [];
    const r2 = r * r;
    for (let i = 0; i < pts.length; i++)
      for (let j = i + 1; j < pts.length; j++) {
        const dx = pts[i].x - pts[j].x;
        const dy = pts[i].y - pts[j].y;
        if (dx * dx + dy * dy <= r2)
          out.push(`${Math.min(pts[i].id, pts[j].id)}-${Math.max(pts[i].id, pts[j].id)}`);
      }
    return out.sort();
  };

  const collect = (h: SpatialHash<P>, r: number): string[] => {
    const out: string[] = [];
    h.forEachPair(r, (a, b) =>
      out.push(`${Math.min(a.id, b.id)}-${Math.max(a.id, b.id)}`)
    );
    return out.sort();
  };

  it("100 điểm ngẫu nhiên, r = cellSize", () => {
    let seed = 12345;
    const rng = () => {
      seed = (seed * 1103515245 + 12345) & 0x7fffffff;
      return seed / 0x7fffffff;
    };
    const R = 6;
    for (let trial = 0; trial < 20; trial++) {
      const pts: P[] = [];
      for (let i = 0; i < 100; i++)
        pts.push({ id: i, x: (rng() * 2 - 1) * 60, y: (rng() * 2 - 1) * 60 });
      const h = new SpatialHash<P>(R);
      for (const p of pts) h.insert(p);
      expect(collect(h, R)).toEqual(bruteForce(pts, R));
    }
  });

  it("mỗi cặp chỉ phát đúng MỘT lần (không trùng)", () => {
    const h = new SpatialHash<P>(5);
    h.insert({ id: 0, x: 0, y: 0 });
    h.insert({ id: 1, x: 1, y: 1 });
    h.insert({ id: 2, x: 2, y: 0 });
    const pairs = collect(h, 5);
    expect(pairs).toEqual([...new Set(pairs)].sort());
  });
});
