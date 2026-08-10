import { describe, it, expect } from "vitest";
import {
  InterpolationBuffer,
  InterpState,
  lerpAngle,
} from "../interpolation";

const ents = (m: Record<number, InterpState>): Map<number, InterpState> =>
  new Map(Object.entries(m).map(([k, v]) => [Number(k), v]));

describe("lerpAngle", () => {
  it("nội suy đi đường NGẮN qua mối nối pi (3.0 → -3.0 đi qua pi, không qua 0)", () => {
    // 3.0 và -3.0 cách nhau ~0.283 rad qua pi. Giữa đường phải ~ ±pi, không ~0.
    const mid = lerpAngle(3.0, -3.0, 0.5);
    const norm = ((mid % (Math.PI * 2)) + Math.PI * 2) % (Math.PI * 2);
    // Chuẩn hoá về [0,2pi): kết quả phải gần pi (~3.1416), tuyệt đối KHÔNG gần 0.
    expect(Math.abs(norm - Math.PI)).toBeLessThan(0.05);
  });
});

describe("InterpolationBuffer", () => {
  it("sample tại thời điểm GIỮA trả vị trí trung điểm giữa hai snapshot", () => {
    const buf = new InterpolationBuffer();
    buf.insert(1000, ents({ 5: { x: 0, y: 0, heading: 0 } }));
    buf.insert(2000, ents({ 5: { x: 10, y: 20, heading: 1 } }));

    const out = buf.sample(1500);
    const s = out.get(5)!;
    expect(s.x).toBeCloseTo(5, 6);
    expect(s.y).toBeCloseTo(10, 6);
    expect(s.heading).toBeCloseTo(0.5, 6);
  });

  it("clamp về snapshot CŨ nhất khi renderTime trước đầu buffer", () => {
    const buf = new InterpolationBuffer();
    buf.insert(1000, ents({ 5: { x: 1, y: 2, heading: 0.3 } }));
    buf.insert(2000, ents({ 5: { x: 9, y: 9, heading: 0.9 } }));
    const s = buf.sample(500).get(5)!;
    expect(s).toEqual({ x: 1, y: 2, heading: 0.3 });
  });

  it("clamp về snapshot MỚI nhất khi renderTime sau cuối buffer", () => {
    const buf = new InterpolationBuffer();
    buf.insert(1000, ents({ 5: { x: 1, y: 2, heading: 0.3 } }));
    buf.insert(2000, ents({ 5: { x: 9, y: 9, heading: 0.9 } }));
    const s = buf.sample(5000).get(5)!;
    expect(s).toEqual({ x: 9, y: 9, heading: 0.9 });
  });

  it("nội suy heading đi đường ngắn qua mối nối -pi/pi", () => {
    const buf = new InterpolationBuffer();
    buf.insert(0, ents({ 7: { x: 0, y: 0, heading: 3.0 } }));
    buf.insert(100, ents({ 7: { x: 0, y: 0, heading: -3.0 } }));
    const s = buf.sample(50).get(7)!;
    const norm = ((s.heading % (Math.PI * 2)) + Math.PI * 2) % (Math.PI * 2);
    expect(Math.abs(norm - Math.PI)).toBeLessThan(0.05);
  });

  it("giữ buffer có giới hạn (không phình quá maxFrames)", () => {
    const buf = new InterpolationBuffer(3);
    for (let t = 0; t < 10; t++) {
      buf.insert(t * 100, ents({ 1: { x: t, y: 0, heading: 0 } }));
    }
    // Chỉ giữ 3 frame mới nhất → thời gian mới nhất = 900.
    expect(buf.latestTime()).toBe(900);
    // Sample rất sớm → clamp về frame cũ nhất còn lại (t=7 -> x=7).
    const s = buf.sample(0).get(1)!;
    expect(s.x).toBe(7);
  });
});
