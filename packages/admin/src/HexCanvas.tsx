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
  key as hexKey,
  parseKey,
  CONFIG,
  type HexKey,
  type Axial,
} from "@hexagon/shared";

const SQRT3 = Math.sqrt(3);
const HEX = 1; // HEX_SIZE (= CONFIG.HEX_SIZE); world circumradius mỗi ô.

export interface HexCanvasHandle {
  zoomBy: (factor: number) => void;
  fit: () => void;
}

interface HexCanvasProps {
  radius: number;
  obstacles: Set<HexKey>;
  /** Tô (erase=false) hoặc xóa (erase=true) một tập ô hợp lệ. M2. */
  onPaint?: (cells: HexKey[], erase: boolean) => void;
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

export function HexCanvas({ radius, obstacles, onPaint, brush = 0, readOnly, onReady }: HexCanvasProps) {
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
  const hover = useRef<Axial | null>(null);
  const rafRef = useRef(0);

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
    // Cửa sổ world nhìn thấy (cull) — nới 1 ô để không hụt biên.
    const pad = HEX + 1;
    const wx0 = (-ox) / scale - pad, wx1 = (w - ox) / scale + pad;
    const wy0 = (-oy) / scale - pad, wy1 = (h - oy) / scale + pad;

    const base = new Path2D();
    const obs = new Path2D();
    const obstacleSet = obstaclesRef.current;
    for (const c of cells.centers) {
      if (c.cx < wx0 || c.cx > wx1 || c.cy < wy0 || c.cy > wy1) continue;
      const path = obstacleSet.has(c.k) ? obs : base;
      const sx = c.cx * scale + ox, sy = c.cy * scale + oy;
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

    // Ô đang hover (nếu hợp lệ).
    const hv = hover.current;
    if (hv && cells.valid.has(hexKey(hv.q, hv.r))) {
      const p = axialToPixel(hv, HEX);
      const sx = p.x * scale + ox, sy = p.y * scale + oy;
      ctx.beginPath();
      ctx.moveTo(sx + CORNERS[0].dx * scale, sy + CORNERS[0].dy * scale);
      for (let i = 1; i < 6; i++) ctx.lineTo(sx + CORNERS[i].dx * scale, sy + CORNERS[i].dy * scale);
      ctx.closePath();
      ctx.fillStyle = "rgba(255,255,255,0.25)";
      ctx.fill();
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

  useEffect(() => { scheduleDraw(); }, [obstacles, scheduleDraw]);

  useEffect(() => {
    onReady?.({ zoomBy: (f: number) => zoomAt(f), fit });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fit]);

  // --- Tương tác ---------------------------------------------------------------------------
  const screenToAxial = useCallback((sx: number, sy: number): Axial => {
    const { scale, ox, oy } = view.current;
    return pixelToAxial((sx - ox) / scale, (sy - oy) / scale, HEX);
  }, []);

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
    const onKeyDown = (e: KeyboardEvent) => { if (e.code === "Space") spaceHeld.current = true; };
    const onKeyUp = (e: KeyboardEvent) => { if (e.code === "Space") spaceHeld.current = false; };
    window.addEventListener("keydown", onKeyDown);
    window.addEventListener("keyup", onKeyUp);
    return () => { window.removeEventListener("keydown", onKeyDown); window.removeEventListener("keyup", onKeyUp); };
  }, []);

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
    canvas.setPointerCapture(e.pointerId);
    const rect = canvas.getBoundingClientRect();
    const mx = e.clientX - rect.left, my = e.clientY - rect.top;
    const paintButton = e.button === 0 && !!onPaint && !readOnly && !spaceHeld.current;
    if (paintButton) {
      const a = screenToAxial(mx, my);
      const erase = e.altKey;
      drag.current = { mode: "paint", erase, last: a, px: mx, py: my };
      paintAt(a, erase);
    } else {
      drag.current = { mode: "pan", erase: false, last: null, px: mx, py: my };
    }
  }, [onPaint, readOnly, screenToAxial, paintAt]);

  const onPointerMove = useCallback((e: React.PointerEvent) => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const rect = canvas.getBoundingClientRect();
    const mx = e.clientX - rect.left, my = e.clientY - rect.top;
    hover.current = screenToAxial(mx, my);
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
  }, [screenToAxial, scheduleDraw, paintAt]);

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
