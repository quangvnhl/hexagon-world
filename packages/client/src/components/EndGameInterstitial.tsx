"use client";

import { useEffect, useRef } from "react";
import { showAdsgramAd } from "@/lib/adsgram";
import {
  advanceEndGameAdGate,
  INITIAL_END_GAME_AD_GATE,
  type EndGameAdGateState,
} from "@/lib/endGameAdGate";

/**
 * Placement không render UI và không liên quan death/revive. Nó chỉ phản ứng với
 * cạnh chuyển sang `won`, sau khi đã quan sát ít nhất một KING trong chính ván đó.
 */
export function EndGameInterstitial({
  won,
  kingReached,
}: {
  won: boolean;
  kingReached: boolean;
}) {
  const gate = useRef<EndGameAdGateState>({ ...INITIAL_END_GAME_AD_GATE });

  useEffect(() => {
    const next = advanceEndGameAdGate(gate.current, { won, kingReached });
    gate.current = next.state;
    if (next.shouldShow) {
      void showAdsgramAd("interstitial-end-game");
    }
  }, [kingReached, won]);

  return null;
}
