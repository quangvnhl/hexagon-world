"use client";

import { memo, useEffect, useMemo, useRef } from "react";
import * as THREE from "three";
import { GameState } from "@hexagon/shared";
import { CONFIG, COLORS } from "@hexagon/shared";
import { axialToPixel, parseKey } from "@hexagon/shared";

/**
 * BIÊN ẢO: không có tường hiển thị riêng; thay vào đó các ô lục giác NẰM NGOÀI vùng
 * chơi (map \ playable) được EXTRUDE lên thành lăng trụ, tạo vành ranh giới quanh sân.
 * Va chạm vẫn do `insideArena`/`clampInside` lo (độc lập với hiển thị này).
 */
export const BorderRim = memo(function BorderRim({
  game,
}: {
  game: GameState;
}) {
  const meshRef = useRef<THREE.InstancedMesh>(null);

  // Vị trí các ô ngoài vùng chơi (tính 1 lần).
  const outer = useMemo(() => {
    const arr: { x: number; y: number }[] = [];
    for (const k of game.map) {
      if (game.playable.has(k)) continue;
      const p = axialToPixel(parseKey(k), CONFIG.HEX_SIZE);
      arr.push({ x: p.x, y: p.y });
    }
    return arr;
  }, [game]);

  useEffect(() => {
    const mesh = meshRef.current;
    if (!mesh) return;
    const dummy = new THREE.Object3D();
    dummy.rotation.set(Math.PI / 2, 0, 0); // trục lăng trụ (mặc định Y) → dựng theo Z
    for (let i = 0; i < outer.length; i++) {
      dummy.position.set(outer[i].x, outer[i].y, CONFIG.WALL.HEIGHT / 2);
      dummy.updateMatrix();
      mesh.setMatrixAt(i, dummy.matrix);
    }
    mesh.count = outer.length;
    mesh.instanceMatrix.needsUpdate = true;
  }, [outer]);

  return (
    <instancedMesh
      ref={meshRef}
      args={[undefined, undefined, Math.max(1, outer.length)]}
      frustumCulled={false}
    >
      {/* Lăng trụ lục giác (cylinder 6 cạnh) cao bằng tường. */}
      <cylinderGeometry
        args={[CONFIG.HEX_SIZE, CONFIG.HEX_SIZE, CONFIG.WALL.HEIGHT, 6]}
      />
      <meshStandardMaterial
        color={COLORS.wall}
        emissive={COLORS.wallEdge}
        emissiveIntensity={0.2}
        metalness={0.2}
        roughness={0.7}
      />
    </instancedMesh>
  );
});
