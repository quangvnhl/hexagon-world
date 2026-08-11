"use client";

import { memo, useMemo } from "react";
import * as THREE from "three";
import { WALLS, WALL_R, WALL_LIMIT, CONFIG } from "@hexagon/shared";

/**
 * DEBUG COLLIDER: vẽ chính BIÊN VA CHẠM (không phải rim hiển thị) bằng STROKE VECTOR:
 *  - Đường viền lục giác nối 6 ĐỈNH collider (bán kính ngoại tiếp `ARENA_R`) — đây là
 *    ranh giới mà `clampInside` giữ đầu người chơi ở bên trong.
 *  - Ở giữa mỗi cạnh (cách tâm `ARENA_INRADIUS` dọc pháp tuyến) vẽ một mũi tên PHÁP
 *    TUYẾN hướng RA NGOÀI — chính là vector mà va chạm dùng để "kéo về / trượt dọc".
 * Nhờ vậy nhìn thấy rõ nơi đầu bị chặn, giải thích vì sao dừng/trượt sát biên.
 * Chỉ ĐỌC hằng số hình học sân (không phụ thuộc trạng thái game).
 */
export const ArenaCollider = memo(function ArenaCollider() {
  const { COLOR, Z, NORMALS, NORMAL_LEN } = CONFIG.DEBUG.ARENA_LINE;
  const color = useMemo(() => new THREE.Color(COLOR), [COLOR]);
  // WALL_R/WALL_LIMIT = biên VA CHẠM THẬT (đã co WALL_SCALE) → line vẽ ĐÚNG chỗ physics chặn.
  const R = WALL_R; // bán kính ngoại tiếp của viền collider (đỉnh)

  // Viền collider: LineLoop qua 6 đỉnh lục giác (flat-top) bán kính R, tự khép kín.
  const loop = useMemo(() => {
    const arr: number[] = [];
    for (let k = 0; k < 6; k++) {
      const a = k * (Math.PI / 3);
      arr.push(R * Math.cos(a), R * Math.sin(a), Z);
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute("position", new THREE.Float32BufferAttribute(arr, 3));
    const mat = new THREE.LineBasicMaterial({ color, toneMapped: false });
    const line = new THREE.LineLoop(geo, mat);
    line.frustumCulled = false;
    return line;
  }, [color, Z, R]);

  // Mũi tên pháp tuyến tại tâm mỗi cạnh (gốc nằm ĐÚNG trên tường va chạm = WALL_LIMIT).
  const normals = useMemo(
    () =>
      NORMALS
        ? WALLS.map((w) => {
            const bx = w.nx * WALL_LIMIT;
            const by = w.ny * WALL_LIMIT;
            return new THREE.ArrowHelper(
              new THREE.Vector3(w.nx, w.ny, 0),
              new THREE.Vector3(bx, by, Z),
              NORMAL_LEN,
              color,
              NORMAL_LEN * 0.33,
              NORMAL_LEN * 0.21
            );
          })
        : [],
    [color, Z, NORMALS, NORMAL_LEN]
  );

  return (
    <>
      {/* Viền collider — stroke vector khép kín. */}
      <primitive object={loop} />
      {/* Pháp tuyến 6 tường (hướng va chạm ra ngoài). */}
      {normals.map((a, i) => (
        <primitive key={i} object={a} />
      ))}
    </>
  );
});
