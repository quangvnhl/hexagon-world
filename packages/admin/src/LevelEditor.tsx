// Trình vẽ hex cho admin (doc 30 L6b — bản app admin riêng): tô ô chướng ngại +
// form objective/thưởng/unlock → publish. Gate bằng admin key (nhập tay, gửi header
// x-admin-key). Tái dùng toán hex + validateLevelDraft từ @hexagon/shared.
//
// KHÁC bản trong client cũ: KHÔNG kéo R3F/GameScene. "Xem thử" là PREVIEW 2D —
// dựng lại lưới hex + tóm tắt config/objective (không sim sống). Muốn thử-chơi thật
// thì Publish (nháp) rồi mở /campaign trong game client.

import { useCallback, useEffect, useMemo, useState } from "react";
import {
  axialToPixel,
  key as hexKey,
  validateLevelDraft,
  type PowerupKind,
  type WinConditionKind,
  type MatchConfigInput,
  type CampaignLevelDraft,
} from "@hexagon/shared";
import { adminListLevels, adminUpsertLevel, adminPublishLevel, type AdminLevelRow } from "./api";

const EDIT_SIZE = 20; // px mỗi hex trong trình vẽ
const R_EDIT = 6; // bán kính cửa sổ sửa (cube distance) — vùng đặt obstacle quanh tâm
const POWERUPS: PowerupKind[] = ["speed", "head_start", "extra_life"];
const POWERUP_LABEL: Record<PowerupKind, string> = { speed: "⚡ Tốc", head_start: "🟩 Khởi đầu rộng", extra_life: "❤ Thêm mạng" };
const WIN_KINDS: { kind: WinConditionKind; label: string }[] = [
  { kind: "territory_pct", label: "Chiếm % lãnh thổ" },
  { kind: "survive", label: "Sống sót (giây)" },
  { kind: "capture_totems", label: "Thu totem" },
  { kind: "none", label: "Không thắng/thua" },
];

/** Ô trong cửa sổ sửa: mọi (q,r) có cube-distance ≤ R_EDIT. */
const EDIT_CELLS = (() => {
  const cells: { q: number; r: number; cx: number; cy: number }[] = [];
  for (let q = -R_EDIT; q <= R_EDIT; q++) {
    for (let r = -R_EDIT; r <= R_EDIT; r++) {
      if (Math.abs(q + r) > R_EDIT) continue;
      const p = axialToPixel({ q, r }, EDIT_SIZE);
      cells.push({ q, r, cx: p.x, cy: p.y });
    }
  }
  return cells;
})();

function hexPoints(cx: number, cy: number, size: number): string {
  const pts: string[] = [];
  for (let i = 0; i < 6; i++) {
    const a = (Math.PI / 180) * (60 * i - 30);
    pts.push(`${(cx + size * Math.cos(a)).toFixed(1)},${(cy + size * Math.sin(a)).toFixed(1)}`);
  }
  return pts.join(" ");
}

interface FormState {
  id: string; sortOrder: number; name: string; botCount: number; maxLives: number;
  kind: WinConditionKind; targetPct: number; durationSec: number; totemGoal: number;
  powerups: PowerupKind[]; unlockRequires: string; coin: number; xp: number; energy: number; published: boolean;
}

const BLANK: FormState = {
  id: "", sortOrder: 1, name: "", botCount: 8, maxLives: 3,
  kind: "territory_pct", targetPct: 0.3, durationSec: 60, totemGoal: 3,
  powerups: [], unlockRequires: "", coin: 50, xp: 40, energy: 0, published: false,
};

function buildConfig(f: FormState, obstacles: Set<string>): MatchConfigInput {
  const win =
    f.kind === "territory_pct" ? { kind: f.kind, targetPct: f.targetPct }
    : f.kind === "survive" ? { kind: f.kind, durationSec: f.durationSec }
    : f.kind === "capture_totems" ? { kind: f.kind, totemGoal: f.totemGoal }
    : { kind: "none" as const };
  const rules: MatchConfigInput["rules"] = { maxLives: f.maxLives };
  if (f.kind === "capture_totems") rules.totemsEnabled = true;
  const config: MatchConfigInput = { bots: { count: f.botCount }, rules, win };
  if (obstacles.size > 0) config.map = { obstacles: [...obstacles] };
  return config;
}

function toDraft(f: FormState, obstacles: Set<string>): CampaignLevelDraft {
  return {
    id: f.id.trim(), sortOrder: f.sortOrder, name: f.name.trim(),
    config: buildConfig(f, obstacles), powerups: f.powerups,
    unlockRequires: f.unlockRequires.trim() || null,
    rewards: { coin: f.coin, xp: f.xp, energy: f.energy }, published: f.published,
  };
}

/** Nhãn mục tiêu ngắn gọn để hiển thị ở preview. */
function objectiveLabel(f: FormState): string {
  switch (f.kind) {
    case "territory_pct": return `Chiếm ${Math.round(f.targetPct * 100)}% lãnh thổ`;
    case "survive": return `Sống sót ${f.durationSec}s`;
    case "capture_totems": return `Thu ${f.totemGoal} totem`;
    default: return "Không thắng/thua (chơi tự do)";
  }
}

/** Nạp form từ một hàng cấp DB (khi bấm Sửa). */
function rowToForm(r: AdminLevelRow): { form: FormState; obstacles: Set<string> } {
  const cfg = (r.config ?? {}) as MatchConfigInput;
  const win = cfg.win ?? { kind: "territory_pct" };
  return {
    form: {
      id: r.id, sortOrder: r.sort_order, name: r.name,
      botCount: cfg.bots?.count ?? 8, maxLives: cfg.rules?.maxLives ?? 3,
      kind: (win.kind ?? "territory_pct") as WinConditionKind,
      targetPct: win.targetPct ?? 0.3, durationSec: win.durationSec ?? 60, totemGoal: win.totemGoal ?? 3,
      powerups: (r.powerups ?? []) as PowerupKind[], unlockRequires: r.unlock_requires ?? "",
      coin: r.rewards?.coin ?? 0, xp: r.rewards?.xp ?? 0, energy: r.rewards?.energy ?? 0, published: r.published,
    },
    obstacles: new Set(cfg.map?.obstacles ?? []),
  };
}

const inputStyle: React.CSSProperties = {
  width: "100%", padding: "7px 10px", borderRadius: 8, border: "1px solid rgba(255,255,255,0.14)",
  background: "rgba(255,255,255,0.05)", color: "#e8eefc", fontSize: 14, boxSizing: "border-box",
};
const labelStyle: React.CSSProperties = { fontSize: 11, opacity: 0.65, letterSpacing: 0.5, display: "block", marginBottom: 3, marginTop: 10 };

/** Lưới hex — dùng cho cột sửa (bấm để bật/tắt) và cho preview 2D (đọc-thôi). */
function HexGrid({ obstacles, onToggle }: { obstacles: Set<string>; onToggle?: (q: number, r: number) => void }) {
  const bounds = useMemo(() => {
    const xs = EDIT_CELLS.map((c) => c.cx), ys = EDIT_CELLS.map((c) => c.cy);
    const pad = EDIT_SIZE + 2;
    return { minX: Math.min(...xs) - pad, minY: Math.min(...ys) - pad, w: Math.max(...xs) - Math.min(...xs) + pad * 2, h: Math.max(...ys) - Math.min(...ys) + pad * 2 };
  }, []);
  return (
    <svg viewBox={`${bounds.minX} ${bounds.minY} ${bounds.w} ${bounds.h}`} style={{ width: "100%", background: "rgba(255,255,255,0.03)", borderRadius: 12, border: "1px solid rgba(255,255,255,0.08)" }}>
      {EDIT_CELLS.map((c) => {
        const on = obstacles.has(hexKey(c.q, c.r));
        const center = c.q === 0 && c.r === 0;
        return <polygon key={`${c.q},${c.r}`} points={hexPoints(c.cx, c.cy, EDIT_SIZE - 1)}
          onClick={onToggle ? () => onToggle(c.q, c.r) : undefined}
          style={{ cursor: onToggle ? "pointer" : "default", fill: on ? "#ff6a5a" : center ? "rgba(120,220,150,0.25)" : "rgba(120,140,180,0.12)", stroke: "rgba(255,255,255,0.15)", strokeWidth: 0.5 }} />;
      })}
    </svg>
  );
}

/** Preview 2D (doc 30 L6b) — không sim sống; dựng lại bố cục + tóm tắt config. */
function Preview2D({ form, obstacles, onClose }: { form: FormState; obstacles: Set<string>; onClose: () => void }) {
  const chips: { label: string; value: string }[] = [
    { label: "Mục tiêu", value: objectiveLabel(form) },
    { label: "Số bot", value: String(form.botCount) },
    { label: "Số mạng", value: form.maxLives > 0 ? String(form.maxLives) : "Vô hạn" },
    { label: "Mở khóa sau", value: form.unlockRequires.trim() || "— (mở sẵn)" },
    { label: "Ô chướng ngại", value: String(obstacles.size) },
    { label: "Power-up", value: form.powerups.length ? form.powerups.map((p) => POWERUP_LABEL[p]).join(", ") : "—" },
    { label: "Thưởng", value: `${form.coin} coin · ${form.xp} xp · ${form.energy} energy` },
  ];
  return (
    <div style={{ position: "fixed", inset: 0, overflow: "auto", background: "#0a0e16", color: "#e8eefc", fontFamily: "system-ui, sans-serif", zIndex: 10 }}>
      <div style={{ maxWidth: 820, margin: "0 auto", padding: "20px 16px 60px" }}>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12 }}>
          <h1 style={{ fontSize: 20, fontWeight: 900, margin: 0 }}>👁️ Xem thử (2D): {form.name || form.id || "(chưa đặt tên)"}</h1>
          <button onClick={onClose} style={btn("rgba(255,255,255,0.12)")}>← Về trình vẽ</button>
        </div>
        <p style={{ fontSize: 12, opacity: 0.55, marginTop: 6 }}>
          Preview tĩnh — dựng lại bố cục obstacle + tóm tắt luật. Không mô phỏng trận. Muốn thử-chơi thật: Publish (nháp) rồi mở <code>/campaign</code>.
        </p>
        <div style={{ display: "grid", gridTemplateColumns: "minmax(0,1.1fr) minmax(0,1fr)", gap: 20, marginTop: 12 }}>
          <HexGrid obstacles={obstacles} />
          <div>
            {chips.map((c) => (
              <div key={c.label} style={{ padding: "8px 0", borderBottom: "1px solid rgba(255,255,255,0.07)" }}>
                <div style={{ fontSize: 10, opacity: 0.55, letterSpacing: 0.5 }}>{c.label.toUpperCase()}</div>
                <div style={{ fontSize: 15, fontWeight: 600 }}>{c.value}</div>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}

export default function LevelEditor() {
  const [adminKey, setAdminKey] = useState("");
  const [rows, setRows] = useState<AdminLevelRow[]>([]);
  const [form, setForm] = useState<FormState>(BLANK);
  const [obstacles, setObstacles] = useState<Set<string>>(new Set());
  const [status, setStatus] = useState<string>("");
  const [previewing, setPreviewing] = useState(false);

  useEffect(() => { setAdminKey(window.localStorage.getItem("hexagon.adminKey") ?? ""); }, []);

  const set = useCallback(<K extends keyof FormState>(k: K, v: FormState[K]) => setForm((f) => ({ ...f, [k]: v })), []);

  const load = useCallback(async () => {
    window.localStorage.setItem("hexagon.adminKey", adminKey);
    setStatus("Đang tải…");
    try { const list = await adminListLevels(adminKey); setRows(list); setStatus(`Đã tải ${list.length} cấp`); }
    catch (e) { setStatus(e instanceof Error ? e.message : "Tải thất bại (sai admin key?)"); }
  }, [adminKey]);

  const toggleCell = useCallback((q: number, r: number) => {
    const k = hexKey(q, r);
    setObstacles((prev) => { const next = new Set(prev); if (next.has(k)) next.delete(k); else next.add(k); return next; });
  }, []);

  const errors = useMemo(() => validateLevelDraft(toDraft(form, obstacles)), [form, obstacles]);

  const publish = useCallback(async () => {
    if (errors.length) { setStatus("Còn lỗi: " + errors.join("; ")); return; }
    setStatus("Đang lưu…");
    try {
      const draft = toDraft(form, obstacles);
      await adminUpsertLevel(adminKey, draft);
      await adminPublishLevel(adminKey, draft.id, form.published);
      setStatus(`Đã lưu cấp "${draft.id}"${form.published ? " (đã publish)" : " (nháp)"}`);
      setRows(await adminListLevels(adminKey));
    } catch (e) { setStatus(e instanceof Error ? e.message : "Lưu thất bại"); }
  }, [errors, form, obstacles, adminKey]);

  const editRow = useCallback((r: AdminLevelRow) => { const { form: f, obstacles: o } = rowToForm(r); setForm(f); setObstacles(o); setStatus(`Đang sửa "${r.id}"`); }, []);
  const newLevel = useCallback(() => { setForm({ ...BLANK, sortOrder: rows.length + 1 }); setObstacles(new Set()); setStatus("Cấp mới"); }, [rows.length]);

  if (previewing) {
    return <Preview2D form={form} obstacles={obstacles} onClose={() => setPreviewing(false)} />;
  }

  return (
    <div style={{ position: "fixed", inset: 0, overflow: "auto", background: "#0a0e16", color: "#e8eefc", fontFamily: "system-ui, sans-serif" }}>
      <div style={{ maxWidth: 980, margin: "0 auto", padding: "20px 16px 60px" }}>
        <h1 style={{ fontSize: 22, fontWeight: 900, margin: "0 0 12px" }}>🛠️ Trình vẽ cấp Campaign</h1>

        {/* Admin key */}
        <div style={{ display: "flex", gap: 8, alignItems: "flex-end", flexWrap: "wrap" }}>
          <div style={{ flex: 1, minWidth: 220 }}>
            <label style={labelStyle}>ADMIN KEY (header x-admin-key)</label>
            <input type="password" value={adminKey} onChange={(e) => setAdminKey(e.target.value)} style={inputStyle} placeholder="ADMIN_API_KEY…" />
          </div>
          <button onClick={() => void load()} style={btn("#31b0ff")}>Tải danh sách</button>
          <button onClick={newLevel} style={btn("#48d987")}>+ Cấp mới</button>
        </div>
        {status && <div style={{ marginTop: 10, fontSize: 13, color: errors.length ? "#ffb3b3" : "#8ee7a8" }}>{status}</div>}

        {/* Danh sách cấp hiện có */}
        {rows.length > 0 && (
          <div style={{ marginTop: 14, display: "flex", flexWrap: "wrap", gap: 8 }}>
            {rows.map((r) => (
              <button key={r.id} onClick={() => editRow(r)} style={{ ...btn("rgba(255,255,255,0.1)"), color: "#cdd7ea" }}>
                {r.published ? "✅" : "📝"} {r.sort_order}. {r.name} <span style={{ opacity: 0.5 }}>({r.id})</span>
              </button>
            ))}
          </div>
        )}

        <div style={{ marginTop: 18, display: "grid", gridTemplateColumns: "minmax(0,1fr) minmax(0,1.1fr)", gap: 20 }}>
          {/* Cột trái: form */}
          <div>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
              <div><label style={labelStyle}>ID</label><input value={form.id} onChange={(e) => set("id", e.target.value)} style={inputStyle} placeholder="vd c6" /></div>
              <div><label style={labelStyle}>Thứ tự</label><input type="number" value={form.sortOrder} onChange={(e) => set("sortOrder", Number(e.target.value))} style={inputStyle} /></div>
            </div>
            <label style={labelStyle}>Tên</label><input value={form.name} onChange={(e) => set("name", e.target.value)} style={inputStyle} />

            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
              <div><label style={labelStyle}>Số bot</label><input type="number" value={form.botCount} onChange={(e) => set("botCount", Number(e.target.value))} style={inputStyle} /></div>
              <div><label style={labelStyle}>Số mạng</label><input type="number" value={form.maxLives} onChange={(e) => set("maxLives", Number(e.target.value))} style={inputStyle} /></div>
            </div>

            <label style={labelStyle}>Mục tiêu</label>
            <select value={form.kind} onChange={(e) => set("kind", e.target.value as WinConditionKind)} style={inputStyle}>
              {WIN_KINDS.map((w) => <option key={w.kind} value={w.kind}>{w.label}</option>)}
            </select>
            {form.kind === "territory_pct" && <><label style={labelStyle}>Ngưỡng % (0–1)</label><input type="number" step="0.05" value={form.targetPct} onChange={(e) => set("targetPct", Number(e.target.value))} style={inputStyle} /></>}
            {form.kind === "survive" && <><label style={labelStyle}>Giây sống sót</label><input type="number" value={form.durationSec} onChange={(e) => set("durationSec", Number(e.target.value))} style={inputStyle} /></>}
            {form.kind === "capture_totems" && <><label style={labelStyle}>Số totem</label><input type="number" value={form.totemGoal} onChange={(e) => set("totemGoal", Number(e.target.value))} style={inputStyle} /></>}

            <label style={labelStyle}>Power-up cho phép</label>
            <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
              {POWERUPS.map((p) => {
                const on = form.powerups.includes(p);
                return <button key={p} onClick={() => set("powerups", on ? form.powerups.filter((x) => x !== p) : [...form.powerups, p])}
                  style={{ ...btn(on ? "rgba(49,176,255,0.22)" : "rgba(30,40,60,0.8)"), color: on ? "#bdecff" : "#cdd7ea", fontSize: 12 }}>{on ? "✓ " : ""}{POWERUP_LABEL[p]}</button>;
              })}
            </div>

            <label style={labelStyle}>Mở khóa sau cấp (id, để trống = mở sẵn)</label>
            <input value={form.unlockRequires} onChange={(e) => set("unlockRequires", e.target.value)} style={inputStyle} placeholder="vd c5" />

            <label style={labelStyle}>Thưởng</label>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 10 }}>
              <div><span style={{ fontSize: 10, opacity: 0.6 }}>coin</span><input type="number" value={form.coin} onChange={(e) => set("coin", Number(e.target.value))} style={inputStyle} /></div>
              <div><span style={{ fontSize: 10, opacity: 0.6 }}>xp</span><input type="number" value={form.xp} onChange={(e) => set("xp", Number(e.target.value))} style={inputStyle} /></div>
              <div><span style={{ fontSize: 10, opacity: 0.6 }}>energy</span><input type="number" value={form.energy} onChange={(e) => set("energy", Number(e.target.value))} style={inputStyle} /></div>
            </div>

            <label style={{ ...labelStyle, display: "flex", alignItems: "center", gap: 8, cursor: "pointer" }}>
              <input type="checkbox" checked={form.published} onChange={(e) => set("published", e.target.checked)} /> Publish (hiện cho người chơi)
            </label>

            {errors.length > 0 && <div style={{ marginTop: 8, fontSize: 12, color: "#ffb3b3" }}>⚠ {errors.join("; ")}</div>}
            <div style={{ display: "flex", gap: 8, marginTop: 14 }}>
              <button onClick={() => void publish()} disabled={errors.length > 0} style={{ ...btn("#31b0ff"), flex: 1, opacity: errors.length ? 0.5 : 1 }}>💾 Lưu + Publish</button>
              <button onClick={() => setPreviewing(true)} style={btn("rgba(255,210,63,0.15)")}>👁️ Xem thử (2D)</button>
            </div>
          </div>

          {/* Cột phải: lưới hex tô obstacle */}
          <div>
            <label style={labelStyle}>Ô CHƯỚNG NGẠI — bấm để bật/tắt (vùng quanh tâm, ngoài vùng này luôn đi được)</label>
            <HexGrid obstacles={obstacles} onToggle={toggleCell} />
            <div style={{ fontSize: 11, opacity: 0.5, marginTop: 6 }}>{obstacles.size} ô chướng ngại · ô lục màu = tâm (điểm xuất phát)</div>
          </div>
        </div>
      </div>
    </div>
  );
}

function btn(bg: string): React.CSSProperties {
  return { padding: "9px 16px", borderRadius: 999, border: "1px solid rgba(255,255,255,0.15)", background: bg, color: "#04121f", fontWeight: 700, fontSize: 13, cursor: "pointer", whiteSpace: "nowrap" };
}
