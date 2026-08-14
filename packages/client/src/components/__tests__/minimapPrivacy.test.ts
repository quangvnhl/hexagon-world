import { describe, expect, it } from "vitest";
import { visibleMiniMapData } from "../minimapPrivacy";

const territory = [
  { q: 0, r: 0, owner: 3, kind: 0 as const },
  { q: 1, r: 0, owner: 8, kind: 0 as const },
  { q: 2, r: 0, owner: 3, kind: 1 as const },
];
const entities = [
  { id: 3, x: 1, y: 2, alive: true },
  { id: 8, x: 9, y: 7, alive: true },
  { id: 9, x: 4, y: 5, alive: false },
];

describe("minimap privacy", () => {
  it("shows only self position and own territory/trail without Radar", () => {
    expect(
      visibleMiniMapData({ localId: 3, radarActive: false, territory, entities })
    ).toEqual({ territory: [territory[0], territory[2]], entities: [entities[0]] });
  });

  it("shows all live spatial data with Radar and drops it immediately when disabled", () => {
    const radar = visibleMiniMapData({ localId: 3, radarActive: true, territory, entities });
    expect(radar.territory).toHaveLength(3);
    expect(radar.entities).toEqual([entities[0], entities[1]]);

    const revoked = visibleMiniMapData({
      localId: 3,
      radarActive: false,
      territory: radar.territory,
      entities: radar.entities,
    });
    expect(revoked.territory).toEqual([territory[0], territory[2]]);
    expect(revoked.entities).toEqual([entities[0]]);
  });
});
