import { describe, it, expect } from "vitest";
import { CONFIG, insideArena } from "@hexagon/shared";
import { stepHead, normalizeAngle } from "../stepHead";

describe("normalizeAngle", () => {
  it("đưa góc về khoảng (-pi, pi]", () => {
    expect(normalizeAngle(0)).toBeCloseTo(0, 10);
    expect(normalizeAngle(Math.PI)).toBeCloseTo(Math.PI, 10);
    expect(normalizeAngle(-Math.PI)).toBeCloseTo(Math.PI, 10); // -pi -> pi
    expect(normalizeAngle(Math.PI * 2)).toBeCloseTo(0, 10);
    expect(normalizeAngle(Math.PI * 1.5)).toBeCloseTo(-Math.PI * 0.5, 10);
  });
});

describe("stepHead", () => {
  it("giới hạn quay đầu đúng bằng CONFIG.TURN_RATE * dt", () => {
    const dt = 0.1;
    const maxTurn = CONFIG.TURN_RATE * dt;
    // targetHeading lệch rất lớn (pi) → chỉ được quay tối đa maxTurn trong 1 bước.
    // Đặt ở tâm sân, hướng ban đầu 0, target = pi.
    const s0 = { x: 0, y: 0, heading: 0 };
    const s1 = stepHead(s0, Math.PI, dt);
    // Sau khi quay maxTurn (chưa tính wall-slide vì ở tâm sân), rồi di chuyển →
    // heading thực = hướng di chuyển = maxTurn (vì ở giữa sân, không clamp).
    expect(s1.heading).toBeCloseTo(maxTurn, 6);
  });

  it("đi thẳng tiến ~CONFIG.SPEED * dt khi đã đúng hướng", () => {
    const dt = 0.1;
    const s0 = { x: 0, y: 0, heading: 0 }; // hướng +x, target trùng
    const s1 = stepHead(s0, 0, dt);
    const dist = Math.hypot(s1.x - s0.x, s1.y - s0.y);
    expect(dist).toBeCloseTo(CONFIG.SPEED * dt, 6);
    expect(s1.x).toBeCloseTo(CONFIG.SPEED * dt, 6);
    expect(s1.y).toBeCloseTo(0, 6);
    expect(s1.heading).toBeCloseTo(0, 6);
  });

  it("giữ kết quả BÊN TRONG sân khi lao vào tường (clampInside)", () => {
    const dt = 0.1;
    // Đặt sát biên phải, hướng +x lao thẳng ra ngoài.
    const near = CONFIG.ARENA_RADIUS * 2; // chắc chắn ngoài sân nếu không clamp
    const s0 = { x: 0.0, y: 0.0, heading: 0 };
    // Đẩy nhiều bước về phía +x để ép chạm tường rồi trượt.
    let s = { ...s0 };
    for (let i = 0; i < 200; i++) s = stepHead(s, 0, dt);
    expect(insideArena(s.x, s.y, 1e-6)).toBe(true);
    // Sanity: đã đi xa hơn 1 hex nhưng vẫn không vượt bán kính ngoại tiếp.
    expect(Math.hypot(s.x, s.y)).toBeLessThan(near);
  });

  it("không đột biến trạng thái đầu vào", () => {
    const s0 = { x: 1, y: 2, heading: 0.5 };
    const copy = { ...s0 };
    stepHead(s0, 1.2, 0.05);
    expect(s0).toEqual(copy);
  });
});
