"use client";

import { memo, useRef, useEffect } from "react";
import { useFrame } from "@react-three/fiber";
import * as THREE from "three";
import { GameState, Entity, CONFIG } from "@hexagon/shared";

/**
 * Ống đuôi 3D phát sáng cho 1 thực thể.
 *
 * HIỆU NĂNG: KHÔNG dựng lại geometry mỗi frame. Trước đây mỗi frame, cho MỖI thực thể,
 * ta cấp phát 1 mảng Vector3 + CatmullRomCurve3 + TubeGeometry (tới ~600 đoạn) rồi vứt đi
 * → với nhiều bot là hàng chục TubeGeometry/​frame ⇒ GC dồn ⇒ GIẬT. Nay chỉ dựng lại khi
 * ĐUÔI THỰC SỰ ĐỔI (số điểm đổi, hoặc điểm ĐẦU dịch chuyển đáng kể). Điểm Vector3 dùng lại
 * từ một pool để không cấp phát mỗi lần.
 */
function EntityTrail({ entity }: { entity: Entity }) {
  const meshRef = useRef<THREE.Mesh>(null);
  const geomRef = useRef<THREE.TubeGeometry | null>(null);
  // Chữ ký đuôi lần dựng gần nhất: số điểm + toạ độ điểm ĐẦU (làm tròn) → chỉ dựng lại khi đổi.
  const sig = useRef<{ n: number; hx: number; hy: number }>({ n: -1, hx: 0, hy: 0 });
  // Pool Vector3 tái sử dụng (tránh cấp phát mảng mỗi frame).
  const pool = useRef<THREE.Vector3[]>([]);

  useEffect(() => {
    return () => geomRef.current?.dispose();
  }, []);

  useFrame(() => {
    const mesh = meshRef.current;
    if (!mesh) return;
    const pts = entity.trailPoints;
    if (pts.length < 2 || !entity.alive) {
      mesh.visible = false;
      sig.current.n = -1; // buộc dựng lại khi đuôi xuất hiện trở lại
      return;
    }
    mesh.visible = true;

    // Điểm ĐẦU (đang vẽ) dịch liên tục khi thực thể chạy; làm tròn 0.1 world unit để bỏ
    // qua dao động cực nhỏ mà vẫn bám sát đầu.
    const head = pts[pts.length - 1];
    const hx = Math.round(head.x * 10);
    const hy = Math.round(head.y * 10);
    const s = sig.current;
    if (s.n === pts.length && s.hx === hx && s.hy === hy) return; // không đổi → khỏi dựng
    s.n = pts.length;
    s.hx = hx;
    s.hy = hy;

    // Dựng lại đường cong từ pool Vector3 (mở rộng pool khi cần).
    const p = pool.current;
    while (p.length < pts.length) p.push(new THREE.Vector3());
    for (let i = 0; i < pts.length; i++) p[i].set(pts[i].x, pts[i].y, 0.45);
    const v3 = p.length === pts.length ? p : p.slice(0, pts.length);
    const curve = new THREE.CatmullRomCurve3(v3);
    // Đủ mượt với ít đoạn hơn: ~2 đoạn/​điểm, trần 200 (trước là 600) → geometry nhẹ hơn.
    const seg = Math.min(200, Math.max(8, pts.length * 2));
    const geo = new THREE.TubeGeometry(curve, seg, 0.18, 6, false);

    geomRef.current?.dispose();
    geomRef.current = geo;
    mesh.geometry = geo;
  });

  return (
    <mesh ref={meshRef} frustumCulled={false} visible={false}>
      <boxGeometry args={[0.001, 0.001, 0.001]} />
      <meshStandardMaterial
        color={entity.color.cube}
        emissive={entity.color.glow}
        emissiveIntensity={0.85}
        roughness={0.4}
        metalness={0.1}
      />
    </mesh>
  );
}

/** Vẽ đuôi cho MỌI thực thể. Tắt toàn bộ lớp qua CONFIG.DISPLAY.TRAILS. */
export const TrailLine = memo(function TrailLine({
  game,
}: {
  game: GameState;
}) {
  if (!CONFIG.DISPLAY.TRAILS) return null;
  return (
    <>
      {game.players.map((e) => (
        <EntityTrail key={e.id} entity={e} />
      ))}
    </>
  );
});
