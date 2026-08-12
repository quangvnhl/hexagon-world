"use client";

import { memo, useRef, useEffect } from "react";
import { useFrame } from "@react-three/fiber";
import * as THREE from "three";
import { GameState, Entity, CONFIG } from "@hexagon/shared";
import { getCameraGroundView, isInGroundView, type GroundView } from "./cameraVisibility";

/** Texture trắng có alpha; material nhân với màu nhân vật nên đuôi luôn đồng màu thân. */
function createPatternTexture(pattern: Entity["trailPattern"]): THREE.CanvasTexture | null {
  if (pattern === "solid") return null;
  const canvas = document.createElement("canvas");
  canvas.width = 128;
  canvas.height = 32;
  const ctx = canvas.getContext("2d");
  if (!ctx) return null;

  ctx.fillStyle = "rgba(255,255,255,0.18)";
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.fillStyle = "white";
  ctx.strokeStyle = "white";

  if (pattern === "stripes") {
    for (let x = -16; x < canvas.width + 16; x += 32) {
      ctx.beginPath();
      ctx.moveTo(x, canvas.height);
      ctx.lineTo(x + 18, 0);
      ctx.lineTo(x + 30, 0);
      ctx.lineTo(x + 12, canvas.height);
      ctx.closePath();
      ctx.fill();
    }
  } else if (pattern === "dots") {
    for (let x = 12; x < canvas.width; x += 24) {
      ctx.beginPath();
      ctx.arc(x, canvas.height / 2, 7, 0, Math.PI * 2);
      ctx.fill();
    }
  } else {
    ctx.lineWidth = 6;
    ctx.lineJoin = "round";
    for (let x = -10; x < canvas.width + 20; x += 30) {
      ctx.beginPath();
      ctx.moveTo(x, 4);
      ctx.lineTo(x + 13, canvas.height / 2);
      ctx.lineTo(x, canvas.height - 4);
      ctx.stroke();
    }
  }

  const texture = new THREE.CanvasTexture(canvas);
  texture.wrapS = THREE.RepeatWrapping;
  texture.wrapT = THREE.RepeatWrapping;
  texture.minFilter = THREE.LinearMipmapLinearFilter;
  texture.magFilter = THREE.LinearFilter;
  return texture;
}

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
  const materialRef = useRef<THREE.MeshStandardMaterial>(null);
  const lastAppearance = useRef("");
  const textureRef = useRef<THREE.CanvasTexture | null>(null);
  const geomRef = useRef<THREE.TubeGeometry | null>(null);
  // Chữ ký đuôi lần dựng gần nhất: số điểm + toạ độ điểm ĐẦU (làm tròn) → chỉ dựng lại khi đổi.
  const sig = useRef<{ n: number; hx: number; hy: number }>({ n: -1, hx: 0, hy: 0 });
  // Pool Vector3 tái sử dụng (tránh cấp phát mảng mỗi frame).
  const pool = useRef<THREE.Vector3[]>([]);
  const view = useRef<GroundView>({ x: 0, y: 0, radius: 0 });
  const lastCullAt = useRef(-Infinity);
  const inView = useRef(false);

  useEffect(() => {
    return () => {
      geomRef.current?.dispose();
      textureRef.current?.dispose();
    };
  }, []);

  useFrame(({ camera, size, clock }) => {
    const mesh = meshRef.current;
    if (!mesh) return;
    const pts = entity.trailPoints;
    if (pts.length < 2 || !entity.alive) {
      mesh.visible = false;
      sig.current.n = -1; // buộc dựng lại khi đuôi xuất hiện trở lại
      return;
    }

    // Chỉ kiểm tra vùng nhìn 10 lần/giây. Đuôi ngoài camera không dựng lại TubeGeometry.
    if (clock.elapsedTime - lastCullAt.current >= 0.1) {
      lastCullAt.current = clock.elapsedTime;
      getCameraGroundView(camera, size.width, size.height, view.current, 4);
      inView.current = false;
      for (let i = 0; i < pts.length; i++) {
        if (isInGroundView(view.current, pts[i].x, pts[i].y, 1.5)) {
          inView.current = true;
          break;
        }
      }
    }
    if (!inView.current) {
      mesh.visible = false;
      return;
    }

    const appearance = `${entity.colorIndex}:${entity.trailPattern}`;
    if (lastAppearance.current !== appearance) {
      lastAppearance.current = appearance;
      const mat = materialRef.current;
      textureRef.current?.dispose();
      textureRef.current = createPatternTexture(entity.trailPattern);
      if (mat) {
        mat.color.set(entity.color.glow);
        mat.emissive.set(entity.color.glow);
        mat.map = textureRef.current;
        mat.emissiveMap = textureRef.current;
        mat.transparent = textureRef.current !== null;
        mat.alphaTest = textureRef.current ? 0.04 : 0;
        mat.needsUpdate = true;
      }
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
    if (textureRef.current) {
      textureRef.current.repeat.set(Math.max(1, curve.getLength() / 1.15), 1);
    }
    // Đủ mượt với ít đoạn hơn: ~2 đoạn/​điểm, trần 200 (trước là 600) → geometry nhẹ hơn.
    const seg = Math.min(120, Math.max(8, Math.ceil(pts.length * 1.35)));
    const geo = new THREE.TubeGeometry(curve, seg, 0.18, 6, false);

    geomRef.current?.dispose();
    geomRef.current = geo;
    mesh.geometry = geo;
  });

  return (
    <mesh ref={meshRef} frustumCulled={false} visible={false}>
      <boxGeometry args={[0.001, 0.001, 0.001]} />
      <meshStandardMaterial
        ref={materialRef}
        color={entity.color.glow}
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
