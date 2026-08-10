"use client";

// Trang chủ: bảng chọn (nhập tên + chế độ). Chọn xong render THẲNG scene chơi ngay trên
// trang — KHÔNG đổi route. Nút "← Menu" trong scene quay lại bảng chọn.

import { useState } from "react";
import dynamic from "next/dynamic";
import { StartPanel, type GameMode } from "@/components/StartPanel";

// R3F chỉ chạy phía client → tắt SSR cho các scene.
const GameScene = dynamic(() => import("@/components/GameScene"), { ssr: false });
const NetGameScene = dynamic(() => import("@/components/NetGameScene"), {
  ssr: false,
});

interface Session {
  mode: GameMode;
  name: string;
  serverUrl: string;
}

export default function Home() {
  const [session, setSession] = useState<Session | null>(null);

  if (!session) {
    return (
      <StartPanel
        onStart={(mode, name, serverUrl) =>
          setSession({ mode, name, serverUrl })
        }
      />
    );
  }

  const back = () => setSession(null);

  if (session.mode === "online") {
    return (
      <NetGameScene
        playerName={session.name}
        serverUrl={session.serverUrl}
        onExit={back}
      />
    );
  }
  return <GameScene playerName={session.name} onExit={back} />;
}
