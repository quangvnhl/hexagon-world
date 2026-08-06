"use client";

import { useMemo, useRef, useState, useCallback } from "react";
import { Canvas, useFrame, useThree } from "@react-three/fiber";
import { PerspectiveCamera } from "@react-three/drei";
import * as THREE from "three";
import { GameState } from "@/game/state";
import { CONFIG } from "@/game/config";
import { HexGridView } from "./HexGridView";
import { PlayerCube } from "./PlayerCube";
import { TrailLine } from "./TrailLine";
import { HUD, Stats } from "./HUD";

interface PointerRef {
  x: number;
  y: number;
  w: number;
  h: number;
  active: boolean;
}

/** Vòng lặp: đọc chuột → hướng mong muốn, cập nhật game liên tục, bám camera. */
function GameLoop({
  game,
  pointer,
  onStats,
}: {
  game: GameState;
  pointer: React.MutableRefObject<PointerRef>;
  onStats: (s: Stats) => void;
}) {
  const camera = useThree((s) => s.camera);
  const statAcc = useRef(0);
  // Raycaster + mặt phẳng mặt đất (z=0) để quy đổi vị trí chuột → điểm world.
  const ray = useMemo(() => new THREE.Raycaster(), []);
  const groundPlane = useMemo(
    () => new THREE.Plane(new THREE.Vector3(0, 0, 1), 0),
    []
  );
  const hitPoint = useMemo(() => new THREE.Vector3(), []);
  const ndc = useMemo(() => new THREE.Vector2(), []);
  // Rotation camera KHOÁ cố định (chỉ pan, không xoay theo chuột/di chuyển).
  const camQuat = useMemo(() => {
    const [ox, oy, oz] = CONFIG.CAMERA.OFFSET;
    const dummy = new THREE.Object3D();
    dummy.position.set(ox, oy, oz);
    dummy.lookAt(0, 0, 0);
    return dummy.quaternion.clone();
  }, []);

  useFrame((_, dtRaw) => {
    const dt = Math.min(dtRaw, 0.05); // chống nhảy vọt khi tab bị đóng băng

    // Hướng mong muốn = góc từ đầu người chơi tới điểm con trỏ chiếu xuống mặt đất.
    const p = pointer.current;
    if (p.active) {
      ndc.set((p.x / p.w) * 2 - 1, -(p.y / p.h) * 2 + 1);
      ray.setFromCamera(ndc, camera);
      if (ray.ray.intersectPlane(groundPlane, hitPoint)) {
        const dx = hitPoint.x - game.pos.x;
        const dy = hitPoint.y - game.pos.y;
        if (Math.hypot(dx, dy) > 0.4) {
          game.setHeadingTarget(Math.atan2(dy, dx));
        }
      }
    }

    game.update(dt);

    // Camera perspective: rotation cố định, chỉ PAN (tịnh tiến) theo người chơi.
    const [ox, oy, oz] = CONFIG.CAMERA.OFFSET;
    const k = CONFIG.CAMERA.LERP;
    camera.quaternion.copy(camQuat);
    camera.position.x += (game.pos.x + ox - camera.position.x) * k;
    camera.position.y += (game.pos.y + oy - camera.position.y) * k;
    camera.position.z += (oz - camera.position.z) * k;

    statAcc.current += dt;
    if (statAcc.current >= 0.2) {
      statAcc.current = 0;
      onStats({
        pct: game.territoryPct(),
        king: game.isKing,
        deaths: game.deaths,
      });
    }
  });

  return null;
}

export default function GameScene() {
  const game = useMemo(() => new GameState(), []);
  const pointer = useRef<PointerRef>({ x: 0, y: 0, w: 1, h: 1, active: false });
  const [stats, setStats] = useState<Stats>({ pct: 0, king: false, deaths: 0 });

  const onStats = useCallback((s: Stats) => setStats(s), []);

  const handlePointer = useCallback((e: React.PointerEvent<HTMLDivElement>) => {
    const rect = e.currentTarget.getBoundingClientRect();
    pointer.current = {
      x: e.clientX - rect.left,
      y: e.clientY - rect.top,
      w: rect.width,
      h: rect.height,
      active: true,
    };
  }, []);

  return (
    <div
      onPointerMove={handlePointer}
      style={{
        position: "fixed",
        inset: 0,
        background: "#0a0e16",
        cursor: "crosshair",
        touchAction: "none",
      }}
    >
      <Canvas>
        <PerspectiveCamera
          makeDefault
          position={CONFIG.CAMERA.OFFSET}
          fov={CONFIG.CAMERA.FOV}
          near={0.1}
          far={1000}
        />
        <color attach="background" args={["#0a0e16"]} />
        <ambientLight intensity={0.8} />
        <directionalLight position={[4, 6, 12]} intensity={1.15} />

        <GameLoop game={game} pointer={pointer} onStats={onStats} />
        <HexGridView game={game} />
        <TrailLine game={game} />
        <PlayerCube game={game} />
      </Canvas>
      <HUD stats={stats} />
    </div>
  );
}
