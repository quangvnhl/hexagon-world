"use client";

import { memo, useLayoutEffect, useMemo, useRef } from "react";
import { useFrame } from "@react-three/fiber";
import * as THREE from "three";
import { CONFIG, GameState } from "@hexagon/shared";
import { resolvedOwnershipScore } from "./authoritativeScore";

const SPARK_POOL_SIZE = 300;
const DROP_POOL_SIZE = 240;
const FLOOR_Z = 0.08;

/**
 * Hiệu ứng dùng pool cố định để không cấp phát object trong vòng lặp render:
 * - Giọt 3D cùng màu nhân vật bắn ra khi alive chuyển từ true sang false.
 * - Tia sáng nhỏ khi chiếm thêm đất.
 */
export const Effects = memo(function Effects({
  game,
  visibleEntityIds,
  authoritativeScores,
}: {
  game: GameState;
  /** Online AoI; bỏ trống ở single-player để theo dõi toàn bộ entity. */
  visibleEntityIds?: React.MutableRefObject<ReadonlySet<number>>;
  /** Điểm toàn phòng từ server; số ô trong scene online chỉ là lát cắt AoI. */
  authoritativeScores?: React.MutableRefObject<ReadonlyMap<number, number>>;
}) {
  const sparkLifeTime = CONFIG.EFFECTS.LIFE;
  const sparkCount = CONFIG.EFFECTS.PARTICLES;
  const dropLifeTime = CONFIG.EFFECTS.DEATH_LIFE;
  const dropCount = CONFIG.EFFECTS.DEATH_DROPS;

  const { sparkGeometry, sparkPositions, sparkColors } = useMemo(() => {
    const positions = new Float32Array(SPARK_POOL_SIZE * 3);
    const colors = new Float32Array(SPARK_POOL_SIZE * 3);
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute("position", new THREE.BufferAttribute(positions, 3));
    geometry.setAttribute("color", new THREE.BufferAttribute(colors, 3));
    return {
      sparkGeometry: geometry,
      sparkPositions: positions,
      sparkColors: colors,
    };
  }, []);

  const sparkVelocity = useMemo(
    () => new Float32Array(SPARK_POOL_SIZE * 3),
    []
  );
  const sparkLife = useMemo(() => new Float32Array(SPARK_POOL_SIZE), []);
  const sparkBaseColor = useMemo(
    () => new Float32Array(SPARK_POOL_SIZE * 3),
    []
  );
  const sparkCursor = useRef(0);

  const dropsRef = useRef<THREE.InstancedMesh>(null);
  const dropPosition = useMemo(
    () => new Float32Array(DROP_POOL_SIZE * 3),
    []
  );
  const dropVelocity = useMemo(
    () => new Float32Array(DROP_POOL_SIZE * 3),
    []
  );
  const dropLife = useMemo(() => new Float32Array(DROP_POOL_SIZE), []);
  const dropSize = useMemo(() => new Float32Array(DROP_POOL_SIZE), []);
  const dropCursor = useRef(0);

  const lastAlive = useRef(new Map<number, boolean>());
  const lastOwned = useRef(new Map<number, number>());
  /** Entity vừa hồi sinh đang chờ keyframe cụm đất spawn đầu tiên; lần tăng này không phải capture. */
  const awaitingSpawnTerritory = useRef(new Set<number>());
  const initialized = useRef(false);

  const tmpColor = useMemo(() => new THREE.Color(), []);
  const tmpMatrix = useMemo(() => new THREE.Matrix4(), []);
  const tmpPosition = useMemo(() => new THREE.Vector3(), []);
  const tmpVelocity = useMemo(() => new THREE.Vector3(), []);
  const tmpScale = useMemo(() => new THREE.Vector3(), []);
  const tmpQuaternion = useMemo(() => new THREE.Quaternion(), []);
  const up = useMemo(() => new THREE.Vector3(0, 0, 1), []);

  useLayoutEffect(() => {
    const mesh = dropsRef.current;
    if (!mesh) return;
    const hidden = new THREE.Matrix4().makeScale(0, 0, 0);
    for (let i = 0; i < DROP_POOL_SIZE; i++) mesh.setMatrixAt(i, hidden);
    mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    mesh.instanceMatrix.needsUpdate = true;
  }, []);

  const sparkBurst = (x: number, y: number, r: number, g: number, b: number) => {
    for (let n = 0; n < sparkCount; n++) {
      const i = sparkCursor.current;
      sparkCursor.current = (sparkCursor.current + 1) % SPARK_POOL_SIZE;
      const angle = Math.random() * Math.PI * 2;
      const speed = 2 + Math.random() * 4;
      sparkVelocity[i * 3] = Math.cos(angle) * speed;
      sparkVelocity[i * 3 + 1] = Math.sin(angle) * speed;
      sparkVelocity[i * 3 + 2] = (Math.random() - 0.2) * 3;
      sparkPositions[i * 3] = x;
      sparkPositions[i * 3 + 1] = y;
      sparkPositions[i * 3 + 2] = 0.6;
      sparkBaseColor[i * 3] = r;
      sparkBaseColor[i * 3 + 1] = g;
      sparkBaseColor[i * 3 + 2] = b;
      sparkLife[i] = sparkLifeTime;
    }
  };

  const deathBurst = (x: number, y: number, color: THREE.Color) => {
    const mesh = dropsRef.current;
    if (!mesh) return;

    for (let n = 0; n < dropCount; n++) {
      const i = dropCursor.current;
      dropCursor.current = (dropCursor.current + 1) % DROP_POOL_SIZE;
      const angle = Math.random() * Math.PI * 2;
      const speed = 2.8 + Math.random() * 4.2;
      const radialBias = 0.75 + Math.random() * 0.25;

      dropPosition[i * 3] = x + Math.cos(angle) * Math.random() * 0.18;
      dropPosition[i * 3 + 1] = y + Math.sin(angle) * Math.random() * 0.18;
      dropPosition[i * 3 + 2] = CONFIG.CUBE_SIZE * (0.35 + Math.random() * 0.45);
      dropVelocity[i * 3] = Math.cos(angle) * speed * radialBias;
      dropVelocity[i * 3 + 1] = Math.sin(angle) * speed * radialBias;
      dropVelocity[i * 3 + 2] = 2.4 + Math.random() * 4.4;
      dropLife[i] = dropLifeTime * (0.72 + Math.random() * 0.28);
      dropSize[i] = 0.65 + Math.random() * 0.75;
      mesh.setColorAt(i, color);
    }
    if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
  };

  useFrame((_, rawDt) => {
    const dt = Math.min(rawDt, 0.05);

    if (!initialized.current) {
      for (const entity of game.players) {
        if (visibleEntityIds && !visibleEntityIds.current.has(entity.id)) continue;
        lastAlive.current.set(entity.id, entity.alive);
        const owned = resolvedOwnershipScore(
          entity.id,
          entity.owned.size,
          authoritativeScores?.current
        );
        if (owned !== undefined) lastOwned.current.set(entity.id, owned);
      }
      initialized.current = true;
    } else {
      for (const entity of game.players) {
        if (visibleEntityIds && !visibleEntityIds.current.has(entity.id)) {
          // Khi enter lại AoI, baseline lại trạng thái hiện tại; không phát vụ nổ cho cái chết
          // đã xảy ra trong lúc entity nằm ngoài vùng quan tâm.
          lastAlive.current.delete(entity.id);
          lastOwned.current.delete(entity.id);
          awaitingSpawnTerritory.current.delete(entity.id);
          continue;
        }
        const wasAlive = lastAlive.current.get(entity.id);
        if (wasAlive === true && !entity.alive) {
          tmpColor.set(entity.color.glow);
          deathBurst(entity.pos.x, entity.pos.y, tmpColor);
        }
        if (entity.alive && wasAlive === false) {
          awaitingSpawnTerritory.current.add(entity.id);
        }
        lastAlive.current.set(entity.id, entity.alive);

        const owned = resolvedOwnershipScore(
          entity.id,
          entity.owned.size,
          authoritativeScores?.current
        );
        if (owned === undefined) {
          lastOwned.current.delete(entity.id);
          continue;
        }
        const previousOwned = lastOwned.current.get(entity.id) ?? owned;
        if (owned > previousOwned) {
          if (awaitingSpawnTerritory.current.has(entity.id)) {
            // 0 → cụm đất khởi đầu khi respawn: chỉ chốt baseline, không phát particle tại
            // transform cũ. Xóa cờ sau khi keyframe đất spawn thực sự đã tới.
            awaitingSpawnTerritory.current.delete(entity.id);
          } else if (entity.alive && wasAlive === true) {
            const [r, g, b] = entity.color.owned;
            sparkBurst(entity.pos.x, entity.pos.y, r, g, b);
          }
        }
        lastOwned.current.set(entity.id, owned);
      }
    }

    for (let i = 0; i < SPARK_POOL_SIZE; i++) {
      if (sparkLife[i] <= 0) {
        sparkColors[i * 3] = 0;
        sparkColors[i * 3 + 1] = 0;
        sparkColors[i * 3 + 2] = 0;
        continue;
      }
      sparkLife[i] -= dt;
      sparkPositions[i * 3] += sparkVelocity[i * 3] * dt;
      sparkPositions[i * 3 + 1] += sparkVelocity[i * 3 + 1] * dt;
      sparkPositions[i * 3 + 2] += sparkVelocity[i * 3 + 2] * dt;
      sparkVelocity[i * 3 + 2] -= 6 * dt;
      const fade = Math.max(sparkLife[i] / sparkLifeTime, 0);
      sparkColors[i * 3] = sparkBaseColor[i * 3] * fade;
      sparkColors[i * 3 + 1] = sparkBaseColor[i * 3 + 1] * fade;
      sparkColors[i * 3 + 2] = sparkBaseColor[i * 3 + 2] * fade;
    }
    (sparkGeometry.attributes.position as THREE.BufferAttribute).needsUpdate = true;
    (sparkGeometry.attributes.color as THREE.BufferAttribute).needsUpdate = true;

    const mesh = dropsRef.current;
    if (!mesh) return;
    for (let i = 0; i < DROP_POOL_SIZE; i++) {
      if (dropLife[i] <= 0) {
        tmpMatrix.makeScale(0, 0, 0);
        mesh.setMatrixAt(i, tmpMatrix);
        continue;
      }

      dropLife[i] -= dt;
      dropVelocity[i * 3 + 2] -= CONFIG.EFFECTS.DEATH_GRAVITY * dt;
      dropPosition[i * 3] += dropVelocity[i * 3] * dt;
      dropPosition[i * 3 + 1] += dropVelocity[i * 3 + 1] * dt;
      dropPosition[i * 3 + 2] += dropVelocity[i * 3 + 2] * dt;

      if (dropPosition[i * 3 + 2] < FLOOR_Z) {
        dropPosition[i * 3 + 2] = FLOOR_Z;
        dropVelocity[i * 3 + 2] = Math.abs(dropVelocity[i * 3 + 2]) * 0.24;
        dropVelocity[i * 3] *= 0.72;
        dropVelocity[i * 3 + 1] *= 0.72;
      }

      tmpVelocity.set(
        dropVelocity[i * 3],
        dropVelocity[i * 3 + 1],
        dropVelocity[i * 3 + 2]
      );
      const speed = tmpVelocity.length();
      if (speed > 0.001) {
        tmpVelocity.multiplyScalar(1 / speed);
        tmpQuaternion.setFromUnitVectors(up, tmpVelocity);
      } else {
        tmpQuaternion.identity();
      }

      const remaining = Math.max(dropLife[i] / dropLifeTime, 0);
      const shrink = Math.min(1, remaining * 4);
      const width = dropSize[i] * shrink;
      const stretch = 1 + Math.min(speed * 0.12, 1.25);
      tmpPosition.set(
        dropPosition[i * 3],
        dropPosition[i * 3 + 1],
        dropPosition[i * 3 + 2]
      );
      tmpScale.set(width, width, width * stretch);
      tmpMatrix.compose(tmpPosition, tmpQuaternion, tmpScale);
      mesh.setMatrixAt(i, tmpMatrix);
    }
    mesh.instanceMatrix.needsUpdate = true;
  });

  return (
    <>
      <points geometry={sparkGeometry} frustumCulled={false}>
        <pointsMaterial
          vertexColors
          size={
            CONFIG.CAMERA.TYPE === "ORTHOGRAPHIC"
              ? CONFIG.EFFECTS.CAPTURE_SPARK_SIZE.ORTHOGRAPHIC
              : CONFIG.EFFECTS.CAPTURE_SPARK_SIZE.PERSPECTIVE
          }
          sizeAttenuation={CONFIG.CAMERA.TYPE === "PERSPECTIVE"}
          transparent
          depthWrite={false}
          blending={THREE.AdditiveBlending}
        />
      </points>
      <instancedMesh
        ref={dropsRef}
        args={[undefined, undefined, DROP_POOL_SIZE]}
        frustumCulled={false}
      >
        <sphereGeometry args={[0.14, 8, 6]} />
        <meshStandardMaterial
          roughness={0.28}
          metalness={0.08}
          emissiveIntensity={0.12}
        />
      </instancedMesh>
    </>
  );
});
