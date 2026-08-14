"use client";

import { memo, useEffect, useRef } from "react";
import { GameState } from "@hexagon/shared";
import { CONFIG } from "@hexagon/shared";
import { parseKey, axialToPixel } from "@hexagon/shared";
import { ARENA_R, ARENA_INRADIUS } from "@hexagon/shared";
import type { WorldUiEntity } from "@hexagon/shared";
import type { TerritoryCell } from "@hexagon/shared";
import {
  visibleMiniMapData,
  type MiniMapEntityView,
} from "./minimapPrivacy";

export interface MiniMapPrivacyState {
  radarActive: boolean;
  territory: readonly TerritoryCell[];
  entities: readonly MiniMapEntityView[];
}

export interface MiniMapTotemState {
  id: number;
  kind: "speed" | "slow" | "radar";
  q: number;
  r: number;
  ownerId: number;
}

const SQRT3 = Math.sqrt(3);

const rgb = (c: readonly [number, number, number]) =>
  `rgb(${Math.round(c[0] * 255)},${Math.round(c[1] * 255)},${Math.round(
    c[2] * 255
  )})`;

/**
 * Bản đồ con (minimap) góc dưới-phải. Vẽ toàn sân thu nhỏ: lãnh thổ đã chiếm, đuôi
 * đang vẽ, và chấm người chơi kèm hướng. Đọc trực tiếp từ `GameState` (không đưa
 * logic vào đây). Lớp lãnh thổ/đuôi chỉ vẽ lại khi `gridRevision` đổi (cache
 * offscreen); toàn bộ minimap chỉ đồng bộ mỗi 200ms để không cạnh tranh CPU/GPU với scene 3D.
 */
export const MiniMap = memo(function MiniMap({
  game,
  localId = 0,
  territorySource,
  privacy,
  totems = [],
}: {
  game: GameState;
  /** Id thực thể người chơi cục bộ (0 khi chơi đơn; = playerId khi online). */
  localId?: number;
  /** Trạng thái toàn phòng nhịp thấp; không bị giới hạn bởi entity AoI của scene 3D. */
  entities?: readonly WorldUiEntity[];
  /** Full-map low-frequency stream; scene GameState may contain only territory AoI. */
  territorySource?: () => readonly TerritoryCell[];
  /** Privacy-filtered online stream. Turning Radar off recreates and clears canvas caches. */
  privacy?: MiniMapPrivacyState;
  /** Public objectives: always visible, independent of Radar privacy. */
  totems?: readonly MiniMapTotemState[];
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  // `entities` is retained for source compatibility only. Scoreboard entities no
  // longer carry coordinates; online spatial dots arrive through `privacy`.
  const privacyRef = useRef(privacy);
  privacyRef.current = privacy;
  const totemsRef = useRef(totems);
  totemsRef.current = totems;

  useEffect(() => {
    // Sân lục giác flat-top: rộng nhất = bán kính ngoại tiếp (trục x), cao nhất =
    // bán kính nội tiếp (trục y).
    const halfW = ARENA_R;
    const halfH = ARENA_INRADIUS;
    const mobile = window.matchMedia("(max-width: 620px), (pointer: coarse)").matches;
    const W = mobile ? 128 : 190;
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
      const mine: [number, number, 0 | 1][] = [];
      tctx.globalAlpha = 0.45;
      const drawCell = (q: number, r: number, oid: number, kind: 0 | 1 = 0) => {
        const p = axialToPixel({ q, r }, CONFIG.HEX_SIZE);
        const [px, py] = toPx(p.x, p.y);
        if (oid === localId) {
          mine.push([px, py, kind]);
          return;
        }
        const palette = game.players[oid]?.color;
        const color = kind === 1 ? palette?.trail : palette?.owned;
        if (!color) return;
        tctx.fillStyle = rgb(color);
        tctx.fillRect(px - cellW / 2, py - cellH / 2, cellW, cellH);
      };
      const privateData = privacyRef.current
        ? visibleMiniMapData({ localId, ...privacyRef.current })
        : null;
      const sourceCells = privateData?.territory ?? territorySource?.();
      if (sourceCells) {
        for (const cell of sourceCells) {
          drawCell(cell.q, cell.r, cell.owner, cell.kind);
        }
      } else {
        game.forEachOwned((k, oid) => {
          const cell = parseKey(k);
          drawCell(cell.q, cell.r, oid);
        });
      }
      // Ô của NGƯỜI CHƠI: đậm, hơi to hơn để rõ.
      tctx.globalAlpha = 1;
      const mineColor = rgb(game.players[localId].color.owned);
      const mw = cellW * 1.25;
      const mh = cellH * 1.25;
      for (const [px, py, kind] of mine) {
        tctx.fillStyle = kind === 1
          ? rgb(game.players[localId].color.trail)
          : mineColor;
        tctx.fillRect(px - mw / 2, py - mh / 2, mw, mh);
      }
      tctx.globalAlpha = 1;
    };

    let lastGrid = -1;
    let timer = 0;
    const render = () => {
      if (privacyRef.current || territorySource || game.gridRevision !== lastGrid) {
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

      // Totems are public navigation targets. Radar only controls visibility of
      // other players, territory and trails; it never hides Totem locations.
      for (const totem of totemsRef.current) {
        const point = axialToPixel(totem, CONFIG.HEX_SIZE);
        const [px, py] = toPx(point.x, point.y);
        const size = 4.2 * dpr;

        ctx.save();
        ctx.translate(px, py);
        ctx.fillStyle = "rgba(8,12,20,0.88)";
        ctx.lineWidth = (totem.ownerId === localId ? 1.8 : 1.35) * dpr;

        if (totem.kind === "speed") {
          ctx.rotate(Math.PI / 4);
          ctx.fillRect(-size, -size, size * 2, size * 2);
          ctx.strokeStyle = "#ffd23f";
          ctx.strokeRect(-size, -size, size * 2, size * 2);
        } else if (totem.kind === "slow") {
          ctx.beginPath();
          ctx.rect(-size, -size, size * 2, size * 2);
          ctx.fill();
          ctx.strokeStyle = "#58a6ff";
          ctx.stroke();
        } else {
          ctx.beginPath();
          ctx.arc(0, 0, size, 0, Math.PI * 2);
          ctx.fill();
          ctx.strokeStyle = "#c77dff";
          ctx.stroke();
          ctx.beginPath();
          ctx.arc(0, 0, size * 0.42, 0, Math.PI * 2);
          ctx.stroke();
        }
        ctx.restore();
      }

      // Chấm cho mọi thực thể còn sống (người chơi nổi bật hơn: viền trắng + to hơn).
      const privateData = privacyRef.current
        ? visibleMiniMapData({ localId, ...privacyRef.current })
        : null;
      const dots = privateData?.entities ?? game.players;
      for (const e of dots) {
        if (!e.alive) continue;
        const wx = "pos" in e ? e.pos.x : e.x;
        const wy = "pos" in e ? e.pos.y : e.y;
        const [px, py] = toPx(wx, wy);
        const human = e.id === localId;
        const r = (human ? 3.5 : 2.6) * dpr;
        const color = game.players[e.id]?.color.owned;
        ctx.fillStyle = human ? "#ffffff" : color ? rgb(color) : "#ffffff";
        ctx.beginPath();
        ctx.arc(px, py, r, 0, Math.PI * 2);
        ctx.fill();
        ctx.strokeStyle = human ? "#1a2233" : "rgba(0,0,0,0.5)";
        ctx.lineWidth = 1 * dpr;
        ctx.stroke();
      }

    };
    render();
    timer = window.setInterval(render, 200);
    return () => window.clearInterval(timer);
  }, [game, localId, territorySource, privacy?.radarActive]);

  return (
    <div
      style={{
        position: "absolute",
        right: "max(10px, env(safe-area-inset-right))",
        bottom: "max(10px, env(safe-area-inset-bottom))",
        pointerEvents: "none",
      }}
    >
      {/* Bỏ nhãn "BẢN ĐỒ" và khung viền — chỉ còn canvas (tự vẽ nền + viền lục giác sân). */}
      <canvas ref={canvasRef} style={{ display: "block" }} />
    </div>
  );
});
