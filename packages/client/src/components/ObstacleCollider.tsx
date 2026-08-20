"use client";

import { memo, useMemo } from "react";
import * as THREE from "three";
import { DIRECTIONS, axialToPixel, keyOf, parseKey, CONFIG } from "@hexagon/shared";
import type { GameState } from "@hexagon/shared";

/**
 * DEBUG COLLIDER cho CHƯỚNG NGẠI (doc 33). Vẽ ĐÚNG hình collider đang dùng theo
 * `config.map.colliderShape`:
 *  - `"rect"` (mặc định): HỘP CHỮ NHẬT (AABB) bao trọn mỗi ô lục — 4 cạnh/ô.
 *  - `"hex"`: các CẠNH hex giáp ô KHÔNG-obstacle (mặt va chạm hex).
 * Gom mọi cạnh vào 1 LineSegments cho nhẹ. Chỉ ĐỌC `game.obstacles` + hình học.
 */
export const ObstacleCollider = memo(function ObstacleCollider({ game }: { game: GameState }) {
  const { COLOR, Z } = CONFIG.DEBUG.OBSTACLE_LINE;
  const color = useMemo(() => new THREE.Color(COLOR), [COLOR]);
  const size = game.config.map.hexSize;
  const shape = game.config.map.colliderShape;
  const obstacles = game.obstacles;

  const line = useMemo(() => {
    const pts: number[] = [];
    if (shape === "hex") {
      const half = size / 2; // nửa cạnh hex
      for (const k of obstacles) {
        const cell = parseKey(k);
        const oc = axialToPixel(cell, size);
        for (const d of DIRECTIONS) {
          const nb = { q: cell.q + d.q, r: cell.r + d.r };
          if (obstacles.has(keyOf(nb))) continue; // cạnh giữa 2 obstacle → nội bộ
          const nc = axialToPixel(nb, size);
          const mx = (oc.x + nc.x) / 2, my = (oc.y + nc.y) / 2;
          let dx = nc.x - oc.x, dy = nc.y - oc.y;
          const len = Math.hypot(dx, dy) || 1;
          dx /= len; dy /= len;
          const px = -dy, py = dx;
          pts.push(mx + px * half, my + py * half, Z, mx - px * half, my - py * half, Z);
        }
      }
    } else {
      // RECT/AABB: hộp chữ nhật bao trọn ô (nửa rộng √3/2·size, nửa cao size), 4 cạnh/ô.
      const hw = (Math.sqrt(3) / 2) * size, hh = size;
      for (const k of obstacles) {
        const c = axialToPixel(parseKey(k), size);
        const x0 = c.x - hw, x1 = c.x + hw, y0 = c.y - hh, y1 = c.y + hh;
        pts.push(
          x0, y0, Z, x1, y0, Z, // dưới
          x1, y0, Z, x1, y1, Z, // phải
          x1, y1, Z, x0, y1, Z, // trên
          x0, y1, Z, x0, y0, Z, // trái
        );
      }
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute("position", new THREE.Float32BufferAttribute(pts, 3));
    const mat = new THREE.LineBasicMaterial({ color, toneMapped: false });
    const segs = new THREE.LineSegments(geo, mat);
    segs.frustumCulled = false;
    return segs;
  }, [obstacles, size, shape, color, Z]);

  if (obstacles.size === 0) return null;
  return <primitive object={line} />;
});
