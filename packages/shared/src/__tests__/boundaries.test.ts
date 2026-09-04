import { describe, it, expect } from "vitest";
import { GameState } from "../state";
import { key, keyOf, pixelToAxial, axialToPixel } from "../hex";
import { CONFIG } from "../config";

// [doc 36 R2 tầng 3] ĐO thay vì NHÌN.
//
// Doc 33 §5 và doc 34 để lại các mục nghiệm thu dạng "cần hiện pane để mắt thường xác nhận"
// (trượt dọc viền obstacle, biên polyline không xuyên, minimap khớp bán kính cấp). Mắt người
// không dùng làm cổng CI được, nên ở đây quy chúng về phép ĐO trên `GameState` thuần.
//
// Cách đo bám đúng mẹo đã dùng khi port Unity: chạy N tick từ trạng thái dựng sẵn rồi đo vị trí,
// thay vì chụp ảnh.

/** Cho thực thể vào trạng thái chơi ngay (bỏ 3s chuẩn bị). */
function play(g: GameState): void {
  const steps = Math.ceil(CONFIG.PREP_TIME * 60) + 2;
  for (let i = 0; i < steps; i++) g.update(1 / 60);
}

/** Đặt đầu người chơi tại (x,y) với hướng cố định. */
function placeHead(g: GameState, x: number, y: number, heading: number): void {
  const e = g.human;
  e.pos = { x, y };
  e.currentHex = pixelToAxial(x, y, CONFIG.HEX_SIZE);
  e.heading = heading;
  e.targetHeading = heading;
}

describe("Chướng ngại: hợp đồng HIỆN TẠI là barrier flood-fill, KHÔNG phải collider", () => {
  // Tường dọc 3 ô ở cột q=2 — cùng cụm dùng trong catalog Campaign.
  const wall = [key(2, -1), key(2, 0), key(2, 1)];

  // ⚠️ ĐO ĐƯỢC, KHÔNG PHẢI GIẢ ĐỊNH: doc 33 mô tả obstacle có collider (trượt dọc viền), nhưng
  // doc 34 D đã BỎ collider riêng của ô chướng ngại — xem chú thích tại `state.ts` trong
  // `updateEntity`: "Ô CHƯỚNG NGẠI KHÔNG còn collider riêng (doc 34) … Va chạm duy nhất = tường
  // biên vẽ". Test này ghim hành vi THẬT để nếu ai đó đổi lại thì CI báo, thay vì để hai tài liệu
  // mâu thuẫn âm thầm. Nếu sản phẩm muốn obstacle chặn được người chơi thì đây là test phải sửa.
  it("thực thể ĐI XUYÊN ô chướng ngại (obstacle không chặn di chuyển)", () => {
    const g = new GameState({ config: { bots: { count: 0 }, map: { obstacles: wall } } });
    play(g);
    const wallCenter = axialToPixel({ q: 2, r: 0 }, CONFIG.HEX_SIZE);
    placeHead(g, wallCenter.x - 2.2, wallCenter.y, 0); // thẳng +X vào mặt tường

    let touchedObstacle = false;
    for (let i = 0; i < 240; i++) {
      g.update(1 / 60);
      if (g.obstacles.has(keyOf(pixelToAxial(g.human.pos.x, g.human.pos.y, CONFIG.HEX_SIZE)))) touchedObstacle = true;
    }

    expect(touchedObstacle).toBe(true); // có lúc đứng TRONG ô chướng ngại
    expect(g.human.pos.x).toBeGreaterThan(wallCenter.x); // và đi hẳn sang phía bên kia
  });

  it("nhưng obstacle VẪN là barrier: bị loại khỏi ô chơi được", () => {
    const g = new GameState({ config: { bots: { count: 0 }, map: { obstacles: wall } } });
    for (const k of wall) {
      expect(g.obstacles.has(k)).toBe(true);
      expect(g.playable.has(k)).toBe(false);
    }
  });
});

describe("Biên polyline admin vẽ: tường va chạm BỔ SUNG (doc 34 D)", () => {
  /** Một đoạn biên DỌC tại x = wallX, dài từ y=-30 tới y=30. */
  function withWallAt(wallX: number) {
    return new GameState({
      config: {
        bots: { count: 0 },
        map: { boundaries: [{ id: "b1", points: [[wallX, -30], [wallX, 30]] as Array<[number, number]> }] },
      },
    });
  }

  it("đâm thẳng vào đoạn biên ⇒ KHÔNG xuyên sang phía bên kia", () => {
    const wallX = 12;
    const g = withWallAt(wallX);
    play(g);
    placeHead(g, wallX - 4, 0, 0); // đi thẳng +X vào biên

    let crossed = false;
    for (let i = 0; i < 300; i++) {
      g.update(1 / 60);
      if (g.human.pos.x > wallX) { crossed = true; break; }
    }
    expect(crossed).toBe(false);
  });

  it("đâm CHÉO vào đoạn biên ⇒ trượt dọc biên (vẫn di chuyển), không xuyên", () => {
    const wallX = 12;
    const g = withWallAt(wallX);
    play(g);
    placeHead(g, wallX - 4, 0, 0.5);

    const y0 = g.human.pos.y;
    let crossed = false;
    for (let i = 0; i < 300; i++) {
      g.update(1 / 60);
      if (g.human.pos.x > wallX) { crossed = true; break; }
    }
    expect(crossed).toBe(false);
    expect(Math.abs(g.human.pos.y - y0)).toBeGreaterThan(1);
  });

  it("KHÔNG khai boundaries ⇒ bất biến: không có tường phụ nào chặn", () => {
    const g = new GameState({ config: { bots: { count: 0 } } });
    play(g);
    placeHead(g, 0, 0, 0);
    // 300 tick = 5s, cùng ngân sách với hai ca trên để so sánh công bằng.
    for (let i = 0; i < 300; i++) g.update(1 / 60);
    // Đi tự do sang phải, vượt hẳn mốc x = 12 nơi hai ca trên bị chặn.
    expect(g.human.pos.x).toBeGreaterThan(12);
  });
});

describe("Minimap khớp bán kính CẤP (doc 34 C)", () => {
  it("arenaR / arenaInradius bám theo config, không phải hằng toàn cục", () => {
    const small = new GameState({ config: { bots: { count: 0 }, map: { radius: 20 } } });
    const big = new GameState({ config: { bots: { count: 0 }, map: { radius: 130 } } });

    expect(small.arenaR).toBe(20);
    expect(big.arenaR).toBe(130);
    // inradius = R·√3/2 (lục giác đều), và phải tỉ lệ đúng giữa hai cấp.
    expect(small.arenaInradius).toBeCloseTo(20 * (Math.sqrt(3) / 2), 5);
    expect(big.arenaInradius / small.arenaInradius).toBeCloseTo(130 / 20, 5);
  });

  it("sân nhỏ có ít ô chơi được hơn hẳn sân lớn (tỉ lệ ~ bình phương bán kính)", () => {
    const small = new GameState({ config: { bots: { count: 0 }, map: { radius: 20 } } });
    const big = new GameState({ config: { bots: { count: 0 }, map: { radius: 130 } } });
    expect(small.playable.size).toBeLessThan(big.playable.size);
  });
});
