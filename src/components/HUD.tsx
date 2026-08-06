"use client";

import { CONFIG } from "@/game/config";

export interface Stats {
  pct: number;
  king: boolean;
  deaths: number;
}

export function HUD({ stats }: { stats: Stats }) {
  return (
    <>
      {/* Bảng chỉ số góc trên trái */}
      <div
        style={{
          position: "absolute",
          top: 16,
          left: 16,
          padding: "12px 16px",
          borderRadius: 12,
          background: "rgba(10,14,22,0.72)",
          color: "#e8eefc",
          fontFamily: "system-ui, sans-serif",
          minWidth: 180,
          pointerEvents: "none",
          backdropFilter: "blur(6px)",
        }}
      >
        <div style={{ fontSize: 12, opacity: 0.7, letterSpacing: 1 }}>
          DIỆN TÍCH
        </div>
        <div style={{ fontSize: 32, fontWeight: 700, lineHeight: 1.1 }}>
          {stats.pct.toFixed(1)}%
        </div>
        {/* Thanh tiến trình tới ngưỡng King */}
        <div
          style={{
            marginTop: 8,
            height: 8,
            borderRadius: 4,
            background: "rgba(255,255,255,0.12)",
            overflow: "hidden",
          }}
        >
          <div
            style={{
              height: "100%",
              width: `${Math.min(100, (stats.pct / CONFIG.KING_PCT) * 100)}%`,
              background: stats.king ? "#ffd23f" : "#31b0ff",
              transition: "width 120ms linear",
            }}
          />
        </div>
        <div style={{ fontSize: 12, opacity: 0.6, marginTop: 6 }}>
          Mục tiêu King: {CONFIG.KING_PCT}% · Chết: {stats.deaths}
        </div>
      </div>

      {/* Banner KING */}
      {stats.king && (
        <div
          style={{
            position: "absolute",
            top: 16,
            left: "50%",
            transform: "translateX(-50%)",
            padding: "10px 22px",
            borderRadius: 999,
            background: "linear-gradient(90deg,#ffb02e,#ffd23f)",
            color: "#3a2400",
            fontFamily: "system-ui, sans-serif",
            fontWeight: 800,
            letterSpacing: 2,
            boxShadow: "0 6px 24px rgba(255,180,46,0.4)",
            pointerEvents: "none",
          }}
        >
          👑 NHÀ VUA
        </div>
      )}

      {/* Hướng dẫn góc dưới */}
      <div
        style={{
          position: "absolute",
          bottom: 16,
          left: "50%",
          transform: "translateX(-50%)",
          padding: "8px 16px",
          borderRadius: 10,
          background: "rgba(10,14,22,0.6)",
          color: "#cdd7ea",
          fontFamily: "system-ui, sans-serif",
          fontSize: 13,
          pointerEvents: "none",
        }}
      >
        Di chuột để đổi hướng · Đi ra ngoài rồi khép vòng về vùng của mình để
        chiếm đất · Đừng cắt đuôi chính mình
      </div>
    </>
  );
}
