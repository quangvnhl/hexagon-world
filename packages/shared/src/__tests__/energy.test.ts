import { describe, it, expect } from "vitest";
import { computeEnergy, DEFAULT_ENERGY_RULES } from "../energy";

// E3 — công thức hồi lười năng lượng (spec cho RPC SQL). max 50, 180s/điểm.

const R = DEFAULT_ENERGY_RULES;
const T0 = 1_700_000_000_000; // mốc ms tùy ý

describe("computeEnergy", () => {
  it("chưa qua interval nào ⇒ giữ nguyên, nextAt = mốc + 1 interval", () => {
    const v = computeEnergy(10, T0, T0 + 60_000, R); // 1 phút < 3 phút
    expect(v.current).toBe(10);
    expect(v.nextAtMs).toBe(T0 + R.regenIntervalSeconds * 1000);
  });

  it("hồi đúng số điểm theo thời gian đã trôi (floor)", () => {
    const v = computeEnergy(10, T0, T0 + 2.5 * R.regenIntervalSeconds * 1000, R);
    expect(v.current).toBe(12); // floor(2.5) = 2 điểm
    expect(v.nextAtMs).toBe(T0 + 3 * R.regenIntervalSeconds * 1000);
  });

  it("cạn tới đầy thì kẹp ở max và dừng đồng hồ (nextAt=null)", () => {
    const v = computeEnergy(48, T0, T0 + 100 * R.regenIntervalSeconds * 1000, R);
    expect(v.current).toBe(R.energyMax);
    expect(v.nextAtMs).toBeNull();
  });

  it("đã ở max ⇒ đứng yên, không tích quá max", () => {
    const v = computeEnergy(R.energyMax, T0, T0 + 10 * R.regenIntervalSeconds * 1000, R);
    expect(v.current).toBe(R.energyMax);
    expect(v.nextAtMs).toBeNull();
  });

  it("nowMs trước lastRefill (lệch đồng hồ) ⇒ không âm, giữ nguyên", () => {
    const v = computeEnergy(5, T0, T0 - 10_000, R);
    expect(v.current).toBe(5);
  });
});
