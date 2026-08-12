"use client";

import { useEffect, useState } from "react";
import dynamic from "next/dynamic";
import {
  DEFAULT_PLAYER_APPEARANCE,
  sanitizePlayerAppearance,
  type PlayerAppearance,
} from "@hexagon/shared";

// R3F chỉ chạy phía client → tắt SSR cho scene.
const GameScene = dynamic(() => import("@/components/GameScene"), {
  ssr: false,
});

export default function PlayPage() {
  const [appearance, setAppearance] = useState<PlayerAppearance>(
    DEFAULT_PLAYER_APPEARANCE
  );
  useEffect(() => {
    const saved = window.localStorage.getItem("hexagon.appearance");
    if (!saved) return;
    try {
      setAppearance(sanitizePlayerAppearance(JSON.parse(saved)));
    } catch {
      // Giữ mặc định.
    }
  }, []);
  return <GameScene appearance={appearance} />;
}
