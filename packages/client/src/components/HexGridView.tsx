"use client";

import { memo, useEffect, useMemo, useRef } from "react";
import { useFrame } from "@react-three/fiber";
import * as THREE from "three";
import { GameState } from "@hexagon/shared";
import { CONFIG } from "@hexagon/shared";
import { axialToPixel, parseKey } from "@hexagon/shared";

/**
 * Render toàn bộ lưới hex bằng 1 InstancedMesh (mỗi ô playable = 1 instance) → ô trung
 * lập vẫn hiện dạng LỤC GIÁC. Ô để scale 0.92 nên khe hở giữa các ô để lộ nền tối =
 * lưới cell. Chỉ tô lại màu khi `gridRevision` đổi.
 *
 * Lưu ý quy mô: cách này instance MỌI ô playable → hợp với bản đồ vừa/nhỏ. Với bản đồ
 * cực lớn (hàng trăm nghìn ô) nên chuyển sang nền + chỉ instance ô đã tô.
 */
export const HexGridView = memo(function HexGridView({
  game,
}: {
  game: GameState;
}) {
  const meshRef = useRef<THREE.InstancedMesh>(null);
  const lastRev = useRef(-1);

  const cells = useMemo(() => {
    const arr: { key: string; x: number; y: number }[] = [];
    for (const k of game.playable) {
      const a = parseKey(k);
      const p = axialToPixel(a, CONFIG.HEX_SIZE);
      arr.push({ key: k, x: p.x, y: p.y });
    }
    return arr;
  }, [game]);

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
    lastRev.current = -1; // buộc tô màu lần đầu
  }, [cells]);

  useFrame(() => {
    const mesh = meshRef.current;
    if (!mesh) return;
    if (lastRev.current === game.gridRevision) return;
    lastRev.current = game.gridRevision;

    const c = new THREE.Color();
    for (let i = 0; i < cells.length; i++) {
      const rgb = game.cellColor(cells[i].key);
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
