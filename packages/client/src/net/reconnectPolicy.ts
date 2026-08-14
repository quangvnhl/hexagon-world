export const DEFAULT_RECONNECT_DELAYS_MS = [500, 1000, 2000, 4000, 8000] as const;

export function reconnectDelayMs(
  attempt: number,
  delays: readonly number[] = DEFAULT_RECONNECT_DELAYS_MS
): number | null {
  if (!Number.isInteger(attempt) || attempt < 0 || attempt >= delays.length) return null;
  return delays[attempt];
}

export function shouldReconnect(code: number, manuallyClosed: boolean): boolean {
  if (manuallyClosed) return false;
  return code !== 4002 && code !== 4003;
}
