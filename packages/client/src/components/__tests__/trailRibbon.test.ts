import { describe, expect, it } from "vitest";
import { createTrailRibbonGeometry } from "../trailRibbonGeometry";

describe("createTrailRibbonGeometry", () => {
  it("creates a flat ribbon whose UV repeats along path length", () => {
    const geometry = createTrailRibbonGeometry([
      { x: 0, y: 0 },
      { x: 2, y: 0 },
      { x: 4, y: 1 },
    ]);
    const position = geometry.getAttribute("position");
    const uv = geometry.getAttribute("uv");
    expect(position.count).toBeGreaterThan(4);
    expect(geometry.getIndex()?.count).toBeGreaterThan(0);
    let maxU = 0;
    for (let index = 0; index < uv.count; index++) maxU = Math.max(maxU, uv.getX(index));
    expect(maxU).toBeGreaterThan(1);
    geometry.dispose();
  });
});
