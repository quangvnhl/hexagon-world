import { describe, expect, it } from "vitest";
import { TokenBucket, SlidingWindowCounter } from "../src/net/rate-limit";

describe("TokenBucket (input rate-limit)", () => {
  it("cho qua tới trần burst rồi DROP khi cạn token", () => {
    // capacity 48, refill 48/s. Bơm 60 khung tại CÙNG mốc thời gian (không hồi token).
    const bucket = new TokenBucket(48, 48, 1000);
    let allowed = 0;
    let dropped = 0;
    for (let i = 0; i < 60; i++) {
      if (bucket.tryConsume(1000)) allowed++;
      else dropped++;
    }
    expect(allowed).toBe(48);
    expect(dropped).toBe(12);
  });

  it("hồi token theo thời gian để client hợp lệ không bao giờ bị drop", () => {
    const bucket = new TokenBucket(48, 48, 0);
    // 24 Hz đều đặn trong 2 giây (khoảng ~41,67 ms/khung) → luôn còn token.
    let dropped = 0;
    for (let i = 0; i < 48; i++) {
      const now = Math.round((i * 1000) / 24);
      if (!bucket.tryConsume(now)) dropped++;
    }
    expect(dropped).toBe(0);
  });

  it("không tích quá capacity dù để lâu", () => {
    const bucket = new TokenBucket(48, 48, 0);
    // Sau 10 giây nhàn rỗi vẫn chỉ có tối đa 48 token.
    let allowed = 0;
    for (let i = 0; i < 100; i++) if (bucket.tryConsume(10_000)) allowed++;
    expect(allowed).toBe(48);
  });
});

describe("SlidingWindowCounter (text rate-limit)", () => {
  it("báo vượt khi quá trần trong cửa sổ", () => {
    const window = new SlidingWindowCounter(5, 5000);
    const results: boolean[] = [];
    for (let i = 0; i < 7; i++) results.push(window.record(1000 + i)); // 7 khung trong <5s
    expect(results.slice(0, 5)).toEqual([true, true, true, true, true]);
    expect(results[5]).toBe(false);
    expect(results[6]).toBe(false);
  });

  it("cho phép lại sau khi cửa sổ trôi qua", () => {
    const window = new SlidingWindowCounter(5, 5000);
    for (let i = 0; i < 5; i++) expect(window.record(1000 + i)).toBe(true);
    expect(window.record(1005)).toBe(false); // vượt trong cửa sổ
    // Cách xa hơn windowMs: các hit cũ rụng khỏi cửa sổ → lại cho qua.
    expect(window.record(1000 + 6000)).toBe(true);
  });
});
