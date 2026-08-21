// Renderer lưới lục giác bằng Canvas 2D (doc 31 M1/M2) — thay lưới SVG cũ (chỉ 127 ô
// quanh tâm). Vẽ TOÀN sân thật theo `radius` (ArenaGeometry.mapArena, tới ~16.6k ô),
// pan/zoom, và tô/xóa obstacle bằng chuột. Hit-test bằng pixelToAxial.
//
// Hiệu năng: gom mọi ô vào 1 Path2D (nền) + 1 Path2D (obstacle) rồi fill/stroke MỘT lần
// mỗi frame, và CULL theo viewport ⇒ mượt dù chục nghìn ô. Trạng thái view (scale/offset)
// giữ trong ref + vẽ trong requestAnimationFrame để không re-render React mỗi lần pan.

import { useCallback, useEffect, useMemo, useRef } from "react";
import {
  ArenaGeometry,
  axialToPixel,
  pixelToAxial,
  cubeDistance,
  hexLinedraw,
  neighbors,
  key as hexKey,
  parseKey,
  CONFIG,
  type HexKey,
  type Axial,
  type TotemKind,
} from "@hexagon/shared";

export type EditorTool = "obstacle" | "totem" | "boundary" | "stronghold" | "startzone";

/** Mức zoom (world→screen px/đơn vị). DEFAULT = "100%" mặc định (KHÔNG fit-toàn-sân để tránh lag khi
 *  sân lớn). MIN/MAX giới hạn cuộn/±; nút "Toàn cảnh" (fit) được phép vượt MIN để hiện tối đa. */
const SCALE_DEFAULT = 12;
const SCALE_MIN = 4;
const SCALE_MAX = 60;

/** Màu + nhãn marker cho từng loại totem (đồng bộ ý nghĩa với game). */
export const TOTEM_STYLE: Record<TotemKind, { color: string; label: string }> = {
  speed: { color: "#ffd23f", label: "T" }, // Tốc
  slow: { color: "#4fa8ff", label: "C" },  // Chậm
  radar: { color: "#b06aff", label: "R" }, // Radar
};

const SQRT3 = Math.sqrt(3);
const HEX = 1; // HEX_SIZE (= CONFIG.HEX_SIZE); world circumradius mỗi ô.

export interface HexCanvasHandle {
  zoomBy: (factor: number) => void;
  /** Về mức 100% mặc định (căn giữa) — "Phóng chuẩn". */
  reset100: () => void;
  /** Fit toàn sân (hiện tối đa) — nút "Toàn cảnh". */
  fit: () => void;
}

interface HexCanvasProps {
  radius: number;
  obstacles: Set<HexKey>;
  /** Totem tác giả đã đặt (doc 32). Vẽ marker theo loại. */
  totems?: Map<HexKey, TotemKind>;
  /** Cứ điểm bot (doc 34 B): ô → số bot. Vẽ marker vuông + số. */
  strongholds?: Map<HexKey, number>;
  /** Đặt/gỡ cứ điểm tại 1 ô. */
  onPlaceStronghold?: (cell: HexKey) => void;
  /** [doc 35] Ô KHỞI ĐỘNG người chơi (vị trí xuất hiện đầu ván); null = ngẫu nhiên. */
  startZone?: HexKey | null;
  /** Đặt/gỡ ô khởi động (bấm ô đang chọn = gỡ). */
  onPlaceStartZone?: (cell: HexKey) => void;
  /** [doc 35] Hiện THƯỚC KẺ XY (crosshair + toạ độ) tại ô hover. */
  showRuler?: boolean;
  /** Công cụ đang dùng: tô obstacle hay đặt totem. */
  tool?: EditorTool;
  /** Tô (erase=false) hoặc xóa (erase=true) một tập ô hợp lệ. M2. */
  onPaint?: (cells: HexKey[], erase: boolean) => void;
  /** Đặt/gỡ totem tại 1 ô (editor tự quyết định thêm loại đang chọn hay gỡ). */
  onPlaceTotem?: (cell: HexKey) => void;
  /** Biên đã tạo (doc 34 D) — polyline world; vẽ đường + cho phép nối tiếp/chọn. */
  boundaries?: Array<{ id: string; points: [number, number][] }>;
  /** Cập nhật danh sách biên (tạo/nối/xoá). */
  onBoundariesChange?: (next: Array<{ id: string; points: [number, number][] }>) => void;
  /** Bán kính cọ theo cube-distance (0 = 1 ô, 1 = 7 ô, …). M2. */
  brush?: number;
  readOnly?: boolean;
  /** Nhận API điều khiển (zoom/fit) cho thanh công cụ ngoài. */
  onReady?: (api: HexCanvasHandle) => void;
}

/** Góc 6 đỉnh hex pointy-top (đơn vị world, circumradius = HEX). */
const CORNERS = Array.from({ length: 6 }, (_, i) => {
  const a = (Math.PI / 180) * (60 * i - 30);
  return { dx: HEX * Math.cos(a), dy: HEX * Math.sin(a) };
});

/** SNAP: đỉnh hex GẦN NHẤT với điểm world (xét ô của điểm + 6 ô kề để phủ mọi đỉnh biên). */
function snapHexVertex(wx: number, wy: number): { x: number; y: number } {
  const base = pixelToAxial(wx, wy, HEX);
  let bx = 0, by = 0, bd = Infinity;
  for (const cand of [base, ...neighbors(base)]) {
    const c = axialToPixel(cand, HEX);
    for (const k of CORNERS) {
      const vx = c.x + k.dx, vy = c.y + k.dy;
      const d = (vx - wx) ** 2 + (vy - wy) ** 2;
      if (d < bd) { bd = d; bx = vx; by = vy; }
    }
  }
  return { x: bx, y: by };
}


export function HexCanvas({ radius, obstacles, totems, strongholds, boundaries, startZone, tool = "obstacle", onPaint, onPlaceTotem, onPlaceStronghold, onPlaceStartZone, onBoundariesChange, brush = 0, readOnly, showRuler, onReady }: HexCanvasProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const wrapRef = useRef<HTMLDivElement>(null);

  // Tập ô hợp lệ (khớp đúng set sim chấp nhận obstacle) + tâm world, cache theo radius.
  const cells = useMemo(() => {
    const arena = new ArenaGeometry(radius);
    const valid = arena.mapArena(CONFIG.MAP_MARGIN);
    const centers: { k: HexKey; q: number; r: number; cx: number; cy: number }[] = [];
    for (const k of valid) {
      const { q, r } = parseKey(k);
      const p = axialToPixel({ q, r }, HEX);
      centers.push({ k, q, r, cx: p.x, cy: p.y });
    }
    return { valid, centers, arenaR: arena.arenaR };
  }, [radius]);

  // View: world→screen là  s = w*scale + offset  (CSS px). Giữ trong ref (không gây re-render).
  const view = useRef({ scale: SCALE_DEFAULT, ox: 0, oy: 0 });
  const obstaclesRef = useRef(obstacles);
  obstaclesRef.current = obstacles;
  const totemsRef = useRef(totems);
  totemsRef.current = totems;
  const strongholdsRef = useRef(strongholds);
  strongholdsRef.current = strongholds;
  const startZoneRef = useRef(startZone);
  startZoneRef.current = startZone;
  const showRulerRef = useRef(showRuler);
  showRulerRef.current = showRuler;
  const hover = useRef<Axial | null>(null);
  // Vị trí chuột màn hình gần nhất (cho thước kẻ).
  const mouseRef = useRef<{ x: number; y: number } | null>(null);
  const rafRef = useRef(0);
  // Công cụ BIÊN (doc 34 D): polyline đang vẽ (draft) + snap dưới con trỏ.
  const draftRef = useRef<[number, number][]>([]);
  // snap: đỉnh hex gần nhất (vx,vy); px,py = điểm SẼ đặt (đỉnh nếu hover, else vị trí chuột); onVertex = đang hover đỉnh.
  const snapRef = useRef<{ vx: number; vy: number; px: number; py: number; onVertex: boolean } | null>(null);
  const boundariesRef = useRef(boundaries);
  boundariesRef.current = boundaries;
  // Nút biên ĐANG CHỌN (để xoá 1 điểm) — {bid, idx}. Chuột PHẢI vào 1 nút để chọn (doc 35).
  const selNodeRef = useRef<{ bid: string; idx: number } | null>(null);

  const draw = useCallback(() => {
    rafRef.current = 0;
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    const dpr = window.devicePixelRatio || 1;
    const w = canvas.clientWidth, h = canvas.clientHeight;
    // Đồng bộ backing store với kích thước CSS mỗi frame (ResizeObserver không phải lúc nào
    // cũng set kịp) → tránh vẽ ra ngoài canvas 300×150 mặc định.
    const bw = Math.round(w * dpr), bh = Math.round(h * dpr);
    if (canvas.width !== bw || canvas.height !== bh) { canvas.width = bw; canvas.height = bh; }
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, w, h);
    const { scale, ox, oy } = view.current;
    // Cửa sổ world nhìn thấy (cull) — nới 1 ô để không hụt biên. LƯU Ý: màn hình LẬT trục Y so
    // với world (sy = -wy·scale + oy) để KHỚP hướng game 3D (world +Y hiện LÊN TRÊN, không xuống).
    const pad = HEX + 1;
    const wx0 = (-ox) / scale - pad, wx1 = (w - ox) / scale + pad;
    const wy0 = (oy - h) / scale - pad, wy1 = oy / scale + pad;

    const base = new Path2D();
    const obs = new Path2D();
    const obstacleSet = obstaclesRef.current;
    for (const c of cells.centers) {
      if (c.cx < wx0 || c.cx > wx1 || c.cy < wy0 || c.cy > wy1) continue;
      const path = obstacleSet.has(c.k) ? obs : base;
      const sx = c.cx * scale + ox, sy = -c.cy * scale + oy;
      path.moveTo(sx + CORNERS[0].dx * scale, sy + CORNERS[0].dy * scale);
      for (let i = 1; i < 6; i++) path.lineTo(sx + CORNERS[i].dx * scale, sy + CORNERS[i].dy * scale);
      path.closePath();
    }
    ctx.fillStyle = "rgba(120,140,180,0.12)";
    ctx.fill(base);
    if (scale > 2.2) { ctx.lineWidth = Math.min(1, scale * 0.06); ctx.strokeStyle = "rgba(255,255,255,0.14)"; ctx.stroke(base); }
    ctx.fillStyle = "#ff6a5a";
    ctx.fill(obs);
    if (scale > 2.2) { ctx.strokeStyle = "rgba(0,0,0,0.35)"; ctx.stroke(obs); }

    // Tâm sân (điểm xuất phát).
    const c0 = { sx: ox, sy: oy };
    ctx.beginPath();
    ctx.arc(c0.sx, c0.sy, Math.max(2, scale * 0.5), 0, Math.PI * 2);
    ctx.fillStyle = "rgba(120,220,150,0.9)";
    ctx.fill();

    // Marker totem tác giả (đè lên lưới).
    const totemMap = totemsRef.current;
    if (totemMap && totemMap.size) {
      const rad = Math.max(3, scale * 0.85);
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      ctx.font = `700 ${Math.max(7, scale * 1.1)}px system-ui, sans-serif`;
      for (const [k, kind] of totemMap) {
        const { q, r } = parseKey(k);
        const p = axialToPixel({ q, r }, HEX);
        const sx = p.x * scale + ox, sy = -p.y * scale + oy;
        if (sx < -rad || sx > w + rad || sy < -rad || sy > h + rad) continue;
        const st = TOTEM_STYLE[kind];
        ctx.beginPath();
        ctx.arc(sx, sy, rad, 0, Math.PI * 2);
        ctx.fillStyle = st.color;
        ctx.fill();
        ctx.lineWidth = Math.max(1, scale * 0.12);
        ctx.strokeStyle = "rgba(0,0,0,0.55)";
        ctx.stroke();
        if (scale > 3) { ctx.fillStyle = "#04121f"; ctx.fillText(st.label, sx, sy + 0.5); }
      }
    }

    // Marker CỨ ĐIỂM bot (vuông + số bot).
    const shMap = strongholdsRef.current;
    if (shMap && shMap.size) {
      const rad = Math.max(4, scale * 0.9);
      ctx.textAlign = "center"; ctx.textBaseline = "middle";
      ctx.font = `700 ${Math.max(8, scale * 1.0)}px system-ui, sans-serif`;
      for (const [k, count] of shMap) {
        const { q, r } = parseKey(k);
        const p = axialToPixel({ q, r }, HEX);
        const sx = p.x * scale + ox, sy = -p.y * scale + oy;
        if (sx < -rad || sx > w + rad || sy < -rad || sy > h + rad) continue;
        ctx.fillStyle = "#ffb428";
        ctx.fillRect(sx - rad, sy - rad, rad * 2, rad * 2);
        ctx.lineWidth = Math.max(1, scale * 0.12); ctx.strokeStyle = "rgba(0,0,0,0.55)";
        ctx.strokeRect(sx - rad, sy - rad, rad * 2, rad * 2);
        if (scale > 3) { ctx.fillStyle = "#04121f"; ctx.fillText(String(count), sx, sy + 0.5); }
      }
    }

    // Ô KHỞI ĐỘNG người chơi (doc 35): vòng tròn xanh lá + cờ 🏁.
    const sz = startZoneRef.current;
    if (sz) {
      const { q, r } = parseKey(sz);
      const p = axialToPixel({ q, r }, HEX);
      const sx = p.x * scale + ox, sy = -p.y * scale + oy;
      const rad = Math.max(4, scale * 0.9);
      ctx.beginPath();
      ctx.arc(sx, sy, rad, 0, Math.PI * 2);
      ctx.fillStyle = "rgba(72,217,135,0.85)";
      ctx.fill();
      ctx.lineWidth = Math.max(1, scale * 0.14); ctx.strokeStyle = "rgba(0,0,0,0.55)"; ctx.stroke();
      if (scale > 3) {
        ctx.textAlign = "center"; ctx.textBaseline = "middle";
        ctx.font = `700 ${Math.max(8, scale * 1.1)}px system-ui, sans-serif`;
        ctx.fillStyle = "#04121f"; ctx.fillText("🏁", sx, sy + 0.5);
      }
    }

    // Ô đang hover (nếu hợp lệ).
    const hv = hover.current;
    if (hv && cells.valid.has(hexKey(hv.q, hv.r))) {
      const p = axialToPixel(hv, HEX);
      const sx = p.x * scale + ox, sy = -p.y * scale + oy;
      ctx.beginPath();
      ctx.moveTo(sx + CORNERS[0].dx * scale, sy + CORNERS[0].dy * scale);
      for (let i = 1; i < 6; i++) ctx.lineTo(sx + CORNERS[i].dx * scale, sy + CORNERS[i].dy * scale);
      ctx.closePath();
      ctx.fillStyle = "rgba(255,255,255,0.25)";
      ctx.fill();
    }

    // Công cụ BIÊN (doc 34 D): vẽ các BIÊN đã tạo (line) + polyline đang vẽ + đỉnh snap.
    const w2sx = (wx: number) => wx * scale + ox, w2sy = (wy: number) => -wy * scale + oy;
    const drawPolyline = (pts: [number, number][], color: string, dots: boolean) => {
      if (pts.length === 0) return;
      ctx.beginPath();
      ctx.moveTo(w2sx(pts[0][0]), w2sy(pts[0][1]));
      for (let i = 1; i < pts.length; i++) ctx.lineTo(w2sx(pts[i][0]), w2sy(pts[i][1]));
      ctx.strokeStyle = color; ctx.lineWidth = 2.5; ctx.stroke();
      if (dots) for (const p of pts) { ctx.beginPath(); ctx.arc(w2sx(p[0]), w2sy(p[1]), 3.5, 0, Math.PI * 2); ctx.fillStyle = color; ctx.fill(); }
    };
    for (const b of boundariesRef.current ?? []) drawPolyline(b.points, "#31d0ff", true); // biên đã tạo (xanh dương)
    // Nút biên ĐANG CHỌN: vòng đỏ to (chuột phải để chọn, Delete để xoá — doc 35).
    const selN = selNodeRef.current;
    if (selN) {
      const b = (boundariesRef.current ?? []).find((x) => x.id === selN.bid);
      const p = b?.points[selN.idx];
      if (p) {
        ctx.beginPath(); ctx.arc(w2sx(p[0]), w2sy(p[1]), 7, 0, Math.PI * 2);
        ctx.fillStyle = "#ff5a5a"; ctx.fill();
        ctx.lineWidth = 2; ctx.strokeStyle = "#fff"; ctx.stroke();
      }
    }
    const draft = draftRef.current;
    if (draft.length > 0) {
      const withCursor = snapRef.current ? [...draft, [snapRef.current.px, snapRef.current.py] as [number, number]] : draft;
      drawPolyline(withCursor, "#48d987", true); // đang vẽ (xanh lá)
    }
    // Đỉnh snap dưới con trỏ: stroke thường; FILL khi ĐANG HOVER đỉnh (doc 34 D).
    if (snapRef.current && tool === "boundary" && !readOnly) {
      const s = snapRef.current;
      ctx.beginPath();
      ctx.arc(w2sx(s.vx), w2sy(s.vy), 6, 0, Math.PI * 2);
      ctx.lineWidth = 2; ctx.strokeStyle = "#ffd23f";
      if (s.onVertex) { ctx.fillStyle = "#ffd23f"; ctx.fill(); } else ctx.stroke();
    }

    // THƯỚC KẺ XY (doc 35): crosshair BÁM CON TRỎ (không nhảy về tâm ô) để căn nét khi vẽ biên. Khi
    // công cụ BIÊN đang SNAP đỉnh hex, thước bám đúng ĐIỂM SẼ ĐẶT (snap) → đặt nút biên chính xác.
    const m = mouseRef.current;
    if (showRulerRef.current && m) {
      const sn = snapRef.current;
      // Điểm neo (screen) + toạ độ world tương ứng.
      let ax: number, ay: number, wx: number, wy: number;
      if (tool === "boundary" && sn) { wx = sn.px; wy = sn.py; ax = wx * scale + ox; ay = -wy * scale + oy; }
      else { ax = m.x; ay = m.y; wx = (m.x - ox) / scale; wy = (oy - m.y) / scale; }
      ctx.save();
      ctx.setLineDash([5, 4]);
      ctx.lineWidth = 1;
      ctx.strokeStyle = "rgba(255,210,63,0.75)";
      ctx.beginPath(); ctx.moveTo(ax, 0); ctx.lineTo(ax, h); ctx.stroke(); // dọc
      ctx.beginPath(); ctx.moveTo(0, ay); ctx.lineTo(w, ay); ctx.stroke(); // ngang
      ctx.setLineDash([]);
      const cell = pixelToAxial(wx, wy, HEX);
      const label = `x,y = ${wx.toFixed(2)}, ${wy.toFixed(2)}   ·   q,r = ${cell.q}, ${cell.r}`;
      ctx.font = "600 12px system-ui, sans-serif";
      ctx.textAlign = "left"; ctx.textBaseline = "middle";
      const tw = ctx.measureText(label).width;
      const lx = m.x + 14, ly = m.y - 14;
      ctx.fillStyle = "rgba(10,14,22,0.85)";
      ctx.fillRect(lx - 5, ly - 10, tw + 10, 20);
      ctx.fillStyle = "#ffd23f";
      ctx.fillText(label, lx, ly);
      ctx.restore();
    }
  }, [cells, tool, readOnly]);

  const scheduleDraw = useCallback(() => {
    if (!rafRef.current) rafRef.current = requestAnimationFrame(draw);
  }, [draw]);

  // Về mức 100% mặc định (căn giữa) — KHÔNG fit-toàn-sân ⇒ tránh dựng cả chục nghìn ô lúc load/đổi
  // bán kính (nguồn gây lag). Muốn thấy tối đa thì bấm "Toàn cảnh".
  const reset100 = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    view.current = { scale: SCALE_DEFAULT, ox: canvas.clientWidth / 2, oy: canvas.clientHeight / 2 };
    scheduleDraw();
  }, [scheduleDraw]);

  // Fit TOÀN SÂN (hiện tối đa) — nút "Toàn cảnh"; được phép xuống dưới SCALE_MIN.
  const fit = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const w = canvas.clientWidth, h = canvas.clientHeight;
    const halfX = (cells.arenaR * SQRT3) / 2 + HEX * 2; // nửa bề rộng world (đỉnh trái/phải)
    const halfY = cells.arenaR + HEX * 2;               // nửa chiều cao world
    const scale = Math.min(w / (2 * halfX), h / (2 * halfY)) * 0.94;
    view.current = { scale, ox: w / 2, oy: h / 2 };
    scheduleDraw();
  }, [cells, scheduleDraw]);

  // Về 100% khi đổi bán kính sân (thay cho fit-all cũ).
  useEffect(() => { reset100(); }, [cells, reset100]);

  // Vẽ lại + căn giữa 100% khi container đổi kích thước.
  useEffect(() => {
    const wrap = wrapRef.current;
    if (!wrap) return;
    const ro = new ResizeObserver(() => reset100());
    ro.observe(wrap);
    return () => ro.disconnect();
  }, [reset100]);

  useEffect(() => { scheduleDraw(); }, [obstacles, totems, strongholds, boundaries, startZone, showRuler, scheduleDraw]);

  useEffect(() => {
    onReady?.({ zoomBy: (f: number) => zoomAt(f), reset100, fit });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fit, reset100]);

  // --- Tương tác ---------------------------------------------------------------------------
  const screenToAxial = useCallback((sx: number, sy: number): Axial => {
    const { scale, ox, oy } = view.current;
    // Y màn hình LẬT so với world (khớp game 3D) → world y = (oy - sy)/scale.
    return pixelToAxial((sx - ox) / scale, (oy - sy) / scale, HEX);
  }, []);

  const screenToWorld = useCallback((sx: number, sy: number): { x: number; y: number } => {
    const { scale, ox, oy } = view.current;
    return { x: (sx - ox) / scale, y: (oy - sy) / scale };
  }, []);

  /** Tạo BIÊN từ polyline đang vẽ (≥2 điểm) → thêm vào danh sách, rồi reset draft (doc 34 D). */
  const commitBoundary = useCallback(() => {
    const draft = draftRef.current;
    if (draft.length >= 2 && onBoundariesChange) {
      const id = `b${Date.now().toString(36)}${Math.floor(Math.random() * 1e4).toString(36)}`;
      onBoundariesChange([...(boundariesRef.current ?? []), { id, points: draft.map((p) => [p[0], p[1]] as [number, number]) }]);
    }
    draftRef.current = [];
    scheduleDraw();
  }, [onBoundariesChange, scheduleDraw]);

  /** Bấm gần ĐIỂM CUỐI/ĐẦU một biên đã tạo ⇒ trả điểm (định hướng để đầu chọn nằm CUỐI) + list còn lại. */
  const pickBoundaryEndpoint = useCallback((wx: number, wy: number): { points: [number, number][]; rest: Array<{ id: string; points: [number, number][] }> } | null => {
    const list = boundariesRef.current ?? [];
    const thr = 12 / view.current.scale;
    for (let i = 0; i < list.length; i++) {
      const pts = list[i].points;
      if (pts.length < 1) continue;
      const rest = list.filter((_, j) => j !== i);
      const end = pts[pts.length - 1], start = pts[0];
      if (Math.hypot(end[0] - wx, end[1] - wy) <= thr) return { points: pts.map((p) => [p[0], p[1]] as [number, number]), rest };
      if (Math.hypot(start[0] - wx, start[1] - wy) <= thr) return { points: [...pts].reverse().map((p) => [p[0], p[1]] as [number, number]), rest };
    }
    return null;
  }, []);

  /** Nút biên GẦN NHẤT trong ngưỡng (mọi điểm, không chỉ đầu/cuối) — cho chọn-để-xoá (doc 35). */
  const pickBoundaryNode = useCallback((wx: number, wy: number): { bid: string; idx: number } | null => {
    const list = boundariesRef.current ?? [];
    const thr = 12 / view.current.scale;
    let best: { bid: string; idx: number } | null = null, bd = thr * thr;
    for (const b of list) {
      for (let i = 0; i < b.points.length; i++) {
        const dx = b.points[i][0] - wx, dy = b.points[i][1] - wy;
        const d = dx * dx + dy * dy;
        if (d <= bd) { bd = d; best = { bid: b.id, idx: i }; }
      }
    }
    return best;
  }, []);

  /** Xoá NÚT đang chọn khỏi biên của nó; biên còn <2 nút ⇒ xoá luôn cả biên (doc 35). */
  const deleteSelectedNode = useCallback(() => {
    const sel = selNodeRef.current;
    if (!sel || !onBoundariesChange) return;
    const next: Array<{ id: string; points: [number, number][] }> = [];
    for (const b of boundariesRef.current ?? []) {
      if (b.id !== sel.bid) { next.push(b); continue; }
      const pts = b.points.filter((_, i) => i !== sel.idx);
      if (pts.length >= 2) next.push({ id: b.id, points: pts });
    }
    selNodeRef.current = null;
    onBoundariesChange(next);
    scheduleDraw();
  }, [onBoundariesChange, scheduleDraw]);

  const zoomAt = useCallback((factor: number, mx?: number, my?: number) => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const cx = mx ?? canvas.clientWidth / 2, cy = my ?? canvas.clientHeight / 2;
    const v = view.current;
    const nScale = Math.max(SCALE_MIN, Math.min(SCALE_MAX, v.scale * factor));
    // Giữ điểm world dưới con trỏ cố định.
    v.ox = cx - ((cx - v.ox) / v.scale) * nScale;
    v.oy = cy - ((cy - v.oy) / v.scale) * nScale;
    v.scale = nScale;
    scheduleDraw();
  }, [scheduleDraw]);

  // Trạng thái kéo: pan hoặc paint.
  const drag = useRef<{ mode: "pan" | "paint"; erase: boolean; last: Axial | null; px: number; py: number } | null>(null);
  const spaceHeld = useRef(false);

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.code === "Space") spaceHeld.current = true;
      // Công cụ BIÊN: Esc huỷ draft + bỏ chọn; Enter TẠO biên; Delete xoá NÚT đang chọn; Backspace
      // xoá nút cuối draft (đang vẽ) HOẶC xoá nút đang chọn khi draft trống (doc 34 D + doc 35).
      if (e.key === "Escape") { draftRef.current = []; selNodeRef.current = null; scheduleDraw(); }
      else if (e.key === "Delete") { deleteSelectedNode(); }
      else if (e.key === "Backspace") {
        if (draftRef.current.length) { draftRef.current.pop(); scheduleDraw(); }
        else if (selNodeRef.current) deleteSelectedNode();
      }
      else if (e.key === "Enter") commitBoundary();
    };
    const onKeyUp = (e: KeyboardEvent) => { if (e.code === "Space") spaceHeld.current = false; };
    window.addEventListener("keydown", onKeyDown);
    window.addEventListener("keyup", onKeyUp);
    return () => { window.removeEventListener("keydown", onKeyDown); window.removeEventListener("keyup", onKeyUp); };
  }, [commitBoundary, deleteSelectedNode, scheduleDraw]);

  // Đổi công cụ khác BIÊN ⇒ huỷ polyline đang vẽ + bỏ chọn nút.
  useEffect(() => { if (tool !== "boundary") { draftRef.current = []; snapRef.current = null; selNodeRef.current = null; scheduleDraw(); } }, [tool, scheduleDraw]);

  /** Các ô trong cọ quanh tâm (q,r), lọc theo sân hợp lệ. */
  const brushCells = useCallback((center: Axial): HexKey[] => {
    const out: HexKey[] = [];
    for (let dq = -brush; dq <= brush; dq++)
      for (let dr = -brush; dr <= brush; dr++) {
        const a = { q: center.q + dq, r: center.r + dr };
        if (cubeDistance(center, a) > brush) continue;
        const k = hexKey(a.q, a.r);
        if (cells.valid.has(k)) out.push(k);
      }
    return out;
  }, [brush, cells]);

  const paintAt = useCallback((a: Axial, erase: boolean) => {
    if (!onPaint) return;
    const acc = new Set<HexKey>();
    for (const k of brushCells(a)) acc.add(k);
    if (acc.size) onPaint([...acc], erase);
  }, [onPaint, brushCells]);

  const onPointerDown = useCallback((e: React.PointerEvent) => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    try { canvas.setPointerCapture(e.pointerId); } catch { /* pointer capture optional */ }
    const rect = canvas.getBoundingClientRect();
    const mx = e.clientX - rect.left, my = e.clientY - rect.top;
    // CHUỘT PHẢI trên công cụ BIÊN: bấm vào 1 NÚT ⇒ CHỌN (để xoá bằng Delete); ngoài nút ⇒ pan (else).
    if (tool === "boundary" && e.button === 2 && !readOnly) {
      const w = screenToWorld(mx, my);
      const hit = pickBoundaryNode(w.x, w.y);
      if (hit) { selNodeRef.current = hit; scheduleDraw(); drag.current = null; return; }
      selNodeRef.current = null;
    }
    const actionButton = e.button === 0 && !readOnly && !spaceHeld.current;
    if (actionButton && tool === "boundary") {
      selNodeRef.current = null; // thao tác trái (vẽ/nối) ⇒ bỏ chọn nút
      // BIÊN (doc 34 D): hover đỉnh ⇒ snap đỉnh; ngoài đỉnh ⇒ vị trí chuột. Draft trống + bấm gần
      // điểm cuối/đầu biên đã tạo ⇒ nối tiếp biên đó.
      const w = screenToWorld(mx, my);
      const v = snapHexVertex(w.x, w.y);
      const onVertex = Math.hypot(v.x - w.x, v.y - w.y) <= 12 / view.current.scale;
      const pt: [number, number] = onVertex ? [v.x, v.y] : [w.x, w.y];
      const draft = draftRef.current;
      if (draft.length === 0) {
        const resume = pickBoundaryEndpoint(w.x, w.y);
        if (resume) { draftRef.current = resume.points; onBoundariesChange?.(resume.rest); scheduleDraw(); drag.current = null; return; }
      }
      draft.push(pt);
      scheduleDraw();
      drag.current = null;
    } else if (actionButton && tool === "totem" && onPlaceTotem) {
      // Đặt/gỡ totem: 1 ô/lần (không kéo-tô). Editor quyết định thêm loại hay gỡ.
      const a = screenToAxial(mx, my);
      if (cells.valid.has(hexKey(a.q, a.r))) onPlaceTotem(hexKey(a.q, a.r));
      drag.current = null;
    } else if (actionButton && tool === "stronghold" && onPlaceStronghold) {
      const a = screenToAxial(mx, my);
      if (cells.valid.has(hexKey(a.q, a.r))) onPlaceStronghold(hexKey(a.q, a.r));
      drag.current = null;
    } else if (actionButton && tool === "startzone" && onPlaceStartZone) {
      const a = screenToAxial(mx, my);
      if (cells.valid.has(hexKey(a.q, a.r))) onPlaceStartZone(hexKey(a.q, a.r));
      drag.current = null;
    } else if (actionButton && tool === "obstacle" && onPaint) {
      const a = screenToAxial(mx, my);
      const erase = e.altKey;
      drag.current = { mode: "paint", erase, last: a, px: mx, py: my };
      paintAt(a, erase);
    } else {
      drag.current = { mode: "pan", erase: false, last: null, px: mx, py: my };
    }
  }, [tool, onPaint, onPlaceTotem, onPlaceStronghold, onPlaceStartZone, onBoundariesChange, readOnly, screenToAxial, screenToWorld, pickBoundaryEndpoint, pickBoundaryNode, paintAt, cells]);

  const onPointerMove = useCallback((e: React.PointerEvent) => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const rect = canvas.getBoundingClientRect();
    const mx = e.clientX - rect.left, my = e.clientY - rect.top;
    mouseRef.current = { x: mx, y: my };
    hover.current = screenToAxial(mx, my);
    if (tool === "boundary" && !readOnly) {
      const w = screenToWorld(mx, my);
      const v = snapHexVertex(w.x, w.y);
      const snapDist = 12 / view.current.scale; // ngưỡng hover đỉnh (12px màn hình → world)
      const onVertex = Math.hypot(v.x - w.x, v.y - w.y) <= snapDist;
      // Hover đỉnh ⇒ điểm đặt = đỉnh (snap); ngoài đỉnh ⇒ điểm đặt = vị trí chuột (tự do).
      snapRef.current = { vx: v.x, vy: v.y, px: onVertex ? v.x : w.x, py: onVertex ? v.y : w.y, onVertex };
    } else snapRef.current = null;
    const d = drag.current;
    if (!d) { scheduleDraw(); return; }
    if (d.mode === "pan") {
      view.current.ox += mx - d.px;
      view.current.oy += my - d.py;
      d.px = mx; d.py = my;
      scheduleDraw();
    } else {
      const a = screenToAxial(mx, my);
      if (d.last && (a.q !== d.last.q || a.r !== d.last.r)) {
        // Vá các ô nhảy cóc giữa 2 lần move (chuột nhanh).
        for (const step of hexLinedraw(d.last, a)) paintAt(step, d.erase);
      } else {
        paintAt(a, d.erase);
      }
      d.last = a;
    }
  }, [tool, readOnly, screenToAxial, screenToWorld, scheduleDraw, paintAt]);

  const endDrag = useCallback((e: React.PointerEvent) => {
    const canvas = canvasRef.current;
    if (canvas?.hasPointerCapture(e.pointerId)) canvas.releasePointerCapture(e.pointerId);
    drag.current = null;
  }, []);

  const onWheel = useCallback((e: React.WheelEvent) => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const rect = canvas.getBoundingClientRect();
    zoomAt(e.deltaY < 0 ? 1.12 : 1 / 1.12, e.clientX - rect.left, e.clientY - rect.top);
  }, [zoomAt]);

  const cursor = readOnly ? "default" : onPaint ? "crosshair" : "grab";

  return (
    <div ref={wrapRef} style={{ position: "absolute", inset: 0, overflow: "hidden", background: "#0a0e16", touchAction: "none" }}>
      <canvas
        ref={canvasRef}
        style={{ display: "block", width: "100%", height: "100%", cursor }}
        onPointerDown={readOnly ? undefined : onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={endDrag}
        onPointerCancel={endDrag}
        onPointerLeave={() => { hover.current = null; mouseRef.current = null; scheduleDraw(); }}
        onWheel={onWheel}
        onContextMenu={(e) => e.preventDefault()}
      />
    </div>
  );
}
