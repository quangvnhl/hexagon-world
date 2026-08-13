"use client";

import { memo, useRef } from "react";
import { useFrame } from "@react-three/fiber";
import type { GameState } from "@hexagon/shared";
import { impactTelegramHaptic, notifyTelegramHaptic } from "@/lib/telegram";
import {
  resolvedOwnershipScore,
  shouldHapticForCapture,
} from "./authoritativeScore";

/** Theo dõi bộ đếm chết nên vẫn hoạt động khi người dùng tắt hiệu ứng hạt. */
export const TelegramGameHaptics = memo(function TelegramGameHaptics({
  game,
  playerId,
  trackDeaths = true,
  authoritativeScores,
  captureEnabled,
}: {
  game: GameState;
  playerId: number;
  trackDeaths?: boolean;
  authoritativeScores?: React.MutableRefObject<ReadonlyMap<number, number>>;
  captureEnabled?: React.MutableRefObject<boolean>;
}) {
  const previousDeaths = useRef<Map<number, number> | null>(null);
  const previousOwned = useRef<number | null>(null);

  useFrame(() => {
    const player = game.players[playerId];
    if (player) {
      const owned = resolvedOwnershipScore(
        playerId,
        player.owned.size,
        authoritativeScores?.current
      );
      const enabled =
        (captureEnabled?.current ?? true) && player.phase === "playing";
      if (shouldHapticForCapture(previousOwned.current, owned, enabled)) {
        // Một lần rung nhẹ cho mỗi đợt chiếm đất, không rung N lần khi khép
        // vòng và server/client cấp nhiều ô trong cùng một tick.
        impactTelegramHaptic("light");
      }
      if (owned !== undefined) previousOwned.current = owned;
    }

    if (!trackDeaths) return;
    if (!previousDeaths.current) {
      previousDeaths.current = new Map(
        game.players.map((entity) => [entity.id, entity.deaths])
      );
      return;
    }

    for (const entity of game.players) {
      const previous = previousDeaths.current.get(entity.id) ?? entity.deaths;
      if (entity.deaths > previous) {
        if (entity.id === playerId) notifyTelegramHaptic("error");
        else if (entity.killerId === playerId) notifyTelegramHaptic("success");
      }
      previousDeaths.current.set(entity.id, entity.deaths);
    }
  });

  return null;
});
