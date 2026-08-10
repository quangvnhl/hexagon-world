"use client";

import { memo, useEffect, useRef } from "react";
import { GameState } from "@hexagon/shared";
import { CONFIG } from "@hexagon/shared";
import { parseKey, axialToPixel } from "@hexagon/shared";
import { ARENA_R, ARENA_INRADIUS } from "@hexagon/shared";

const SQRT3 = Math.sqrt(3);

const rgb = (c: readonly [number, number, number]) =>
  `rgb(${Math.round(c[0] * 255)},${Math.round(c[1] * 255)},${Math.round(
    c[2] * 255
  )})`;

/**
 * Bản đồ con (minimap) góc dưới-phải. Vẽ toàn sân thu nhỏ: lãnh thổ đã chiếm, đuôi
 * đang vẽ, và chấm người chơi kèm hướng. Đọc trực tiếp từ `GameState` (không đưa
 * logic vào đây). Lớp lãnh thổ/đuôi chỉ vẽ lại khi `gridRevision` đổi (cache
 * offscreen); chấm người chơi vẽ mỗi frame cho mượt.
 */
export const MiniMap = memo(function MiniMap({
  game,
  localId = 0,
}: {
  game: GameState;
  /** Id thực thể người chơi cục bộ (0 khi chơi đơn; = playerId khi online). */
  localId?: number;
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    // Sân lục giác flat-top: rộng nhất = bán kính ngoại tiếp (trục x), cao nhất =
    // bán kính nội tiếp (trục y).
    const halfW = ARENA_R;
    const halfH = ARENA_INRADIUS;
    const W = 190;
    const H = Math.round((W * halfH) / halfW);
    const dpr = Math.min(window.devicePixelRatio || 1, 2);

    const canvas = canvasRef.current;
    if (!canvas) return;
    canvas.width = W * dpr;
    canvas.height = H * dpr;
    canvas.style.width = W + "px";
    canvas.style.height = H + "px";
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    // Canvas ngoài màn hình giữ lớp lãnh thổ + đuôi (chỉ vẽ lại khi gridRevision đổi).
    const terr = document.createElement("canvas");
    terr.width = W * dpr;
    terr.height = H * dpr;
    const tctx = terr.getContext("2d");
    if (!tctx) return;

    const sx = (W * dpr) / (2 * halfW);
    const sy = (H * dpr) / (2 * halfH);
    // world → pixel minimap; lật trục y để +Y hướng LÊN như nhìn từ trên xuống.
    const toPx = (wx: number, wy: number): [number, number] => [
      (wx + halfW) * sx,
      (halfH - wy) * sy,
    ];
    const cellW = SQRT3 * sx * 1.15;
    const cellH = 1.5 * sy * 1.15;

    // Tô lãnh thổ theo màu chủ sở hữu. CHỈ duyệt ô đã chiếm (forEachOwned) — O(owned),
    // không quét toàn bản đồ, để chịu được map cực lớn.
    const drawTerritory = () => {
      tctx.clearRect(0, 0, terr.width, terr.height);
      // Đối thủ vẽ MỜ HƠN (alpha thấp) trước; đất người chơi vẽ ĐÈ LÊN, đậm + to hơn
      // + viền sáng để NỔI BẬT rõ ràng so với đối thủ.
      const mine: [number, number][] = [];
      tctx.globalAlpha = 0.45;
      game.forEachOwned((k, oid) => {
        const p = axialToPixel(parseKey(k), CONFIG.HEX_SIZE);
        const [px, py] = toPx(p.x, p.y);
        if (oid === localId) {
          mine.push([px, py]);
          return;
        }
        tctx.fillStyle = rgb(game.players[oid].color.owned);
        tctx.fillRect(px - cellW / 2, py - cellH / 2, cellW, cellH);
      });
      // Ô của NGƯỜI CHƠI: đậm, hơi to hơn để rõ.
      tctx.globalAlpha = 1;
      const mineColor = rgb(game.players[localId].color.owned);
      const mw = cellW * 1.25;
      const mh = cellH * 1.25;
      for (const [px, py] of mine) {
        tctx.fillStyle = mineColor;
        tctx.fillRect(px - mw / 2, py - mh / 2, mw, mh);
      }
      tctx.globalAlpha = 1;
    };

    let lastGrid = -1;
    let raf = 0;
    const render = () => {
      if (game.gridRevision !== lastGrid) {
        lastGrid = game.gridRevision;
        drawTerritory();
      }

      ctx.clearRect(0, 0, canvas.width, canvas.height);

      // Đường lục giác của sân (flat-top: đỉnh tại 0°,60°,…,300°).
      const hexPath = () => {
        ctx.beginPath();
        for (let k = 0; k < 6; k++) {
          const a = (k * Math.PI) / 3;
          const [vx, vy] = toPx(Math.cos(a) * ARENA_R, Math.sin(a) * ARENA_R);
          if (k === 0) ctx.moveTo(vx, vy);
          else ctx.lineTo(vx, vy);
        }
        ctx.closePath();
      };

      // Nền + lãnh thổ được CẮT theo hình lục giác (không còn khung chữ nhật).
      ctx.save();
      hexPath();
      ctx.clip();
      ctx.fillStyle = "rgba(12,16,24,0.82)";
      ctx.fillRect(0, 0, canvas.width, canvas.height);
      ctx.drawImage(terr, 0, 0);
      ctx.restore();

      // Viền lục giác mảnh (đường bao sân, không phải khung hộp).
      hexPath();
      ctx.strokeStyle = "rgba(120,140,180,0.5)";
      ctx.lineWidth = 1 * dpr;
      ctx.stroke();

      // Chấm cho mọi thực thể còn sống (người chơi nổi bật hơn: viền trắng + to hơn).
      for (const e of game.players) {
        if (!e.alive) continue;
        const [px, py] = toPx(e.pos.x, e.pos.y);
        const human = e.id === localId;
        const r = (human ? 3.5 : 2.6) * dpr;
        ctx.fillStyle = human ? "#ffffff" : rgb(e.color.owned);
        ctx.beginPath();
        ctx.arc(px, py, r, 0, Math.PI * 2);
        ctx.fill();
        ctx.strokeStyle = human ? "#1a2233" : "rgba(0,0,0,0.5)";
        ctx.lineWidth = 1 * dpr;
        ctx.stroke();
      }

      raf = requestAnimationFrame(render);
    };
    raf = requestAnimationFrame(render);
    return () => cancelAnimationFrame(raf);
  }, [game, localId]);

  return (
    <div
      style={{
        position: "absolute",
        right: 16,
        bottom: 16,
        pointerEvents: "none",
      }}
    >
      {/* Bỏ nhãn "BẢN ĐỒ" và khung viền — chỉ còn canvas (tự vẽ nền + viền lục giác sân). */}
      <canvas ref={canvasRef} style={{ display: "block" }} />
    </div>
  );
});
