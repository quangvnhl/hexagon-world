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

const LABEL_HEIGHT = 0.62;
const LABEL_MAX_WIDTH = 3.35;

function makeLabelTexture(text: string, king: boolean): {
  texture: THREE.CanvasTexture;
  width: number;
} {
  const canvas = document.createElement("canvas");
  const height = 96;
  const horizontalPadding = 28;
  const font = "700 40px system-ui, -apple-system, sans-serif";
  const measure = canvas.getContext("2d");
  if (!measure) throw new Error("Canvas 2D is unavailable");
  measure.font = font;
  const measuredWidth = measure.measureText(text).width;
  canvas.width = Math.ceil(Math.min(512, Math.max(128, measuredWidth + horizontalPadding * 2)));
  canvas.height = height;

  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("Canvas 2D is unavailable");
  ctx.font = font;
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";

  const radius = height / 2;
  ctx.beginPath();
  ctx.moveTo(radius, 1);
  ctx.lineTo(canvas.width - radius, 1);
  ctx.arc(canvas.width - radius, radius, radius - 1, -Math.PI / 2, Math.PI / 2);
  ctx.lineTo(radius, height - 1);
  ctx.arc(radius, radius, radius - 1, Math.PI / 2, -Math.PI / 2);
  ctx.closePath();
  ctx.fillStyle = king ? "rgba(64,45,5,0.88)" : "rgba(7,10,18,0.82)";
  ctx.fill();
  ctx.lineWidth = 3;
  ctx.strokeStyle = king ? "rgba(255,210,63,0.92)" : "rgba(255,255,255,0.28)";
  ctx.stroke();

  ctx.fillStyle = king ? "#ffe47a" : "#ffffff";
  ctx.shadowColor = "rgba(0,0,0,0.9)";
  ctx.shadowBlur = 5;
  ctx.fillText(text, canvas.width / 2, height / 2 + 1, canvas.width - horizontalPadding * 2);

  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.minFilter = THREE.LinearFilter;
  texture.magFilter = THREE.LinearFilter;
  return {
    texture,
    width: Math.min(LABEL_MAX_WIDTH, LABEL_HEIGHT * (canvas.width / height)),
  };
}

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
  localId = 0,
  kingId: authoritativeKingId,
}: {
  game: GameState;
  /** Online AoI: chỉ render entity có mặt trong snapshot hiện tại. Chơi đơn để trống. */
  visibleEntityIds?: MutableRefObject<ReadonlySet<number>>;
  localId?: number;
  kingId?: number;
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
  const labelSprites = useRef<(THREE.Sprite | null)[]>([]);
  const labelTextures = useRef<(THREE.CanvasTexture | null)[]>([]);
  const labelSignatures = useRef<string[]>([]);
  const view = useRef<GroundView>({ x: 0, y: 0, radius: 0 });

  useEffect(
    () => () => {
      for (const root of modelObjects.current) {
        if (root) disposeModelObject(root);
      }
      for (const texture of labelTextures.current) texture?.dispose();
    },
    []
  );

  useFrame(({ camera, size }) => {
    getCameraGroundView(camera, size.width, size.height, view.current, 3);
    const kingId = authoritativeKingId ?? game.kingId();
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

      const label = labelSprites.current[i];
      if (label) {
        const isKing = kingId === e.id;
        const name = game.nameOf(e.id);
        const nextSignature = `${isKing ? "king" : "player"}:${name}`;
        if (labelSignatures.current[i] !== nextSignature) {
          labelSignatures.current[i] = nextSignature;
          labelTextures.current[i]?.dispose();
          const next = makeLabelTexture(`${isKing ? "♛ " : ""}${name}`, isKing);
          labelTextures.current[i] = next.texture;
          label.material.map = next.texture;
          label.material.needsUpdate = true;
          label.scale.set(next.width, LABEL_HEIGHT, 1);
        }
      }

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

      for (const child of g.children) {
        child.visible =
          child.name === "player-label" || (e.alive && child.name === e.shape);
      }

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
          {e.id !== localId && (
            <sprite
              name="player-label"
              ref={(sprite) => {
                labelSprites.current[i] = sprite;
              }}
              position={[0, 0, CONFIG.CUBE_SIZE * 2.15]}
              scale={[1, LABEL_HEIGHT, 1]}
              renderOrder={20}
            >
              <spriteMaterial transparent depthWrite={false} toneMapped={false} />
            </sprite>
          )}
        </group>
      ))}
    </>
  );
});

for (const url of Object.values(MODEL_URLS)) useGLTF.preload(url);
