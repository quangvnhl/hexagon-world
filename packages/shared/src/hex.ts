// Toán học lưới lục giác — pointy-top, toạ độ axial (q, r).
// Không import Three/React ở đây (để sau bê sang packages/shared).
// Tham chiếu: Red Blob Games "Hexagonal Grids".

export interface Axial {
  q: number;
  r: number;
}

export type HexKey = string;

export function key(q: number, r: number): HexKey {
  return q + "," + r;
}

export function keyOf(a: Axial): HexKey {
  return key(a.q, a.r);
}

export function parseKey(k: HexKey): Axial {
  const i = k.indexOf(",");
  return { q: Number(k.slice(0, i)), r: Number(k.slice(i + 1)) };
}

// 6 hướng láng giềng (pointy-top). Chỉ số 0..5.
export const DIRECTIONS: ReadonlyArray<Axial> = [
  { q: 1, r: 0 },
  { q: 1, r: -1 },
  { q: 0, r: -1 },
  { q: -1, r: 0 },
  { q: -1, r: 1 },
  { q: 0, r: 1 },
];

export function neighbor(a: Axial, dir: number): Axial {
  const d = DIRECTIONS[((dir % 6) + 6) % 6];
  return { q: a.q + d.q, r: a.r + d.r };
}

export function neighbors(a: Axial): Axial[] {
  return DIRECTIONS.map((d) => ({ q: a.q + d.q, r: a.r + d.r }));
}

/** Hướng ngược lại (quay đầu 180°). */
export function opposite(dir: number): number {
  return (dir + 3) % 6;
}

// --- Cube distance ---
export function cubeDistance(a: Axial, b: Axial): number {
  const ax = a.q;
  const az = a.r;
  const ay = -ax - az;
  const bx = b.q;
  const bz = b.r;
  const by = -bx - bz;
  return (Math.abs(ax - bx) + Math.abs(ay - by) + Math.abs(az - bz)) / 2;
}

const SQRT3 = Math.sqrt(3);

/** Axial → pixel (pointy-top). Trả về toạ độ mặt phẳng (x, y). */
export function axialToPixel(a: Axial, size: number): { x: number; y: number } {
  const x = size * (SQRT3 * a.q + (SQRT3 / 2) * a.r);
  const y = size * (1.5 * a.r);
  return { x, y };
}

/** Pixel → axial (chưa làm tròn). */
export function pixelToAxialFractional(
  x: number,
  y: number,
  size: number
): { q: number; r: number } {
  const q = ((SQRT3 / 3) * x - (1 / 3) * y) / size;
  const r = ((2 / 3) * y) / size;
  return { q, r };
}

/** Làm tròn toạ độ cube (x,y,z) về ô gần nhất, giữ x+y+z=0. */
export function roundCube(x: number, y: number, z: number): Axial {
  let rx = Math.round(x);
  let ry = Math.round(y);
  let rz = Math.round(z);
  const dx = Math.abs(rx - x);
  const dy = Math.abs(ry - y);
  const dz = Math.abs(rz - z);
  if (dx > dy && dx > dz) {
    rx = -ry - rz;
  } else if (dy > dz) {
    ry = -rx - rz;
  } else {
    rz = -rx - ry;
  }
  return { q: rx, r: rz };
}

/** Làm tròn toạ độ cube từ axial phân số (q, r). */
export function cubeRound(q: number, r: number): Axial {
  return roundCube(q, -q - r, r);
}

/** Danh sách ô trên đường thẳng hex từ a → b (gồm cả 2 đầu).
 *  Dùng để "vá" các ô bị bỏ qua khi di chuyển liên tục nhanh. */
export function hexLinedraw(a: Axial, b: Axial): Axial[] {
  const n = cubeDistance(a, b);
  if (n === 0) return [{ q: a.q, r: a.r }];
  const ax = a.q;
  const az = a.r;
  const ay = -ax - az;
  const bx = b.q;
  const bz = b.r;
  const by = -bx - bz;
  const out: Axial[] = [];
  for (let i = 0; i <= n; i++) {
    const t = i / n;
    out.push(
      roundCube(ax + (bx - ax) * t, ay + (by - ay) * t, az + (bz - az) * t)
    );
  }
  return out;
}

export function pixelToAxial(x: number, y: number, size: number): Axial {
  const f = pixelToAxialFractional(x, y, size);
  return cubeRound(f.q, f.r);
}

/** Tập ô hợp lệ trong SÂN HÌNH CHỮ NHẬT: mọi hex có TÂM nằm trong
 *  [-halfW, halfW] × [-halfH, halfH] (world). Cho biên thẳng. */
export function mapRect(halfW: number, halfH: number, size: number): Set<HexKey> {
  const cells = new Set<HexKey>();
  const rMax = Math.ceil(halfH / (1.5 * size)) + 1;
  const qMax = Math.ceil(halfW / (SQRT3 * size)) + rMax + 1;
  for (let r = -rMax; r <= rMax; r++) {
    for (let q = -qMax; q <= qMax; q++) {
      const p = axialToPixel({ q, r }, size);
      if (Math.abs(p.x) <= halfW && Math.abs(p.y) <= halfH) {
        cells.add(key(q, r));
      }
    }
  }
  return cells;
}

/** Tập ô hợp lệ của bản đồ lục giác bán kính `radius` quanh tâm (0,0). */
export function mapCells(radius: number): Set<HexKey> {
  const cells = new Set<HexKey>();
  for (let q = -radius; q <= radius; q++) {
    const rMin = Math.max(-radius, -q - radius);
    const rMax = Math.min(radius, -q + radius);
    for (let r = rMin; r <= rMax; r++) {
      cells.add(key(q, r));
    }
  }
  return cells;
}

/** Chọn chỉ số hướng (0..5) gần nhất với một vector (dx, dy) trên mặt phẳng.
 *  Lưu ý: trục y ở đây theo hệ world của axialToPixel (y tăng theo r). */
export function dirFromVector(dx: number, dy: number): number {
  let best = 0;
  let bestDot = -Infinity;
  for (let i = 0; i < 6; i++) {
    const p = axialToPixel(DIRECTIONS[i], 1);
    const len = Math.hypot(p.x, p.y) || 1;
    const dot = (p.x / len) * dx + (p.y / len) * dy;
    if (dot > bestDot) {
      bestDot = dot;
      best = i;
    }
  }
  return best;
}
