import { describe, expect, it } from "vitest";
import {
  advanceEndGameAdGate,
  INITIAL_END_GAME_AD_GATE,
  type EndGameAdGateState,
} from "../../lib/endGameAdGate";

function step(
  state: EndGameAdGateState,
  won: boolean,
  kingReached: boolean
) {
  return advanceEndGameAdGate(state, { won, kingReached });
}

describe("end-game interstitial gate", () => {
  it("không hiện trong ván, death/revive hoặc khi kết thúc mà chưa từng có KING", () => {
    let state = { ...INITIAL_END_GAME_AD_GATE };
    let result = step(state, false, false);
    expect(result.shouldShow).toBe(false);
    state = result.state;

    result = step(state, true, false);
    expect(result.shouldShow).toBe(false);
  });

  it("chỉ hiện một lần ở cạnh kết thúc sau khi đã có KING", () => {
    let result = step({ ...INITIAL_END_GAME_AD_GATE }, false, true);
    expect(result.shouldShow).toBe(false);

    result = step(result.state, true, true);
    expect(result.shouldShow).toBe(true);

    result = step(result.state, true, true);
    expect(result.shouldShow).toBe(false);
  });

  it("reset guard khi bắt đầu ván kế tiếp", () => {
    let result = step({ ...INITIAL_END_GAME_AD_GATE }, false, true);
    result = step(result.state, true, true);
    result = step(result.state, false, false);
    result = step(result.state, false, true);
    result = step(result.state, true, true);
    expect(result.shouldShow).toBe(true);
  });
});
