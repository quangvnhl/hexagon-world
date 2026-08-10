"use client";

// Route online trực tiếp (/netplay): render scene online ĐẦY ĐỦ (giống chọn "Nhiều người"
// ở trang chủ). Lấy tên đã lưu; muốn đổi tên thì vào trang chủ.

import { useEffect, useState } from "react";
import dynamic from "next/dynamic";

const NetGameScene = dynamic(() => import("@/components/NetGameScene"), {
  ssr: false,
});

export default function NetplayPage() {
  const [name, setName] = useState("Bạn");
  useEffect(() => {
    const saved = window.localStorage.getItem("hexagon.name");
    if (saved) setName(saved);
  }, []);
  return <NetGameScene playerName={name} />;
}
