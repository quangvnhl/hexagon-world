"use client";

import { memo, useEffect, useRef, type MutableRefObject } from "react";
import { useFrame } from "@react-three/fiber";
import { useGLTF } from "@react-three/drei";
import * as THREE from "three";
import { CONFIG, GameState, type PlayerShape } from "@hexagon/shared";
import { getCameraGroundView, isInGroundView, type GroundView } from "./cameraVisibility";
import { applyPlayerColorToPrimaryMaterials } from "./modelMaterialColor";

const MODEL_URLS = {
  fly: "/models/low_poly_house_fly_diptera.glb",
  bee: "/models/bee.glb",
  ladybug: "/models/ladybug.glb",
} as const satisfies Partial<Record<PlayerShape, string>>;

type ModelShape = keyof typeof MODEL_URLS;

function disposeModelObject(root: THREE.Object3D): void {
  root.traverse((obj) => {
    if (!(obj instanceof THREE.Mesh)) return;
    const materials = Array.isArray(obj.material) ? obj.material : [obj.material];
    for (const material of materials) material.dispose();
  });
}

/** Clone material, convert Y-up models to the game's Z-up plane, then fit them to one cell. */
function makeModelObject(
  source: THREE.Object3D,
  shape: ModelShape
): THREE.Group {
  const wrapper = new THREE.Group();
  wrapper.name = shape;
  const model = source.clone(true);

  model.traverse((obj) => {
    if (!(obj instanceof THREE.Mesh)) return;
    const materials = Array.isArray(obj.material) ? obj.material : [obj.material];
    const cloned = materials.map((material) => material.clone());
    obj.material = Array.isArray(obj.material) ? cloned : cloned[0];
    obj.userData.hexModelMesh = true;
  });

  model.rotation.x = Math.PI / 2;
  model.updateMatrixWorld(true);
  const box = new THREE.Box3().setFromObject(model);
  const size = box.getSize(new THREE.Vector3());
  const maxSize = Math.max(size.x, size.y, size.z) || 1;
  model.scale.setScalar((CONFIG.CUBE_SIZE * 1.35) / maxSize);
  model.updateMatrixWorld(true);

  const fitted = new THREE.Box3().setFromObject(model);
  const center = fitted.getCenter(new THREE.Vector3());
  model.position.set(-center.x, -center.y, -fitted.min.z);
  wrapper.add(model);
  return wrapper;
}

/** 3D object for every entity (the legacy component name remains for existing imports). */
export const PlayerCube = memo(function PlayerCube({
  game,
  visibleEntityIds,
}: {
  game: GameState;
  /** Online AoI: chỉ render entity có mặt trong snapshot hiện tại. Chơi đơn để trống. */
  visibleEntityIds?: MutableRefObject<ReadonlySet<number>>;
}) {
  const { scene: flySource } = useGLTF(MODEL_URLS.fly);
  const { scene: beeSource } = useGLTF(MODEL_URLS.bee);
  const { scene: ladybugSource } = useGLTF(MODEL_URLS.ladybug);
  const modelSources: Record<ModelShape, THREE.Object3D> = {
    fly: flySource,
    bee: beeSource,
    ladybug: ladybugSource,
  };
  const refs = useRef<(THREE.Group | null)[]>([]);
  const appearanceSig = useRef<string[]>([]);
  const modelObjects = useRef<(THREE.Group | null)[]>([]);
  const lastAlive = useRef<boolean[]>([]);
  const view = useRef<GroundView>({ x: 0, y: 0, radius: 0 });

  useEffect(
    () => () => {
      for (const root of modelObjects.current) {
        if (root) disposeModelObject(root);
      }
    },
    []
  );

  useFrame(({ camera, size }) => {
    getCameraGroundView(camera, size.width, size.height, view.current, 3);
    for (let i = 0; i < game.players.length; i++) {
      const g = refs.current[i];
      const e = game.players[i];
      if (!g) continue;

      const wasAlive = lastAlive.current[i];
      if (!e.alive && wasAlive !== false) {
        // GLB là object được add thủ công, nên phải remove thủ công khi chết. Hồi sinh sẽ
        // clone instance mới, tuyệt đối không tái hiện instance còn giữ transform lúc chết.
        const oldModel = modelObjects.current[i];
        if (oldModel) {
          g.remove(oldModel);
          disposeModelObject(oldModel);
          modelObjects.current[i] = null;
          appearanceSig.current[i] = "";
        }
      }
      lastAlive.current[i] = e.alive;

      // Luôn cập nhật transform TRƯỚC rồi mới cho visible để frame hồi sinh đầu tiên không
      // thể vẽ group ở transform của mạng sống cũ.
      g.position.set(e.pos.x, e.pos.y, 0);
      g.rotation.z = e.heading;
      const present = visibleEntityIds?.current.has(e.id) ?? true;
      g.visible =
        present && e.alive && isInGroundView(view.current, e.pos.x, e.pos.y, 2);
      if (!g.visible) continue;

      if (
        e.shape in MODEL_URLS &&
        modelObjects.current[i]?.name !== e.shape
      ) {
        const previousModel = modelObjects.current[i];
        if (previousModel) {
          g.remove(previousModel);
          disposeModelObject(previousModel);
        }
        const shape = e.shape as ModelShape;
        const model = makeModelObject(modelSources[shape], shape);
        modelObjects.current[i] = model;
        g.add(model);
        appearanceSig.current[i] = "";
      }

      for (const child of g.children) child.visible = child.name === e.shape;

      const sig = `${e.colorIndex}:${e.shape}`;
      if (appearanceSig.current[i] !== sig) {
        appearanceSig.current[i] = sig;
        const playerColor = new THREE.Color(e.color.glow);
        g.traverse((obj) => {
          if (!(obj instanceof THREE.Mesh)) return;
          if (obj.userData.hexModelMesh) {
            applyPlayerColorToPrimaryMaterials(obj.material, playerColor);
            return;
          }

          const materials = Array.isArray(obj.material)
            ? obj.material
            : [obj.material];
          for (const material of materials) {
            if ("color" in material && material.color instanceof THREE.Color) {
              material.color.copy(playerColor);
            }
            if (material instanceof THREE.MeshStandardMaterial) {
              material.emissive.copy(playerColor);
              material.emissiveIntensity = 0.35;
            }
          }
        });
      }
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
          <mesh name="cube" position={[0, 0, CONFIG.CUBE_SIZE / 2]}>
            <boxGeometry args={[CONFIG.CUBE_SIZE, CONFIG.CUBE_SIZE, CONFIG.CUBE_SIZE]} />
            <meshStandardMaterial color={e.color.glow} emissive={e.color.glow} emissiveIntensity={0.35} metalness={0.35} roughness={0.3} />
          </mesh>
          <mesh name="cylinder" position={[0, 0, CONFIG.CUBE_SIZE / 2]} rotation={[Math.PI / 2, 0, 0]}>
            <cylinderGeometry args={[CONFIG.CUBE_SIZE * 0.48, CONFIG.CUBE_SIZE * 0.48, CONFIG.CUBE_SIZE, 16]} />
            <meshStandardMaterial color={e.color.glow} emissive={e.color.glow} emissiveIntensity={0.35} metalness={0.35} roughness={0.3} />
          </mesh>
          <mesh name="sphere" position={[0, 0, CONFIG.CUBE_SIZE / 2]}>
            <sphereGeometry args={[CONFIG.CUBE_SIZE * 0.52, 18, 12]} />
            <meshStandardMaterial color={e.color.glow} emissive={e.color.glow} emissiveIntensity={0.35} metalness={0.35} roughness={0.3} />
          </mesh>
          <mesh name="cone" position={[0, 0, CONFIG.CUBE_SIZE / 2]} rotation={[Math.PI / 2, 0, 0]}>
            <coneGeometry args={[CONFIG.CUBE_SIZE * 0.56, CONFIG.CUBE_SIZE, 12]} />
            <meshStandardMaterial color={e.color.glow} emissive={e.color.glow} emissiveIntensity={0.35} metalness={0.35} roughness={0.3} />
          </mesh>
        </group>
      ))}
    </>
  );
});

for (const url of Object.values(MODEL_URLS)) useGLTF.preload(url);
