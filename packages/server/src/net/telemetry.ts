/**
 * Pha 5 · B3 — Telemetry vận hành cho server authoritative.
 *
 * Gom số liệu KHÔNG thuộc mạng-thuần (đã có `gameNetworkMetrics`):
 *   - Tick/room: thời lượng `stepRoom` (p50/p95), event-loop lag, số tick "behind", số room sống.
 *   - Bộ đếm B1: input dropped, text flood, socket đóng do flood, IP bị chặn.
 *
 * Là singleton tiến trình (giống `gameNetworkMetrics`) để controller `/metrics` gom được mà
 * không cần tham chiếu trực tiếp tới NetServer. NetServer bơm số vào trong vòng lặp tick.
 */

/** Giữ tối đa ngần này mẫu gần nhất cho mỗi reservoir (đủ cho phân vị ổn định, chặn RAM). */
const SAMPLE_CAP = 4096;

function quantile(sortedAsc: number[], q: number): number {
  if (sortedAsc.length === 0) return 0;
  if (sortedAsc.length === 1) return sortedAsc[0];
  const pos = (sortedAsc.length - 1) * q;
  const lo = Math.floor(pos);
  const hi = Math.ceil(pos);
  if (lo === hi) return sortedAsc[lo];
  const frac = pos - lo;
  return sortedAsc[lo] * (1 - frac) + sortedAsc[hi] * frac;
}

export interface TelemetrySnapshot {
  sampledAt: string;
  tick: {
    /** Thời lượng stepRoom (ms), gộp mọi room. */
    stepMs: { p50: number; p95: number; max: number; count: number };
    /** Event-loop lag (ms): lệch giữa lịch setTimeout và lúc chạy thật. */
    eventLoopLagMs: { p50: number; p95: number; max: number; count: number };
    /** Tổng số bước mô phỏng đã chạy (mẫu số cho tỷ lệ behind). */
    total: number;
    /** Số vòng loop phải chạy ≥2 bước hoặc bị kẹp dt*5 (chỉ báo bão hòa). */
    behind: number;
    /** Số room đang sống (kể cả phòng chờ). */
    roomsActive: number;
  };
  antiCheat: {
    inputDropped: number;
    textFlood: number;
    textDisconnect: number;
    ipRejected: number;
  };
}

class Reservoir {
  private readonly samples: number[] = [];
  private max = 0;
  private count = 0;

  add(value: number): void {
    this.count++;
    if (value > this.max) this.max = value;
    if (this.samples.length >= SAMPLE_CAP) this.samples.shift();
    this.samples.push(value);
  }

  stats(): { p50: number; p95: number; max: number; count: number } {
    const sorted = [...this.samples].sort((a, b) => a - b);
    return {
      p50: quantile(sorted, 0.5),
      p95: quantile(sorted, 0.95),
      max: this.max,
      count: this.count,
    };
  }

  reset(): void {
    this.samples.length = 0;
    this.max = 0;
    this.count = 0;
  }
}

export class ServerTelemetry {
  private readonly stepMs = new Reservoir();
  private readonly lagMs = new Reservoir();
  private tickTotal = 0;
  private tickBehind = 0;
  private roomsActive = 0;

  private inputDropped = 0;
  private textFlood = 0;
  private textDisconnect = 0;
  private ipRejected = 0;

  /** Thời lượng một bước `stepRoom` (ms). */
  recordTickStep(ms: number): void {
    if (Number.isFinite(ms) && ms >= 0) this.stepMs.add(ms);
  }

  /** Event-loop lag đo được ở đầu một vòng loop (ms). Chỉ ghi giá trị không âm. */
  recordEventLoopLag(ms: number): void {
    if (Number.isFinite(ms) && ms >= 0) this.lagMs.add(ms);
  }

  /**
   * Kết một vòng loop đã bước mô phỏng: `steps` bước đã chạy, `clamped` = có kẹp dt*5 không.
   * Tick "behind" = phải chạy ≥2 bước trong một vòng, HOẶC bị kẹp dt*5.
   */
  recordTick(steps: number, clamped: boolean): void {
    if (steps <= 0) return;
    this.tickTotal += steps;
    if (steps >= 2 || clamped) this.tickBehind++;
  }

  setRoomsActive(count: number): void {
    this.roomsActive = Math.max(0, Math.round(count));
  }

  incInputDropped(count = 1): void { this.inputDropped += count; }
  incTextFlood(count = 1): void { this.textFlood += count; }
  incTextDisconnect(count = 1): void { this.textDisconnect += count; }
  incIpRejected(count = 1): void { this.ipRejected += count; }

  snapshot(now: number = Date.now()): TelemetrySnapshot {
    return {
      sampledAt: new Date(now).toISOString(),
      tick: {
        stepMs: this.stepMs.stats(),
        eventLoopLagMs: this.lagMs.stats(),
        total: this.tickTotal,
        behind: this.tickBehind,
        roomsActive: this.roomsActive,
      },
      antiCheat: {
        inputDropped: this.inputDropped,
        textFlood: this.textFlood,
        textDisconnect: this.textDisconnect,
        ipRejected: this.ipRejected,
      },
    };
  }

  /** Chỉ dùng trong test để cô lập trạng thái singleton. */
  reset(): void {
    this.stepMs.reset();
    this.lagMs.reset();
    this.tickTotal = 0;
    this.tickBehind = 0;
    this.roomsActive = 0;
    this.inputDropped = 0;
    this.textFlood = 0;
    this.textDisconnect = 0;
    this.ipRejected = 0;
  }
}

export const serverTelemetry = new ServerTelemetry();
