"use client";

import { memo, useEffect, useMemo, useRef } from "react";
import { useFrame } from "@react-three/fiber";
import * as THREE from "three";
import { GameState } from "@hexagon/shared";
import { CONFIG } from "@hexagon/shared";
import { axialToPixel, hexLinedraw, keyOf, parseKey } from "@hexagon/shared";
import { getCameraGroundView, type GroundView } from "./cameraVisibility";

/**
 * Render toàn bộ lưới hex bằng 1 InstancedMesh (mỗi ô playable = 1 instance) → ô trung
 * lập vẫn hiện dạng KHỐI LỤC GIÁC có độ dày. TILE_SCALE chừa khe giữa các ô để lộ
 * nền tối = lưới cell. Chỉ tô lại màu khi `gridRevision` đổi; matrix chỉ cập nhật cho
 * các ô đang nhún khi người chơi bước qua.
 *
 * Lưu ý quy mô: cách này instance MỌI ô playable → hợp với bản đồ vừa/nhỏ. Với bản đồ
 * cực lớn (hàng trăm nghìn ô) nên chuyển sang nền + chỉ instance ô đã tô.
 */
export const HexGridView = memo(function HexGridView({
  game,
  activeEntityId = 0,
}: {
  game: GameState;
  /** Thực thể kích hoạt hiệu ứng nhún (0 ở local, playerId của chính client khi online). */
  activeEntityId?: number;
}) {
  const meshRef = useRef<THREE.InstancedMesh>(null);
  const lastRev = useRef(-1);
  const lastHexKey = useRef<string | null>(null);
  const presses = useRef(new Map<number, number>());
  const visibleCells = useRef<number[]>([]);
  const visibleSlots = useRef(new Map<number, number>());
  const lastView = useRef<GroundView>({ x: Infinity, y: Infinity, radius: 0 });
  const view = useRef<GroundView>({ x: 0, y: 0, radius: 0 });
  const dummy = useMemo(() => new THREE.Object3D(), []);
  const color = useMemo(() => new THREE.Color(), []);

  const geometry = useMemo(() => {
    const g = new THREE.CylinderGeometry(
      CONFIG.HEX_SIZE * CONFIG.GRID.TILE_SCALE,
      CONFIG.HEX_SIZE * CONFIG.GRID.TILE_SCALE,
      CONFIG.GRID.THICKNESS,
      6,
      1,
      false,
      Math.PI / 3,
      Math.PI * 2
    );
    // Cylinder mặc định dọc trục Y; sân dùng mặt phẳng XY và chiều cao là trục Z.
    g.rotateX(Math.PI / 2);
    return g;
  }, []);

  const cells = useMemo(() => {
    const arr: { key: string; x: number; y: number }[] = [];
    for (const k of game.playable) {
      const a = parseKey(k);
      const p = axialToPixel(a, CONFIG.HEX_SIZE);
      arr.push({ key: k, x: p.x, y: p.y });
    }
    return arr;
  }, [game]);

  const cellIndex = useMemo(
    () => new Map(cells.map((cell, index) => [cell.key, index])),
    [cells]
  );

  const setCellMatrix = (slot: number, cellIndex: number, press: number) => {
    const cell = cells[cellIndex];
    const planarScale = 1 - (1 - CONFIG.GRID.PRESS_SCALE) * press;
    dummy.position.set(
      cell.x,
      cell.y,
      -CONFIG.GRID.THICKNESS / 2 - CONFIG.GRID.PRESS_DEPTH * press
    );
    dummy.scale.set(planarScale, planarScale, 1);
    dummy.updateMatrix();
    meshRef.current?.setMatrixAt(slot, dummy.matrix);
  };

  useEffect(() => {
    const mesh = meshRef.current;
    if (!mesh) return;
    mesh.count = 0;
    lastRev.current = -1; // buộc tô màu lần đầu
    lastView.current.x = Infinity;
    presses.current.clear();
    const entity = game.players[activeEntityId];
    lastHexKey.current = entity?.alive ? keyOf(entity.currentHex) : null;
  }, [activeEntityId, cells, game]);

  useFrame(({ camera, size }, dtRaw) => {
    const mesh = meshRef.current;
    if (!mesh) return;

    getCameraGroundView(camera, size.width, size.height, view.current, 4);
    const previousView = lastView.current;
    const viewMoved =
      Math.hypot(view.current.x - previousView.x, view.current.y - previousView.y) >= 0.8 ||
      Math.abs(view.current.radius - previousView.radius) >= 0.5;

    if (viewMoved) {
      previousView.x = view.current.x;
      previousView.y = view.current.y;
      previousView.radius = view.current.radius;
      const radiusSq = view.current.radius * view.current.radius;
      const nextVisible = visibleCells.current;
      const nextSlots = visibleSlots.current;
      nextVisible.length = 0;
      nextSlots.clear();

      for (let cellIndex = 0; cellIndex < cells.length; cellIndex++) {
        const cell = cells[cellIndex];
        const dx = cell.x - view.current.x;
        const dy = cell.y - view.current.y;
        if (dx * dx + dy * dy > radiusSq) continue;
        const slot = nextVisible.length;
        nextVisible.push(cellIndex);
        nextSlots.set(cellIndex, slot);
        const elapsed = presses.current.get(cellIndex);
        const press = elapsed === undefined
          ? 0
          : Math.sin(
              Math.PI * Math.min(elapsed / CONFIG.GRID.PRESS_DURATION, 1)
            );
        setCellMatrix(slot, cellIndex, press);
        const rgb = game.cellColor(cell.key);
        color.setRGB(rgb[0], rgb[1], rgb[2]);
        mesh.setColorAt(slot, color);
      }
      mesh.count = nextVisible.length;
      mesh.instanceMatrix.needsUpdate = true;
      if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
      lastRev.current = game.gridRevision;
    } else if (lastRev.current !== game.gridRevision) {
      lastRev.current = game.gridRevision;
      for (let slot = 0; slot < visibleCells.current.length; slot++) {
        const cellIndex = visibleCells.current[slot];
        const rgb = game.cellColor(cells[cellIndex].key);
        color.setRGB(rgb[0], rgb[1], rgb[2]);
        mesh.setColorAt(slot, color);
      }
      if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
    }

    const entity = game.players[activeEntityId];
    if (!entity?.alive) {
      lastHexKey.current = null;
    } else {
      const currentKey = keyOf(entity.currentHex);
      const previousKey = lastHexKey.current;
      if (previousKey && previousKey !== currentKey) {
        // Snapshot online có thể nhảy qua hơn một ô; nhún mọi ô thực sự đã đi qua.
        const crossed = hexLinedraw(parseKey(previousKey), entity.currentHex);
        for (let i = 1; i < crossed.length; i++) {
          const index = cellIndex.get(keyOf(crossed[i]));
          if (index !== undefined) presses.current.set(index, 0);
        }
      }
      lastHexKey.current = currentKey;
    }

    if (presses.current.size === 0) return;

    const dt = Math.min(dtRaw, 0.05);
    for (const [index, elapsed] of presses.current) {
      const nextElapsed = elapsed + dt;
      const t = Math.min(nextElapsed / CONFIG.GRID.PRESS_DURATION, 1);
      // Một nhịp sin: xuống nhanh, đạt đáy giữa chu kỳ rồi đàn hồi về mặt sân.
      const slot = visibleSlots.current.get(index);
      if (slot !== undefined) setCellMatrix(slot, index, Math.sin(Math.PI * t));
      if (t >= 1) presses.current.delete(index);
      else presses.current.set(index, nextElapsed);
    }
    mesh.instanceMatrix.needsUpdate = true;
  });

  return (
    <instancedMesh
      ref={meshRef}
      args={[undefined, undefined, cells.length]}
      frustumCulled={false}
    >
      <primitive object={geometry} attach="geometry" />
      <meshStandardMaterial
        toneMapped={false}
        roughness={0.78}
        metalness={0.06}
      />
    </instancedMesh>
  );
});
