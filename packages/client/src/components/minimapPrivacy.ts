import type { TerritoryCell } from "@hexagon/shared";

export interface MiniMapEntityView {
  id: number;
  x: number;
  y: number;
  alive: boolean;
}

export interface MiniMapPrivacyInput {
  localId: number;
  radarActive: boolean;
  territory: readonly TerritoryCell[];
  entities: readonly MiniMapEntityView[];
}

/** UI defence-in-depth. The server must still filter private payloads. */
export function visibleMiniMapData(input: MiniMapPrivacyInput): {
  territory: TerritoryCell[];
  entities: MiniMapEntityView[];
} {
  if (input.radarActive) {
    return {
      territory: [...input.territory],
      entities: input.entities.filter((entity) => entity.alive),
    };
  }
  return {
    territory: input.territory.filter((cell) => cell.owner === input.localId),
    entities: input.entities.filter(
      (entity) => entity.id === input.localId && entity.alive
    ),
  };
}
