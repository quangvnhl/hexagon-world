import { describe, expect, it } from "vitest";
import { isConnectionStale, reconnectDelayMs, shouldReconnect } from "../reconnectPolicy";

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

  it("detects a browser socket that stays falsely open without server traffic", () => {
    expect(isConnectionStale(1000, 5999)).toBe(false);
    expect(isConnectionStale(1000, 6000)).toBe(true);
    expect(isConnectionStale(0, 999999)).toBe(false);
  });
});
