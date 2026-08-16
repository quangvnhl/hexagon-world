/**
 * Pha 5 · B1 — công cụ rate-limit thuần (không phụ thuộc framework, dễ unit test).
 *
 *  - `TokenBucket`: chặn flood khung INPUT nhị phân mỗi kết nối. Cho phép burst tới
 *    `capacity` token rồi hồi ở `refillPerSec`; khi cạn token → khung thừa bị DROP im lặng.
 *  - `SlidingWindowCounter`: chặn flood khung TEXT (join/resume/…) theo cửa sổ trượt.
 */

/** Gáo token hồi liên tục theo thời gian. Idempotent với input (chỉ giữ heading mới nhất). */
export class TokenBucket {
  private tokens: number;
  private last: number;

  constructor(
    private readonly capacity: number,
    private readonly refillPerSec: number,
    now: number = Date.now(),
  ) {
    this.tokens = capacity;
    this.last = now;
  }

  /** Tiêu 1 token. Trả về true nếu còn token (CHO QUA), false nếu cạn (nên DROP). */
  tryConsume(now: number = Date.now()): boolean {
    this.refill(now);
    if (this.tokens >= 1) {
      this.tokens -= 1;
      return true;
    }
    return false;
  }

  private refill(now: number): void {
    if (now <= this.last) return;
    const elapsedSec = (now - this.last) / 1000;
    this.tokens = Math.min(this.capacity, this.tokens + elapsedSec * this.refillPerSec);
    this.last = now;
  }
}

/** Đếm số sự kiện trong cửa sổ trượt `windowMs`; báo vượt trần `max`. */
export class SlidingWindowCounter {
  private readonly hits: number[] = [];

  constructor(
    private readonly max: number,
    private readonly windowMs: number,
  ) {}

  /**
   * Ghi nhận một sự kiện tại thời điểm `now`.
   * Trả về true nếu VẪN trong trần, false nếu sự kiện này làm VƯỢT trần cửa sổ.
   */
  record(now: number = Date.now()): boolean {
    const cutoff = now - this.windowMs;
    while (this.hits.length > 0 && this.hits[0] <= cutoff) this.hits.shift();
    this.hits.push(now);
    return this.hits.length <= this.max;
  }
}
