"use client";

// Bảng thông tin trang đầu: nhập tên + chọn chế độ chơi. Chọn xong bấm "Bắt đầu" →
// trang chủ render thẳng scene tương ứng (không đổi route).

import { useEffect, useState, type CSSProperties } from "react";
import {
  DEFAULT_PLAYER_APPEARANCE,
  CONFIG,
  PLAYER_COLORS,
  PLAYER_SHAPES,
  TRAIL_PATTERNS,
  sanitizePlayerAppearance,
  type PlayerAppearance,
  type PlayerShape,
  type TrailPattern,
} from "@hexagon/shared";
import { PlayerPreview3D } from "./PlayerPreview3D";
import { getTelegramUserName } from "@/lib/telegram";
import { ensureTelegramSession, getMe, startGoogleLogin, type BackendMe } from "@/lib/backend";
import { ShopPanel } from "./ShopPanel";
import { LobbyRewardedAdButton } from "./LobbyRewardedAdButton";
import { measureServerPing } from "./serverPing";
import { trailVectorAsset } from "./trailVectorAssets";

export type GameMode = "solo" | "online" | "campaign";
type AppearanceTab = "color" | "shape" | "trail";
type ServerPingStatus = "connecting" | "online" | "error";

const DEFAULT_URL =
  process.env.NEXT_PUBLIC_SERVER_URL ?? "ws://localhost:8910";

function accountAppearance(me: BackendMe): PlayerAppearance {
  return sanitizePlayerAppearance({
    colorIndex: Number(me.profile?.selected_color?.split(":")[1] ?? 0),
    shape: me.profile?.selected_shape?.replace("shape:", "") as PlayerShape,
    trailPattern: me.profile?.selected_trail_pattern?.replace("trail:", "") as TrailPattern,
  });
}

const SHAPE_LABEL: Record<PlayerShape, string> = {
  cube: "Cube",
  cylinder: "Cylinder",
  sphere: "Sphere",
  cone: "Cone",
  fly: "Fly",
  bee: "Bee",
  ladybug: "Ladybug",
};

const PATTERN_LABEL: Record<TrailPattern, string> = {
  solid: "Solid",
  stripes: "Stripes",
  dots: "Dots",
  chevrons: "Chevron",
};

function trailPatternStyle(pattern: TrailPattern, color: string): CSSProperties {
  const asset = trailVectorAsset(pattern);
  if (!asset) return { background: color };
  return {
    backgroundColor: color,
    WebkitMaskImage: `url("${asset}")`,
    maskImage: `url("${asset}")`,
    WebkitMaskRepeat: "repeat-x",
    maskRepeat: "repeat-x",
    WebkitMaskSize: "auto 100%",
    maskSize: "auto 100%",
  };
}

function ShapeGlyph({ shape, color, size = 42 }: { shape: PlayerShape; color: string; size?: number }) {
  const insectGlyph: Partial<Record<PlayerShape, string>> = {
    fly: "🪰",
    bee: "🐝",
    ladybug: "🐞",
  };
  if (insectGlyph[shape])
    return (
      <span
        style={{
          display: "block",
          fontSize: size * 0.9,
          lineHeight: `${size}px`,
          filter: `drop-shadow(0 6px 10px ${color}99)`,
        }}
      >
        {insectGlyph[shape]}
      </span>
    );
  const common: React.CSSProperties = {
    display: "block",
    width: size,
    height: size,
    background: `linear-gradient(145deg, #ffffff 0%, ${color} 32%, ${color} 72%, #08111f 145%)`,
    boxShadow: `0 8px 22px ${color}55, inset -5px -7px 12px rgba(0,0,0,0.25)`,
  };
  if (shape === "sphere") return <span style={{ ...common, borderRadius: "50%" }} />;
  if (shape === "cylinder")
    return <span style={{ ...common, width: size * 0.72, borderRadius: `${size / 2}px / ${size / 5}px` }} />;
  if (shape === "cone")
    return <span style={{ ...common, clipPath: "polygon(50% 0, 100% 100%, 0 100%)", borderRadius: 6 }} />;
  return <span style={{ ...common, borderRadius: 7, transform: "rotate(-8deg) skewY(3deg)" }} />;
}

/** Option riêng cho mode Luyện tập (solo), truyền thêm qua `onStart`. */
export interface PracticeOptions {
  botCount: number;
}

const MAX_PRACTICE_BOTS = 64;

export function StartPanel({
  onStart,
}: {
  onStart: (
    mode: GameMode,
    name: string,
    serverUrl: string,
    appearance: PlayerAppearance,
    practice: PracticeOptions
  ) => void | Promise<void>;
}) {
  const [name, setName] = useState("");
  const [mode, setMode] = useState<GameMode>("solo");
  const [serverUrl, setServerUrl] = useState(DEFAULT_URL);
  const [botCount, setBotCount] = useState<number>(CONFIG.BOT_COUNT);
  const [appearance, setAppearance] = useState<PlayerAppearance>(
    DEFAULT_PLAYER_APPEARANCE
  );
  const [appearanceTab, setAppearanceTab] = useState<AppearanceTab>("color");
  const [serverPing, setServerPing] = useState<number | null>(null);
  const [serverPingStatus, setServerPingStatus] =
    useState<ServerPingStatus>("connecting");
  const [account, setAccount] = useState<BackendMe | null>(null);
  const [accountReady, setAccountReady] = useState(false);
  const [starting, setStarting] = useState(false);
  const [startError, setStartError] = useState("");
  const [showShop, setShowShop] = useState(false);

  // Nhớ tên đã nhập giữa các lần chơi.
  useEffect(() => {
    const telegramName = getTelegramUserName();
    const saved = window.localStorage.getItem("hexagon.name");
    if (telegramName) setName(telegramName.slice(0, 16));
    else if (saved) setName(saved);
    const savedAppearance = window.localStorage.getItem("hexagon.appearance");
    if (savedAppearance) {
      try {
        setAppearance(sanitizePlayerAppearance(JSON.parse(savedAppearance)));
      } catch {
        // Dữ liệu cũ/hỏng → dùng mặc định an toàn.
      }
    }
  }, []);

  useEffect(() => {
    let active = true;
    void (async () => {
      let me = await getMe();
      if (!me && getTelegramUserName()) {
        try { await ensureTelegramSession(); me = await getMe(); } catch { /* vẫn cho chơi guest */ }
      }
      if (!active) return;
      setAccount(me);
      if (me?.player.displayName) {
        setName(me.player.displayName.slice(0, 16));
        setAppearance(accountAppearance(me));
      }
      setAccountReady(true);
    })();
    return () => { active = false; };
  }, []);

  // Đo RTT qua health endpoint của chính game host. Không mở WebSocket thăm dò:
  // URL nhập ở Welcome có thể là host gốc, còn gateway gameplay nằm tại `/game`.
  useEffect(() => {
    if (mode !== "online") {
      setServerPing(null);
      return;
    }

    setServerPing(null);
    setServerPingStatus("connecting");

    let pingTimer: ReturnType<typeof setInterval> | null = null;
    let disposed = false;

    const sendPing = async () => {
      try {
        const ping = await measureServerPing(serverUrl.trim() || DEFAULT_URL);
        if (disposed) return;
        setServerPing(ping);
        setServerPingStatus("online");
      } catch {
        if (disposed) return;
        setServerPing(null);
        setServerPingStatus("error");
      }
    };

    // Debounce nhẹ để không tạo socket cho từng ký tự khi sửa URL server.
    const connectTimer = setTimeout(() => {
      if (disposed) return;
      void sendPing();
      pingTimer = setInterval(() => void sendPing(), 3000);
    }, 350);

    return () => {
      disposed = true;
      clearTimeout(connectTimer);
      if (pingTimer) clearInterval(pingTimer);
    };
  }, [mode, serverUrl]);

  const start = async () => {
    if (starting) return;
    const finalName = name.trim() || "Bạn";
    window.localStorage.setItem("hexagon.name", finalName);
    const finalAppearance = sanitizePlayerAppearance(appearance);
    window.localStorage.setItem(
      "hexagon.appearance",
      JSON.stringify(finalAppearance)
    );
    setStarting(true);
    setStartError("");
    try {
      await onStart(mode, finalName, serverUrl.trim() || DEFAULT_URL, finalAppearance, {
        botCount,
      });
    }
    catch (error) { setStartError(error instanceof Error ? error.message : "Không thể vào game"); }
    finally { setStarting(false); }
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
        className="mode-card"
        onClick={() => setMode(m)}
        style={{
          flex: 1,
          minWidth: 0,
          textAlign: "left",
          padding: "10px 14px",
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
        <div style={{ fontSize: 18, marginBottom: 2 }}>
          {icon}{" "}
          <span style={{ fontSize: 15, fontWeight: 800, letterSpacing: 0.5 }}>
            {title}
          </span>
        </div>
        <div className="mode-description" style={{ fontSize: 12, opacity: 0.72, lineHeight: 1.35 }}>{desc}</div>
      </button>
    );
  };

  return (
    <main
      className="welcome-main"
      style={{
        height: "100vh",
        minHeight: 0,
        display: "flex",
        alignItems: "center",
        justifyContent: "flex-start",
        padding:
          "max(12px, env(safe-area-inset-top)) clamp(10px, 3vw, 24px) max(20px, env(safe-area-inset-bottom))",
        overflowY: "auto",
        overscrollBehavior: "contain",
        WebkitOverflowScrolling: "touch",
        background:
          "radial-gradient(1200px 600px at 50% -10%, #16203a 0%, #0a0e16 60%)",
        fontFamily: "system-ui, sans-serif",
      }}
    >
      <div
        className="welcome-card"
        style={{
          width: "100%",
          maxWidth: 820,
          flex: "0 0 auto",
          marginBlock: "auto",
          margin: "auto",
          padding: "clamp(16px, 3vw, 24px)",
          borderRadius: 20,
          background: "rgba(14,18,28,0.82)",
          border: "1px solid rgba(255,255,255,0.08)",
          boxShadow: "0 24px 80px rgba(0,0,0,0.5)",
          backdropFilter: "blur(8px)",
          color: "#e8eefc",
        }}
      >
        <div className="welcome-eyebrow" style={{ fontSize: 12, letterSpacing: 4, opacity: 0.55 }}>
          CHIẾM LÃNH THỔ LỤC GIÁC
        </div>
        <h1
          style={{
            fontSize: "clamp(32px, 7vw, 44px)",
            margin: "2px 0",
            background: "linear-gradient(90deg,#31b0ff,#ffd23f)",
            WebkitBackgroundClip: "text",
            WebkitTextFillColor: "transparent",
          }}
        >
          Hexagon World
        </h1>
        <p className="welcome-instructions" style={{ margin: "0 0 10px", opacity: 0.78, lineHeight: 1.4, fontSize: 13 }}>
          Đi ra ngoài vùng của mình để tạo đuôi, khép vòng quay về để chiếm ô.
          Chiếm {">"} {`${20}`}% bản đồ để thành Nhà Vua.
        </p>

        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 10, marginBottom: 10, padding: "8px 10px", borderRadius: 11, background: "rgba(255,255,255,.04)", fontSize: 11 }}>
          <span style={{ opacity: 0.72 }}>
            {!accountReady ? "Đang kiểm tra tài khoản…" : account ? `✓ ${account.player.displayName} · ${account.player.platform}` : "Guest · chơi được, không lưu tài sản"}
          </span>
          {accountReady && !account && !getTelegramUserName() && (
            <button type="button" onClick={startGoogleLogin} style={{ border: "1px solid rgba(255,255,255,.18)", borderRadius: 9, padding: "6px 10px", color: "#e8eefc", background: "rgba(255,255,255,.07)", cursor: "pointer", whiteSpace: "nowrap" }}>
              Đăng nhập Google
            </button>
          )}
          {account && <button type="button" onClick={() => setShowShop(true)} style={{ border: "1px solid rgba(255,210,63,.35)", borderRadius: 9, padding: "6px 10px", color: "#ffe27a", background: "rgba(255,210,63,.08)", cursor: "pointer", whiteSpace: "nowrap" }}>Shop</button>}
        </div>

        {/* Tên */}
        <label style={{ fontSize: 12, opacity: 0.7, letterSpacing: 1 }}>
          TÊN CỦA BẠN
        </label>
        <input
          value={name}
          onChange={(e) => setName(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && void start()}
          placeholder="Nhập tên…"
          maxLength={16}
          style={{
            width: "100%",
            marginTop: 6,
            marginBottom: 10,
            padding: "9px 12px",
            borderRadius: 12,
            border: "1.5px solid rgba(255,255,255,0.12)",
            background: "rgba(255,255,255,0.05)",
            color: "#e8eefc",
            fontSize: 16,
            outline: "none",
            boxSizing: "border-box",
          }}
        />

        {/* Cá nhân hoá */}
        <label style={{ fontSize: 12, opacity: 0.7, letterSpacing: 1 }}>
          NHÂN VẬT CỦA BẠN
        </label>
        <div
          className="appearance-panel"
          style={{
            marginTop: 8,
            marginBottom: 14,
            padding: 10,
            borderRadius: 16,
            border: "1px solid rgba(255,255,255,0.09)",
            background: "linear-gradient(135deg,rgba(49,176,255,0.07),rgba(255,255,255,0.025))",
            display: "grid",
            gridTemplateColumns: "minmax(150px, 180px) minmax(0, 1fr)",
            gap: 10,
          }}
        >
          <div className="appearance-preview">
            <PlayerPreview3D
              shape={appearance.shape}
              color={PLAYER_COLORS[appearance.colorIndex].glow}
              pattern={appearance.trailPattern}
            />
            <span className="preview-label">PREVIEW 3D</span>
          </div>

          <div className="appearance-controls">
            <div className="appearance-tabs" role="tablist" aria-label="Tùy chỉnh nhân vật">
              {([
                ["color", "Màu nhân vật"],
                ["shape", "3D Object"],
                ["trail", "Đuôi"],
              ] as const).map(([tab, label]) => (
                <button
                  key={tab}
                  type="button"
                  role="tab"
                  aria-selected={appearanceTab === tab}
                  onClick={() => setAppearanceTab(tab)}
                  className={`appearance-tab${appearanceTab === tab ? " active" : ""}`}
                >
                  {label}
                </button>
              ))}
            </div>

            <div className="tab-content" role="tabpanel">
              {appearanceTab === "color" && (
                <div className="color-grid">
                {PLAYER_COLORS.map((palette, index) => (
                  <button
                    key={`body-${index}`}
                    type="button"
                    aria-label={`Màu nhân vật ${palette.name.replace("Bot ", "")}`}
                    aria-pressed={appearance.colorIndex === index}
                    title={palette.name.replace("Bot ", "")}
                    onClick={() => setAppearance((a) => ({ ...a, colorIndex: index }))}
                    style={{
                      width: 34,
                      height: 34,
                      borderRadius: "50%",
                      cursor: "pointer",
                      background: palette.glow,
                      border: appearance.colorIndex === index ? "3px solid white" : "2px solid rgba(255,255,255,0.18)",
                      boxShadow: appearance.colorIndex === index ? `0 0 0 3px ${palette.glow}66, 0 0 15px ${palette.glow}` : "none",
                    }}
                  />
                ))}
                </div>
              )}

              {appearanceTab === "shape" && (
                <div className="shape-grid">
                {PLAYER_SHAPES.map((shape) => {
                  const active = appearance.shape === shape;
                  return (
                    <button
                      key={shape}
                      type="button"
                      aria-pressed={active}
                      onClick={() => setAppearance((a) => ({ ...a, shape }))}
                      style={{
                        minHeight: 56,
                        minWidth: 0,
                        padding: "5px 2px",
                        borderRadius: 10,
                        border: active ? "1.5px solid #31b0ff" : "1px solid rgba(255,255,255,0.1)",
                        background: active ? "rgba(49,176,255,0.15)" : "rgba(255,255,255,0.035)",
                        color: "#e8eefc",
                        cursor: "pointer",
                        display: "flex",
                        flexDirection: "column",
                        alignItems: "center",
                        justifyContent: "center",
                        gap: 3,
                        fontSize: 9,
                      }}
                    >
                      <ShapeGlyph shape={shape} color={PLAYER_COLORS[appearance.colorIndex].glow} size={21} />
                      {SHAPE_LABEL[shape]}
                    </button>
                  );
                })}
                </div>
              )}

              {appearanceTab === "trail" && (
                <div className="pattern-grid">
                {TRAIL_PATTERNS.map((pattern) => (
                  <button
                    key={pattern}
                    type="button"
                    aria-label={`Pattern vệt đuôi ${PATTERN_LABEL[pattern]}`}
                    aria-pressed={appearance.trailPattern === pattern}
                    onClick={() => setAppearance((a) => ({ ...a, trailPattern: pattern }))}
                    style={{
                      minHeight: 34,
                      padding: "4px",
                      borderRadius: 9,
                      cursor: "pointer",
                      color: "#e8eefc",
                      fontSize: 9,
                      background: appearance.trailPattern === pattern ? "rgba(49,176,255,0.15)" : "rgba(255,255,255,0.035)",
                      border: appearance.trailPattern === pattern ? "1.5px solid #31b0ff" : "1px solid rgba(255,255,255,0.1)",
                    }}
                  >
                    <span
                      style={{
                        display: "block",
                        height: 9,
                        borderRadius: 99,
                        marginBottom: 3,
                        ...trailPatternStyle(pattern, PLAYER_COLORS[appearance.colorIndex].glow),
                      }}
                    />
                    {PATTERN_LABEL[pattern]}
                  </button>
                ))}
                <div className="trail-color-note">Màu đuôi tự động đồng bộ với nhân vật</div>
                </div>
              )}
            </div>
          </div>
        </div>

        {/* Chọn chế độ */}
        <label style={{ fontSize: 12, opacity: 0.7, letterSpacing: 1 }}>
          CHẾ ĐỘ CHƠI
        </label>
        <div className="mode-grid" style={{ display: "grid", gridTemplateColumns: "repeat(3,minmax(0,1fr))", gap: 10, marginTop: 8 }}>
          {card(
            "solo",
            "Luyện tập",
            "Không giới hạn thời gian, hồi sinh tự do, tự chỉnh số bot — chơi thoải mái không thắng/thua.",
            "🏋️"
          )}
          {card(
            "campaign",
            "Cấp độ",
            "Chơi từng cấp có mục tiêu, chọn vật phẩm tăng cường, tốn 1 năng lượng mỗi lượt.",
            "🗺️"
          )}
          {card(
            "online",
            "Nhiều người",
            "Tìm phòng, đấu thời gian thực với người thật (tối thiểu 2 người, không bot).",
            "🌐"
          )}
        </div>

        {/* Chỉnh số bot (chỉ khi Luyện tập) */}
        {mode === "solo" && (
          <div
            style={{
              marginTop: 10,
              padding: "10px 12px",
              borderRadius: 12,
              border: "1px solid rgba(255,255,255,0.09)",
              background: "rgba(255,255,255,0.03)",
            }}
          >
            <div
              style={{
                display: "flex",
                alignItems: "center",
                justifyContent: "space-between",
                marginBottom: 6,
              }}
            >
              <label style={{ fontSize: 11, opacity: 0.7, letterSpacing: 1 }}>
                SỐ BOT
              </label>
              <span style={{ fontSize: 13, fontWeight: 800, color: "#31b0ff" }}>
                {botCount}
              </span>
            </div>
            <input
              type="range"
              min={0}
              max={MAX_PRACTICE_BOTS}
              step={1}
              value={botCount}
              onChange={(e) => setBotCount(Number(e.target.value))}
              style={{ width: "100%", accentColor: "#31b0ff" }}
              aria-label="Số lượng bot"
            />
            <div style={{ fontSize: 10, opacity: 0.5, marginTop: 4 }}>
              0 = chỉ mình bạn · tối đa {MAX_PRACTICE_BOTS} bot
            </div>
          </div>
        )}

        {/* Địa chỉ server (chỉ khi online) */}
        {/* Bắt đầu */}
        <button
          onClick={() => void start()}
          disabled={starting}
          style={{
            width: "100%",
            marginTop: 12,
            marginBottom: mode === "online" ? 0 : 40,
            padding: "12px 24px",
            borderRadius: 999,
            border: "none",
            cursor: starting ? "wait" : "pointer",
            opacity: starting ? 0.7 : 1,
            fontSize: 17,
            fontWeight: 800,
            letterSpacing: 1,
            color: "white",
            background: "linear-gradient(90deg,#31b0ff,#2b8be0)",
            boxShadow: "0 10px 32px rgba(49,176,255,0.42)",
          }}
        >
          {starting ? "Đang kết nối…" : mode === "online" ? "🔍 Tìm phòng chơi" : mode === "campaign" ? "🗺️ Vào Cấp độ" : "▶ Bắt đầu chơi"}
        </button>
        {startError && <div role="alert" style={{ color: "#ff8b9a", fontSize: 11, marginTop: 7, textAlign: "center" }}>{startError}</div>}
        <LobbyRewardedAdButton />

        {/* Địa chỉ server nằm sau hành động tìm phòng để giao diện chính gọn hơn. */}
        {mode === "online" && (
          <div className="server-settings">
            <div className="server-heading">
              <label style={{ fontSize: 11, opacity: 0.65, letterSpacing: 1 }}>
                ĐỊA CHỈ SERVER
              </label>
              <span
                className={`server-ping ${serverPingStatus}`}
                role="status"
                aria-live="polite"
              >
                <i aria-hidden="true" />
                {serverPingStatus === "connecting"
                  ? "Đang đo ping…"
                  : serverPingStatus === "online"
                    ? `${serverPing} ms`
                    : "Không kết nối"}
              </span>
            </div>
            <input
              value={serverUrl}
              onChange={(e) => setServerUrl(e.target.value)}
              placeholder="ws://localhost:8910"
              style={{
                width: "100%",
                marginTop: 5,
                padding: "9px 12px",
                borderRadius: 10,
                border: "1.5px solid rgba(255,255,255,0.12)",
                background: "rgba(255,255,255,0.05)",
                color: "#e8eefc",
                fontSize: 13,
                outline: "none",
                boxSizing: "border-box",
              }}
            />
            <div style={{ fontSize: 10, opacity: 0.48, marginTop: 5 }}>
              Server dev: <code>pnpm --filter @hexagon/server start:dev</code>
            </div>
          </div>
        )}
        <style jsx>{`
          @supports (height: 100dvh) {
            .welcome-main {
              height: 100dvh !important;
            }
          }

          .appearance-preview {
            height: 168px;
            border-radius: 14px;
            position: relative;
            overflow: hidden;
            background: radial-gradient(
              circle at 50% 42%,
              rgba(255, 255, 255, 0.12),
              rgba(5, 9, 16, 0.82) 68%
            );
          }
          .appearance-preview :global(.player-preview-canvas) {
            width: 100%;
            height: 100%;
          }
          .preview-label {
            position: absolute;
            left: 10px;
            bottom: 8px;
            pointer-events: none;
            font-size: 9px;
            letter-spacing: 1.5px;
            opacity: 0.48;
          }
          .appearance-controls {
            display: flex;
            min-width: 0;
            flex-direction: column;
            gap: 8px;
          }
          .appearance-tabs {
            display: grid;
            grid-template-columns: repeat(3, minmax(0, 1fr));
            gap: 5px;
            padding: 4px;
            border-radius: 11px;
            background: rgba(0, 0, 0, 0.2);
          }
          .appearance-tab {
            min-width: 0;
            padding: 8px 5px;
            border: 1px solid transparent;
            border-radius: 8px;
            color: rgba(232, 238, 252, 0.66);
            background: transparent;
            font-size: 10px;
            font-weight: 750;
            cursor: pointer;
            white-space: nowrap;
          }
          .appearance-tab.active {
            color: white;
            border-color: rgba(49, 176, 255, 0.55);
            background: rgba(49, 176, 255, 0.17);
            box-shadow: 0 4px 14px rgba(49, 176, 255, 0.14);
          }
          .tab-content {
            min-height: 112px;
            display: flex;
            align-items: center;
          }
          .color-grid {
            display: flex;
            gap: 11px;
            flex-wrap: wrap;
            padding: 8px 5px;
          }
          .shape-grid {
            width: 100%;
            display: grid;
            grid-template-columns: repeat(4, minmax(0, 1fr));
            gap: 6px;
          }
          .pattern-grid {
            width: 100%;
            display: grid;
            grid-template-columns: repeat(4, minmax(0, 1fr));
            gap: 6px;
          }
          .trail-color-note {
            grid-column: 1 / -1;
            margin-top: 3px;
            font-size: 9px;
            text-align: center;
            opacity: 0.48;
          }
          .server-settings {
            margin-top: 12px;
            margin-bottom: 40px;
            padding: 10px 12px;
            border: 1px solid rgba(255, 255, 255, 0.07);
            border-radius: 12px;
            background: rgba(255, 255, 255, 0.025);
          }
          .server-heading {
            display: flex;
            align-items: center;
            justify-content: space-between;
            gap: 12px;
          }
          .server-ping {
            display: inline-flex;
            align-items: center;
            gap: 5px;
            min-width: 0;
            font-size: 10px;
            font-weight: 700;
            white-space: nowrap;
            color: rgba(232, 238, 252, 0.72);
          }
          .server-ping i {
            width: 7px;
            height: 7px;
            flex: 0 0 auto;
            border-radius: 50%;
            background: #ffd23f;
            box-shadow: 0 0 8px #ffd23f88;
          }
          .server-ping.online {
            color: #7ee7a8;
          }
          .server-ping.online i {
            background: #48d987;
            box-shadow: 0 0 8px #48d98799;
          }
          .server-ping.error {
            color: #ff8d99;
          }
          .server-ping.error i {
            background: #ff5d6c;
            box-shadow: 0 0 8px #ff5d6c88;
          }

          @media (max-width: 620px) {
            .welcome-main {
              padding-bottom: max(
                96px,
                calc(env(safe-area-inset-bottom) + 72px)
              ) !important;
            }
            .appearance-panel {
              grid-template-columns: 1fr !important;
            }
            .appearance-preview {
              height: 132px !important;
            }
            .welcome-eyebrow,
            .welcome-instructions {
              display: none;
            }
            .mode-grid {
              grid-template-columns: repeat(3, minmax(0, 1fr)) !important;
              gap: 7px !important;
            }
            :global(.mode-card) {
              padding: 9px 8px !important;
              text-align: center !important;
            }
            :global(.mode-description) {
              display: none;
            }
            .appearance-tab {
              font-size: 9px;
              padding-inline: 3px;
            }
            .tab-content {
              min-height: 66px;
            }
            .server-settings {
              margin-bottom: 52px;
            }
          }

          @media (max-width: 360px) {
            .welcome-card {
              padding: 14px !important;
            }
            .shape-grid {
              grid-template-columns: repeat(4, minmax(0, 1fr)) !important;
            }
            .pattern-grid {
              grid-template-columns: repeat(2, minmax(0, 1fr)) !important;
            }
          }
        `}</style>
        {showShop && account && <ShopPanel account={account} onClose={() => setShowShop(false)} onChanged={async () => { const next = await getMe(); if (next) { setAccount(next); setAppearance(accountAppearance(next)); } }} />}
      </div>
    </main>
  );
}
