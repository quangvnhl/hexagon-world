"use client";

// Trang chủ: bảng chọn (nhập tên + chế độ). Chọn xong render THẲNG scene chơi ngay trên
// trang — KHÔNG đổi route. Nút "← Menu" trong scene quay lại bảng chọn.

import { useCallback, useState } from "react";
import dynamic from "next/dynamic";
import { StartPanel, type GameMode, type PracticeOptions } from "@/components/StartPanel";
import type { PlayerAppearance } from "@hexagon/shared";
import { useTelegramWebApp } from "@/lib/telegram";
import { acquireGameAccess } from "@/lib/backend";
import { track } from "@/lib/analytics";

// R3F chỉ chạy phía client → tắt SSR cho các scene.
const GameScene = dynamic(() => import("@/components/GameScene"), { ssr: false });
const NetGameScene = dynamic(() => import("@/components/NetGameScene"), {
  ssr: false,
});
const CampaignScene = dynamic(() => import("@/components/CampaignScene"), {
  ssr: false,
});

interface Session {
  mode: GameMode;
  name: string;
  serverUrl: string;
  appearance: PlayerAppearance;
  gameTicket?: string;
  /** Số bot cho mode Luyện tập (solo); bỏ qua khi online. */
  botCount?: number;
}

export default function Home() {
  const [session, setSession] = useState<Session | null>(null);
  const back = useCallback(() => setSession(null), []);
  const isTelegram = useTelegramWebApp(Boolean(session), back);
  const start = useCallback(async (mode: GameMode, name: string, serverUrl: string, appearance: PlayerAppearance, practice: PracticeOptions) => {
    // doc 35 §A1 — `mode_select` phát NGAY khi bấm, trước cả bước xin vé mạng: nếu chỉ đo lúc vào
    // được trận thì mọi lần chọn "online" rồi hỏng mạng sẽ biến mất, và tỉ lệ chọn chế độ sẽ đẹp
    // hơn sự thật đúng ở chỗ đang có vấn đề.
    track("mode_select", { mode });
    if (mode === "online") {
      const access = await acquireGameAccess(name, appearance);
      setSession({ mode, name, serverUrl: access.serverUrl, appearance, gameTicket: access.ticket });
      track("match_start", { mode });
      return;
    }
    if (mode === "campaign") {
      setSession({ mode, name, serverUrl, appearance });
      return; // `campaign_level_start` phát ở màn chọn cấp, không phải ở đây.
    }
    setSession({ mode, name, serverUrl, appearance, botCount: practice.botCount });
    track("match_start", { mode, bot_count: practice.botCount });
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
        onExit={back}
        showMenu={!isTelegram}
      />
    );
  }

  if (session.mode === "campaign") {
    return (
      <CampaignScene
        playerName={session.name}
        appearance={session.appearance}
        onExit={back}
        showMenu={!isTelegram}
      />
    );
  }
  return (
    <GameScene
      playerName={session.name}
      appearance={session.appearance}
      botCount={session.botCount}
      onExit={back}
      showMenu={!isTelegram}
    />
  );
}
