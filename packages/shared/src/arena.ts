// Hình học SÂN CHƠI hình LỤC GIÁC (flat-top) + va chạm tường tổng quát.
// Thuần TypeScript, deterministic (chỉ phụ thuộc config) — dùng lại được trên server.
//
// Sân là lục giác đều tâm (0,0), bán kính ngoại tiếp R = radius.
// Biên gồm 6 tường; vùng chơi = giao của 6 nửa mặt phẳng { p : p·n_k ≤ inradius }.
// Vì lồi, việc "clamp về trong" và "trượt dọc tường" đều tổng quát cho mọi pháp tuyến.
//
// P0 (doc 25): hình học TỪNG VÁN gói trong `ArenaGeometry` (per-instance) để mỗi mode dựng
// sân riêng. Các export module-level (ARENA_R, WALL_LIMIT, insideArena, …) GIỮ NGUYÊN, nay là
// shim mỏng trỏ tới `DEFAULT_ARENA` (dựng từ CONFIG) → mọi render/debug/net cũ chạy y hệt.

import { CONFIG } from "./config";
import { key, axialToPixel, HexKey } from "./hex";

const SQRT3 = Math.sqrt(3);

export interface Wall {
  /** Pháp tuyến đơn vị hướng RA NGOÀI. */
  nx: number;
  ny: number;
}

/** 6 tường của lục giác flat-top: pháp tuyến tại 30°, 90°, …, 330°. ĐỘC LẬP với bán kính. */
export const WALLS: Wall[] = Array.from({ length: 6 }, (_, k) => {
  const ang = Math.PI / 6 + k * (Math.PI / 3);
  return { nx: Math.cos(ang), ny: Math.sin(ang) };
});

/**
 * Hình học + va chạm của MỘT sân lục giác. Mọi hàm vật lý chạy mỗi tick (`clampInside`,
 * `slideMove`, `insideArena`) đọc theo bán kính/biên của instance này ⇒ mỗi ván có sân riêng.
 */
export class ArenaGeometry {
  /** Bán kính ngoại tiếp HÌNH HỌC (tâm → đỉnh) — render/minimap/HUD. */
  readonly arenaR: number;
  /** Bán kính nội tiếp HÌNH HỌC (tâm → cạnh). */
  readonly inradius: number;
  /** Bán kính ngoại tiếp của BIÊN VA CHẠM (đã co theo wallScale) — vẽ line đỏ debug. */
  readonly wallR: number;
  /** Khoảng cách tâm → TƯỜNG VA CHẠM thật (inradius đã co). Nguồn duy nhất cho biên vật lý. */
  readonly wallLimit: number;
  readonly hexSize: number;
  readonly walls: Wall[] = WALLS;

  constructor(
    radius: number = CONFIG.ARENA_RADIUS,
    wallScale: number = CONFIG.WALL_SCALE,
    hexSize: number = CONFIG.HEX_SIZE,
  ) {
    this.arenaR = radius;
    this.inradius = (radius * SQRT3) / 2;
    this.wallR = radius * wallScale;
    this.wallLimit = this.inradius * wallScale;
    this.hexSize = hexSize;
  }

  /** Điểm (x,y) có nằm trong sân không (nới/thu biên bằng `slack`). */
  insideArena(x: number, y: number, slack = 0): boolean {
    const lim = this.wallLimit + slack;
    for (const w of WALLS) {
      if (x * w.nx + y * w.ny > lim) return false;
    }
    return true;
  }

  /** Kéo điểm trở về TRONG lục giác lồi (chiếu lên các nửa mặt phẳng bị vi phạm). */
  clampInside(x: number, y: number): { x: number; y: number } {
    for (let pass = 0; pass < 2; pass++) {
      for (const w of WALLS) {
        const d = x * w.nx + y * w.ny - this.wallLimit;
        if (d > 0) {
          x -= d * w.nx;
          y -= d * w.ny;
        }
      }
    }
    return { x, y };
  }

  /**
   * Di chuyển từ `(x,y)` theo `heading` một đoạn `dist`, TRƯỢT dọc tường ở tốc độ ĐẦY
   * ĐỦ (không chậm/đứng khi men theo biên) rồi đảm bảo điểm cuối nằm TRONG sân.
   *
   * Cách làm: bước "move-then-clamp" (dịch rồi kéo về trong lục giác) tự khử thành phần
   * pháp tuyến → phần còn lại là trượt DỌC tường; nhưng nó bị NGẮN lại (chậm) khi đâm
   * chếch. Ở đây, khi tường cắt bớt bước mà vẫn còn thành phần trượt đáng kể, ta KÉO DÀI
   * phần trượt về đủ `dist` (giữ nguyên tốc độ), rồi clamp lần nữa cho chắc trong sân.
   * Đâm gần VUÔNG GÓC hoặc ép đúng GÓC lồi (trượt quá ít) thì giữ bước đã clamp (đứng/nhích
   * nhẹ) — tránh "văng" ngang. `blocked` = bước bị tường cắt bớt (đang áp biên).
   */
  slideMove(
    x: number,
    y: number,
    heading: number,
    dist: number,
  ): { x: number; y: number; blocked: boolean } {
    const vx0 = Math.cos(heading);
    const vy0 = Math.sin(heading);

    // Các tường mà bước dự định sẽ VƯỢT (điểm đích ra ngoài & vận tốc hướng ra).
    const active: number[] = [];
    for (let k = 0; k < WALLS.length; k++) {
      const w = WALLS[k];
      const dest = (x + vx0 * dist) * w.nx + (y + vy0 * dist) * w.ny - this.wallLimit;
      if (dest > 0 && vx0 * w.nx + vy0 * w.ny > 0) active.push(k);
    }
    if (active.length === 0) {
      const c = this.clampInside(x + vx0 * dist, y + vy0 * dist);
      return { x: c.x, y: c.y, blocked: false };
    }

    // Bỏ thành phần PHÁP TUYẾN của các tường đang chặn → vận tốc TRƯỢT dọc tường. Lặp 2
    // lần để hội tụ khi có 2 tường (gần đỉnh).
    let vx = vx0;
    let vy = vy0;
    for (let pass = 0; pass < 2; pass++) {
      for (const k of active) {
        const w = WALLS[k];
        const vn = vx * w.nx + vy * w.ny;
        if (vn > 0) {
          vx -= vn * w.nx;
          vy -= vn * w.ny;
        }
      }
    }

    let len = Math.hypot(vx, vy);
    if (len <= 1e-4) {
      if (active.length === 1) {
        // Đâm gần VUÔNG GÓC vào MỘT tường → không tự có tiếp tuyến. Chọn tiếp tuyến (CCW)
        // của tường để VẪN TRƯỢT dọc biên (không đứng khựng / không dội lại). Chỉ cần con
        // trỏ lệch nhẹ là hướng trượt tự quyết định theo ý người chơi.
        const w = WALLS[active[0]];
        vx = -w.ny;
        vy = w.nx;
        len = 1;
      } else {
        // Ép đúng GÓC LỒI (≥2 tường ngược nhau) → không hướng thoát → đứng lại.
        return { x, y, blocked: true };
      }
    }

    // Chuẩn hoá → trượt ở TỐC ĐỘ ĐẦY ĐỦ; clamp cho chắc trong sân.
    vx /= len;
    vy /= len;
    const c = this.clampInside(x + vx * dist, y + vy * dist);
    return { x: c.x, y: c.y, blocked: true };
  }

  /**
   * Tập ô hợp lệ: mọi hex có TÂM nằm trong sân, nới thêm `margin` world units để tạo
   * vành ô "biên ngoài" (cho flood fill) và đảm bảo vị trí clamp luôn rơi vào ô hợp lệ.
   */
  mapArena(margin: number): Set<HexKey> {
    const size = this.hexSize;
    const reach = this.arenaR + margin + 1;
    const rMax = Math.ceil(reach / (1.5 * size)) + 1;
    const qMax = Math.ceil(reach / (SQRT3 * size)) + rMax + 1;
    const cells = new Set<HexKey>();
    for (let r = -rMax; r <= rMax; r++) {
      for (let q = -qMax; q <= qMax; q++) {
        const p = axialToPixel({ q, r }, size);
        if (this.insideArena(p.x, p.y, margin)) cells.add(key(q, r));
      }
    }
    return cells;
  }
}

/** Sân MẶC ĐỊNH dựng từ CONFIG — dùng cho render/debug/net (single-player & client-view). */
export const DEFAULT_ARENA = new ArenaGeometry();

// ---- Shim tương thích ngược: giữ nguyên API module-level cũ, trỏ về DEFAULT_ARENA. --------
/** Bán kính ngoại tiếp HÌNH HỌC (tâm → đỉnh) của sân mặc định. Dùng cho render/minimap/HUD. */
export const ARENA_R = DEFAULT_ARENA.arenaR;
/** Bán kính nội tiếp HÌNH HỌC (tâm → cạnh) của sân mặc định. */
export const ARENA_INRADIUS = DEFAULT_ARENA.inradius;
/** Bán kính ngoại tiếp của BIÊN VA CHẠM sân mặc định (đã co theo WALL_SCALE). */
export const WALL_R = DEFAULT_ARENA.wallR;
/** Khoảng cách tâm → TƯỜNG VA CHẠM thật của sân mặc định. */
export const WALL_LIMIT = DEFAULT_ARENA.wallLimit;

/** [shim] `insideArena` trên sân mặc định. */
export function insideArena(x: number, y: number, slack = 0): boolean {
  return DEFAULT_ARENA.insideArena(x, y, slack);
}
/** [shim] `clampInside` trên sân mặc định. */
export function clampInside(x: number, y: number): { x: number; y: number } {
  return DEFAULT_ARENA.clampInside(x, y);
}
/** [shim] `slideMove` trên sân mặc định. */
export function slideMove(
  x: number,
  y: number,
  heading: number,
  dist: number,
): { x: number; y: number; blocked: boolean } {
  return DEFAULT_ARENA.slideMove(x, y, heading, dist);
}
/** [shim] `mapArena` trên sân mặc định. */
export function mapArena(margin: number): Set<HexKey> {
  return DEFAULT_ARENA.mapArena(margin);
}
