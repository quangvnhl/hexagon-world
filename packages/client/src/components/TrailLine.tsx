"use client";

import { memo, useEffect, useRef } from "react";
import { useFrame } from "@react-three/fiber";
import * as THREE from "three";
import {
  GameState,
  Entity,
  CONFIG,
  type TrailPattern,
} from "@hexagon/shared";
import { getCameraGroundView, isInGroundView, type GroundView } from "./cameraVisibility";
import { trailVectorAsset } from "./trailVectorAssets";
import { createTrailRibbonGeometry } from "./trailRibbonGeometry";

const textureLoader = new THREE.TextureLoader();
const textureCache = new Map<TrailPattern, Promise<THREE.Texture | null>>();

/** Một nguồn SVG dùng chung cho Welcome/preview/gameplay; màu được nhân từ instance/material. */
function loadPatternTexture(pattern: TrailPattern): Promise<THREE.Texture | null> {
  const cached = textureCache.get(pattern);
  if (cached) return cached;
  const asset = trailVectorAsset(pattern);
  const pending = asset
    ? new Promise<THREE.Texture | null>((resolve) => {
        textureLoader.load(
          asset,
          (texture) => {
            texture.wrapS = THREE.RepeatWrapping;
            texture.wrapT = THREE.ClampToEdgeWrapping;
            texture.minFilter = THREE.LinearMipmapLinearFilter;
            texture.magFilter = THREE.LinearFilter;
            texture.colorSpace = THREE.SRGBColorSpace;
            texture.needsUpdate = true;
            resolve(texture);
          },
          undefined,
          () => resolve(null),
        );
      })
    : Promise.resolve(null);
  textureCache.set(pattern, pending);
  return pending;
}

/** Ribbon 2D dùng cùng SVG với preview; các ô hex bên dưới vẫn do grid tô màu nhân vật. */
function EntityTrail({ entity }: { entity: Entity }) {
  const meshRef = useRef<THREE.Mesh>(null);
  const materialRef = useRef<THREE.MeshBasicMaterial>(null);
  const geometryRef = useRef<THREE.BufferGeometry | null>(null);
  const lastAppearance = useRef("");
  const textureVersion = useRef(0);
  const signature = useRef({ n: -1, hx: 0, hy: 0 });
  const view = useRef<GroundView>({ x: 0, y: 0, radius: 0 });
  const lastCullAt = useRef(-Infinity);
  const inView = useRef(false);

  useEffect(() => () => {
    textureVersion.current++;
    geometryRef.current?.dispose();
  }, []);

  useFrame(({ camera, size, clock }) => {
    const mesh = meshRef.current;
    const material = materialRef.current;
    if (!mesh || !material) return;
    const points = entity.trailPoints;
    if (!entity.alive || points.length < 2) {
      mesh.visible = false;
      signature.current.n = -1;
      return;
    }

    if (clock.elapsedTime - lastCullAt.current >= 0.1) {
      lastCullAt.current = clock.elapsedTime;
      getCameraGroundView(camera, size.width, size.height, view.current, 4);
      inView.current = points.some((point) => isInGroundView(view.current, point.x, point.y, 1.5));
    }
    if (!inView.current) {
      mesh.visible = false;
      return;
    }

    const appearance = `${entity.colorIndex}:${entity.trailPattern}`;
    if (lastAppearance.current !== appearance) {
      lastAppearance.current = appearance;
      material.color.set(entity.color.glow);
      material.map = null;
      material.alphaTest = 0;
      material.needsUpdate = true;
      const version = ++textureVersion.current;
      void loadPatternTexture(entity.trailPattern).then((texture) => {
        if (textureVersion.current !== version || !materialRef.current) return;
        materialRef.current.map = texture;
        materialRef.current.alphaTest = texture ? 0.04 : 0;
        materialRef.current.needsUpdate = true;
      });
    }

    mesh.visible = true;
    const head = points[points.length - 1];
    const hx = Math.round(head.x * 10);
    const hy = Math.round(head.y * 10);
    const current = signature.current;
    if (current.n === points.length && current.hx === hx && current.hy === hy) return;
    current.n = points.length;
    current.hx = hx;
    current.hy = hy;

    const geometry = createTrailRibbonGeometry(points);
    geometryRef.current?.dispose();
    geometryRef.current = geometry;
    mesh.geometry = geometry;
  });

  return (
    <mesh ref={meshRef} frustumCulled={false} visible={false} renderOrder={3}>
      <planeGeometry args={[0.001, 0.001]} />
      <meshBasicMaterial
        ref={materialRef}
        color={entity.color.glow}
        transparent
        depthWrite={false}
        toneMapped={false}
        side={THREE.DoubleSide}
      />
    </mesh>
  );
}

/** Vẽ ribbon vector cho mọi thực thể; không phủ texture lên ô lục giác. */
export const TrailLine = memo(function TrailLine({ game }: { game: GameState }) {
  if (!CONFIG.DISPLAY.TRAILS) return null;
  return (
    <>
      {game.players.map((entity) => (
        <EntityTrail key={entity.id} entity={entity} />
      ))}
    </>
  );
});
