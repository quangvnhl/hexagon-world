"use client";

import { memo, useRef } from "react";
import { useFrame } from "@react-three/fiber";
import * as THREE from "three";
import { GameState } from "@/game/state";

/** Nhân vật: cube 3D, quay (rotation.z) theo hướng đi; nghiêng nhẹ để lộ khối 3D
 *  dưới camera top-down. */
export const PlayerCube = memo(function PlayerCube({
  game,
}: {
  game: GameState;
}) {
  const group = useRef<THREE.Group>(null);

  useFrame(() => {
    const g = group.current;
    if (!g) return;
    g.position.set(game.pos.x, game.pos.y, 0.6);
    g.rotation.z = game.heading;
  });

  return (
    <group ref={group}>
      <mesh>
        <boxGeometry args={[1.15, 1.15, 1.15]} />
        <meshStandardMaterial
          color="#eef4ff"
          emissive="#2f8fe6"
          emissiveIntensity={0.35}
          metalness={0.35}
          roughness={0.3}
        />
      </mesh>
    </group>
  );
});
