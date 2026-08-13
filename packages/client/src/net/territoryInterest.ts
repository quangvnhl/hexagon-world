export interface TerritoryInterestState {
  x: number;
  y: number;
  sentAt: number;
}

export function shouldSendTerritoryInterest(
  previous: TerritoryInterestState | null,
  x: number,
  y: number,
  now: number,
  movementThreshold = 6,
  minimumIntervalMs = 150
): boolean {
  if (!Number.isFinite(x) || !Number.isFinite(y)) return false;
  if (!previous) return true;
  const dx = x - previous.x;
  const dy = y - previous.y;
  return (
    dx * dx + dy * dy >= movementThreshold * movementThreshold &&
    now - previous.sentAt >= minimumIntervalMs
  );
}
