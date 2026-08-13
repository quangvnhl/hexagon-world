import { describe, expect, it } from "vitest";
import { resolvedOwnershipScore } from "../authoritativeScore";

describe("resolvedOwnershipScore", () => {
  it("does not change when camera AoI adds or removes rendered territory", () => {
    const serverScores = new Map([[3, 42]]);
    expect(resolvedOwnershipScore(3, 8, serverScores)).toBe(42);
    expect(resolvedOwnershipScore(3, 17, serverScores)).toBe(42);
    expect(resolvedOwnershipScore(3, 2, serverScores)).toBe(42);
  });

  it("falls back to scene ownership in single-player mode", () => {
    expect(resolvedOwnershipScore(0, 7)).toBe(7);
  });

  it("waits for the authoritative baseline in online mode", () => {
    expect(resolvedOwnershipScore(0, 7, new Map())).toBeUndefined();
  });
});
