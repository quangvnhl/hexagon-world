"use client";

import { useEffect, useState } from "react";
import dynamic from "next/dynamic";
import {
  DEFAULT_PLAYER_APPEARANCE,
  sanitizePlayerAppearance,
  type PlayerAppearance,
} from "@hexagon/shared";

const CampaignScene = dynamic(() => import("@/components/CampaignScene"), { ssr: false });

export default function CampaignPage() {
  const [appearance, setAppearance] = useState<PlayerAppearance>(DEFAULT_PLAYER_APPEARANCE);
  useEffect(() => {
    const saved = window.localStorage.getItem("hexagon.appearance");
    if (!saved) return;
    try {
      setAppearance(sanitizePlayerAppearance(JSON.parse(saved)));
    } catch {
      // Giữ mặc định.
    }
  }, []);
  return <CampaignScene appearance={appearance} showMenu={false} />;
}
