"use client";

import { memo, useLayoutEffect, useMemo, useRef } from "react";
import * as THREE from "three";
import { axialToPixel, CONFIG } from "@hexagon/shared";

export type TotemVisualKind = "speed" | "slow" | "radar";

export interface TotemVisualState {
  id: number;
  kind: TotemVisualKind;
  q: number;
  r: number;
  ownerId: number;
}

const COLORS: Record<TotemVisualKind, string> = {
  speed: "#ffd23f",
  slow: "#58a6ff",
  radar: "#c77dff",
};

function TotemBatch({ kind, items }: { kind: TotemVisualKind; items: readonly TotemVisualState[] }) {
  const ref = useRef<THREE.InstancedMesh>(null);
  const dummy = useMemo(() => new THREE.Object3D(), []);

  useLayoutEffect(() => {
    const mesh = ref.current;
    if (!mesh) return;
    items.forEach((item, index) => {
      const p = axialToPixel(item, CONFIG.HEX_SIZE);
      dummy.position.set(p.x, p.y, 0.7);
      dummy.rotation.set(0, 0, kind === "radar" ? Math.PI / 4 : 0);
      dummy.scale.setScalar(item.ownerId >= 0 ? 1 : 0.82);
      dummy.updateMatrix();
      mesh.setMatrixAt(index, dummy.matrix);
    });
    mesh.count = items.length;
    mesh.instanceMatrix.needsUpdate = true;
  }, [dummy, items, kind]);

  return (
    <instancedMesh ref={ref} args={[undefined, undefined, Math.max(1, items.length)]} frustumCulled>
      {kind === "speed" ? (
        <octahedronGeometry args={[0.48, 0]} />
      ) : kind === "slow" ? (
        <cylinderGeometry args={[0.4, 0.55, 0.9, 8]} />
      ) : (
        <torusGeometry args={[0.4, 0.12, 8, 18]} />
      )}
      <meshStandardMaterial
        color={COLORS[kind]}
        emissive={COLORS[kind]}
        emissiveIntensity={0.35}
        roughness={0.45}
        metalness={0.15}
      />
    </instancedMesh>
  );
}

/** Exactly three instanced draw batches regardless of Totem count. */
export const TotemInstances = memo(function TotemInstances({
  items,
}: {
  items: readonly TotemVisualState[];
}) {
  const groups = useMemo(
    () => ({
      speed: items.filter((item) => item.kind === "speed"),
      slow: items.filter((item) => item.kind === "slow"),
      radar: items.filter((item) => item.kind === "radar"),
    }),
    [items]
  );
  return (
    <group>
      <TotemBatch kind="speed" items={groups.speed} />
      <TotemBatch kind="slow" items={groups.slow} />
      <TotemBatch kind="radar" items={groups.radar} />
    </group>
  );
});
