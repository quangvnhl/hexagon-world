"use client";

import dynamic from "next/dynamic";

// R3F chỉ chạy phía client → tắt SSR cho scene.
const GameScene = dynamic(() => import("@/components/GameScene"), {
  ssr: false,
});

export default function PlayPage() {
  return <GameScene />;
}
