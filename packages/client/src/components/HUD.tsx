"use client";

import { useEffect, useRef, useState } from "react";
import { CONFIG, PLAYER_COLORS } from "@hexagon/shared";
import type { DeathCause, Phase } from "@hexagon/shared";
import { ARENA_R, ARENA_INRADIUS } from "@hexagon/shared";

export interface Score {
  id: number;
  name: string;
  pct: number;
  alive: boolean;
}

export interface Stats {
  pct: number;
  king: boolean;
  deaths: number;
  phase: Phase;
  prep: number;
  scores: Score[];
  won: boolean;
  kingHold: number;
  /** Phòng đang bị KING khoá (không cho hồi sinh cho tới khi mất ngôi). */
  locked: boolean;
  /** Tên KING hiện tại (rỗng nếu chưa có). */
  kingName: string;
  /** Id người thắng khi game kết thúc (-1 nếu chưa); 0 = người chơi. */
  winnerId: number;
  /** Tên người thắng (để hiển thị khi bot thắng). */
  winnerName: string;
  /** Còn ô trống hợp lệ để hồi sinh không (không tính khoá phòng). */
  canRevive: boolean;
  /** Người chơi đã chọn XEM (khán giả) — chờ hết ván. */
  spectating: boolean;
  /** Lý do chết lần gần nhất (cho popup). */
  deathCause: DeathCause;
  /** Tên kẻ đã hạ (rỗng nếu tự chết / cả hai chết). */
  killerName: string;
  /** % diện tích ngay trước khi chết. */
  lastPct: number;
  /** Toạ độ world các ô lãnh thổ NGAY TRƯỚC khi chết — vẽ bản đồ trong popup. */
  deathCells: { x: number; y: number }[];
}

/** Câu mô tả lý do chết (tiếng Việt) cho popup. */
function deathReason(cause: DeathCause, killerName: string): string {
  switch (cause) {
    case "self":
      return "Bạn tự đâm vào đuôi của chính mình";
    case "cut":
      return `Bị ${killerName || "đối thủ"} cắt đuôi`;
    case "headIntruder":
      return `Bị ${killerName || "chủ đất"} húc đầu khi xâm nhập lãnh thổ`;
    case "headMutual":
      return "Đâm đầu trực diện — cả hai cùng chết";
    default:
      return "";
  }
}

/** Bản đồ nhỏ trong popup chết: vẽ viền sân + các ô đất người chơi từng chiếm. */
function DeathMiniMap({ cells }: { cells: { x: number; y: number }[] }) {
  const ref = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const canvas = ref.current;
    if (!canvas) return;
    const halfW = ARENA_R;
    const halfH = ARENA_INRADIUS;
    const W = 220;
    const H = Math.round((W * halfH) / halfW);
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    canvas.width = W * dpr;
    canvas.height = H * dpr;
    canvas.style.width = W + "px";
    canvas.style.height = H + "px";
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const sx = (W * dpr) / (2 * halfW);
    const sy = (H * dpr) / (2 * halfH);
    const toPx = (wx: number, wy: number): [number, number] => [
      (wx + halfW) * sx,
      (halfH - wy) * sy,
    ];

    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.fillStyle = "rgba(12,16,24,0.9)";
    ctx.fillRect(0, 0, canvas.width, canvas.height);

    // Các ô đất người chơi từng chiếm (màu người chơi).
    const cw = Math.sqrt(3) * sx * 1.2;
    const ch = 1.5 * sy * 1.2;
    ctx.fillStyle = rgbCss(PLAYER_COLORS[0].owned);
    for (const c of cells) {
      const [px, py] = toPx(c.x, c.y);
      ctx.fillRect(px - cw / 2, py - ch / 2, cw, ch);
    }

    // Viền lục giác sân.
    ctx.beginPath();
    for (let k = 0; k < 6; k++) {
      const a = (k * Math.PI) / 3;
      const [vx, vy] = toPx(Math.cos(a) * ARENA_R, Math.sin(a) * ARENA_R);
      if (k === 0) ctx.moveTo(vx, vy);
      else ctx.lineTo(vx, vy);
    }
    ctx.closePath();
    ctx.strokeStyle = "rgba(150,170,210,0.6)";
    ctx.lineWidth = 1 * dpr;
    ctx.stroke();
  }, [cells]);

  return <canvas ref={ref} style={{ display: "block", borderRadius: 8 }} />;
}

const rgbCss = (c: readonly [number, number, number]) =>
  `rgb(${Math.round(c[0] * 255)},${Math.round(c[1] * 255)},${Math.round(
    c[2] * 255
  )})`;

/** Định dạng số giây → "m:ss" (vd 179 → "2:59"). */
const fmtTime = (secs: number) => {
  const s = Math.max(0, Math.ceil(secs));
  const m = Math.floor(s / 60);
  const ss = s % 60;
  return `${m}:${ss.toString().padStart(2, "0")}`;
};

/** true khi màn hình hẹp (điện thoại) → thu nhỏ các bảng thông số cho đỡ che màn hình. */
function useIsMobile(): boolean {
  const [mobile, setMobile] = useState(false);
  useEffect(() => {
    const mq = window.matchMedia("(max-width: 640px)");
    const on = () => setMobile(mq.matches);
    on();
    mq.addEventListener("change", on);
    return () => mq.removeEventListener("change", on);
  }, []);
  return mobile;
}

export function HUD({
  stats,
  onRevive,
  onRestart,
  onSpectate,
  localId = 0,
  playerName,
}: {
  stats: Stats;
  onRevive: () => void;
  onRestart: () => void;
  onSpectate: () => void;
  /** Id thực thể của NGƯỜI CHƠI CỤC BỘ (0 khi chơi đơn; = playerId khi online). */
  localId?: number;
  /** Tên hiển thị của người chơi cục bộ (thay cho tên màu mặc định). */
  playerName?: string;
}) {
  const isMobile = useIsMobile();
  // Trên điện thoại: thu nhỏ 2 bảng thông số về góc để không đè lên vùng chơi.
  const uiScale = isMobile ? 0.78 : 1;

  // Bảng xếp hạng: chỉ TOP 5; nếu người chơi cục bộ hạng > 5 thì thêm 1 dòng dưới cùng.
  const sorted = [...stats.scores].sort((a, b) => b.pct - a.pct);
  const top = sorted.slice(0, 5);
  const humanRank = sorted.findIndex((s) => s.id === localId);
  const humanInTop = humanRank > -1 && humanRank < 5;

  const rankRow = (s: Score, rank: number, highlight = false) => (
    <div
      key={`${s.id}-${rank}`}
      style={{
        display: "flex",
        alignItems: "center",
        gap: 8,
        fontSize: 13,
        lineHeight: 1.7,
        opacity: s.alive ? 1 : 0.4,
        padding: highlight ? "2px 6px" : undefined,
        margin: highlight ? "0 -6px" : undefined,
        borderRadius: highlight ? 6 : undefined,
        background: highlight ? "rgba(49,176,255,0.16)" : undefined,
      }}
    >
      <span style={{ width: 16, textAlign: "right", opacity: 0.55, flex: "0 0 auto" }}>
        {rank}
      </span>
      <span
        style={{
          width: 10,
          height: 10,
          borderRadius: 3,
          background: rgbCss(PLAYER_COLORS[s.id % PLAYER_COLORS.length].owned),
          flex: "0 0 auto",
        }}
      />
      <span style={{ flex: 1, fontWeight: s.id === localId ? 700 : 400 }}>
        {s.id === localId && playerName ? playerName : s.name}
        {!s.alive ? " 💀" : ""}
      </span>
      <span style={{ opacity: 0.85 }}>{s.pct.toFixed(1)}%</span>
    </div>
  );

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
          transform: uiScale !== 1 ? `scale(${uiScale})` : undefined,
          transformOrigin: "top left",
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

      {/* Bảng xếp hạng (góc trên phải) — TOP 5, + dòng người chơi nếu hạng > 5 */}
      <div
        style={{
          position: "absolute",
          top: 16,
          right: 16,
          padding: "10px 12px",
          borderRadius: 12,
          background: "rgba(10,14,22,0.72)",
          color: "#e8eefc",
          fontFamily: "system-ui, sans-serif",
          minWidth: 176,
          pointerEvents: "none",
          backdropFilter: "blur(6px)",
          transform: uiScale !== 1 ? `scale(${uiScale})` : undefined,
          transformOrigin: "top right",
        }}
      >
        <div
          style={{
            fontSize: 11,
            opacity: 0.7,
            letterSpacing: 1,
            marginBottom: 6,
          }}
        >
          XẾP HẠNG
        </div>
        {top.map((s, i) => rankRow(s, i + 1))}
        {!humanInTop && humanRank > -1 && (
          <>
            <div
              style={{
                borderTop: "1px dashed rgba(255,255,255,0.18)",
                margin: "6px 0 4px",
              }}
            />
            {rankRow(sorted[humanRank], humanRank + 1, true)}
          </>
        )}
      </div>

      {/* Banner KING + đếm ngược giữ ngôi */}
      {stats.king && !stats.won && (
        <div
          style={{
            position: "absolute",
            top: 16,
            left: "50%",
            transform: `translateX(-50%)${uiScale !== 1 ? ` scale(${uiScale})` : ""}`,
            transformOrigin: "top center",
            display: "flex",
            flexDirection: "column",
            alignItems: "center",
            gap: 6,
            pointerEvents: "none",
          }}
        >
          <div
            style={{
              padding: "10px 22px",
              borderRadius: 999,
              background: "linear-gradient(90deg,#ffb02e,#ffd23f)",
              color: "#3a2400",
              fontFamily: "system-ui, sans-serif",
              fontWeight: 800,
              letterSpacing: 2,
              boxShadow: "0 6px 24px rgba(255,180,46,0.4)",
            }}
          >
            👑 NHÀ VUA
          </div>
          <div
            style={{
              padding: "5px 16px",
              borderRadius: 999,
              background: "rgba(10,14,22,0.72)",
              color: "#ffd23f",
              fontFamily: "system-ui, sans-serif",
              fontSize: 15,
              fontWeight: 700,
              letterSpacing: 1,
              backdropFilter: "blur(6px)",
            }}
          >
            Giữ ngôi: {fmtTime(stats.kingHold)}
          </div>
        </div>
      )}

      {/* Hướng dẫn góc dưới — ẩn trên điện thoại (dài, che màn hình; đã có joystick) */}
      {!isMobile && (
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
      )}

      {/* Đếm ngược CHUẨN BỊ (đứng yên, xoay hướng) */}
      {stats.phase === "prep" && (
        <div
          style={{
            position: "absolute",
            top: "38%",
            left: "50%",
            transform: "translate(-50%,-50%)",
            textAlign: "center",
            color: "#e8eefc",
            fontFamily: "system-ui, sans-serif",
            pointerEvents: "none",
            textShadow: "0 4px 24px rgba(0,0,0,0.6)",
          }}
        >
          <div style={{ fontSize: 88, fontWeight: 800, lineHeight: 1 }}>
            {Math.ceil(stats.prep)}
          </div>
          <div style={{ fontSize: 15, opacity: 0.85, marginTop: 6 }}>
            Di chuột để chọn hướng xuất phát…
          </div>
        </div>
      )}

      {/* Popup CHẾT: chọn Hồi sinh hoặc Xem (chưa xem & chưa hết ván) */}
      {stats.phase === "dead" && !stats.spectating && !stats.won && (
        <div
          style={{
            position: "absolute",
            inset: 0,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            background: "rgba(4,6,12,0.55)",
            backdropFilter: "blur(3px)",
          }}
        >
          <div
            style={{
              padding: "28px 34px",
              borderRadius: 16,
              background: "rgba(16,20,30,0.96)",
              border: "1px solid rgba(255,255,255,0.14)",
              boxShadow: "0 12px 48px rgba(0,0,0,0.5)",
              textAlign: "center",
              color: "#e8eefc",
              fontFamily: "system-ui, sans-serif",
              minWidth: 280,
            }}
          >
            <div style={{ fontSize: 26, fontWeight: 800 }}>💀 Bạn đã chết</div>
            {/* Lý do chết */}
            {deathReason(stats.deathCause, stats.killerName) && (
              <div
                style={{
                  marginTop: 10,
                  padding: "8px 14px",
                  borderRadius: 10,
                  background: "rgba(255,90,90,0.14)",
                  border: "1px solid rgba(255,120,120,0.3)",
                  fontSize: 14,
                  fontWeight: 600,
                  color: "#ffb3b3",
                }}
              >
                ☠️ {deathReason(stats.deathCause, stats.killerName)}
              </div>
            )}
            {/* Bản đồ đất đã chiếm trước khi chết */}
            <div style={{ marginTop: 14 }}>
              <div
                style={{
                  fontSize: 11,
                  letterSpacing: 1,
                  opacity: 0.6,
                  marginBottom: 6,
                }}
              >
                LÃNH THỔ ĐÃ CHIẾM · {stats.lastPct.toFixed(1)}%
              </div>
              <div style={{ display: "flex", justifyContent: "center" }}>
                <DeathMiniMap cells={stats.deathCells} />
              </div>
            </div>
            <div style={{ fontSize: 13, opacity: 0.6, marginTop: 10 }}>
              Số lần chết: {stats.deaths}
            </div>
            {stats.locked ? (
              <div
                style={{ marginTop: 12, fontSize: 13, color: "#ffd23f", fontWeight: 600 }}
              >
                🔒 Phòng đang bị {stats.kingName || "KING"} khoá · chờ đến khi
                mất ngôi mới hồi sinh
              </div>
            ) : !stats.canRevive ? (
              <div
                style={{ marginTop: 12, fontSize: 13, color: "#ff9d5c", fontWeight: 600 }}
              >
                🧱 Bản đồ đã đủ ô đất · chưa có vị trí trống hợp lệ để hồi sinh ·
                chờ khi có chỗ
              </div>
            ) : null}
            <div
              style={{
                marginTop: 20,
                display: "flex",
                gap: 10,
                justifyContent: "center",
              }}
            >
              {(() => {
                const blocked = stats.locked || !stats.canRevive;
                return (
                  <button
                    onClick={onRevive}
                    disabled={blocked}
                    style={{
                      padding: "12px 24px",
                      borderRadius: 999,
                      border: "none",
                      cursor: blocked ? "not-allowed" : "pointer",
                      fontSize: 15,
                      fontWeight: 800,
                      letterSpacing: 1,
                      color: "#04121f",
                      background: blocked
                        ? "rgba(255,255,255,0.2)"
                        : "linear-gradient(90deg,#31b0ff,#5ce1ff)",
                      boxShadow: blocked
                        ? "none"
                        : "0 6px 20px rgba(49,176,255,0.45)",
                      opacity: blocked ? 0.6 : 1,
                    }}
                  >
                    {blocked ? "⏳ ĐANG CHỜ" : "↻ HỒI SINH"}
                  </button>
                );
              })()}
              <button
                onClick={onSpectate}
                title="Chọn Xem thì không hồi sinh được nữa, phải chờ hết ván"
                style={{
                  padding: "12px 24px",
                  borderRadius: 999,
                  border: "1px solid rgba(255,255,255,0.25)",
                  cursor: "pointer",
                  fontSize: 15,
                  fontWeight: 800,
                  letterSpacing: 1,
                  color: "#e8eefc",
                  background: "rgba(255,255,255,0.08)",
                }}
              >
                👁 XEM
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Chế độ KHÁN GIẢ (đã chọn Xem): banner nhẹ, không chặn tầm nhìn */}
      {stats.phase === "dead" && stats.spectating && !stats.won && (
        <div
          style={{
            position: "absolute",
            top: 16,
            left: "50%",
            transform: "translateX(-50%)",
            padding: "8px 18px",
            borderRadius: 999,
            background: "rgba(10,14,22,0.8)",
            color: "#cdd7ea",
            fontFamily: "system-ui, sans-serif",
            fontSize: 13,
            fontWeight: 600,
            pointerEvents: "none",
            backdropFilter: "blur(6px)",
          }}
        >
          👁 Đang xem · chờ hết ván để chơi lại
        </div>
      )}

      {/* Màn hình CHIẾN THẮNG + nút Chơi lại */}
      {stats.won && (
        <div
          style={{
            position: "absolute",
            inset: 0,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            background: "rgba(4,6,12,0.6)",
            backdropFilter: "blur(4px)",
          }}
        >
          <div
            style={{
              padding: "34px 44px",
              borderRadius: 16,
              background: "rgba(16,20,30,0.96)",
              border: "1px solid rgba(255,210,63,0.35)",
              boxShadow: "0 12px 48px rgba(0,0,0,0.55)",
              textAlign: "center",
              color: "#e8eefc",
              fontFamily: "system-ui, sans-serif",
              minWidth: 300,
            }}
          >
            <div style={{ fontSize: 34, fontWeight: 900, letterSpacing: 1 }}>
              {stats.winnerId === localId ? "🏆 CHIẾN THẮNG!" : "☠️ THUA CUỘC"}
            </div>
            <div style={{ fontSize: 15, opacity: 0.75, marginTop: 10 }}>
              {stats.winnerId === localId
                ? "Bạn là người chiến thắng chung cuộc!"
                : `${stats.winnerName || "Đối thủ"} đã chiến thắng`}
            </div>
            <button
              onClick={onRestart}
              style={{
                marginTop: 24,
                padding: "12px 30px",
                borderRadius: 999,
                border: "none",
                cursor: "pointer",
                fontSize: 16,
                fontWeight: 800,
                letterSpacing: 1,
                color: "#3a2400",
                background: "linear-gradient(90deg,#ffb02e,#ffd23f)",
                boxShadow: "0 6px 20px rgba(255,180,46,0.45)",
              }}
            >
              ▶ CHƠI LẠI
            </button>
          </div>
        </div>
      )}
    </>
  );
}
