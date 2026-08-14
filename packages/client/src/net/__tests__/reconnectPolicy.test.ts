import { describe, expect, it } from "vitest";
import { reconnectDelayMs, shouldReconnect } from "../reconnectPolicy";

describe("reconnect policy", () => {
  it("uses bounded exponential backoff", () => {
    expect([0, 1, 2, 3, 4].map((n) => reconnectDelayMs(n))).toEqual([
      500, 1000, 2000, 4000, 8000,
    ]);
    expect(reconnectDelayMs(5)).toBeNull();
  });

  it("does not reconnect after cancel or an incompatible/invalid ticket", () => {
    expect(shouldReconnect(1006, false)).toBe(true);
    expect(shouldReconnect(1000, true)).toBe(false);
    expect(shouldReconnect(4002, false)).toBe(false);
    expect(shouldReconnect(4003, false)).toBe(false);
  });
});
