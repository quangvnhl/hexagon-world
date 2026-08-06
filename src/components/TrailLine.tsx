"use client";

import { memo, useRef, useEffect } from "react";
import { useFrame } from "@react-three/fiber";
import * as THREE from "three";
import { GameState } from "@/game/state";

/** Vẽ đuôi bằng ỐNG 3D phát sáng (TubeGeometry) dựng lại mỗi frame từ
 *  game.trailPoints. Cách này hiển thị chắc chắn dưới camera perspective. */
export const TrailLine = memo(function TrailLine({
  game,
}: {
  game: GameState;
}) {
  const meshRef = useRef<THREE.Mesh>(null);
  const geomRef = useRef<THREE.TubeGeometry | null>(null);

  useEffect(() => {
    return () => geomRef.current?.dispose();
  }, []);

  useFrame(() => {
    const mesh = meshRef.current;
    if (!mesh) return;
    const pts = game.trailPoints;
    if (pts.length < 2) {
      mesh.visible = false;
      return;
    }
    mesh.visible = true;

    const v3 = pts.map((p) => new THREE.Vector3(p.x, p.y, 0.45));
    const curve = new THREE.CatmullRomCurve3(v3);
    const seg = Math.min(600, Math.max(8, pts.length * 2));
    const geo = new THREE.TubeGeometry(curve, seg, 0.18, 8, false);

    geomRef.current?.dispose();
    geomRef.current = geo;
    mesh.geometry = geo;
  });

  return (
    <mesh ref={meshRef} frustumCulled={false} visible={false}>
      <boxGeometry args={[0.001, 0.001, 0.001]} />
      <meshStandardMaterial
        color="#ffcf3f"
        emissive="#ffb02e"
        emissiveIntensity={0.8}
        roughness={0.4}
        metalness={0.1}
      />
    </mesh>
  );
});
