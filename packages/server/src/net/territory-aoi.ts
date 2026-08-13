import { axialToPixel, type TerritoryCell } from "@hexagon/shared";

export function filterTerritoryAoi(
  cells: readonly TerritoryCell[],
  knownKeys: ReadonlySet<string>,
  focus: { x: number; y: number },
  hexSize: number,
  radius: number,
  hysteresis: number
): TerritoryCell[] {
  const enter2 = radius * radius;
  const exit2 = (radius + hysteresis) ** 2;
  return cells.filter((cell) => {
    const p = axialToPixel(cell, hexSize);
    const dx = p.x - focus.x;
    const dy = p.y - focus.y;
    return dx * dx + dy * dy <=
      (knownKeys.has(`${cell.q},${cell.r}`) ? exit2 : enter2);
  });
}
