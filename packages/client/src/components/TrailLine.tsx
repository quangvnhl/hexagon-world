"use client";

import { memo, useRef, useEffect } from "react";
import { useFrame } from "@react-three/fiber";
import * as THREE from "three";
import { GameState, Entity } from "@hexagon/shared";

/** Ống đuôi 3D phát sáng cho 1 thực thể; dựng lại mỗi frame từ entity.trailPoints. */
function EntityTrail({ entity }: { entity: Entity }) {
  const meshRef = useRef<THREE.Mesh>(null);
  const geomRef = useRef<THREE.TubeGeometry | null>(null);

  useEffect(() => {
    return () => geomRef.current?.dispose();
  }, []);

  useFrame(() => {
    const mesh = meshRef.current;
    if (!mesh) return;
    const pts = entity.trailPoints;
    if (pts.length < 2 || !entity.alive) {
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
        color={entity.color.cube}
        emissive={entity.color.glow}
        emissiveIntensity={0.85}
        roughness={0.4}
        metalness={0.1}
      />
    </mesh>
  );
}

/** Vẽ đuôi cho MỌI thực thể. */
export const TrailLine = memo(function TrailLine({
  game,
}: {
  game: GameState;
}) {
  return (
    <>
      {game.players.map((e) => (
        <EntityTrail key={e.id} entity={e} />
      ))}
    </>
  );
});
