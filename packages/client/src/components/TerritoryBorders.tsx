"use client";

import { memo, useMemo, useRef } from "react";
import { useFrame } from "@react-three/fiber";
import * as THREE from "three";
import { GameState } from "@hexagon/shared";
import { CONFIG } from "@hexagon/shared";
import { parseKey, key, axialToPixel, DIRECTIONS } from "@hexagon/shared";

/**
 * VẠCH ngăn cách hai ô ĐẤT **cùng màu nhưng khác chủ** (nhiều thực thể dùng lại 6 màu nên
 * hai người khác nhau có thể trùng màu và dính liền). Vẽ bằng QUAD dày (không phải line
 * 1px). Hai LỚP để LUÔN NỔI trên mọi màu đất:
 *   - VIỀN TỐI (casing): quad RỘNG hơn, màu đục, blend thường, z thấp → tạo tương phản kể
 *     cả trên nền ấm (cam/vàng) nơi lõi vàng additive bị "cháy trắng" chìm.
 *   - LÕI VÀNG: quad hẹp, màu vàng cộng dồn (additive) phát sáng, z cao hơn.
 * Đặt `CONFIG.BORDER.CASING_WIDTH = 0` để tắt viền tối (chỉ còn lõi vàng như cũ).
 *
 * LUÔN VẼ TRÊN CÙNG: cả hai lớp dùng `depthTest=false` + `renderOrder` cao (casing 10 <
 * lõi 11) → vạch KHÔNG bao giờ bị ống đuôi/cube/hạt của các thực thể quét qua che, cũng
 * không z-fight khi camera pan. Đây là lý do vạch trước kia "lúc ẩn lúc hiện" (dữ liệu ổn
 * định — đã kiểm chứng — nhưng bị che theo độ sâu). Thứ tự 2 lớp giờ do renderOrder, không
 * còn phụ thuộc z của quad.
 *
 * "Cùng màu" so bằng MÀU RGB đất THỰC TẾ của 2 chủ (không dùng id%6) → đúng dù đổi số màu
 * trong PLAYER_COLORS (kể cả rút còn 1 màu cho mọi bot cùng màu).
 *
 * Dựng lại khi `territoryRevision` đổi (CHỦ ô đổi) — hiếm hơn `gridRevision` nhiều lần. Mỗi
 * ô chỉ xét 3 hướng (0..2) để mỗi cạnh vẽ đúng 1 lần (đối của hướng d là d+3).
 */
export const TerritoryBorders = memo(function TerritoryBorders({
  game,
}: {
  game: GameState;
}) {
  const coreGeom = useMemo(() => new THREE.BufferGeometry(), []);
  const caseGeom = useMemo(() => new THREE.BufferGeometry(), []);
  const glowColor = useMemo(() => {
    const c = new THREE.Color(CONFIG.BORDER.COLOR);
    c.multiplyScalar(CONFIG.BORDER.GLOW); // > 1 → sáng rực (toneMapped=false + additive)
    return c;
  }, []);
  const caseColor = useMemo(
    () => new THREE.Color(CONFIG.BORDER.CASING_COLOR),
    []
  );
  const casingOn = CONFIG.BORDER.CASING_WIDTH > 0;

  const lastRev = useRef(-1);
  // Bộ đệm đỉnh dùng lại cho từng lớp (chỉ cấp phát khi cần LỚN HƠN) → không sinh
  // Float32Array mỗi lần dựng lại ⇒ không dồn GC.
  const coreBuf = useRef<Float32Array>(new Float32Array(0));
  const caseBuf = useRef<Float32Array>(new Float32Array(0));
  const coreAttr = useRef<THREE.BufferAttribute | null>(null);
  const caseAttr = useRef<THREE.BufferAttribute | null>(null);

  useFrame(() => {
    if (lastRev.current === game.territoryRevision) return;
    lastRev.current = game.territoryRevision;

    const s = CONFIG.HEX_SIZE; // = bán kính ngoại tiếp = độ dài cạnh hex đều
    const half = s / 2; // nửa độ dài cạnh chung
    const wCore = CONFIG.BORDER.WIDTH / 2; // nửa bề rộng lõi
    const wCase = CONFIG.BORDER.CASING_WIDTH / 2; // nửa bề rộng viền tối
    // So MÀU THỰC TẾ (RGB đất) chứ KHÔNG dùng id % 6: số màu trong PLAYER_COLORS có thể đổi
    // (vd rút còn 1 màu để mọi bot cùng màu) → id%6 sai. So màu thật thì LUÔN đúng: hai ô
    // khác chủ mà cùng màu nhìn thấy ⇒ vẽ vạch. Tra cứu O(1)/cạnh qua bảng dựng 1 lần.
    const ownerColorKey = game.players.map((e) => e.color.owned.join(","));
    const core: number[] = [];
    const cased: number[] = [];

    // Đẩy 1 quad (2 tam giác) tâm (mx,my), dọc cạnh (ex,ey)·half, dày (nx,ny)·w, cao z.
    const pushQuad = (
      out: number[],
      mx: number,
      my: number,
      ex: number,
      ey: number,
      nx: number,
      ny: number,
      w: number,
      z: number
    ) => {
      const x1 = mx + ex * half,
        y1 = my + ey * half;
      const x2 = mx - ex * half,
        y2 = my - ey * half;
      const ox = nx * w,
        oy = ny * w;
      out.push(x1 + ox, y1 + oy, z, x2 + ox, y2 + oy, z, x2 - ox, y2 - oy, z);
      out.push(x1 + ox, y1 + oy, z, x2 - ox, y2 - oy, z, x1 - ox, y1 - oy, z);
    };

    game.forEachOwned((k, oid) => {
      const a = parseKey(k);
      const pa = axialToPixel(a, s);
      for (let d = 0; d < 3; d++) {
        const bq = a.q + DIRECTIONS[d].q;
        const br = a.r + DIRECTIONS[d].r;
        const nid = game.cellOwnerId(key(bq, br));
        if (nid < 0 || nid === oid) continue; // trống hoặc cùng chủ → bỏ
        if (ownerColorKey[nid] !== ownerColorKey[oid]) continue; // khác màu nhìn thấy → bỏ

        const pb = axialToPixel({ q: bq, r: br }, s);
        const mx = (pa.x + pb.x) / 2;
        const my = (pa.y + pb.y) / 2;
        // hướng nối 2 tâm (đơn vị) = pháp tuyến của cạnh chung
        let nx = pb.x - pa.x;
        let ny = pb.y - pa.y;
        const len = Math.hypot(nx, ny) || 1;
        nx /= len;
        ny /= len;
        // hướng dọc cạnh chung = vuông góc pháp tuyến
        const ex = -ny;
        const ey = nx;
        // Viền tối RỘNG hơn ở z thấp; lõi vàng HẸP ở z cao (nằm trên viền).
        if (casingOn) pushQuad(cased, mx, my, ex, ey, nx, ny, wCase, 0.055);
        pushQuad(core, mx, my, ex, ey, nx, ny, wCore, 0.06);
      }
    });

    writeLayer(coreBuf, coreAttr, coreGeom, core);
    if (casingOn) writeLayer(caseBuf, caseAttr, caseGeom, cased);
  });

  return (
    <>
      {casingOn && (
        <mesh geometry={caseGeom} frustumCulled={false} renderOrder={10}>
          <meshBasicMaterial
            color={caseColor}
            toneMapped={false}
            transparent
            depthWrite={false}
            depthTest={false}
            side={THREE.DoubleSide}
          />
        </mesh>
      )}
      <mesh geometry={coreGeom} frustumCulled={false} renderOrder={11}>
        <meshBasicMaterial
          color={glowColor}
          toneMapped={false}
          transparent
          depthWrite={false}
          depthTest={false}
          side={THREE.DoubleSide}
          blending={THREE.AdditiveBlending}
        />
      </mesh>
    </>
  );
});

/** Ghi mảng đỉnh `v` vào buffer dùng lại: chỉ cấp phát khi cần LỚN HƠN (dôi 1.5×), còn lại
 *  ghi đè tại chỗ + `setDrawRange` để bỏ phần thừa. Tránh cấp phát Float32Array mỗi frame. */
function writeLayer(
  bufRef: React.MutableRefObject<Float32Array>,
  attrRef: React.MutableRefObject<THREE.BufferAttribute | null>,
  geom: THREE.BufferGeometry,
  v: number[]
): void {
  if (bufRef.current.length < v.length || !attrRef.current) {
    bufRef.current = new Float32Array(Math.ceil(v.length * 1.5));
    const attr = new THREE.BufferAttribute(bufRef.current, 3);
    attr.setUsage(THREE.DynamicDrawUsage);
    attrRef.current = attr;
    geom.setAttribute("position", attr);
  }
  const arr = bufRef.current;
  for (let i = 0; i < v.length; i++) arr[i] = v[i];
  attrRef.current.needsUpdate = true;
  geom.setDrawRange(0, v.length / 3);
}
