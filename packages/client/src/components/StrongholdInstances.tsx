"use client";

import { memo, useMemo, useRef } from "react";
import { useFrame } from "@react-three/fiber";
import * as THREE from "three";
import { axialToPixel, CONFIG } from "@hexagon/shared";
import type { GameState } from "@hexagon/shared";

const ACTIVE = new THREE.Color("#ffb428"); // cứ điểm còn hoạt động (vàng cam)
const CAPTURED = new THREE.Color("#78dc96"); // đã bị người chơi chiếm (xanh)

/** Marker CỨ ĐIỂM bot (doc 34 B): cột/cờ tại ô cứ điểm; đổi màu khi bị chiếm (đọc mỗi frame). */
export const StrongholdInstances = memo(function StrongholdInstances({ game }: { game: GameState }) {
  const strongholds = game.strongholds;
  const matRefs = useRef<(THREE.MeshStandardMaterial | null)[]>([]);

  const positions = useMemo(
    () => strongholds.map((s) => axialToPixel({ q: s.q, r: s.r }, CONFIG.HEX_SIZE)),
    [strongholds],
  );

  useFrame(() => {
    for (let i = 0; i < strongholds.length; i++) {
      const m = matRefs.current[i];
      if (!m) continue;
      const captured = game.capturedStrongholds.has(i);
      m.color.copy(captured ? CAPTURED : ACTIVE);
      m.emissive.copy(captured ? CAPTURED : ACTIVE);
    }
  });

  if (strongholds.length === 0) return null;
  return (
    <group>
      {positions.map((p, i) => (
        <mesh key={i} position={[p.x, p.y, 1.1]} rotation={[Math.PI / 2, 0, 0]}>
          <coneGeometry args={[0.6, 2.2, 6]} />
          <meshStandardMaterial ref={(m) => { matRefs.current[i] = m; }} emissiveIntensity={0.4} roughness={0.5} metalness={0.1} />
        </mesh>
      ))}
    </group>
  );
});
