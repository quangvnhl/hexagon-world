"use client";

import { memo, useMemo } from "react";
import * as THREE from "three";
import { DIRECTIONS, axialToPixel, keyOf, parseKey, CONFIG } from "@hexagon/shared";
import type { GameState } from "@hexagon/shared";

/**
 * DEBUG COLLIDER cho CHƯỚNG NGẠI (doc 33): vẽ các CẠNH va chạm của ô obstacle = cạnh hex
 * GIÁP một ô KHÔNG-obstacle (mặt mà đầu người chơi trượt dọc). Cạnh giữa hai obstacle là
 * tường NỘI BỘ → bỏ (không phải mặt va chạm).
 *
 * Cạnh chung của 2 ô kề = đoạn qua trung điểm hai tâm, vuông góc đường nối tâm, dài = cạnh
 * hex (= hexSize với lục giác đều). Gom mọi cạnh vào 1 LineSegments cho nhẹ.
 * Chỉ ĐỌC `game.obstacles` + hình học (không phụ thuộc tick) → geometry tính một lần.
 */
export const ObstacleCollider = memo(function ObstacleCollider({ game }: { game: GameState }) {
  const { COLOR, Z } = CONFIG.DEBUG.OBSTACLE_LINE;
  const color = useMemo(() => new THREE.Color(COLOR), [COLOR]);
  const size = game.config.map.hexSize;
  const obstacles = game.obstacles;

  const line = useMemo(() => {
    const pts: number[] = [];
    const half = size / 2; // nửa cạnh hex (lục giác đều: cạnh = bán kính ngoại tiếp = size)
    for (const k of obstacles) {
      const cell = parseKey(k);
      const oc = axialToPixel(cell, size);
      for (const d of DIRECTIONS) {
        const nb = { q: cell.q + d.q, r: cell.r + d.r };
        if (obstacles.has(keyOf(nb))) continue; // cạnh giữa 2 obstacle → nội bộ, bỏ
        const nc = axialToPixel(nb, size);
        const mx = (oc.x + nc.x) / 2, my = (oc.y + nc.y) / 2;
        let dx = nc.x - oc.x, dy = nc.y - oc.y;
        const len = Math.hypot(dx, dy) || 1;
        dx /= len; dy /= len;
        const px = -dy, py = dx; // vuông góc = hướng cạnh
        pts.push(mx + px * half, my + py * half, Z, mx - px * half, my - py * half, Z);
      }
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute("position", new THREE.Float32BufferAttribute(pts, 3));
    const mat = new THREE.LineBasicMaterial({ color, toneMapped: false });
    const segs = new THREE.LineSegments(geo, mat);
    segs.frustumCulled = false;
    return segs;
  }, [obstacles, size, color, Z]);

  if (obstacles.size === 0) return null;
  return <primitive object={line} />;
});
