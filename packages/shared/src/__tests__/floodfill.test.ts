import { describe, it, expect } from "vitest";
import { captureEnclosed } from "../floodfill";
import { mapCells, key } from "../hex";

describe("captureEnclosed", () => {
  it("bao vây thì chiếm ô bên trong và giữ đủ 7 ô", () => {
    // Mirror verify-logic [3]: owned = {(0,0)}, đuôi vòng quanh ô (1,0).
    const map = mapCells(3);
    const owned = new Set([key(0, 0)]);
    const trail = [
      key(2, 0),
      key(2, -1),
      key(1, -1),
      key(0, 1),
      key(1, 1),
    ];
    const res = captureEnclosed(map, owned, trail);

    expect(res.has(key(1, 0))).toBe(true); // ô bị nhốt được chiếm
    expect(res.size).toBe(7); // owned + interior + trail
    expect(res.has(key(0, -3))).toBe(false); // ô xa KHÔNG bị chiếm
  });

  it("kết quả luôn chứa toàn bộ đuôi", () => {
    const map = mapCells(3);
    const owned = new Set([key(0, 0)]);
    const trail = [key(2, 0), key(2, -1), key(1, -1), key(0, 1), key(1, 1)];
    const res = captureEnclosed(map, owned, trail);
    for (const t of trail) expect(res.has(t)).toBe(true);
  });

  it("không có vòng khép kín → không nhốt được ô rỗng nào (chỉ owned + trail)", () => {
    // Một đuôi thẳng, không tạo vùng kín → không chiếm thêm interior.
    const map = mapCells(3);
    const owned = new Set([key(0, 0)]);
    const trail = [key(1, 0), key(2, 0)];
    const res = captureEnclosed(map, owned, trail);
    expect(res.has(key(0, 0))).toBe(true);
    expect(res.has(key(1, 0))).toBe(true);
    expect(res.has(key(2, 0))).toBe(true);
    // Không nhốt được ô xa nào ở rìa.
    expect(res.has(key(0, -3))).toBe(false);
    expect(res.has(key(3, 0))).toBe(false);
  });
});
