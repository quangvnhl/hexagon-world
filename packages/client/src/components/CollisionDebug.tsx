"use client";

import { memo, useMemo } from "react";
import { useFrame } from "@react-three/fiber";
import * as THREE from "three";
import { GameState } from "@hexagon/shared";
import { CONFIG } from "@hexagon/shared";
import { WALLS, WALL_LIMIT } from "@hexagon/shared";

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
  entityId = 0,
}: {
  game: GameState;
  /** Thực thể cần vẽ vector (chơi đơn = 0; online = ghế người cục bộ). */
  entityId?: number;
}) {
  const dir = useMemo(() => new THREE.Vector3(), []);
  const origin = useMemo(() => new THREE.Vector3(), []);

  // COLLIDER của cube người chơi (stroke vector): vòng TRÒN bán kính
  // CONFIG.DEBUG.CUBE_COLLIDER_RADIUS + vòng TRÒN bán kính va chạm ĐẦU
  // (CONFIG.DEBUG.KILL_RING_RADIUS) — vùng phân xử va đầu trên/ngoài sân nhà.
  const makeRing = (radius: number, color: number) => {
    const seg = 40;
    const pos: number[] = [];
    for (let i = 0; i < seg; i++) {
      const a = (i / seg) * Math.PI * 2;
      pos.push(Math.cos(a) * radius, Math.sin(a) * radius, 0);
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3));
    const line = new THREE.LineLoop(
      geo,
      new THREE.LineBasicMaterial({ color, toneMapped: false })
    );
    line.frustumCulled = false;
    return line;
  };
  const cubeOutline = useMemo(
    () => makeRing(CONFIG.DEBUG.CUBE_COLLIDER_RADIUS, 0x8be9ff),
    []
  );
  const killCircle = useMemo(
    () => makeRing(CONFIG.DEBUG.KILL_RING_RADIUS, 0xffd23f),
    []
  );

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
    const e = game.players[entityId] ?? game.human;
    const z = CONFIG.CUBE_SIZE + 0.2;
    origin.set(e.pos.x, e.pos.y, z);
    const show = e.alive;

    // Collider cube: vòng tròn collider + vòng va chạm đầu, sát mặt sân.
    const cz = 0.32;
    cubeOutline.visible = show;
    killCircle.visible = show;
    if (show) {
      cubeOutline.position.set(e.pos.x, e.pos.y, cz);
      killCircle.position.set(e.pos.x, e.pos.y, cz);
    }

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
    const near = WALL_LIMIT - CONFIG.DEBUG.WALL_NEAR;
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
      <primitive object={cubeOutline} />
      <primitive object={killCircle} />
      <primitive object={velArrow} />
      <primitive object={slideArrow} />
      {wallArrows.map((a, i) => (
        <primitive key={i} object={a} />
      ))}
    </>
  );
});
