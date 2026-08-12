"use client";

// Route online trực tiếp (/netplay): render scene online ĐẦY ĐỦ (giống chọn "Nhiều người"
// ở trang chủ). Lấy tên đã lưu; muốn đổi tên thì vào trang chủ.

import { useEffect, useState } from "react";
import dynamic from "next/dynamic";
import {
  DEFAULT_PLAYER_APPEARANCE,
  sanitizePlayerAppearance,
  type PlayerAppearance,
} from "@hexagon/shared";

const NetGameScene = dynamic(() => import("@/components/NetGameScene"), {
  ssr: false,
});

export default function NetplayPage() {
  const [name, setName] = useState("Bạn");
  const [ready, setReady] = useState(false);
  const [appearance, setAppearance] = useState<PlayerAppearance>(
    DEFAULT_PLAYER_APPEARANCE
  );
  useEffect(() => {
    const saved = window.localStorage.getItem("hexagon.name");
    if (saved) setName(saved);
    const savedAppearance = window.localStorage.getItem("hexagon.appearance");
    if (savedAppearance) {
      try {
        setAppearance(sanitizePlayerAppearance(JSON.parse(savedAppearance)));
      } catch {
        // Giữ mặc định.
      }
    }
    setReady(true);
  }, []);
  if (!ready) return null;
  return <NetGameScene playerName={name} appearance={appearance} />;
}
