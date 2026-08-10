"use client";

import { memo, useMemo } from "react";
import { useFrame } from "@react-three/fiber";
import * as THREE from "three";
import { GameState } from "@hexagon/shared";
import { CONFIG } from "@hexagon/shared";
import { WALLS, ARENA_INRADIUS } from "@hexagon/shared";

const MAX_WALLS = 3;

/**
 * DEBUG: vẽ VECTOR VẬT LÝ va chạm tường ngay tại đầu người chơi để "nhìn thấy" vì sao
 * chết khi đi lướt sát biên:
 *  - Xanh dương: hướng đi MONG MUỐN (theo heading).
 *  - Đỏ: pháp tuyến của (các) tường đang áp sát — lực đẩy vào trong.
 *  - Xanh lá: hướng TRƯỢT kết quả sau khi trừ thành phần đâm vào tường.
 * Chỉ ĐỌC GameState (không đưa logic game vào render). Bật/tắt ở
 * `CONFIG.DEBUG.COLLISION_VECTORS`; component chỉ được mount khi cờ bật.
 */
export const CollisionDebug = memo(function CollisionDebug({
  game,
}: {
  game: GameState;
}) {
  const dir = useMemo(() => new THREE.Vector3(), []);
  const origin = useMemo(() => new THREE.Vector3(), []);

  const velArrow = useMemo(
    () =>
      new THREE.ArrowHelper(
        new THREE.Vector3(1, 0, 0),
        new THREE.Vector3(),
        2.6,
        0x3fa9ff,
        0.7,
        0.45
      ),
    []
  );
  const slideArrow = useMemo(
    () =>
      new THREE.ArrowHelper(
        new THREE.Vector3(1, 0, 0),
        new THREE.Vector3(),
        2.6,
        0x4dff88,
        0.7,
        0.45
      ),
    []
  );
  const wallArrows = useMemo(
    () =>
      Array.from(
        { length: MAX_WALLS },
        () =>
          new THREE.ArrowHelper(
            new THREE.Vector3(1, 0, 0),
            new THREE.Vector3(),
            1.9,
            0xff4d4d,
            0.6,
            0.4
          )
      ),
    []
  );

  useFrame(() => {
    const e = game.human;
    const z = CONFIG.CUBE_SIZE + 0.2;
    origin.set(e.pos.x, e.pos.y, z);
    const show = e.alive;

    // Hướng mong muốn (heading).
    velArrow.visible = show;
    if (show) {
      velArrow.position.copy(origin);
      dir.set(Math.cos(e.heading), Math.sin(e.heading), 0);
      velArrow.setDirection(dir);
    }

    // Các tường đang áp sát (điều kiện giống trượt tường trong updateEntity, nới rộng
    // bằng WALL_NEAR để thấy vector sớm hơn), đồng thời trừ dần để ra hướng trượt.
    let vx = Math.cos(e.heading);
    let vy = Math.sin(e.heading);
    let wi = 0;
    const near = ARENA_INRADIUS - CONFIG.DEBUG.WALL_NEAR;
    for (const w of WALLS) {
      const d = e.pos.x * w.nx + e.pos.y * w.ny;
      const outward = vx * w.nx + vy * w.ny > 0;
      if (show && d >= near && outward && wi < MAX_WALLS) {
        const arr = wallArrows[wi++];
        arr.visible = true;
        arr.position.copy(origin);
        dir.set(w.nx, w.ny, 0);
        arr.setDirection(dir);
        const dp = vx * w.nx + vy * w.ny; // trừ thành phần đâm vào tường
        vx -= dp * w.nx;
        vy -= dp * w.ny;
      }
    }
    for (let k = wi; k < MAX_WALLS; k++) wallArrows[k].visible = false;

    // Hướng trượt kết quả (chỉ khi có tường đang chạm).
    const len = Math.hypot(vx, vy);
    const colliding = show && wi > 0 && len > 1e-4;
    slideArrow.visible = colliding;
    if (colliding) {
      slideArrow.position.copy(origin);
      dir.set(vx / len, vy / len, 0);
      slideArrow.setDirection(dir);
    }
  });

  return (
    <>
      <primitive object={velArrow} />
      <primitive object={slideArrow} />
      {wallArrows.map((a, i) => (
        <primitive key={i} object={a} />
      ))}
    </>
  );
});
