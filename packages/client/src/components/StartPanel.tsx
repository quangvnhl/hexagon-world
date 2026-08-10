"use client";

// Bảng thông tin trang đầu: nhập tên + chọn chế độ chơi. Chọn xong bấm "Bắt đầu" →
// trang chủ render thẳng scene tương ứng (không đổi route).

import { useEffect, useState } from "react";

export type GameMode = "solo" | "online";

const DEFAULT_URL =
  process.env.NEXT_PUBLIC_SERVER_URL ?? "ws://localhost:8787";

export function StartPanel({
  onStart,
}: {
  onStart: (mode: GameMode, name: string, serverUrl: string) => void;
}) {
  const [name, setName] = useState("");
  const [mode, setMode] = useState<GameMode>("solo");
  const [serverUrl, setServerUrl] = useState(DEFAULT_URL);

  // Nhớ tên đã nhập giữa các lần chơi.
  useEffect(() => {
    const saved = window.localStorage.getItem("hexagon.name");
    if (saved) setName(saved);
  }, []);

  const start = () => {
    const finalName = name.trim() || "Bạn";
    window.localStorage.setItem("hexagon.name", finalName);
    onStart(mode, finalName, serverUrl.trim() || DEFAULT_URL);
  };

  const card = (
    m: GameMode,
    title: string,
    desc: string,
    icon: string
  ) => {
    const active = mode === m;
    return (
      <button
        onClick={() => setMode(m)}
        style={{
          flex: 1,
          minWidth: 200,
          textAlign: "left",
          padding: "16px 18px",
          borderRadius: 14,
          cursor: "pointer",
          color: "#e8eefc",
          background: active
            ? "linear-gradient(135deg,rgba(49,176,255,0.22),rgba(43,139,224,0.12))"
            : "rgba(255,255,255,0.04)",
          border: active
            ? "1.5px solid rgba(49,176,255,0.8)"
            : "1.5px solid rgba(255,255,255,0.1)",
          boxShadow: active ? "0 8px 28px rgba(49,176,255,0.25)" : "none",
          transition: "all 120ms ease",
        }}
      >
        <div style={{ fontSize: 22, marginBottom: 4 }}>
          {icon}{" "}
          <span style={{ fontSize: 16, fontWeight: 800, letterSpacing: 0.5 }}>
            {title}
          </span>
        </div>
        <div style={{ fontSize: 13, opacity: 0.72, lineHeight: 1.5 }}>{desc}</div>
      </button>
    );
  };

  return (
    <main
      style={{
        minHeight: "100vh",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        padding: 24,
        background:
          "radial-gradient(1200px 600px at 50% -10%, #16203a 0%, #0a0e16 60%)",
        fontFamily: "system-ui, sans-serif",
      }}
    >
      <div
        style={{
          width: "100%",
          maxWidth: 560,
          padding: "32px 32px 28px",
          borderRadius: 20,
          background: "rgba(14,18,28,0.82)",
          border: "1px solid rgba(255,255,255,0.08)",
          boxShadow: "0 24px 80px rgba(0,0,0,0.5)",
          backdropFilter: "blur(8px)",
          color: "#e8eefc",
        }}
      >
        <div style={{ fontSize: 12, letterSpacing: 4, opacity: 0.55 }}>
          CHIẾM LÃNH THỔ LỤC GIÁC
        </div>
        <h1
          style={{
            fontSize: 44,
            margin: "6px 0 4px",
            background: "linear-gradient(90deg,#31b0ff,#ffd23f)",
            WebkitBackgroundClip: "text",
            WebkitTextFillColor: "transparent",
          }}
        >
          Hexagon World
        </h1>
        <p style={{ margin: "0 0 22px", opacity: 0.78, lineHeight: 1.6, fontSize: 14 }}>
          Đi ra ngoài vùng của mình để tạo đuôi, khép vòng quay về để chiếm ô.
          Chiếm {">"} {`${20}`}% bản đồ để thành Nhà Vua.
        </p>

        {/* Tên */}
        <label style={{ fontSize: 12, opacity: 0.7, letterSpacing: 1 }}>
          TÊN CỦA BẠN
        </label>
        <input
          value={name}
          onChange={(e) => setName(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && start()}
          placeholder="Nhập tên…"
          maxLength={16}
          style={{
            width: "100%",
            marginTop: 6,
            marginBottom: 20,
            padding: "12px 14px",
            borderRadius: 12,
            border: "1.5px solid rgba(255,255,255,0.12)",
            background: "rgba(255,255,255,0.05)",
            color: "#e8eefc",
            fontSize: 16,
            outline: "none",
            boxSizing: "border-box",
          }}
        />

        {/* Chọn chế độ */}
        <label style={{ fontSize: 12, opacity: 0.7, letterSpacing: 1 }}>
          CHẾ ĐỘ CHƠI
        </label>
        <div style={{ display: "flex", gap: 12, flexWrap: "wrap", marginTop: 8 }}>
          {card("solo", "Chơi đơn", "Đấu với 20 bot ngay trên máy, không cần mạng.", "🎮")}
          {card(
            "online",
            "Nhiều người",
            "Tìm phòng, đấu thời gian thực với người thật (tối thiểu 2 người, không bot).",
            "🌐"
          )}
        </div>

        {/* Địa chỉ server (chỉ khi online) */}
        {mode === "online" && (
          <div style={{ marginTop: 16 }}>
            <label style={{ fontSize: 12, opacity: 0.7, letterSpacing: 1 }}>
              ĐỊA CHỈ SERVER
            </label>
            <input
              value={serverUrl}
              onChange={(e) => setServerUrl(e.target.value)}
              placeholder="ws://localhost:8787"
              style={{
                width: "100%",
                marginTop: 6,
                padding: "10px 12px",
                borderRadius: 10,
                border: "1.5px solid rgba(255,255,255,0.12)",
                background: "rgba(255,255,255,0.05)",
                color: "#e8eefc",
                fontSize: 14,
                outline: "none",
                boxSizing: "border-box",
              }}
            />
            <div style={{ fontSize: 12, opacity: 0.55, marginTop: 6, lineHeight: 1.5 }}>
              Cần chạy server: <code>pnpm --filter @hexagon/server start:dev</code>
            </div>
          </div>
        )}

        {/* Bắt đầu */}
        <button
          onClick={start}
          style={{
            width: "100%",
            marginTop: 24,
            padding: "15px 24px",
            borderRadius: 999,
            border: "none",
            cursor: "pointer",
            fontSize: 17,
            fontWeight: 800,
            letterSpacing: 1,
            color: "white",
            background: "linear-gradient(90deg,#31b0ff,#2b8be0)",
            boxShadow: "0 10px 32px rgba(49,176,255,0.42)",
          }}
        >
          {mode === "online" ? "🔍 Tìm phòng chơi" : "▶ Bắt đầu chơi"}
        </button>
      </div>
    </main>
  );
}
