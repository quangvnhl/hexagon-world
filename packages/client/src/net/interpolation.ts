// Nội suy (interpolation) cho các thực thể TỪ XA (remote). Thuần, kiểm thử được.
//
// Ta render các thực thể khác ở một thời điểm TRỄ so với hiện tại (`INTERP_DELAY_MS`)
// để luôn có hai snapshot bao quanh thời điểm render → nội suy tuyến tính vị trí và
// nội suy góc theo cung NGẮN NHẤT (xử lý mối nối -pi ↔ pi). Buffer được giữ có giới hạn.

import { normalizeAngle } from "./stepHead";

/** Độ trễ render (ms): thời điểm render = thời gian client mới nhất - độ trễ này. */
export const INTERP_DELAY_MS = 100;

/** Trạng thái nội suy tối thiểu của một thực thể. */
export interface InterpState {
  x: number;
  y: number;
  heading: number;
}

interface Frame {
  time: number;
  entities: Map<number, InterpState>;
}

/** Nội suy tuyến tính góc theo cung ngắn nhất (không vòng qua đường 0 sai hướng). */
export function lerpAngle(a: number, b: number, t: number): number {
  // Chênh lệch đưa về (-pi, pi] rồi cộng theo tỉ lệ → luôn đi đường ngắn.
  const diff = normalizeAngle(b - a);
  return a + diff * t;
}

const lerp = (a: number, b: number, t: number): number => a + (b - a) * t;

/**
 * Buffer snapshot cho nội suy thực thể từ xa.
 *
 * - `insert(time, entities)` đẩy một snapshot (đã sắp theo thời gian tăng dần).
 * - `sample(renderTime)` tìm hai snapshot bao quanh `renderTime`, nội suy từng thực
 *   thể; clamp về snapshot mới/cũ nhất khi `renderTime` nằm ngoài khoảng.
 */
export class InterpolationBuffer {
  private frames: Frame[] = [];
  /** Giữ tối đa bao nhiêu snapshot (chặn buffer phình vô hạn). */
  private readonly maxFrames: number;
  private readonly delayMs: number;

  constructor(maxFrames = 60, delayMs = INTERP_DELAY_MS) {
    this.maxFrames = maxFrames;
    this.delayMs = delayMs;
  }

  /** Đẩy một snapshot vào buffer tại thời điểm `time` (ms). */
  insert(time: number, entities: Map<number, InterpState>): void {
    this.frames.push({ time, entities });
    // Giữ thứ tự tăng dần theo thời gian (phòng khi tới không đúng thứ tự).
    if (this.frames.length > 1 && time < this.frames[this.frames.length - 2].time) {
      this.frames.sort((a, b) => a.time - b.time);
    }
    // Cắt bớt snapshot cũ để buffer có giới hạn.
    if (this.frames.length > this.maxFrames) {
      this.frames.splice(0, this.frames.length - this.maxFrames);
    }
  }

  /** Thời gian client mới nhất đã biết (ms), hoặc null nếu buffer rỗng. */
  latestTime(): number | null {
    return this.frames.length ? this.frames[this.frames.length - 1].time : null;
  }

  /** Thời điểm render đề xuất = thời gian mới nhất - độ trễ. */
  renderTime(): number | null {
    const latest = this.latestTime();
    return latest === null ? null : latest - this.delayMs;
  }

  /**
   * Lấy mẫu trạng thái nội suy của TẤT CẢ thực thể tại `renderTime` (ms).
   * Nếu không truyền `renderTime`, dùng `renderTime()` mặc định.
   */
  sample(renderTime?: number): Map<number, InterpState> {
    const out = new Map<number, InterpState>();
    if (this.frames.length === 0) return out;

    const t =
      renderTime ?? this.renderTime() ?? this.frames[this.frames.length - 1].time;

    // Trước snapshot cũ nhất → clamp về cũ nhất.
    if (t <= this.frames[0].time) {
      for (const [id, s] of this.frames[0].entities) out.set(id, { ...s });
      return out;
    }
    // Sau snapshot mới nhất → clamp về mới nhất.
    const last = this.frames[this.frames.length - 1];
    if (t >= last.time) {
      for (const [id, s] of last.entities) out.set(id, { ...s });
      return out;
    }

    // Tìm cặp (a, b) sao cho a.time <= t < b.time.
    let a = this.frames[0];
    let b = this.frames[1];
    for (let i = 1; i < this.frames.length; i++) {
      if (this.frames[i].time > t) {
        a = this.frames[i - 1];
        b = this.frames[i];
        break;
      }
    }

    const span = b.time - a.time;
    const alpha = span > 0 ? (t - a.time) / span : 0;

    // Nội suy các thực thể có mặt ở snapshot A (mốc gốc). Nếu B cũng có → nội suy;
    // nếu không (thực thể vừa biến mất) → giữ nguyên vị trí ở A.
    for (const [id, sa] of a.entities) {
      const sb = b.entities.get(id);
      if (sb) {
        out.set(id, {
          x: lerp(sa.x, sb.x, alpha),
          y: lerp(sa.y, sb.y, alpha),
          heading: lerpAngle(sa.heading, sb.heading, alpha),
        });
      } else {
        out.set(id, { ...sa });
      }
    }
    return out;
  }

  /** Xoá toàn bộ buffer. */
  clear(): void {
    this.frames = [];
  }
}
