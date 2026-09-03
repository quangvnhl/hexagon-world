import { describe, it, expect } from "vitest";
import { GameState } from "../state";
import { captureEnclosed } from "../floodfill";
import { key, keyOf, neighbors, axialToPixel, type HexKey } from "../hex";
import { CONFIG } from "../config";

// S7 — ô chướng ngại như barrier nội bộ (doc 25 §1.3). Biên ngoài vẫn lục giác lồi.

describe("GameState obstacles — dựng map", () => {
  it("obstacle bị loại khỏi playable nhưng NẰM TRONG map", () => {
    const g = new GameState({ config: { bots: { count: 0 }, map: { obstacles: [key(3, 0)] } } });
    expect(g.playable.has(key(3, 0))).toBe(false);
    expect(g.map.has(key(3, 0))).toBe(true);
    expect(g.obstacles.has(key(3, 0))).toBe(true);
  });

  it("obstacle giảm đúng số ô đếm được (mẫu số %)", () => {
    const base = new GameState({ config: { bots: { count: 0 } } });
    const withObs = new GameState({
      config: { bots: { count: 0 }, map: { obstacles: [key(3, 0), key(3, 1)] } },
    });
    expect(withObs.playable.size).toBe(base.playable.size - 2);
  });

  it("map hexagon thường (không obstacle) ⇒ obstacles rỗng, bất biến", () => {
    const g = new GameState({ config: { bots: { count: 0 } } });
    expect(g.obstacles.size).toBe(0);
  });
});

describe("GameState obstacles — di chuyển", () => {
  // ⚠️ Test cũ ở đây tên là "moveTo vào ô chướng ngại bị chặn (đầu đứng nguyên)" và LUÔN xanh —
  // nhưng không phải vì obstacle chặn, mà vì `GameState` mới tạo còn ở pha CHUẨN BỊ (đứng yên 3s),
  // nên bất kỳ `moveTo` nào cũng "không dịch chuyển". Nó cho cảm giác an toàn sai: doc 34 D đã BỎ
  // collider riêng của ô chướng ngại (xem `updateEntity` trong state.ts). Hành vi thật được đo ở
  // `boundaries.test.ts`.
  it("trong pha CHUẨN BỊ thì không ai dịch chuyển (dù có obstacle hay không)", () => {
    const g = new GameState({ config: { bots: { count: 0 }, map: { obstacles: [key(3, 0)] } } });
    const p = axialToPixel({ q: 3, r: 0 }, CONFIG.HEX_SIZE);
    const before = { x: g.human.pos.x, y: g.human.pos.y };
    expect(g.human.phase).toBe("prep");
    g.moveTo(p.x, p.y);
    expect(g.human.pos.x).toBe(before.x);
    expect(g.human.pos.y).toBe(before.y);
  });
});

describe("captureEnclosed — barrier chướng ngại", () => {
  // Bản đồ nhỏ quanh tâm X=(0,0); trail = 6 ô kề bao quanh X (vòng khép kín quanh 1 ô).
  const X = { q: 0, r: 0 };
  const ring = neighbors(X).map(keyOf);
  const mapSet = new Set<HexKey>();
  for (let q = -3; q <= 3; q++) for (let r = -3; r <= 3; r++) mapSet.add(key(q, r));

  it("KHÔNG obstacle: ô bị vây (X) được chiếm", () => {
    const res = captureEnclosed(mapSet, new Set(), ring);
    expect(res.has(keyOf(X))).toBe(true);
  });

  it("CÓ obstacle tại X: X KHÔNG bị chiếm (là barrier)", () => {
    const res = captureEnclosed(mapSet, new Set(), ring, new Set([keyOf(X)]));
    expect(res.has(keyOf(X))).toBe(false);
    // chỉ còn đúng phần trail (6 ô kề), không có interior.
    for (const t of ring) expect(res.has(t)).toBe(true);
    expect(res.size).toBe(ring.length);
  });
});
