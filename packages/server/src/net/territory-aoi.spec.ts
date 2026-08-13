import { describe, expect, it } from "vitest";
import { filterTerritoryAoi } from "./territory-aoi";

describe("filterTerritoryAoi", () => {
  const cells = [
    { q: 0, r: 0, owner: 1, kind: 0 as const },
    { q: 4, r: 0, owner: 1, kind: 0 as const },
    { q: 8, r: 0, owner: 2, kind: 0 as const },
  ];

  it("includes only cells inside the camera radius", () => {
    expect(filterTerritoryAoi(cells, new Set(), { x: 0, y: 0 }, 1, 8, 2))
      .toEqual(cells.slice(0, 2));
  });

  it("retains a known edge cell inside the hysteresis margin", () => {
    const known = new Set(["4,0"]);
    const visible = filterTerritoryAoi(cells, known, { x: -2, y: 0 }, 1, 8, 2);
    expect(visible).toContainEqual(cells[1]);
  });
});
