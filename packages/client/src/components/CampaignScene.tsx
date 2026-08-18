"use client";

// Campaign (Cấp độ) — sảnh chọn cấp + power-up + thanh năng lượng, rồi chơi bằng GameScene với
// config của cấp (doc 28 §E5/§E6). Sim chạy client; cổng năng lượng + mở khóa server-authoritative.

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import dynamic from "next/dynamic";
import {
  CAMPAIGN_LEVELS,
  applyPowerups,
  isUnlocked,
  computeEnergy,
  type CampaignLevel,
  type PowerupKind,
  type MatchConfigInput,
  type PlayerAppearance,
} from "@hexagon/shared";
import {
  getEnergy,
  getCampaignProgress,
  startCampaignLevel,
  completeCampaignLevel,
  type EnergyStatus,
  type LevelProgress,
} from "@/lib/backend";

const GameScene = dynamic(() => import("@/components/GameScene"), { ssr: false });

const POWERUP_LABEL: Record<PowerupKind, string> = {
  speed: "⚡ Tăng tốc",
  head_start: "🟩 Khởi đầu rộng",
  extra_life: "❤ Thêm mạng",
};

function objectiveSummary(cfg: MatchConfigInput): string {
  const w = cfg.win;
  if (!w) return "";
  switch (w.kind) {
    case "territory_pct": return `Chiếm ${Math.round((w.targetPct ?? 0.2) * 100)}% lãnh thổ`;
    case "survive": return `Sống sót ${w.durationSec ?? 60}s`;
    case "capture_totems": return `Thu ${w.totemGoal ?? 0} totem`;
    default: return "";
  }
}

const fmt = (secs: number) => {
  const s = Math.max(0, Math.ceil(secs));
  return `${Math.floor(s / 60)}:${(s % 60).toString().padStart(2, "0")}`;
};

/** Đếm ngược tới điểm năng lượng kế (client tự tính bằng computeEnergy, không spam server). */
function EnergyBar({ energy }: { energy: EnergyStatus }) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const t = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(t);
  }, []);
  // Suy ra last_refill từ next_at (nếu có): next_at - interval.
  const intervalMs = energy.regen_interval_seconds * 1000;
  const view = energy.next_at
    ? computeEnergy(energy.current, Date.parse(energy.next_at) - intervalMs, now, {
        energyMax: energy.max,
        regenIntervalSeconds: energy.regen_interval_seconds,
      })
    : { current: energy.current, max: energy.max, nextAtMs: null, regenIntervalSeconds: energy.regen_interval_seconds };
  const countdown = view.nextAtMs ? (view.nextAtMs - now) / 1000 : 0;
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 10, fontFamily: "system-ui, sans-serif", color: "#e8eefc" }}>
      <span style={{ fontSize: 20, fontWeight: 800 }}>⚡ {view.current}/{view.max}</span>
      {view.nextAtMs && (
        <span style={{ fontSize: 12, opacity: 0.7 }}>Hồi sau {fmt(countdown)}</span>
      )}
    </div>
  );
}

interface Props {
  playerName?: string;
  appearance?: PlayerAppearance;
  onExit?: () => void;
  showMenu?: boolean;
}

export default function CampaignScene({ playerName, appearance, onExit, showMenu = true }: Props) {
  const [energy, setEnergy] = useState<EnergyStatus | null>(null);
  const [progress, setProgress] = useState<LevelProgress[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [picks, setPicks] = useState<PowerupKind[]>([]);
  const [selected, setSelected] = useState<CampaignLevel | null>(null);
  const [playing, setPlaying] = useState<{ level: CampaignLevel; config: MatchConfigInput; playId: string } | null>(null);
  const submitting = useRef(false);

  const cleared = useMemo(() => new Set(progress.filter((p) => p.status === "cleared").map((p) => p.level_id)), [progress]);
  const starsOf = useCallback((id: string) => progress.find((p) => p.level_id === id)?.stars ?? 0, [progress]);

  const refresh = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [e, p] = await Promise.all([getEnergy(), getCampaignProgress()]);
      setEnergy(e);
      setProgress(p);
    } catch {
      setError("Cần đăng nhập để chơi Cấp độ (năng lượng + tiến độ lưu trên máy chủ).");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { void refresh(); }, [refresh]);

  const start = useCallback(async (level: CampaignLevel) => {
    try {
      const res = await startCampaignLevel(level.id);
      setEnergy(res.energy);
      setPlaying({ level, config: applyPowerups(level.config, picks), playId: res.playId });
      setSelected(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Không bắt đầu được cấp");
    }
  }, [picks]);

  const onOutcome = useCallback(async (won: boolean, playId: string) => {
    if (!won || submitting.current) return;
    submitting.current = true;
    try {
      await completeCampaignLevel(playId, true, 1, 0);
      await refresh();
    } catch { /* giữ nguyên; người chơi vẫn thấy màn thắng */ }
    finally { submitting.current = false; }
  }, [refresh]);

  // Đang chơi: mount GameScene với config của cấp.
  if (playing) {
    return (
      <GameScene
        playerName={playerName}
        appearance={appearance}
        config={playing.config}
        endMode="campaign"
        onOutcome={(won) => void onOutcome(won, playing.playId)}
        onExit={() => { setPlaying(null); void refresh(); }}
        showMenu={showMenu}
      />
    );
  }

  return (
    <div style={{ position: "fixed", inset: 0, overflow: "auto", background: "#0a0e16", color: "#e8eefc", fontFamily: "system-ui, sans-serif" }}>
      <div style={{ maxWidth: 760, margin: "0 auto", padding: "24px 16px 48px" }}>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12, flexWrap: "wrap" }}>
          <h1 style={{ fontSize: 24, fontWeight: 900, margin: 0 }}>🗺️ Cấp độ</h1>
          {energy && <EnergyBar energy={energy} />}
        </div>

        {loading && <p style={{ opacity: 0.7, marginTop: 24 }}>Đang tải…</p>}
        {error && (
          <div style={{ marginTop: 24, padding: "14px 16px", borderRadius: 12, background: "rgba(255,90,90,0.12)", border: "1px solid rgba(255,120,120,0.3)", color: "#ffb3b3" }}>
            {error}
          </div>
        )}

        {!loading && !error && (
          <div style={{ marginTop: 20, display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(220px, 1fr))", gap: 12 }}>
            {CAMPAIGN_LEVELS.map((level) => {
              const unlocked = isUnlocked(level.id, cleared);
              const done = cleared.has(level.id);
              const stars = starsOf(level.id);
              const noEnergy = (energy?.current ?? 0) < 1;
              return (
                <button
                  key={level.id}
                  disabled={!unlocked}
                  onClick={() => setSelected(level)}
                  style={{
                    textAlign: "left",
                    padding: "14px 16px",
                    borderRadius: 14,
                    border: unlocked ? "1px solid rgba(120,140,180,0.35)" : "1px solid rgba(120,140,180,0.15)",
                    background: unlocked ? "rgba(20,26,40,0.9)" : "rgba(16,20,30,0.6)",
                    color: unlocked ? "#e8eefc" : "#7a869c",
                    cursor: unlocked ? "pointer" : "not-allowed",
                    opacity: unlocked ? 1 : 0.6,
                  }}
                >
                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                    <span style={{ fontSize: 15, fontWeight: 800 }}>
                      {unlocked ? "" : "🔒 "}{level.order}. {level.name}
                    </span>
                    {done && <span style={{ fontSize: 12 }}>{"⭐".repeat(Math.max(1, stars))}</span>}
                  </div>
                  <div style={{ fontSize: 12, opacity: 0.75, marginTop: 6 }}>🎯 {objectiveSummary(level.config)}</div>
                  <div style={{ fontSize: 11, opacity: 0.55, marginTop: 8 }}>
                    ⚡1 · Thưởng {level.rewards.coin}🪙{level.rewards.energy > 0 ? ` +${level.rewards.energy}⚡` : ""}
                    {unlocked && noEnergy ? " · hết năng lượng" : ""}
                  </div>
                </button>
              );
            })}
          </div>
        )}

        {showMenu && onExit && (
          <button onClick={onExit} style={{ marginTop: 28, padding: "10px 20px", borderRadius: 999, border: "1px solid rgba(255,255,255,0.2)", background: "rgba(255,255,255,0.06)", color: "#cdd7ea", fontWeight: 700, cursor: "pointer" }}>
            ← Menu
          </button>
        )}
      </div>

      {/* Panel chọn power-up trước trận */}
      {selected && (
        <div onClick={() => setSelected(null)} style={{ position: "fixed", inset: 0, display: "flex", alignItems: "center", justifyContent: "center", background: "rgba(4,6,12,0.6)", backdropFilter: "blur(3px)" }}>
          <div onClick={(e) => e.stopPropagation()} style={{ minWidth: 300, maxWidth: 420, padding: "24px 26px", borderRadius: 16, background: "rgba(16,20,30,0.98)", border: "1px solid rgba(255,255,255,0.14)" }}>
            <div style={{ fontSize: 20, fontWeight: 900 }}>{selected.order}. {selected.name}</div>
            <div style={{ fontSize: 13, opacity: 0.75, marginTop: 6 }}>🎯 {objectiveSummary(selected.config)} · ❤ {selected.config.rules?.maxLives ?? 3} mạng</div>
            <div style={{ fontSize: 12, opacity: 0.6, marginTop: 16, marginBottom: 8, letterSpacing: 0.6 }}>VẬT PHẨM TĂNG CƯỜNG</div>
            <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
              {selected.powerups.length === 0 && <span style={{ fontSize: 13, opacity: 0.6 }}>Không có</span>}
              {selected.powerups.map((pk) => {
                const on = picks.includes(pk);
                return (
                  <button
                    key={pk}
                    onClick={() => setPicks((prev) => (prev.includes(pk) ? prev.filter((x) => x !== pk) : [...prev, pk]))}
                    style={{
                      padding: "8px 14px", borderRadius: 999, cursor: "pointer", fontSize: 13, fontWeight: 700,
                      border: on ? "1px solid #5ce1ff" : "1px solid rgba(120,140,180,0.4)",
                      background: on ? "rgba(49,176,255,0.22)" : "rgba(30,40,60,0.8)",
                      color: on ? "#bdecff" : "#cdd7ea",
                    }}
                  >
                    {on ? "✓ " : ""}{POWERUP_LABEL[pk]}
                  </button>
                );
              })}
            </div>
            <div style={{ display: "flex", gap: 10, marginTop: 24 }}>
              <button
                onClick={() => void start(selected)}
                disabled={(energy?.current ?? 0) < 1}
                style={{
                  flex: 1, padding: "12px 20px", borderRadius: 999, border: "none",
                  cursor: (energy?.current ?? 0) < 1 ? "not-allowed" : "pointer", fontSize: 15, fontWeight: 800, letterSpacing: 0.5,
                  color: "#04121f", background: (energy?.current ?? 0) < 1 ? "rgba(255,255,255,0.2)" : "linear-gradient(90deg,#31b0ff,#5ce1ff)",
                  opacity: (energy?.current ?? 0) < 1 ? 0.6 : 1,
                }}
              >
                {(energy?.current ?? 0) < 1 ? "Hết năng lượng" : "▶ Bắt đầu (−1 ⚡)"}
              </button>
              <button onClick={() => setSelected(null)} style={{ padding: "12px 18px", borderRadius: 999, border: "1px solid rgba(255,255,255,0.25)", background: "rgba(255,255,255,0.08)", color: "#e8eefc", fontWeight: 700, cursor: "pointer" }}>
                Hủy
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
