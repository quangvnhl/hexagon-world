"use client";

import { memo, useEffect, useMemo, useRef } from "react";
import { useFrame } from "@react-three/fiber";
import * as THREE from "three";
import { GameState } from "@/game/state";
import { CONFIG, COLORS } from "@/game/config";
import { axialToPixel, parseKey } from "@/game/hex";

/** Render toàn bộ lưới hex bằng 1 InstancedMesh; tô lại theo game.ownedRevision. */
export const HexGridView = memo(function HexGridView({
  game,
}: {
  game: GameState;
}) {
  const meshRef = useRef<THREE.InstancedMesh>(null);
  const lastRev = useRef(-1);

  // Danh sách ô cố định + toạ độ world (tính 1 lần).
  const cells = useMemo(() => {
    const arr: { key: string; x: number; y: number }[] = [];
    for (const k of game.map) {
      const a = parseKey(k);
      const p = axialToPixel(a, CONFIG.HEX_SIZE);
      arr.push({ key: k, x: p.x, y: p.y });
    }
    return arr;
  }, [game]);

  // Đặt ma trận vị trí (không đổi) 1 lần.
  useEffect(() => {
    const mesh = meshRef.current;
    if (!mesh) return;
    const dummy = new THREE.Object3D();
    for (let i = 0; i < cells.length; i++) {
      dummy.position.set(cells[i].x, cells[i].y, 0);
      dummy.updateMatrix();
      mesh.setMatrixAt(i, dummy.matrix);
    }
    mesh.instanceMatrix.needsUpdate = true;
    lastRev.current = -1; // buộc cập nhật màu lần đầu
  }, [cells]);

  // Tô lại lưới khi owned hoặc hex-đuôi thay đổi.
  useFrame(() => {
    const mesh = meshRef.current;
    if (!mesh) return;
    if (lastRev.current === game.gridRevision) return;
    lastRev.current = game.gridRevision;

    const c = new THREE.Color();
    for (let i = 0; i < cells.length; i++) {
      const k = cells[i].key;
      const rgb = game.owned.has(k)
        ? COLORS.owned
        : game.hasTrail(k)
        ? COLORS.trailCell
        : COLORS.neutral;
      c.setRGB(rgb[0], rgb[1], rgb[2]);
      mesh.setColorAt(i, c);
    }
    if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
  });

  return (
    <instancedMesh
      ref={meshRef}
      args={[undefined, undefined, cells.length]}
      frustumCulled={false}
    >
      <circleGeometry
        args={[CONFIG.HEX_SIZE * 0.92, 6, Math.PI / 6, Math.PI * 2]}
      />
      <meshBasicMaterial toneMapped={false} />
    </instancedMesh>
  );
});
