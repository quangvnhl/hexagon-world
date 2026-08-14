import { describe, expect, it } from "vitest";
import { hexToLinearRgb } from "../config";

describe("hexToLinearRgb", () => {
  it("converts sRGB endpoints", () => {
    expect(hexToLinearRgb("#000000")).toEqual([0, 0, 0]);
    expect(hexToLinearRgb("#ffffff")).toEqual([1, 1, 1]);
  });

  it("applies the sRGB transfer curve and supports shorthand", () => {
    const gray = hexToLinearRgb("#808080");
    expect(gray[0]).toBeCloseTo(0.215861, 6);
    expect(gray[1]).toBeCloseTo(gray[0], 10);
    expect(gray[2]).toBeCloseTo(gray[0], 10);
    expect(hexToLinearRgb("#f00")).toEqual([1, 0, 0]);
  });

  it("rejects invalid config values", () => {
    expect(() => hexToLinearRgb("808080")).toThrow(/Invalid HEX color/);
    expect(() => hexToLinearRgb("#abcd")).toThrow(/Invalid HEX color/);
  });
});
