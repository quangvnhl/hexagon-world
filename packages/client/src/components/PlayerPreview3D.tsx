"use client";

import { Suspense, useEffect, useMemo, useRef } from "react";
import { Canvas, useFrame } from "@react-three/fiber";
import { useGLTF } from "@react-three/drei";
import * as THREE from "three";
import type { PlayerShape, TrailPattern } from "@hexagon/shared";

const MODEL_URLS = {
  fly: "/models/low_poly_house_fly_diptera.glb",
  bee: "/models/bee.glb",
  ladybug: "/models/ladybug.glb",
} as const satisfies Partial<Record<PlayerShape, string>>;

type ModelShape = keyof typeof MODEL_URLS;

function PreviewModel({ shape, color }: { shape: ModelShape; color: string }) {
  const { scene } = useGLTF(MODEL_URLS[shape]);
  const model = useMemo(() => {
    const clone = scene.clone(true);
    clone.traverse((object) => {
      if (!(object instanceof THREE.Mesh)) return;
      const source = Array.isArray(object.material) ? object.material : [object.material];
      const materials = source.map((material) => {
        const next = material.clone();
        if ("color" in next && next.color instanceof THREE.Color) {
          next.color.lerp(new THREE.Color(color), 0.58);
        }
        if (next instanceof THREE.MeshStandardMaterial) {
          next.emissive.set(color);
          next.emissiveIntensity = 0.12;
        }
        return next;
      });
      object.material = Array.isArray(object.material) ? materials : materials[0];
    });

    clone.rotation.x = Math.PI / 2;
    clone.updateMatrixWorld(true);
    const box = new THREE.Box3().setFromObject(clone);
    const size = box.getSize(new THREE.Vector3());
    clone.scale.setScalar(1.45 / (Math.max(size.x, size.y, size.z) || 1));
    clone.updateMatrixWorld(true);
    const fitted = new THREE.Box3().setFromObject(clone);
    const center = fitted.getCenter(new THREE.Vector3());
    clone.position.set(-center.x, -center.y, -fitted.min.z - 0.35);
    return clone;
  }, [scene, color]);

  useEffect(
    () => () => {
      model.traverse((object) => {
        if (!(object instanceof THREE.Mesh)) return;
        const materials = Array.isArray(object.material) ? object.material : [object.material];
        materials.forEach((material) => material.dispose());
      });
    },
    [model]
  );

  return <primitive object={model} />;
}

function PreviewShape({ shape, color }: { shape: PlayerShape; color: string }) {
  if (shape in MODEL_URLS) {
    return <PreviewModel shape={shape as ModelShape} color={color} />;
  }

  const material = (
    <meshStandardMaterial
      color={color}
      emissive={color}
      emissiveIntensity={0.28}
      metalness={0.3}
      roughness={0.28}
    />
  );
  if (shape === "sphere")
    return (
      <mesh>
        <sphereGeometry args={[0.58, 24, 18]} />
        {material}
      </mesh>
    );
  if (shape === "cylinder")
    return (
      <mesh rotation={[Math.PI / 2, 0, 0]}>
        <cylinderGeometry args={[0.5, 0.5, 1.05, 20]} />
        {material}
      </mesh>
    );
  if (shape === "cone")
    return (
      <mesh rotation={[Math.PI / 2, 0, 0]}>
        <coneGeometry args={[0.62, 1.15, 18]} />
        {material}
      </mesh>
    );
  return (
    <mesh>
      <boxGeometry args={[1, 1, 1]} />
      {material}
    </mesh>
  );
}

function TrailDot({
  index,
  pattern,
  color,
}: {
  index: number;
  pattern: TrailPattern;
  color: string;
}) {
  const faded = 1 - index / 20;
  const visible =
    pattern === "dots"
      ? index % 2 === 0
      : pattern === "stripes"
        ? index % 4 !== 2
        : true;
  const scale = pattern === "chevrons" && index % 2 ? 0.55 : 1;
  return (
    <mesh scale={[scale, scale, scale]} visible={visible}>
      {pattern === "solid" ? (
        <sphereGeometry args={[0.16, 10, 8]} />
      ) : pattern === "chevrons" ? (
        <coneGeometry args={[0.2, 0.42, 3]} />
      ) : (
        <boxGeometry args={[0.28, 0.14, 0.12]} />
      )}
      <meshBasicMaterial color={color} transparent opacity={0.2 + faded * 0.72} />
    </mesh>
  );
}

function AnimatedPreview({
  shape,
  color,
  pattern,
}: {
  shape: PlayerShape;
  color: string;
  pattern: TrailPattern;
}) {
  const mover = useRef<THREE.Group>(null);
  const trail = useRef<THREE.Group>(null);
  const points = useRef(
    Array.from({ length: 20 }, () => new THREE.Vector3(-4, 0, 0.18))
  );
  const lastSample = useRef(0);

  useFrame(({ clock }) => {
    const t = clock.elapsedTime;
    const x = THREE.MathUtils.pingpong(t * 1.25, 6.8) - 3.4;
    const direction = Math.floor((t * 1.25) / 6.8) % 2 === 0 ? 1 : -1;
    const y = Math.sin(x * 1.55) * 0.72;
    if (mover.current) {
      mover.current.position.set(x, y, 0.55);
      mover.current.rotation.z = Math.atan2(
        Math.cos(x * 1.55) * 1.12,
        direction
      );
      mover.current.position.z += Math.sin(t * 5) * 0.05;
    }
    if (t - lastSample.current > 0.045) {
      lastSample.current = t;
      points.current.pop();
      points.current.unshift(new THREE.Vector3(x, y, 0.22));
    }
    if (trail.current) {
      trail.current.children.forEach((child, index) => {
        child.position.copy(points.current[index]);
        if (index > 0) {
          const previous = points.current[index - 1];
          child.rotation.z = Math.atan2(previous.y - child.position.y, previous.x - child.position.x);
        }
      });
    }
  });

  return (
    <>
      <group ref={trail}>
        {points.current.map((_, index) => (
          <TrailDot key={index} index={index} pattern={pattern} color={color} />
        ))}
      </group>
      <group ref={mover}>
        <Suspense fallback={null}>
          <PreviewShape shape={shape} color={color} />
        </Suspense>
      </group>
    </>
  );
}

export function PlayerPreview3D({
  shape,
  color,
  pattern,
}: {
  shape: PlayerShape;
  color: string;
  pattern: TrailPattern;
}) {
  return (
    <div className="player-preview-canvas" aria-label="Xem trước nhân vật 3D đang di chuyển">
      <Canvas
        dpr={[1, 1.5]}
        camera={{ position: [0, -7.5, 6.4], fov: 40 }}
        gl={{ antialias: true, alpha: true }}
      >
        <ambientLight intensity={1.4} />
        <directionalLight position={[4, -3, 8]} intensity={2.2} />
        <pointLight position={[-4, 2, 3]} intensity={8} color={color} />
        <AnimatedPreview shape={shape} color={color} pattern={pattern} />
        <gridHelper args={[10, 10, "#263953", "#17243a"]} rotation={[Math.PI / 2, 0, 0]} />
      </Canvas>
    </div>
  );
}

for (const url of Object.values(MODEL_URLS)) useGLTF.preload(url);
