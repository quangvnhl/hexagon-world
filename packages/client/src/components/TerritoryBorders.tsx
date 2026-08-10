"use client";

import { memo, useMemo, useRef } from "react";
import { useFrame } from "@react-three/fiber";
import * as THREE from "three";
import { GameState } from "@hexagon/shared";
import { CONFIG } from "@hexagon/shared";
import { parseKey, key, axialToPixel, DIRECTIONS } from "@hexagon/shared";

/**
 * VẠCH VÀNG ngăn cách hai ô ĐẤT **cùng màu nhưng khác chủ** (21 thực thể dùng lại 6 màu
 * nên hai người khác nhau có thể trùng màu và dính liền). Vẽ bằng các QUAD dày (không
 * phải line 1px) + màu vàng cộng dồn (additive) để nổi bật/​phát sáng.
 *
 * Dựng lại khi `gridRevision` đổi. Mỗi ô chỉ xét 3 hướng (0..2) để mỗi cạnh vẽ 1 lần.
 */
export const TerritoryBorders = memo(function TerritoryBorders({
  game,
}: {
  game: GameState;
}) {
  const geom = useMemo(() => new THREE.BufferGeometry(), []);
  const glowColor = useMemo(() => {
    const c = new THREE.Color(CONFIG.BORDER.COLOR);
    c.multiplyScalar(CONFIG.BORDER.GLOW); // > 1 → sáng rực (toneMapped=false + additive)
    return c;
  }, []);
  const lastRev = useRef(-1);

  useFrame(() => {
    if (lastRev.current === game.gridRevision) return;
    lastRev.current = game.gridRevision;

    const s = CONFIG.HEX_SIZE; // = bán kính ngoại tiếp = độ dài cạnh hex đều
    const half = s / 2; // nửa độ dài cạnh chung
    const w = CONFIG.BORDER.WIDTH / 2; // nửa bề rộng vạch
    const group = (id: number) => id % 6; // PLAYER_COLORS lặp mỗi 6
    const v: number[] = [];

    game.forEachOwned((k, oid) => {
      const a = parseKey(k);
      const pa = axialToPixel(a, s);
      for (let d = 0; d < 3; d++) {
        const bq = a.q + DIRECTIONS[d].q;
        const br = a.r + DIRECTIONS[d].r;
        const nid = game.cellOwnerId(key(bq, br));
        if (nid < 0 || nid === oid) continue; // trống hoặc cùng chủ → bỏ
        if (group(nid) !== group(oid)) continue; // khác màu → đã phân biệt được

        const pb = axialToPixel({ q: bq, r: br }, s);
        const mx = (pa.x + pb.x) / 2;
        const my = (pa.y + pb.y) / 2;
        // hướng nối 2 tâm (đơn vị) = pháp tuyến của cạnh chung
        let nx = pb.x - pa.x;
        let ny = pb.y - pa.y;
        const len = Math.hypot(nx, ny) || 1;
        nx /= len;
        ny /= len;
        // hướng dọc cạnh chung = vuông góc pháp tuyến
        const ex = -ny;
        const ey = nx;
        // 4 góc quad: (dọc cạnh ± half) × (dày ± w)
        const x1 = mx + ex * half,
          y1 = my + ey * half;
        const x2 = mx - ex * half,
          y2 = my - ey * half;
        const ox = nx * w,
          oy = ny * w;
        // 2 tam giác
        v.push(x1 + ox, y1 + oy, 0.06, x2 + ox, y2 + oy, 0.06, x2 - ox, y2 - oy, 0.06);
        v.push(x1 + ox, y1 + oy, 0.06, x2 - ox, y2 - oy, 0.06, x1 - ox, y1 - oy, 0.06);
      }
    });

    geom.setAttribute(
      "position",
      new THREE.BufferAttribute(new Float32Array(v), 3)
    );
    geom.setDrawRange(0, v.length / 3);
  });

  return (
    <mesh geometry={geom} frustumCulled={false}>
      <meshBasicMaterial
        color={glowColor}
        toneMapped={false}
        transparent
        depthWrite={false}
        side={THREE.DoubleSide}
        blending={THREE.AdditiveBlending}
      />
    </mesh>
  );
});
