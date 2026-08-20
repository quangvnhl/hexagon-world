// Trình vẽ cấp Campaign — app admin (doc 30 L6 + nâng cấp doc 31).
// Bố cục TOÀN MÀN HÌNH: canvas sân phủ nền; panel Admin Key + danh sách cấp thu gọn
// trên-trái; form thông tin cấp cố định phải; thanh công cụ dưới (zoom/fit/cọ/đếm ô).
// Vẽ obstacle trên ĐÚNG toàn sân (HexCanvas, Canvas 2D) + đặt bán kính sân theo cấp.

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  ArenaGeometry,
  validateLevelDraft,
  CONFIG,
  type PowerupKind,
  type WinConditionKind,
  key as hexKey,
  parseKey,
  type MatchConfigInput,
  type MatchMapConfig,
  type CampaignLevelDraft,
  type AuthoredTotem,
  type HexKey,
  type TotemKind,
} from "@hexagon/shared";
import { adminListLevels, adminUpsertLevel, adminPublishLevel, type AdminLevelRow } from "./api";
import { HexCanvas, TOTEM_STYLE, type HexCanvasHandle, type EditorTool } from "./HexCanvas";

const TOTEM_KINDS: TotemKind[] = ["speed", "slow", "radar"];
const TOTEM_KIND_LABEL: Record<TotemKind, string> = { speed: "⚡ Tốc", slow: "🐌 Chậm", radar: "📡 Radar" };

const DEFAULT_RADIUS = CONFIG.ARENA_RADIUS; // 130 — sentinel: bằng mặc định engine thì BỎ map.radius (cấp cũ bất biến)
const NEW_LEVEL_RADIUS = 20;                 // bán kính mặc định cho cấp MỚI (dễ dựng, vừa màn hình)
const MIN_RADIUS = 5, MAX_RADIUS = 150;
const BRUSHES = [0, 1, 2, 3];
const POWERUPS: PowerupKind[] = ["speed", "head_start", "extra_life"];
const POWERUP_LABEL: Record<PowerupKind, string> = { speed: "⚡ Tốc", head_start: "🟩 Khởi đầu rộng", extra_life: "❤ Thêm mạng" };
const WIN_KINDS: { kind: WinConditionKind; label: string }[] = [
  { kind: "territory_pct", label: "Chiếm % lãnh thổ" },
  { kind: "survive", label: "Sống sót (giây)" },
  { kind: "capture_totems", label: "Thu totem" },
  { kind: "none", label: "Không thắng/thua" },
];

interface FormState {
  id: string; sortOrder: number; name: string; botCount: number; maxLives: number; radius: number;
  kind: WinConditionKind; targetPct: number; durationSec: number; totemGoal: number;
  powerups: PowerupKind[]; unlockRequires: string; coin: number; xp: number; energy: number; published: boolean;
  showColliders: boolean; colliderShape: "hex" | "rect";
}

const BLANK: FormState = {
  id: "", sortOrder: 1, name: "", botCount: 8, maxLives: 3, radius: NEW_LEVEL_RADIUS,
  kind: "territory_pct", targetPct: 0.3, durationSec: 60, totemGoal: 3,
  powerups: [], unlockRequires: "", coin: 50, xp: 40, energy: 0, published: false, showColliders: false, colliderShape: "hex",
};

function clampRadius(r: number): number {
  return Math.max(MIN_RADIUS, Math.min(MAX_RADIUS, Math.floor(r) || NEW_LEVEL_RADIUS));
}

function totemsToList(totems: Map<HexKey, TotemKind>): AuthoredTotem[] {
  return [...totems].map(([k, kind]) => { const { q, r } = parseKey(k); return { kind, q, r }; });
}

function buildConfig(f: FormState, obstacles: Set<HexKey>, totems: Map<HexKey, TotemKind>): MatchConfigInput {
  const win =
    f.kind === "territory_pct" ? { kind: f.kind, targetPct: f.targetPct }
    : f.kind === "survive" ? { kind: f.kind, durationSec: f.durationSec }
    : f.kind === "capture_totems" ? { kind: f.kind, totemGoal: f.totemGoal }
    : { kind: "none" as const };
  // Campaign KHÔNG sinh totem ngẫu nhiên — chỉ dùng totem admin tự vẽ (doc 32). totemsEnabled=false
  // để cấp không có map.totems là KHÔNG có totem nào; có map.totems ⇒ sim dùng đúng danh sách đó.
  const rules: MatchConfigInput["rules"] = { maxLives: f.maxLives, totemsEnabled: false };
  const config: MatchConfigInput = { bots: { count: f.botCount }, rules, win };
  const map: Partial<MatchMapConfig> = {};
  if (f.radius !== DEFAULT_RADIUS) map.radius = f.radius; // chỉ ghi khi khác mặc định engine → cấp cũ bất biến
  if (obstacles.size > 0) map.obstacles = [...obstacles];
  if (totems.size > 0) map.totems = totemsToList(totems);
  if (f.showColliders) map.showColliders = true;
  if (f.colliderShape === "rect") map.colliderShape = "rect"; // "hex" là mặc định → không cần ghi
  if (Object.keys(map).length) config.map = map;
  return config;
}

function toDraft(f: FormState, obstacles: Set<HexKey>, totems: Map<HexKey, TotemKind>): CampaignLevelDraft {
  return {
    id: f.id.trim(), sortOrder: f.sortOrder, name: f.name.trim(),
    config: buildConfig(f, obstacles, totems), powerups: f.powerups,
    unlockRequires: f.unlockRequires.trim() || null,
    rewards: { coin: f.coin, xp: f.xp, energy: f.energy }, published: f.published,
  };
}

function objectiveLabel(f: FormState): string {
  switch (f.kind) {
    case "territory_pct": return `Chiếm ${Math.round(f.targetPct * 100)}% lãnh thổ`;
    case "survive": return `Sống sót ${f.durationSec}s`;
    case "capture_totems": return `Thu ${f.totemGoal} totem`;
    default: return "Không thắng/thua (chơi tự do)";
  }
}

function rowToForm(r: AdminLevelRow): { form: FormState; obstacles: Set<HexKey>; totems: Map<HexKey, TotemKind> } {
  const cfg = (r.config ?? {}) as MatchConfigInput;
  const win = cfg.win ?? { kind: "territory_pct" };
  const totems = new Map<HexKey, TotemKind>();
  for (const t of cfg.map?.totems ?? []) totems.set(hexKey(t.q, t.r), t.kind);
  return {
    form: {
      id: r.id, sortOrder: r.sort_order, name: r.name,
      botCount: cfg.bots?.count ?? 8, maxLives: cfg.rules?.maxLives ?? 3,
      radius: cfg.map?.radius ?? DEFAULT_RADIUS,
      kind: (win.kind ?? "territory_pct") as WinConditionKind,
      targetPct: win.targetPct ?? 0.3, durationSec: win.durationSec ?? 60, totemGoal: win.totemGoal ?? 3,
      powerups: (r.powerups ?? []) as PowerupKind[], unlockRequires: r.unlock_requires ?? "",
      coin: r.rewards?.coin ?? 0, xp: r.rewards?.xp ?? 0, energy: r.rewards?.energy ?? 0, published: r.published,
      showColliders: cfg.map?.showColliders ?? false,
      colliderShape: cfg.map?.colliderShape ?? "hex",
    },
    obstacles: new Set(cfg.map?.obstacles ?? []),
    totems,
  };
}

const inputStyle: React.CSSProperties = {
  width: "100%", padding: "6px 9px", borderRadius: 8, border: "1px solid rgba(255,255,255,0.14)",
  background: "rgba(255,255,255,0.05)", color: "#e8eefc", fontSize: 13, boxSizing: "border-box",
};
const labelStyle: React.CSSProperties = { fontSize: 10, opacity: 0.6, letterSpacing: 0.5, display: "block", marginBottom: 2, marginTop: 8 };
const panelStyle: React.CSSProperties = {
  position: "absolute", background: "rgba(10,14,22,0.92)", backdropFilter: "blur(6px)",
  border: "1px solid rgba(255,255,255,0.1)", borderRadius: 12, color: "#e8eefc",
  fontFamily: "system-ui, sans-serif", zIndex: 5, boxShadow: "0 8px 30px rgba(0,0,0,0.4)",
};

function btn(bg: string): React.CSSProperties {
  return { padding: "8px 14px", borderRadius: 999, border: "1px solid rgba(255,255,255,0.15)", background: bg, color: "#04121f", fontWeight: 700, fontSize: 12, cursor: "pointer", whiteSpace: "nowrap" };
}

export default function LevelEditor() {
  const [adminKey, setAdminKey] = useState("");
  const [rows, setRows] = useState<AdminLevelRow[]>([]);
  const [form, setForm] = useState<FormState>(BLANK);
  const [obstacles, setObstacles] = useState<Set<HexKey>>(new Set());
  const [totems, setTotems] = useState<Map<HexKey, TotemKind>>(new Map());
  const [status, setStatus] = useState<string>("");
  const [previewing, setPreviewing] = useState(false);
  const [brush, setBrush] = useState(1);
  const [tool, setTool] = useState<EditorTool>("obstacle");
  const [totemKind, setTotemKind] = useState<TotemKind>("speed");
  const [radiusText, setRadiusText] = useState(String(NEW_LEVEL_RADIUS));
  const [keyPanelOpen, setKeyPanelOpen] = useState(true);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const canvasApi = useRef<HexCanvasHandle | null>(null);

  // Ô input bán kính đồng bộ khi form.radius đổi từ ngoài (Sửa/ Mới/ commit).
  useEffect(() => { setRadiusText(String(form.radius)); }, [form.radius]);

  useEffect(() => {
    setAdminKey(window.localStorage.getItem("hexagon.adminKey") ?? "");
    setKeyPanelOpen(window.localStorage.getItem("hexagon.keyPanelOpen") !== "0");
  }, []);
  useEffect(() => { window.localStorage.setItem("hexagon.keyPanelOpen", keyPanelOpen ? "1" : "0"); }, [keyPanelOpen]);

  const set = useCallback(<K extends keyof FormState>(k: K, v: FormState[K]) => setForm((f) => ({ ...f, [k]: v })), []);

  const load = useCallback(async () => {
    window.localStorage.setItem("hexagon.adminKey", adminKey);
    setStatus("Đang tải…");
    try { const list = await adminListLevels(adminKey); setRows(list); setStatus(`Đã tải ${list.length} cấp`); }
    catch (e) { setStatus(e instanceof Error ? e.message : "Tải thất bại (sai admin key?)"); }
  }, [adminKey]);

  const handlePaint = useCallback((keys: HexKey[], erase: boolean) => {
    setObstacles((prev) => {
      const next = new Set(prev);
      if (erase) for (const k of keys) next.delete(k);
      // Không tô obstacle chồng lên ô đang có totem (loại trừ lẫn nhau).
      else for (const k of keys) { if (!totems.has(k)) next.add(k); }
      return next;
    });
  }, [totems]);

  /** Đặt/gỡ totem tại 1 ô: có totem sẵn → gỡ; trống → đặt loại đang chọn (bỏ obstacle nếu có). */
  const handlePlaceTotem = useCallback((k: HexKey) => {
    setTotems((prev) => {
      const next = new Map(prev);
      if (next.has(k)) next.delete(k);
      else next.set(k, totemKind);
      return next;
    });
    setObstacles((prev) => { if (!prev.has(k)) return prev; const n = new Set(prev); n.delete(k); return n; });
  }, [totemKind]);

  /** Đổi bán kính sân + cắt obstacle/totem rơi ngoài sân mới (khớp hành vi sim). */
  const commitRadius = useCallback((raw: number) => {
    const rad = clampRadius(raw);
    const valid = new ArenaGeometry(rad).mapArena(CONFIG.MAP_MARGIN);
    let dropped = 0;
    const nextObs = new Set<HexKey>();
    for (const k of obstacles) { if (valid.has(k)) nextObs.add(k); else dropped++; }
    const nextTot = new Map<HexKey, TotemKind>();
    for (const [k, v] of totems) { if (valid.has(k)) nextTot.set(k, v); else dropped++; }
    setObstacles(nextObs); setTotems(nextTot);
    setForm((f) => ({ ...f, radius: rad }));
    setStatus(dropped ? `Bán kính ${rad}: đã bỏ ${dropped} ô ngoài sân` : `Bán kính sân = ${rad}`);
  }, [obstacles, totems]);

  const errors = useMemo(() => validateLevelDraft(toDraft(form, obstacles, totems)), [form, obstacles, totems]);

  const publish = useCallback(async () => {
    if (errors.length) { setStatus("Còn lỗi: " + errors.join("; ")); return; }
    setStatus("Đang lưu…");
    try {
      const draft = toDraft(form, obstacles, totems);
      await adminUpsertLevel(adminKey, draft);
      await adminPublishLevel(adminKey, draft.id, form.published);
      setStatus(`Đã lưu "${draft.id}"${form.published ? " (đã publish)" : " (nháp)"}`);
      setSelectedId(draft.id);
      setRows(await adminListLevels(adminKey));
    } catch (e) { setStatus(e instanceof Error ? e.message : "Lưu thất bại"); }
  }, [errors, form, obstacles, totems, adminKey]);

  const editRow = useCallback((r: AdminLevelRow) => {
    const { form: f, obstacles: o, totems: t } = rowToForm(r);
    setForm(f); setObstacles(o); setTotems(t); setSelectedId(r.id); setStatus(`Đang sửa "${r.id}"`);
  }, []);

  const unpublishRow = useCallback(async (r: AdminLevelRow) => {
    setStatus(`Đang gỡ publish "${r.id}"…`);
    try { await adminPublishLevel(adminKey, r.id, false); setRows(await adminListLevels(adminKey)); setStatus(`Đã gỡ publish "${r.id}"`); }
    catch (e) { setStatus(e instanceof Error ? e.message : "Gỡ publish thất bại"); }
  }, [adminKey]);

  const newLevel = useCallback(() => {
    setForm({ ...BLANK, sortOrder: rows.length + 1 }); setObstacles(new Set()); setTotems(new Map()); setSelectedId(null); setStatus("Cấp mới");
  }, [rows.length]);

  if (previewing) {
    return <Preview2D form={form} obstacles={obstacles} totems={totems} onClose={() => setPreviewing(false)} />;
  }

  return (
    <div style={{ position: "fixed", inset: 0, overflow: "hidden", background: "#0a0e16" }}>
      <HexCanvas radius={form.radius} obstacles={obstacles} totems={totems} tool={tool}
        onPaint={handlePaint} onPlaceTotem={handlePlaceTotem} brush={brush} onReady={(a) => (canvasApi.current = a)} />

      {/* Panel trên-trái: Admin Key + danh sách cấp (thu gọn được) */}
      <div style={{ ...panelStyle, top: 12, left: 12, width: keyPanelOpen ? 300 : "auto", maxHeight: "calc(100vh - 24px)", overflow: "auto", padding: keyPanelOpen ? 14 : 8 }}>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8 }}>
          <strong style={{ fontSize: 13 }}>🛠️ Trình vẽ cấp</strong>
          <button onClick={() => setKeyPanelOpen((v) => !v)} style={{ ...btn("rgba(255,255,255,0.12)"), color: "#cdd7ea", padding: "4px 9px" }}>{keyPanelOpen ? "▾" : "▸"}</button>
        </div>
        {keyPanelOpen && (
          <>
            <label style={labelStyle}>ADMIN KEY — token GỐC (không phải hash)</label>
            <input type="password" value={adminKey} onChange={(e) => setAdminKey(e.target.value)} style={inputStyle} placeholder="token gốc, KHÔNG phải SHA-256…" />
            <div style={{ fontSize: 10, opacity: 0.55, marginTop: 3, lineHeight: 1.4 }}>
              Nhập <b>token gốc</b> mà server băm SHA-256 ra <code>ADMIN_API_KEY_SHA256</code> — KHÔNG dán chính chuỗi hash.
            </div>
            <div style={{ display: "flex", gap: 6, marginTop: 8 }}>
              <button onClick={() => void load()} style={{ ...btn("#31b0ff"), flex: 1 }}>Tải danh sách</button>
              <button onClick={newLevel} style={btn("#48d987")}>+ Mới</button>
            </div>
            {rows.length > 0 && (
              <div style={{ marginTop: 12, display: "flex", flexDirection: "column", gap: 6 }}>
                {rows.map((r) => {
                  const sel = r.id === selectedId;
                  return (
                    <div key={r.id} style={{ display: "flex", alignItems: "center", gap: 6, padding: "6px 8px", borderRadius: 8, background: sel ? "rgba(49,176,255,0.18)" : "rgba(255,255,255,0.05)", border: sel ? "1px solid rgba(49,176,255,0.5)" : "1px solid transparent" }}>
                      <span style={{ flex: 1, fontSize: 12, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                        {r.published ? "✅" : "📝"} {r.sort_order}. {r.name} <span style={{ opacity: 0.5 }}>({r.id})</span>
                      </span>
                      <button onClick={() => editRow(r)} style={{ ...btn("rgba(255,255,255,0.14)"), color: "#cdd7ea", padding: "4px 8px" }}>Sửa</button>
                      {r.published && <button onClick={() => void unpublishRow(r)} style={{ ...btn("rgba(255,120,110,0.18)"), color: "#ffc9c2", padding: "4px 8px" }}>Gỡ</button>}
                    </div>
                  );
                })}
              </div>
            )}
            {status && <div style={{ marginTop: 10, fontSize: 12, color: errors.length ? "#ffb3b3" : "#8ee7a8" }}>{status}</div>}
          </>
        )}
      </div>

      {/* Panel phải: form thông tin cấp */}
      <div style={{ ...panelStyle, top: 12, right: 12, bottom: 12, width: 330, overflow: "auto", padding: 14 }}>
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8 }}>
          <div><label style={labelStyle}>ID</label><input value={form.id} onChange={(e) => set("id", e.target.value)} style={inputStyle} placeholder="vd c6" /></div>
          <div><label style={labelStyle}>Thứ tự</label><input type="number" value={form.sortOrder} onChange={(e) => set("sortOrder", Number(e.target.value))} style={inputStyle} /></div>
        </div>
        <label style={labelStyle}>Tên</label><input value={form.name} onChange={(e) => set("name", e.target.value)} style={inputStyle} />

        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 8 }}>
          <div><label style={labelStyle}>Số bot</label><input type="number" value={form.botCount} onChange={(e) => set("botCount", Number(e.target.value))} style={inputStyle} /></div>
          <div><label style={labelStyle}>Số mạng</label><input type="number" value={form.maxLives} onChange={(e) => set("maxLives", Number(e.target.value))} style={inputStyle} /></div>
          <div><label style={labelStyle}>Bán kính sân (≤{MAX_RADIUS})</label><input type="number" value={radiusText} min={MIN_RADIUS} max={MAX_RADIUS}
            onChange={(e) => { let v = e.target.value; if (v !== "" && Number(v) > MAX_RADIUS) v = String(MAX_RADIUS); setRadiusText(v); }}
            onBlur={(e) => commitRadius(Number(e.target.value))}
            onKeyDown={(e) => { if (e.key === "Enter") (e.target as HTMLInputElement).blur(); }}
            style={inputStyle} /></div>
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
              style={{ ...btn(on ? "rgba(49,176,255,0.22)" : "rgba(30,40,60,0.8)"), color: on ? "#bdecff" : "#cdd7ea", fontSize: 11 }}>{on ? "✓ " : ""}{POWERUP_LABEL[p]}</button>;
          })}
        </div>

        <label style={labelStyle}>Mở khóa sau cấp (id, để trống = mở sẵn)</label>
        <input value={form.unlockRequires} onChange={(e) => set("unlockRequires", e.target.value)} style={inputStyle} placeholder="vd c5" />

        <label style={labelStyle}>Thưởng</label>
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 8 }}>
          <div><span style={{ fontSize: 10, opacity: 0.6 }}>coin</span><input type="number" value={form.coin} onChange={(e) => set("coin", Number(e.target.value))} style={inputStyle} /></div>
          <div><span style={{ fontSize: 10, opacity: 0.6 }}>xp</span><input type="number" value={form.xp} onChange={(e) => set("xp", Number(e.target.value))} style={inputStyle} /></div>
          <div><span style={{ fontSize: 10, opacity: 0.6 }}>energy</span><input type="number" value={form.energy} onChange={(e) => set("energy", Number(e.target.value))} style={inputStyle} /></div>
        </div>

        <label style={labelStyle}>Hình collider chướng ngại</label>
        <select value={form.colliderShape} onChange={(e) => set("colliderShape", e.target.value as "hex" | "rect")} style={inputStyle}>
          <option value="hex">Lục giác (biên đa giác, góc 120° — không kẹt)</option>
          <option value="rect">Chữ nhật (hộp bao ô — góc 90°)</option>
        </select>
        <label style={{ ...labelStyle, display: "flex", alignItems: "center", gap: 8, cursor: "pointer" }}>
          <input type="checkbox" checked={form.showColliders} onChange={(e) => set("showColliders", e.target.checked)} /> Hiện đường collider (viền obstacle + biên) khi chơi
        </label>
        <label style={{ ...labelStyle, display: "flex", alignItems: "center", gap: 8, cursor: "pointer" }}>
          <input type="checkbox" checked={form.published} onChange={(e) => set("published", e.target.checked)} /> Publish (hiện cho người chơi)
        </label>

        {errors.length > 0 && <div style={{ marginTop: 8, fontSize: 11, color: "#ffb3b3" }}>⚠ {errors.join("; ")}</div>}
        <div style={{ display: "flex", gap: 8, marginTop: 12 }}>
          <button onClick={() => void publish()} disabled={errors.length > 0} style={{ ...btn("#31b0ff"), flex: 1, opacity: errors.length ? 0.5 : 1 }}>💾 Lưu + Publish</button>
          <button onClick={() => setPreviewing(true)} style={btn("rgba(255,210,63,0.18)")}>👁️ Xem thử</button>
        </div>
      </div>

      {/* Thanh công cụ dưới-giữa: công cụ / zoom / cọ|totem / đếm */}
      <div style={{ ...panelStyle, bottom: 12, left: "50%", transform: "translateX(-50%)", padding: "8px 12px", display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap", maxWidth: "calc(100vw - 380px)" }}>
        <div style={{ display: "flex", gap: 4 }}>
          <button onClick={() => setTool("obstacle")} style={{ ...btn(tool === "obstacle" ? "rgba(255,106,90,0.35)" : "rgba(255,255,255,0.08)"), color: tool === "obstacle" ? "#ffd0c9" : "#cdd7ea" }}>🧱 Chướng ngại</button>
          <button onClick={() => setTool("totem")} style={{ ...btn(tool === "totem" ? "rgba(49,176,255,0.3)" : "rgba(255,255,255,0.08)"), color: tool === "totem" ? "#bdecff" : "#cdd7ea" }}>🔮 Totem</button>
        </div>
        <div style={{ display: "flex", gap: 4 }}>
          <button onClick={() => canvasApi.current?.zoomBy(1 / 1.25)} style={{ ...btn("rgba(255,255,255,0.12)"), color: "#cdd7ea" }}>−</button>
          <button onClick={() => canvasApi.current?.zoomBy(1.25)} style={{ ...btn("rgba(255,255,255,0.12)"), color: "#cdd7ea" }}>+</button>
          <button onClick={() => canvasApi.current?.fit()} style={{ ...btn("rgba(255,255,255,0.12)"), color: "#cdd7ea" }}>Fit</button>
        </div>
        {tool === "obstacle" ? (
          <div style={{ display: "flex", alignItems: "center", gap: 4 }}>
            <span style={{ fontSize: 10, opacity: 0.6 }}>CỌ</span>
            {BRUSHES.map((b) => (
              <button key={b} onClick={() => setBrush(b)} style={{ ...btn(b === brush ? "rgba(49,176,255,0.3)" : "rgba(255,255,255,0.08)"), color: b === brush ? "#bdecff" : "#cdd7ea", padding: "6px 10px" }}>{b + 1}</button>
            ))}
          </div>
        ) : (
          <div style={{ display: "flex", alignItems: "center", gap: 4 }}>
            <span style={{ fontSize: 10, opacity: 0.6 }}>LOẠI</span>
            {TOTEM_KINDS.map((k) => (
              <button key={k} onClick={() => setTotemKind(k)} style={{ ...btn("rgba(255,255,255,0.08)"), background: k === totemKind ? TOTEM_STYLE[k].color : "rgba(255,255,255,0.08)", color: k === totemKind ? "#04121f" : "#cdd7ea", padding: "6px 10px", outline: k === totemKind ? "2px solid #fff" : "none" }}>{TOTEM_KIND_LABEL[k]}</button>
            ))}
          </div>
        )}
        <span style={{ fontSize: 11, opacity: 0.7 }}>
          {tool === "obstacle"
            ? `${obstacles.size} chướng ngại · kéo tô · Alt/phải xóa · Space/giữa pan`
            : `${totems.size} totem · bấm đặt/gỡ · Space/giữa pan`}
        </span>
      </div>
    </div>
  );
}

/** Preview 2D (doc 30 L6b, doc 31 M6, doc 32) — canvas đọc-thôi + tóm tắt config. */
function Preview2D({ form, obstacles, totems, onClose }: { form: FormState; obstacles: Set<HexKey>; totems: Map<HexKey, TotemKind>; onClose: () => void }) {
  const byKind = { speed: 0, slow: 0, radar: 0 };
  for (const k of totems.values()) byKind[k]++;
  const totemGoalWarn = form.kind === "capture_totems" && form.totemGoal > totems.size;
  const chips: { label: string; value: string }[] = [
    { label: "Mục tiêu", value: objectiveLabel(form) },
    { label: "Bán kính sân", value: String(form.radius) },
    { label: "Số bot", value: String(form.botCount) },
    { label: "Số mạng", value: form.maxLives > 0 ? String(form.maxLives) : "Vô hạn" },
    { label: "Mở khóa sau", value: form.unlockRequires.trim() || "— (mở sẵn)" },
    { label: "Ô chướng ngại", value: String(obstacles.size) },
    { label: "Totem", value: totems.size ? `${totems.size} (⚡${byKind.speed} 🐌${byKind.slow} 📡${byKind.radar})` : "—" },
    { label: "Power-up", value: form.powerups.length ? form.powerups.map((p) => POWERUP_LABEL[p]).join(", ") : "—" },
    { label: "Thưởng", value: `${form.coin} coin · ${form.xp} xp · ${form.energy} energy` },
  ];
  return (
    <div style={{ position: "fixed", inset: 0, overflow: "hidden", background: "#0a0e16", fontFamily: "system-ui, sans-serif" }}>
      <HexCanvas radius={form.radius} obstacles={obstacles} totems={totems} readOnly />
      <div style={{ ...panelStyle, top: 12, left: 12, right: 12, padding: "10px 14px", display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12 }}>
        <strong style={{ fontSize: 15 }}>👁️ Xem thử (2D): {form.name || form.id || "(chưa đặt tên)"}</strong>
        <button onClick={onClose} style={{ ...btn("rgba(255,255,255,0.14)"), color: "#cdd7ea" }}>← Về trình vẽ</button>
      </div>
      <div style={{ ...panelStyle, top: 64, right: 12, width: 280, padding: 14 }}>
        {chips.map((c) => (
          <div key={c.label} style={{ padding: "7px 0", borderBottom: "1px solid rgba(255,255,255,0.07)" }}>
            <div style={{ fontSize: 10, opacity: 0.55, letterSpacing: 0.5 }}>{c.label.toUpperCase()}</div>
            <div style={{ fontSize: 14, fontWeight: 600 }}>{c.value}</div>
          </div>
        ))}
        {totemGoalWarn && <div style={{ marginTop: 10, fontSize: 11, color: "#ffb3b3" }}>⚠ Mục tiêu thu {form.totemGoal} totem nhưng chỉ có {totems.size} totem trên bản đồ.</div>}
        <div style={{ fontSize: 11, opacity: 0.5, marginTop: 10 }}>Preview tĩnh — không mô phỏng trận. Publish (nháp) rồi mở <code>/campaign</code> để thử-chơi.</div>
      </div>
    </div>
  );
}
