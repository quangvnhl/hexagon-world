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

export type EditorTool = "obstacle" | "totem" | "boundary";

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
  fit: () => void;
}

interface HexCanvasProps {
  radius: number;
  obstacles: Set<HexKey>;
  /** Totem tác giả đã đặt (doc 32). Vẽ marker theo loại. */
  totems?: Map<HexKey, TotemKind>;
  /** Công cụ đang dùng: tô obstacle hay đặt totem. */
  tool?: EditorTool;
  /** Tô (erase=false) hoặc xóa (erase=true) một tập ô hợp lệ. M2. */
  onPaint?: (cells: HexKey[], erase: boolean) => void;
  /** Đặt/gỡ totem tại 1 ô (editor tự quyết định thêm loại đang chọn hay gỡ). */
  onPlaceTotem?: (cell: HexKey) => void;
  /** Đóng đa giác BIÊN (snap đỉnh hex) → tô các ô bên trong thành obstacle. */
  onFillPolygon?: (cells: HexKey[]) => void;
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

/** Điểm (x,y) có nằm trong đa giác `pts` (ray casting). */
function pointInPoly(x: number, y: number, pts: { x: number; y: number }[]): boolean {
  let inside = false;
  for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) {
    const xi = pts[i].x, yi = pts[i].y, xj = pts[j].x, yj = pts[j].y;
    if ((yi > y) !== (yj > y) && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}

export function HexCanvas({ radius, obstacles, totems, tool = "obstacle", onPaint, onPlaceTotem, onFillPolygon, brush = 0, readOnly, onReady }: HexCanvasProps) {
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
  const view = useRef({ scale: 4, ox: 0, oy: 0 });
  const obstaclesRef = useRef(obstacles);
  obstaclesRef.current = obstacles;
  const totemsRef = useRef(totems);
  totemsRef.current = totems;
  const hover = useRef<Axial | null>(null);
  const rafRef = useRef(0);
  // Công cụ BIÊN: đa giác đang vẽ (điểm world đã snap vào đỉnh hex) + đỉnh snap dưới con trỏ.
  const polyRef = useRef<{ x: number; y: number }[]>([]);
  const snapRef = useRef<{ x: number; y: number } | null>(null);

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

    // Công cụ BIÊN: đa giác đang vẽ (snap đỉnh hex) + đỉnh snap dưới con trỏ.
    const poly = polyRef.current;
    const w2s = (p: { x: number; y: number }): [number, number] => [p.x * scale + ox, -p.y * scale + oy];
    if (poly.length > 0) {
      ctx.beginPath();
      const [x0, y0] = w2s(poly[0]);
      ctx.moveTo(x0, y0);
      for (let i = 1; i < poly.length; i++) { const [x, y] = w2s(poly[i]); ctx.lineTo(x, y); }
      if (snapRef.current) { const [sx, sy] = w2s(snapRef.current); ctx.lineTo(sx, sy); } // đoạn tới con trỏ
      ctx.strokeStyle = "#48d987";
      ctx.lineWidth = 2;
      ctx.stroke();
      // Đỉnh đã đặt.
      for (const p of poly) { const [x, y] = w2s(p); ctx.beginPath(); ctx.arc(x, y, 4, 0, Math.PI * 2); ctx.fillStyle = "#48d987"; ctx.fill(); }
    }
    if (snapRef.current) {
      const [sx, sy] = w2s(snapRef.current);
      const near0 = poly.length >= 3 && Math.hypot(snapRef.current.x - poly[0].x, snapRef.current.y - poly[0].y) < 1e-6;
      ctx.beginPath();
      ctx.arc(sx, sy, near0 ? 8 : 5, 0, Math.PI * 2);
      ctx.strokeStyle = near0 ? "#ffd23f" : "#8ee7a8"; // vàng = sẽ ĐÓNG biên
      ctx.lineWidth = 2;
      ctx.stroke();
    }
  }, [cells]);

  const scheduleDraw = useCallback(() => {
    if (!rafRef.current) rafRef.current = requestAnimationFrame(draw);
  }, [draw]);

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

  // Fit lại khi đổi bán kính sân.
  useEffect(() => { fit(); }, [fit]);

  // Vẽ lại khi container đổi kích thước (draw() tự đồng bộ backing store + fit lại).
  useEffect(() => {
    const wrap = wrapRef.current;
    if (!wrap) return;
    const ro = new ResizeObserver(() => fit());
    ro.observe(wrap);
    return () => ro.disconnect();
  }, [fit]);

  useEffect(() => { scheduleDraw(); }, [obstacles, totems, scheduleDraw]);

  useEffect(() => {
    onReady?.({ zoomBy: (f: number) => zoomAt(f), fit });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fit]);

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

  /** Đóng đa giác biên: tô mọi ô hợp lệ có TÂM nằm trong đa giác thành obstacle, rồi reset. */
  const closePolygon = useCallback(() => {
    const poly = polyRef.current;
    if (poly.length >= 3 && onFillPolygon) {
      const inside: HexKey[] = [];
      for (const c of cells.centers) if (pointInPoly(c.cx, c.cy, poly)) inside.push(c.k);
      if (inside.length) onFillPolygon(inside);
    }
    polyRef.current = [];
    scheduleDraw();
  }, [cells, onFillPolygon, scheduleDraw]);

  const zoomAt = useCallback((factor: number, mx?: number, my?: number) => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const cx = mx ?? canvas.clientWidth / 2, cy = my ?? canvas.clientHeight / 2;
    const v = view.current;
    const nScale = Math.max(1, Math.min(60, v.scale * factor));
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
      // Công cụ BIÊN: Esc huỷ, Backspace xoá đỉnh cuối, Enter đóng biên.
      if (e.key === "Escape") { polyRef.current = []; scheduleDraw(); }
      else if (e.key === "Backspace" && polyRef.current.length) { polyRef.current.pop(); scheduleDraw(); }
      else if (e.key === "Enter") closePolygon();
    };
    const onKeyUp = (e: KeyboardEvent) => { if (e.code === "Space") spaceHeld.current = false; };
    window.addEventListener("keydown", onKeyDown);
    window.addEventListener("keyup", onKeyUp);
    return () => { window.removeEventListener("keydown", onKeyDown); window.removeEventListener("keyup", onKeyUp); };
  }, [closePolygon, scheduleDraw]);

  // Đổi công cụ khác BIÊN ⇒ huỷ đa giác đang vẽ.
  useEffect(() => { if (tool !== "boundary") { polyRef.current = []; snapRef.current = null; scheduleDraw(); } }, [tool, scheduleDraw]);

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
    const actionButton = e.button === 0 && !readOnly && !spaceHeld.current;
    if (actionButton && tool === "boundary") {
      // BIÊN: thêm đỉnh (đã snap đỉnh hex). Bấm lại vào đỉnh đầu (≥3 điểm) ⇒ ĐÓNG + tô ô trong.
      const v = snapHexVertex(screenToWorld(mx, my).x, screenToWorld(mx, my).y);
      const poly = polyRef.current;
      if (poly.length >= 3 && Math.hypot(v.x - poly[0].x, v.y - poly[0].y) < 1e-6) closePolygon();
      else { poly.push(v); scheduleDraw(); }
      drag.current = null;
    } else if (actionButton && tool === "totem" && onPlaceTotem) {
      // Đặt/gỡ totem: 1 ô/lần (không kéo-tô). Editor quyết định thêm loại hay gỡ.
      const a = screenToAxial(mx, my);
      if (cells.valid.has(hexKey(a.q, a.r))) onPlaceTotem(hexKey(a.q, a.r));
      drag.current = null;
    } else if (actionButton && tool === "obstacle" && onPaint) {
      const a = screenToAxial(mx, my);
      const erase = e.altKey;
      drag.current = { mode: "paint", erase, last: a, px: mx, py: my };
      paintAt(a, erase);
    } else {
      drag.current = { mode: "pan", erase: false, last: null, px: mx, py: my };
    }
  }, [tool, onPaint, onPlaceTotem, readOnly, screenToAxial, screenToWorld, closePolygon, paintAt, cells]);

  const onPointerMove = useCallback((e: React.PointerEvent) => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const rect = canvas.getBoundingClientRect();
    const mx = e.clientX - rect.left, my = e.clientY - rect.top;
    hover.current = screenToAxial(mx, my);
    if (tool === "boundary" && !readOnly) { const w = screenToWorld(mx, my); snapRef.current = snapHexVertex(w.x, w.y); }
    else snapRef.current = null;
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
        onPointerLeave={() => { hover.current = null; scheduleDraw(); }}
        onWheel={onWheel}
        onContextMenu={(e) => e.preventDefault()}
      />
    </div>
  );
}
