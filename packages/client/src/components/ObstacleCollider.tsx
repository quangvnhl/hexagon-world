"use client";

import { memo, useMemo } from "react";
import * as THREE from "three";
import { CONFIG } from "@hexagon/shared";
import type { GameState } from "@hexagon/shared";

/**
 * DEBUG COLLIDER: từ doc 34, ô CHƯỚNG NGẠI KHÔNG còn collider riêng — va chạm DUY NHẤT là tường
 * BIÊN admin vẽ (polyline). Component này chỉ vẽ các đường biên đó (màu xanh lá). Ô chướng ngại
 * giờ chỉ là barrier flood-fill + ô không chơi được, không sinh cạnh va chạm nào.
 */
export const ObstacleCollider = memo(function ObstacleCollider({ game }: { game: GameState }) {
  const { Z } = CONFIG.DEBUG.OBSTACLE_LINE;

  // Tường BIÊN admin vẽ (doc 34 D) — polyline world, màu xanh lá.
  const boundaryLine = useMemo(() => {
    const boundaries = game.config.map.boundaries ?? [];
    if (boundaries.length === 0) return null;
    const pts: number[] = [];
    for (const b of boundaries) {
      for (let i = 0; i + 1 < b.points.length; i++) {
        pts.push(b.points[i][0], b.points[i][1], Z + 0.05, b.points[i + 1][0], b.points[i + 1][1], Z + 0.05);
      }
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute("position", new THREE.Float32BufferAttribute(pts, 3));
    const segs = new THREE.LineSegments(geo, new THREE.LineBasicMaterial({ color: new THREE.Color("#48d987"), toneMapped: false }));
    segs.frustumCulled = false;
    return segs;
  }, [game.config.map.boundaries, Z]);

  if (!boundaryLine) return null;
  return <primitive object={boundaryLine} />;
});
