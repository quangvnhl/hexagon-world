import { CONFIG } from "./config";
import {
  Axial,
  HexKey,
  key,
  keyOf,
  cubeDistance,
  mapRect,
  axialToPixel,
  pixelToAxial,
  hexLinedraw,
} from "./hex";
import { captureEnclosed } from "./floodfill";

export interface Vec2 {
  x: number;
  y: number;
}

/**
 * Trạng thái game thuần TypeScript, deterministic — không phụ thuộc render.
 *
 * DI CHUYỂN LIÊN TỤC (pixel): nhân vật luôn tiến về phía `heading` với tốc độ cố
 * định, quay đầu mượt về phía con trỏ. Lãnh thổ là tập ô hex; đường đi liên tục được
 * nội suy thành chuỗi hex liền mạch để dùng lại flood-fill khi khép vòng.
 */
export class GameState {
  readonly map: Set<HexKey>;
  /** Nửa kích thước sân (biên clamp). */
  readonly halfW = CONFIG.ARENA_HALF_W;
  readonly halfH = CONFIG.ARENA_HALF_H;

  pos: Vec2 = { x: 0, y: 0 };
  heading = 0;
  private targetHeading = 0;

  owned: Set<HexKey> = new Set();
  trailHexes: HexKey[] = [];
  private trailSet: Set<HexKey> = new Set();
  /** Chuỗi điểm liên tục để vẽ đường đuôi mượt. */
  trailPoints: Vec2[] = [];

  private currentHex: Axial = { q: 0, r: 0 };

  /** Tăng khi thực thể đổi (vị trí/đuôi) — cho renderer cube/line. */
  revision = 0;
  /** Tăng khi lưới cần tô lại (owned hoặc trail hex đổi). */
  gridRevision = 0;
  deaths = 0;

  constructor() {
    const m = CONFIG.MAP_MARGIN;
    this.map = mapRect(this.halfW + m, this.halfH + m, CONFIG.HEX_SIZE);
    this.spawn();
  }

  private spawn(): void {
    this.owned = new Set();
    this.trailHexes = [];
    this.trailSet = new Set();
    this.trailPoints = [];
    this.currentHex = { q: 0, r: 0 };
    this.pos = { x: 0, y: 0 };
    this.heading = 0;
    this.targetHeading = 0;
    const center: Axial = { q: 0, r: 0 };
    for (const k of this.map) {
      const a = keyToAxial(k);
      if (cubeDistance(a, center) <= CONFIG.START_RADIUS) this.owned.add(k);
    }
    this.revision++;
    this.gridRevision++;
  }

  reset(): void {
    this.deaths++;
    this.spawn();
  }

  setHeadingTarget(angle: number): void {
    this.targetHeading = angle;
  }

  get outside(): boolean {
    return this.trailHexes.length > 0;
  }

  hasTrail(k: HexKey): boolean {
    return this.trailSet.has(k);
  }

  territoryPct(): number {
    return (this.owned.size / this.map.size) * 100;
  }

  get isKing(): boolean {
    return this.territoryPct() >= CONFIG.KING_PCT;
  }

  private inMap(x: number, y: number): boolean {
    return this.map.has(keyOf(pixelToAxial(x, y, CONFIG.HEX_SIZE)));
  }

  /** Cập nhật theo thời gian thực. Gọi mỗi frame với dt (giây). */
  update(dt: number): void {
    // Quay đầu mượt về targetHeading (giới hạn tốc độ quay).
    const maxTurn = CONFIG.TURN_RATE * dt;
    let diff = normalizeAngle(this.targetHeading - this.heading);
    if (diff > maxTurn) diff = maxTurn;
    else if (diff < -maxTurn) diff = -maxTurn;
    this.heading += diff;

    const dist = CONFIG.SPEED * dt;
    const rawX = this.pos.x + Math.cos(this.heading) * dist;
    const rawY = this.pos.y + Math.sin(this.heading) * dist;

    // Biên THẲNG: clamp từng trục → thành phần song song biên vẫn đi tiếp (trượt mượt).
    const nx = clamp(rawX, -this.halfW, this.halfW);
    const ny = clamp(rawY, -this.halfH, this.halfH);
    if (Math.hypot(nx - this.pos.x, ny - this.pos.y) > 1e-7) {
      this.stepTo(nx, ny);
    }
  }

  /** API cho test: di chuyển tới (x,y) nếu ô đích hợp lệ. */
  moveTo(x: number, y: number): void {
    if (!this.inMap(x, y)) return;
    this.stepTo(x, y);
  }

  /** Áp dụng di chuyển tới (x,y) đã biết hợp lệ + xử lý hệ quả trên lưới. */
  private stepTo(x: number, y: number): void {
    const nextHex = pixelToAxial(x, y, CONFIG.HEX_SIZE);
    this.pos.x = x;
    this.pos.y = y;

    if (nextHex.q !== this.currentHex.q || nextHex.r !== this.currentHex.r) {
      const line = hexLinedraw(this.currentHex, nextHex);
      for (let i = 1; i < line.length; i++) {
        if (this.enterHex(line[i])) break; // true = chết → dừng xử lý
      }
      this.currentHex = nextHex;
      this.revision++;
    }

    // Ghi điểm cho đường đuôi khi đang ở ngoài.
    if (this.trailHexes.length > 0) {
      const pts = this.trailPoints;
      const last = pts[pts.length - 1];
      if (
        !last ||
        Math.hypot(x - last.x, y - last.y) >= CONFIG.TRAIL_POINT_DIST
      ) {
        pts.push({ x, y });
        this.revision++;
      }
    }
  }

  /** Xử lý khi đầu bước vào 1 ô hex mới. Trả về true nếu chết. */
  private enterHex(h: Axial): boolean {
    const hk = keyOf(h);

    if (this.owned.has(hk)) {
      if (this.trailHexes.length > 0) this.captureNow();
      return false;
    }

    if (this.trailSet.has(hk)) {
      this.reset(); // tự cắt đuôi → chết
      return true;
    }

    // Bắt đầu đuôi: seed điểm vẽ tại mép vùng an toàn.
    if (this.trailHexes.length === 0) {
      const p = axialToPixel(this.currentHex, CONFIG.HEX_SIZE);
      this.trailPoints = [{ x: p.x, y: p.y }];
    }
    this.trailHexes.push(hk);
    this.trailSet.add(hk);
    this.gridRevision++; // đánh dấu ô đã đi qua trên lưới
    return false;
  }

  private captureNow(): void {
    this.owned = captureEnclosed(this.map, this.owned, this.trailHexes);
    this.trailHexes = [];
    this.trailSet = new Set();
    this.trailPoints = [];
    this.gridRevision++;
  }
}

function keyToAxial(k: HexKey): Axial {
  const i = k.indexOf(",");
  return { q: Number(k.slice(0, i)), r: Number(k.slice(i + 1)) };
}

function clamp(v: number, lo: number, hi: number): number {
  return v < lo ? lo : v > hi ? hi : v;
}

/** Đưa góc về khoảng (-π, π]. */
function normalizeAngle(a: number): number {
  while (a > Math.PI) a -= Math.PI * 2;
  while (a <= -Math.PI) a += Math.PI * 2;
  return a;
}
