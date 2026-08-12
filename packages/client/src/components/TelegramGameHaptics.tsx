"use client";

import { memo, useRef } from "react";
import { useFrame } from "@react-three/fiber";
import type { GameState } from "@hexagon/shared";
import { impactTelegramHaptic, notifyTelegramHaptic } from "@/lib/telegram";

/** Theo dõi bộ đếm chết nên vẫn hoạt động khi người dùng tắt hiệu ứng hạt. */
export const TelegramGameHaptics = memo(function TelegramGameHaptics({
  game,
  playerId,
  trackDeaths = true,
}: {
  game: GameState;
  playerId: number;
  trackDeaths?: boolean;
}) {
  const previousDeaths = useRef<Map<number, number> | null>(null);
  const previousOwned = useRef<number | null>(null);

  useFrame(() => {
    const player = game.players[playerId];
    if (player) {
      const owned = player.owned.size;
      if (
        previousOwned.current !== null &&
        owned > previousOwned.current &&
        player.phase === "playing"
      ) {
        // Một lần rung nhẹ cho mỗi đợt chiếm đất, không rung N lần khi khép
        // vòng và server/client cấp nhiều ô trong cùng một tick.
        impactTelegramHaptic("light");
      }
      previousOwned.current = owned;
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
