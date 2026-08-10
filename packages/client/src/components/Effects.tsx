"use client";

import { memo, useMemo, useRef } from "react";
import { useFrame } from "@react-three/fiber";
import * as THREE from "three";
import { GameState } from "@hexagon/shared";
import { CONFIG } from "@hexagon/shared";

/**
 * Hiệu ứng "juice" bằng MỘT hệ hạt gộp (pooled THREE.Points), rẻ & không cấp phát
 * geometry mỗi frame:
 *  - Nổ hạt khi 1 thực thể CHẾT (deaths tăng) — màu glow, bay ra & mờ dần.
 *  - Lóe hạt khi CHIẾM đất (owned.size tăng) — màu owned. Đây là bản MVP thay cho
 *    animation tô từng ô: chỉ 1 nhúm hạt nhỏ, không animate từng cell.
 * Dùng AdditiveBlending: màu tiến về đen = trong suốt → fade thật trên nền tối.
 */
export const Effects = memo(function Effects({ game }: { game: GameState }) {
  const MAX = 300; // trần số hạt sống đồng thời (bounded pool)
  const LIFE = CONFIG.EFFECTS.LIFE;
  const COUNT = CONFIG.EFFECTS.PARTICLES;
  const Z = 0.6; // ngang tầm cao cube

  // Bộ đệm cố định cho pool.
  const { geometry, positions, colors } = useMemo(() => {
    const positions = new Float32Array(MAX * 3);
    const colors = new Float32Array(MAX * 3);
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute("position", new THREE.BufferAttribute(positions, 3));
    geometry.setAttribute("color", new THREE.BufferAttribute(colors, 3));
    return { geometry, positions, colors };
  }, []);

  // Trạng thái mỗi hạt (không phải React state → không re-render).
  const vel = useMemo(() => new Float32Array(MAX * 3), []);
  const life = useMemo(() => new Float32Array(MAX), []); // >0 = còn sống
  const base = useMemo(() => new Float32Array(MAX * 3), []); // màu gốc để scale theo life
  const cursor = useRef(0); // con trỏ vòng để tái dùng slot

  // Theo dõi mốc trước để phát hiện sự kiện chết/chiếm.
  const lastDeaths = useRef<number[]>([]);
  const lastOwned = useRef<number[]>([]);
  const tmpColor = useMemo(() => new THREE.Color(), []);

  // Bắn 1 nhúm hạt tại (x,y) với màu rgb (0..1) cho trước.
  const burst = (x: number, y: number, r: number, g: number, b: number) => {
    for (let n = 0; n < COUNT; n++) {
      const i = cursor.current;
      cursor.current = (cursor.current + 1) % MAX;
      const a = Math.random() * Math.PI * 2;
      const sp = 2 + Math.random() * 4;
      vel[i * 3] = Math.cos(a) * sp;
      vel[i * 3 + 1] = Math.sin(a) * sp;
      vel[i * 3 + 2] = (Math.random() - 0.2) * 3;
      positions[i * 3] = x;
      positions[i * 3 + 1] = y;
      positions[i * 3 + 2] = Z;
      base[i * 3] = r;
      base[i * 3 + 1] = g;
      base[i * 3 + 2] = b;
      life[i] = LIFE;
    }
  };

  useFrame((_, dtRaw) => {
    const dt = Math.min(dtRaw, 0.05);

    // Khởi tạo mốc ở frame đầu (tránh nổ giả khi mount).
    if (lastDeaths.current.length !== game.players.length) {
      lastDeaths.current = game.players.map((e) => e.deaths);
      lastOwned.current = game.players.map((e) => e.owned.size);
    }

    // Phát hiện sự kiện theo từng thực thể.
    for (let i = 0; i < game.players.length; i++) {
      const e = game.players[i];
      if (e.deaths > lastDeaths.current[i]) {
        tmpColor.set(e.color.glow);
        burst(e.pos.x, e.pos.y, tmpColor.r, tmpColor.g, tmpColor.b);
      }
      lastDeaths.current[i] = e.deaths;

      const sz = e.owned.size;
      if (sz > lastOwned.current[i]) {
        // MVP: lóe nhỏ báo hiệu vừa chiếm đất (không animate từng ô).
        const [r, g, b] = e.color.owned;
        burst(e.pos.x, e.pos.y, r, g, b);
      }
      lastOwned.current[i] = sz;
    }

    // Tiến hoá hạt: bay ra, rơi nhẹ, mờ dần (màu → đen).
    for (let i = 0; i < MAX; i++) {
      if (life[i] <= 0) {
        colors[i * 3] = colors[i * 3 + 1] = colors[i * 3 + 2] = 0;
        continue;
      }
      life[i] -= dt;
      positions[i * 3] += vel[i * 3] * dt;
      positions[i * 3 + 1] += vel[i * 3 + 1] * dt;
      positions[i * 3 + 2] += vel[i * 3 + 2] * dt;
      vel[i * 3 + 2] -= 6 * dt; // trọng lực nhẹ
      const f = Math.max(life[i] / LIFE, 0);
      colors[i * 3] = base[i * 3] * f;
      colors[i * 3 + 1] = base[i * 3 + 1] * f;
      colors[i * 3 + 2] = base[i * 3 + 2] * f;
    }

    (geometry.attributes.position as THREE.BufferAttribute).needsUpdate = true;
    (geometry.attributes.color as THREE.BufferAttribute).needsUpdate = true;
  });

  return (
    <points geometry={geometry}>
      <pointsMaterial
        vertexColors
        size={0.5}
        sizeAttenuation
        transparent
        depthWrite={false}
        blending={THREE.AdditiveBlending}
      />
    </points>
  );
});
