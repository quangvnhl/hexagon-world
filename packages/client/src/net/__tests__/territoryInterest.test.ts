import { describe, expect, it } from "vitest";
import { shouldSendTerritoryInterest } from "../territoryInterest";

describe("territory interest hysteresis", () => {
  it("sends the initial camera focus", () => {
    expect(shouldSendTerritoryInterest(null, 1, 2, 0)).toBe(true);
  });

  it("suppresses jitter and overly frequent focus changes", () => {
    const previous = { x: 0, y: 0, sentAt: 100 };
    expect(shouldSendTerritoryInterest(previous, 3, 2, 300)).toBe(false);
    expect(shouldSendTerritoryInterest(previous, 8, 0, 200)).toBe(false);
    expect(shouldSendTerritoryInterest(previous, 8, 0, 300)).toBe(true);
  });
});
