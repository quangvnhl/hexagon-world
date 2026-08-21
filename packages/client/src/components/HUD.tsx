"use client";

import { useEffect, useRef, useState, type CSSProperties } from "react";
import { CONFIG, PLAYER_COLORS } from "@hexagon/shared";
import type { DeathCause, Phase } from "@hexagon/shared";
import { ARENA_R, ARENA_INRADIUS } from "@hexagon/shared";
import { endActionForMode, type EndScreenMode } from "./endAction";

export interface Score {
  id: number;
  name: string;
  pct: number;
  alive: boolean;
  colorIndex: number;
}

export interface Stats {
  pct: number;
  king: boolean;
  /** Ngưỡng % MỤC TIÊU của ván cho thanh diện tích (Campaign: targetPct/kingPct theo cấp). Vắng ⇒
   *  dùng CONFIG.KING_PCT (online/luyện tập bất biến). */
  targetPct?: number;
  /** Cơ chế KING có bật không (đổi nhãn "Mục tiêu King" ↔ "Mục tiêu"). */
  kingEnabled?: boolean;
  /** Id KING authoritative hiện tại; -1/undefined nếu chưa có. */
  kingId?: number;
  deaths: number;
  phase: Phase;
  prep: number;
  scores: Score[];
  /** Màu chính của người chơi cục bộ (cho popup/minimap sau khi chết). */
  colorIndex: number;
  won: boolean;
  /** [Campaign] Đã THUA — hiện màn thua. */
  lost?: boolean;
  /** [Campaign] Lý do thua: "lives" = hết mạng; "no_space" = hết chỗ hồi sinh. */
  lostReason?: "" | "lives" | "no_space";
  /** [Campaign] Số mạng của cấp (0 = vô hạn). Hiện "mạng còn lại" khi > 0. */
  maxLives?: number;
  /** [Campaign] Chuỗi tiến độ objective (vd "Chiếm 12.3% / 30%"); rỗng nếu không áp dụng. */
  objective?: string;
  /** Ván endless (Luyện tập, `win.kind === "none"`) — không có đếm ngược King-thắng / màn thắng. */
  endless?: boolean;
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
  /** Tên thực thể ĐANG XEM (khán giả) — hiển thị cạnh nút chuyển. Rỗng nếu chưa xác định. */
  spectateName?: string;
  /** Lý do chết lần gần nhất (cho popup). */
  deathCause: DeathCause;
  /** Tên kẻ đã hạ (rỗng nếu tự chết / cả hai chết). */
  killerName: string;
  /** % diện tích ngay trước khi chết. */
  lastPct: number;
  /** Toạ độ world các ô lãnh thổ NGAY TRƯỚC khi chết — vẽ bản đồ trong popup. */
  deathCells: { x: number; y: number }[];
  effectiveSpeed?: number;
  speedTotemCount?: number;
  radarActive?: boolean;
  insideEnemySlowZone?: boolean;
}

/** Nút tròn nhỏ ◀ ▶ để chuyển người đang xem (khán giả). */
const spectateBtnStyle: CSSProperties = {
  width: 30,
  height: 30,
  borderRadius: "50%",
  border: "1px solid rgba(120,140,180,0.4)",
  background: "rgba(30,40,60,0.9)",
  color: "#e8eefc",
  fontSize: 13,
  fontWeight: 800,
  cursor: "pointer",
  lineHeight: 1,
  display: "flex",
  alignItems: "center",
  justifyContent: "center",
  pointerEvents: "auto",
};

const statusChipStyle: CSSProperties = {
  padding: "2px 5px",
  borderRadius: 999,
  background: "rgba(255,255,255,0.1)",
  color: "#ffd76b",
  fontSize: 9,
  fontWeight: 800,
  whiteSpace: "nowrap",
};

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
function DeathMiniMap({
  cells,
  colorIndex,
}: {
  cells: { x: number; y: number }[];
  colorIndex: number;
}) {
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
    ctx.fillStyle = rgbCss(
      PLAYER_COLORS[colorIndex % PLAYER_COLORS.length].owned
    );
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
  }, [cells, colorIndex]);

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

const hudSafeTop =
  "max(env(safe-area-inset-top, 0px), var(--tg-safe-area-inset-top, 0px), var(--tg-content-safe-area-inset-top, 0px), var(--telegram-safe-top, 0px))";
const hudSafeRight =
  "max(env(safe-area-inset-right, 0px), var(--tg-safe-area-inset-right, 0px), var(--tg-content-safe-area-inset-right, 0px), var(--telegram-safe-right, 0px))";
const hudSafeLeft =
  "max(env(safe-area-inset-left, 0px), var(--tg-safe-area-inset-left, 0px), var(--tg-content-safe-area-inset-left, 0px), var(--telegram-safe-left, 0px))";

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
  onSpectatePrev,
  onSpectateNext,
  localId = 0,
  playerName,
  endMode = "single",
  onReturnToLobby,
  reviveNotice,
}: {
  stats: Stats;
  onRevive: () => void;
  onRestart: () => void;
  onSpectate: () => void;
  /** Chuyển thực thể đang XEM (khán giả) sang người trước/sau. Bỏ trống = không hiện nút. */
  onSpectatePrev?: () => void;
  onSpectateNext?: () => void;
  /** Id thực thể của NGƯỜI CHƠI CỤC BỘ (0 khi chơi đơn; = playerId khi online). */
  localId?: number;
  /** Tên hiển thị của người chơi cục bộ (thay cho tên màu mặc định). */
  playerName?: string;
  endMode?: EndScreenMode;
  onReturnToLobby?: () => void;
  reviveNotice?: string;
}) {
  const isMobile = useIsMobile();
  // Trên điện thoại: thu nhỏ 2 bảng thông số về góc để không đè lên vùng chơi.
  const uiScale = isMobile ? 0.78 : 1;
  const [deathPopupReady, setDeathPopupReady] = useState(false);
  const [showInstructions, setShowInstructions] = useState(true);

  // Hiện hướng dẫn ở đầu mỗi ván, giữ đủ 5 giây rồi mới bắt đầu fade out.
  // `won` đổi từ true về false khi chơi lại, nên timer cũng được khởi động lại.
  useEffect(() => {
    if (stats.won) {
      setShowInstructions(false);
      return;
    }
    setShowInstructions(true);
    const timer = window.setTimeout(() => setShowInstructions(false), 5000);
    return () => window.clearTimeout(timer);
  }, [stats.won]);

  // Giữ nguyên khung cảnh chết để người chơi nhìn trọn hiệu ứng trước khi popup che Canvas.
  // `deaths` nằm trong dependency để mỗi lần chết sau hồi sinh đều bắt đầu một timer mới.
  useEffect(() => {
    if (stats.phase !== "dead" || stats.spectating || stats.won || stats.lost) {
      setDeathPopupReady(false);
      return;
    }
    setDeathPopupReady(false);
    const timer = window.setTimeout(
      () => setDeathPopupReady(true),
      CONFIG.EFFECTS.DEATH_POPUP_DELAY * 1000
    );
    return () => window.clearTimeout(timer);
  }, [stats.phase, stats.deaths, stats.spectating, stats.won, stats.lost]);

  // Bảng xếp hạng: chỉ TOP 5; nếu người chơi cục bộ hạng > 5 thì thêm 1 dòng dưới cùng.
  const sorted = [...stats.scores].sort((a, b) => b.pct - a.pct);
  const top = sorted.slice(0, 5);
  const humanRank = sorted.findIndex((s) => s.id === localId);
  const humanInTop = humanRank > -1 && humanRank < 5;
  const endAction = endActionForMode(endMode);

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
          background: rgbCss(
            PLAYER_COLORS[s.colorIndex % PLAYER_COLORS.length].owned
          ),
          flex: "0 0 auto",
        }}
      />
      <span style={{ flex: 1, fontWeight: s.id === localId ? 700 : 400 }}>
        {s.id === stats.kingId ? "👑 " : ""}
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
          top: `calc(${hudSafeTop} + 36px + var(--telegram-hud-portrait-offset, 0px))`,
          left: `max(10px, ${hudSafeLeft})`,
          padding: "8px 11px",
          borderRadius: 12,
          background: "rgba(10,14,22,0.72)",
          color: "#e8eefc",
          fontFamily: "system-ui, sans-serif",
          minWidth: 150,
          pointerEvents: "none",
          backdropFilter: "blur(6px)",
          transform: uiScale !== 1 ? `scale(${uiScale})` : undefined,
          transformOrigin: "top left",
        }}
      >
        <div style={{ fontSize: 9, opacity: 0.7, letterSpacing: 0.8 }}>
          DIỆN TÍCH
        </div>
        <div style={{ fontSize: 23, fontWeight: 700, lineHeight: 1.1 }}>
          {stats.pct.toFixed(1)}%
        </div>
        {/* Thanh tiến trình tới ngưỡng King */}
        <div
          style={{
            marginTop: 5,
            height: 6,
            borderRadius: 4,
            background: "rgba(255,255,255,0.12)",
            overflow: "hidden",
          }}
        >
          <div
            style={{
              height: "100%",
              width: `${Math.min(100, (stats.pct / (stats.targetPct ?? CONFIG.KING_PCT)) * 100)}%`,
              background: stats.king ? "#ffd23f" : "#31b0ff",
              transition: "width 120ms linear",
            }}
          />
        </div>
        <div style={{ fontSize: 9, opacity: 0.6, marginTop: 4 }}>
          {stats.kingEnabled === false ? "Mục tiêu" : "Mục tiêu King"}:{" "}
          {(stats.targetPct ?? CONFIG.KING_PCT).toFixed(0)}% · Chết: {stats.deaths}
        </div>
        {(stats.effectiveSpeed !== undefined ||
          stats.speedTotemCount ||
          stats.radarActive ||
          stats.insideEnemySlowZone) && (
          <div style={{ display: "flex", gap: 5, flexWrap: "wrap", marginTop: 7 }}>
            {stats.effectiveSpeed !== undefined && (
              <span style={statusChipStyle}>⚡ {stats.effectiveSpeed.toFixed(1)}</span>
            )}
            {(stats.speedTotemCount ?? 0) > 0 && (
              <span style={statusChipStyle}>◆ ×{stats.speedTotemCount}</span>
            )}
            {stats.insideEnemySlowZone && (
              <span style={{ ...statusChipStyle, color: "#8ecbff" }}>❄ CHẬM</span>
            )}
            {stats.radarActive && (
              <span style={{ ...statusChipStyle, color: "#dda8ff" }}>◉ RADAR</span>
            )}
          </div>
        )}
      </div>

      {/* Bảng xếp hạng (góc trên phải) — TOP 5, + dòng người chơi nếu hạng > 5 */}
      <div
        style={{
          position: "absolute",
          top: `calc(${hudSafeTop} + 16px + var(--telegram-hud-portrait-offset, 0px))`,
          right: `max(16px, ${hudSafeRight})`,
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

      {/* Luyện tập (endless): chỉ báo nhỏ thay cho đồng hồ đếm ngược King-thắng
          (mode này không có thắng/thua, không cần cảnh báo "sẽ thắng sau"). */}
      {stats.endless && (
        <div
          style={{
            position: "absolute",
            top: `calc(${hudSafeTop} + 16px)`,
            left: "50%",
            transform: `translateX(-50%)${uiScale !== 1 ? ` scale(${uiScale})` : ""}`,
            transformOrigin: "top center",
            padding: "6px 14px",
            borderRadius: 999,
            background: "rgba(10,14,22,0.72)",
            border: "1px solid rgba(255,255,255,0.16)",
            color: "#cdd7ea",
            fontFamily: "system-ui, sans-serif",
            fontSize: 11,
            fontWeight: 800,
            letterSpacing: 1,
            backdropFilter: "blur(6px)",
            pointerEvents: "none",
          }}
        >
          🏋️ LUYỆN TẬP
        </div>
      )}

      {/* [Campaign] Banner MỤC TIÊU + mạng còn lại (khi có objective, chưa kết thúc). */}
      {stats.objective && !stats.won && !stats.lost && (
        <div
          style={{
            position: "absolute",
            top: `calc(${hudSafeTop} + 16px)`,
            left: "50%",
            transform: `translateX(-50%)${uiScale !== 1 ? ` scale(${uiScale})` : ""}`,
            transformOrigin: "top center",
            display: "flex",
            flexDirection: "column",
            alignItems: "center",
            gap: 5,
            pointerEvents: "none",
          }}
        >
          <div
            style={{
              padding: "6px 14px",
              borderRadius: 999,
              background: "linear-gradient(90deg,#2f7bff,#5ce1ff)",
              color: "#04121f",
              fontFamily: "system-ui, sans-serif",
              fontSize: 12,
              fontWeight: 800,
              letterSpacing: 0.6,
              boxShadow: "0 6px 20px rgba(47,123,255,0.4)",
            }}
          >
            🎯 {stats.objective}
          </div>
          {(stats.maxLives ?? 0) > 0 && (
            <div
              style={{
                padding: "3px 11px",
                borderRadius: 999,
                background: "rgba(10,14,22,0.72)",
                color: "#ff9d9d",
                fontFamily: "system-ui, sans-serif",
                fontSize: 11,
                fontWeight: 700,
                letterSpacing: 0.6,
                backdropFilter: "blur(6px)",
              }}
            >
              {"❤".repeat(Math.max(0, (stats.maxLives ?? 0) - stats.deaths))}
              {"🖤".repeat(Math.min(stats.deaths, stats.maxLives ?? 0))} ·{" "}
              {Math.max(0, (stats.maxLives ?? 0) - stats.deaths)} mạng
            </div>
          )}
        </div>
      )}

      {/* Banner KING + đếm ngược giữ ngôi */}
      {stats.king && !stats.won && !stats.endless && (
        <div
          style={{
            position: "absolute",
            top: `calc(${hudSafeTop} + 16px)`,
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
              padding: "7px 14px",
              borderRadius: 999,
              background: "linear-gradient(90deg,#ffb02e,#ffd23f)",
              color: "#3a2400",
              fontFamily: "system-ui, sans-serif",
              fontSize: 12,
              fontWeight: 800,
              letterSpacing: 1,
              boxShadow: "0 6px 24px rgba(255,180,46,0.4)",
            }}
          >
            👑 NHÀ VUA
          </div>
          <div
            style={{
              padding: "4px 11px",
              borderRadius: 999,
              background: "rgba(10,14,22,0.72)",
              color: "#ffd23f",
              fontFamily: "system-ui, sans-serif",
              fontSize: 11,
              fontWeight: 700,
              letterSpacing: 1,
              backdropFilter: "blur(6px)",
            }}
          >
            Giữ ngôi: {fmtTime(stats.kingHold)}
          </div>
        </div>
      )}

      {/* Banner CẢNH BÁO: NGƯỜI/BOT KHÁC đang là Vua → báo cho MỌI người biết ai đang là Vua
          và còn bao lâu nữa thì họ THẮNG (kingName/kingHold có sẵn cho cả chơi đơn & online). */}
      {!stats.king && stats.kingName && !stats.won && !stats.endless && (
        <div
          style={{
            position: "absolute",
            top: `calc(${hudSafeTop} + 16px)`,
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
              padding: "7px 13px",
              borderRadius: 999,
              background: "rgba(10,14,22,0.82)",
              border: "1px solid rgba(255,180,46,0.55)",
              color: "#ffd23f",
              fontFamily: "system-ui, sans-serif",
              fontSize: 11,
              fontWeight: 800,
              letterSpacing: 1,
              boxShadow: "0 6px 24px rgba(255,180,46,0.25)",
              backdropFilter: "blur(6px)",
            }}
          >
            👑 {stats.kingName} ĐANG LÀ NHÀ VUA
          </div>
          <div
            style={{
              padding: "4px 11px",
              borderRadius: 999,
              background: "rgba(10,14,22,0.72)",
              color: "#ff9d5c",
              fontFamily: "system-ui, sans-serif",
              fontSize: 10,
              fontWeight: 700,
              letterSpacing: 1,
              backdropFilter: "blur(6px)",
            }}
          >
            Sẽ thắng sau: {fmtTime(stats.kingHold)}
          </div>
        </div>
      )}

      {/* Hướng dẫn đầu ván: giữ 5 giây, sau đó fade out. */}
      <div
        aria-hidden={!showInstructions}
        style={{
          position: "absolute",
          bottom:
            "calc(max(16px, env(safe-area-inset-bottom, 0px), var(--tg-safe-area-inset-bottom, 0px), var(--tg-content-safe-area-inset-bottom, 0px), var(--telegram-safe-bottom, 0px)) + 4px)",
          left: "50%",
          width: isMobile ? "min(78vw, 420px)" : "auto",
          transform: "translateX(-50%)",
          padding: isMobile ? "7px 12px" : "8px 16px",
          borderRadius: 10,
          background: "rgba(10,14,22,0.6)",
          color: "#cdd7ea",
          fontFamily: "system-ui, sans-serif",
          fontSize: isMobile ? 11 : 13,
          lineHeight: 1.4,
          textAlign: "center",
          opacity: showInstructions ? 1 : 0,
          transition: "opacity 600ms ease",
          pointerEvents: "none",
        }}
      >
        {isMobile
          ? "Chạm và kéo để đổi hướng · Khép vòng về vùng của mình để chiếm đất · Đừng cắt đuôi chính mình"
          : "Di chuột để đổi hướng · Đi ra ngoài rồi khép vòng về vùng của mình để chiếm đất · Đừng cắt đuôi chính mình"}
      </div>

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
      {stats.phase === "dead" &&
        deathPopupReady &&
        !stats.spectating &&
        !stats.won &&
        !stats.lost && (
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
                <DeathMiniMap
                  cells={stats.deathCells}
                  colorIndex={stats.colorIndex}
                />
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
            {reviveNotice && (
              <div
                role="status"
                style={{
                  marginTop: 12,
                  padding: "8px 12px",
                  borderRadius: 10,
                  background: "rgba(255,157,92,0.14)",
                  border: "1px solid rgba(255,157,92,0.35)",
                  color: "#ffc49c",
                  fontSize: 13,
                  fontWeight: 700,
                }}
              >
                {reviveNotice}
              </div>
            )}
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

      {/* Chế độ KHÁN GIẢ (đã chọn Xem): banner + nút chuyển người xem (◀ ▶). */}
      {stats.phase === "dead" && stats.spectating && !stats.won && (
        <div
          style={{
            position: "absolute",
            top: `calc(${hudSafeTop} + 118px + var(--telegram-hud-portrait-offset, 0px))`,
            left: "50%",
            transform: "translateX(-50%)",
            display: "flex",
            alignItems: "center",
            gap: 10,
            padding: "6px 10px",
            borderRadius: 999,
            background: "rgba(10,14,22,0.8)",
            color: "#cdd7ea",
            fontFamily: "system-ui, sans-serif",
            fontSize: 13,
            fontWeight: 600,
            backdropFilter: "blur(6px)",
          }}
        >
          {onSpectatePrev && (
            <button
              onClick={onSpectatePrev}
              title="Xem người trước"
              style={spectateBtnStyle}
            >
              ◀
            </button>
          )}
          <span style={{ pointerEvents: "none", whiteSpace: "nowrap" }}>
            👁 Đang xem{stats.spectateName ? `: ${stats.spectateName}` : ""}
          </span>
          {onSpectateNext && (
            <button
              onClick={onSpectateNext}
              title="Xem người sau"
              style={spectateBtnStyle}
            >
              ▶
            </button>
          )}
        </div>
      )}

      {/* Màn hình CHIẾN THẮNG + nút Chơi lại (mode endless không bao giờ hiện — won luôn false) */}
      {stats.won && !stats.endless && (
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
              onClick={
                endAction.kind === "lobby"
                  ? (onReturnToLobby ?? onRestart)
                  : onRestart
              }
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
              {endAction.kind === "restart" ? "▶ " : "← "}
              {endAction.label}
            </button>
          </div>
        </div>
      )}

      {/* [Campaign] Màn THUA (hết mạng). Nút = hành động kết màn của mode (Campaign → về sảnh cấp). */}
      {stats.lost && (
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
              border: "1px solid rgba(255,90,90,0.35)",
              boxShadow: "0 12px 48px rgba(0,0,0,0.55)",
              textAlign: "center",
              color: "#e8eefc",
              fontFamily: "system-ui, sans-serif",
              minWidth: 300,
            }}
          >
            <div style={{ fontSize: 34, fontWeight: 900, letterSpacing: 1 }}>
              {stats.lostReason === "no_space" ? "☠️ ĐÃ THUA" : "☠️ HẾT MẠNG"}
            </div>
            <div style={{ fontSize: 15, opacity: 0.75, marginTop: 10 }}>
              {stats.lostReason === "no_space"
                ? "Không còn đủ diện tích để hồi sinh."
                : `Bạn đã dùng hết ${stats.maxLives ?? 0} mạng của cấp này.`}
            </div>
            <button
              onClick={onReturnToLobby ?? onRestart}
              style={{
                marginTop: 24,
                padding: "12px 30px",
                borderRadius: 999,
                border: "none",
                cursor: "pointer",
                fontSize: 16,
                fontWeight: 800,
                letterSpacing: 1,
                color: "#e8eefc",
                background: "linear-gradient(90deg,#ff5a5a,#ff8a5a)",
                boxShadow: "0 6px 20px rgba(255,90,90,0.4)",
              }}
            >
              ← {onReturnToLobby ? "Về danh sách cấp" : "Chơi lại"}
            </button>
          </div>
        </div>
      )}
    </>
  );
}
