import { describe, expect, it } from "vitest";
import {
  resolvedOwnershipScore,
  shouldHapticForCapture,
} from "../authoritativeScore";

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

  it("does not trigger capture haptic from AoI-only ownership changes", () => {
    const serverScores = new Map([[3, 42]]);
    const previous = resolvedOwnershipScore(3, 8, serverScores) ?? null;
    const afterCameraMove = resolvedOwnershipScore(3, 17, serverScores);

    expect(shouldHapticForCapture(previous, afterCameraMove, true)).toBe(false);
  });

  it("triggers only for a real score increase while capture is enabled", () => {
    expect(shouldHapticForCapture(42, 49, true)).toBe(true);
    expect(shouldHapticForCapture(42, 49, false)).toBe(false);
    expect(shouldHapticForCapture(null, 49, true)).toBe(false);
  });
});
