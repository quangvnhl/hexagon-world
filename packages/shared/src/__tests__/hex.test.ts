import { describe, it, expect } from "vitest";
import {
  mapCells,
  hexLinedraw,
  keyOf,
  axialToPixel,
  pixelToAxial,
  type Axial,
} from "../hex";

describe("mapCells", () => {
  // Số ô của bản đồ lục giác bán kính R phải bằng 3R² + 3R + 1.
  it.each([0, 1, 2, 5, 26])("R=%i → 3R²+3R+1 ô", (R: number) => {
    expect(mapCells(R).size).toBe(3 * R * R + 3 * R + 1);
  });
});

describe("hexLinedraw", () => {
  it("(0,0)→(3,0) cho 4 ô liên tiếp theo trục q", () => {
    const line = hexLinedraw({ q: 0, r: 0 }, { q: 3, r: 0 }).map(keyOf);
    expect(line.join(" ")).toBe("0,0 1,0 2,0 3,0");
  });

  it("(0,0)→(0,3) cho 4 ô liên tiếp theo trục r", () => {
    const line = hexLinedraw({ q: 0, r: 0 }, { q: 0, r: 3 }).map(keyOf);
    expect(line.join(" ")).toBe("0,0 0,1 0,2 0,3");
  });

  it("đường đi liền mạch: mỗi bước là 1 ô kề (cube distance = 1)", () => {
    const cells = hexLinedraw({ q: -2, r: 1 }, { q: 3, r: -2 });
    // Gồm cả 2 đầu; các ô kề nhau đúng khoảng cách 1.
    const dist = (a: Axial, b: Axial) => {
      const ax = a.q, az = a.r, ay = -ax - az;
      const bx = b.q, bz = b.r, by = -bx - bz;
      return (Math.abs(ax - bx) + Math.abs(ay - by) + Math.abs(az - bz)) / 2;
    };
    for (let i = 1; i < cells.length; i++) {
      expect(dist(cells[i - 1], cells[i])).toBe(1);
    }
  });

  it("cùng 1 ô → trả về đúng ô đó", () => {
    expect(hexLinedraw({ q: 2, r: -1 }, { q: 2, r: -1 }).map(keyOf)).toEqual([
      "2,-1",
    ]);
  });
});

describe("axialToPixel ↔ pixelToAxial round-trip", () => {
  const coords: Axial[] = [
    { q: 0, r: 0 },
    { q: 1, r: 0 },
    { q: 0, r: 1 },
    { q: 3, r: -2 },
    { q: -4, r: 2 },
    { q: -1, r: -1 },
    { q: 5, r: 5 },
    { q: -6, r: 3 },
  ];
  it.each(coords)("(%o) ổn định sau chuyển đổi qua pixel", (a: Axial) => {
    const size = 0.75;
    const p = axialToPixel(a, size);
    const back = pixelToAxial(p.x, p.y, size);
    expect(back).toEqual(a);
  });

  it("giữ ổn định với nhiều kích thước hex", () => {
    for (const size of [0.5, 1, 2, 3.3]) {
      for (const a of coords) {
        const p = axialToPixel(a, size);
        expect(pixelToAxial(p.x, p.y, size)).toEqual(a);
      }
    }
  });
});
