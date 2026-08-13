export interface EndGameAdGateState {
  kingSeen: boolean;
  previousWon: boolean;
  shownForMatch: boolean;
}

export const INITIAL_END_GAME_AD_GATE: EndGameAdGateState = {
  kingSeen: false,
  previousWon: false,
  shownForMatch: false,
};

/** Thuần logic để placement không thể bị kích hoạt bởi death/revive. */
export function advanceEndGameAdGate(
  current: EndGameAdGateState,
  input: { won: boolean; kingReached: boolean }
): { state: EndGameAdGateState; shouldShow: boolean } {
  let state = { ...current };
  if (!input.won && state.previousWon) {
    state = { ...INITIAL_END_GAME_AD_GATE };
  }
  if (input.kingReached) state.kingSeen = true;

  const shouldShow =
    input.won &&
    !state.previousWon &&
    state.kingSeen &&
    !state.shownForMatch;
  if (shouldShow) state.shownForMatch = true;
  state.previousWon = input.won;
  return { state, shouldShow };
}

