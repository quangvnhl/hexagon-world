"use client";

import dynamic from "next/dynamic";

// Trình vẽ cấp Campaign cho admin (doc 29 §L5). Dùng localStorage + GameScene ⇒ tắt SSR.
const LevelEditor = dynamic(() => import("@/components/LevelEditor"), { ssr: false });

export default function AdminLevelsPage() {
  return <LevelEditor />;
}
