import { WebSocket } from "ws";

export type OutboundFrameKind = "control" | "snapshot" | "territory_keyframe" | "territory_delta" | "territory_minimap";
export interface FrameMetric { frames: number; bytes: number; dropped: number; }
export interface NetworkMetricsSnapshot {
  sampledAt: string;
  backpressureBytes: number;
  currentBufferedConnections: number;
  totals: Record<OutboundFrameKind, FrameMetric>;
  bytesPerSecond: Record<OutboundFrameKind, number>;
}

const KINDS: OutboundFrameKind[] = ["control", "snapshot", "territory_keyframe", "territory_delta", "territory_minimap"];
const emptyMetric = (): FrameMetric => ({ frames: 0, bytes: 0, dropped: 0 });

export class NetworkMetrics {
  private readonly totals = Object.fromEntries(KINDS.map((kind) => [kind, emptyMetric()])) as Record<OutboundFrameKind, FrameMetric>;
  private readonly buckets = new Map<number, Record<OutboundFrameKind, number>>();
  private readonly buffered = new Set<WebSocket>();

  recordSent(kind: OutboundFrameKind, bytes: number, now = Date.now()): void {
    this.totals[kind].frames++;
    this.totals[kind].bytes += bytes;
    const second = Math.floor(now / 1000);
    let bucket = this.buckets.get(second);
    if (!bucket) {
      bucket = Object.fromEntries(KINDS.map((entry) => [entry, 0])) as Record<OutboundFrameKind, number>;
      this.buckets.set(second, bucket);
    }
    bucket[kind] += bytes;
    for (const key of this.buckets.keys()) if (key < second - 1) this.buckets.delete(key);
  }

  recordDropped(kind: OutboundFrameKind, ws: WebSocket): void { this.totals[kind].dropped++; this.buffered.add(ws); }
  markWritable(ws: WebSocket): void { this.buffered.delete(ws); }
  remove(ws: WebSocket): void { this.buffered.delete(ws); }

  snapshot(backpressureBytes: number, now = Date.now()): NetworkMetricsSnapshot {
    const second = Math.floor(now / 1000);
    const current = this.buckets.get(second) ?? this.buckets.get(second - 1);
    return {
      sampledAt: new Date(now).toISOString(), backpressureBytes,
      currentBufferedConnections: this.buffered.size,
      totals: Object.fromEntries(KINDS.map((kind) => [kind, { ...this.totals[kind] }])) as Record<OutboundFrameKind, FrameMetric>,
      bytesPerSecond: Object.fromEntries(KINDS.map((kind) => [kind, current?.[kind] ?? 0])) as Record<OutboundFrameKind, number>,
    };
  }

  reset(): void { for (const kind of KINDS) Object.assign(this.totals[kind], emptyMetric()); this.buckets.clear(); this.buffered.clear(); }
}

export const gameNetworkMetrics = new NetworkMetrics();
function payloadBytes(data: string | ArrayBuffer | Uint8Array): number { return typeof data === "string" ? Buffer.byteLength(data) : data.byteLength; }

export class NetworkTransport {
  constructor(readonly backpressureBytes: number, private readonly metrics: NetworkMetrics = gameNetworkMetrics) {}
  send(ws: WebSocket, data: string | ArrayBuffer | Uint8Array, kind: OutboundFrameKind, options: { binary?: boolean; droppable?: boolean } = {}): boolean {
    if (ws.readyState !== WebSocket.OPEN) return false;
    if (options.droppable && ws.bufferedAmount >= this.backpressureBytes) { this.metrics.recordDropped(kind, ws); return false; }
    this.metrics.markWritable(ws);
    if (options.binary === undefined) ws.send(data);
    else ws.send(data, { binary: options.binary });
    this.metrics.recordSent(kind, payloadBytes(data));
    return true;
  }
  remove(ws: WebSocket): void { this.metrics.remove(ws); }
  snapshot(): NetworkMetricsSnapshot { return this.metrics.snapshot(this.backpressureBytes); }
}
