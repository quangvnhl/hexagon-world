"use client";

// Trang chủ: bảng chọn (nhập tên + chế độ). Chọn xong render THẲNG scene chơi ngay trên
// trang — KHÔNG đổi route. Nút "← Menu" trong scene quay lại bảng chọn.

import { useCallback, useState } from "react";
import dynamic from "next/dynamic";
import { StartPanel, type GameMode } from "@/components/StartPanel";
import type { PlayerAppearance } from "@hexagon/shared";
import { useTelegramWebApp } from "@/lib/telegram";
import { acquireGameAccess } from "@/lib/backend";

// R3F chỉ chạy phía client → tắt SSR cho các scene.
const GameScene = dynamic(() => import("@/components/GameScene"), { ssr: false });
const NetGameScene = dynamic(() => import("@/components/NetGameScene"), {
  ssr: false,
});

interface Session {
  mode: GameMode;
  name: string;
  serverUrl: string;
  appearance: PlayerAppearance;
  gameTicket?: string;
}

export default function Home() {
  const [session, setSession] = useState<Session | null>(null);
  const back = useCallback(() => setSession(null), []);
  const isTelegram = useTelegramWebApp(Boolean(session), back);
  const start = useCallback(async (mode: GameMode, name: string, serverUrl: string, appearance: PlayerAppearance) => {
    if (mode === "online") {
      const access = await acquireGameAccess(name, appearance);
      setSession({ mode, name, serverUrl: access.serverUrl, appearance, gameTicket: access.ticket });
      return;
    }
    setSession({ mode, name, serverUrl, appearance });
  }, []);

  if (!session) {
    return (
      <StartPanel
        onStart={start}
      />
    );
  }

  if (session.mode === "online") {
    return (
      <NetGameScene
        playerName={session.name}
        appearance={session.appearance}
        serverUrl={session.serverUrl}
        gameTicket={session.gameTicket}
        onExit={isTelegram ? undefined : back}
      />
    );
  }
  return (
    <GameScene
      playerName={session.name}
      appearance={session.appearance}
      onExit={isTelegram ? undefined : back}
    />
  );
}
