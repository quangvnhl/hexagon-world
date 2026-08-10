"use client";

import { memo, useRef } from "react";
import { useFrame } from "@react-three/fiber";
import * as THREE from "three";
import { GameState } from "@hexagon/shared";
import { CONFIG } from "@hexagon/shared";

/** Cube 3D cho MỌI thực thể (người + bot), màu theo chủ; ẩn khi chết. */
export const PlayerCube = memo(function PlayerCube({
  game,
}: {
  game: GameState;
}) {
  const refs = useRef<(THREE.Group | null)[]>([]);

  useFrame(() => {
    for (let i = 0; i < game.players.length; i++) {
      const g = refs.current[i];
      const e = game.players[i];
      if (!g) continue;
      g.visible = e.alive;
      g.position.set(e.pos.x, e.pos.y, CONFIG.CUBE_SIZE / 2); // đáy cube chạm mặt sân
      g.rotation.z = e.heading;
    }
  });

  return (
    <>
      {game.players.map((e, i) => (
        <group
          key={e.id}
          ref={(el) => {
            refs.current[i] = el;
          }}
        >
          <mesh>
            <boxGeometry
              args={[CONFIG.CUBE_SIZE, CONFIG.CUBE_SIZE, CONFIG.CUBE_SIZE]}
            />
            <meshStandardMaterial
              color={e.color.cube}
              emissive={e.color.glow}
              emissiveIntensity={0.35}
              metalness={0.35}
              roughness={0.3}
            />
          </mesh>
        </group>
      ))}
    </>
  );
});
