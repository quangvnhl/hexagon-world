"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.NetworkTransport = exports.gameNetworkMetrics = exports.NetworkMetrics = void 0;
const ws_1 = require("ws");
const KINDS = ["control", "snapshot", "territory_keyframe", "territory_delta", "territory_minimap"];
const emptyMetric = () => ({ frames: 0, bytes: 0, dropped: 0 });
class NetworkMetrics {
    constructor() {
        this.totals = Object.fromEntries(KINDS.map((kind) => [kind, emptyMetric()]));
        this.buckets = new Map();
        this.buffered = new Set();
    }
    recordSent(kind, bytes, now = Date.now()) {
        this.totals[kind].frames++;
        this.totals[kind].bytes += bytes;
        const second = Math.floor(now / 1000);
        let bucket = this.buckets.get(second);
        if (!bucket) {
            bucket = Object.fromEntries(KINDS.map((entry) => [entry, 0]));
            this.buckets.set(second, bucket);
        }
        bucket[kind] += bytes;
        for (const key of this.buckets.keys())
            if (key < second - 1)
                this.buckets.delete(key);
    }
    recordDropped(kind, ws) { this.totals[kind].dropped++; this.buffered.add(ws); }
    markWritable(ws) { this.buffered.delete(ws); }
    remove(ws) { this.buffered.delete(ws); }
    snapshot(backpressureBytes, now = Date.now()) {
        const second = Math.floor(now / 1000);
        const current = this.buckets.get(second) ?? this.buckets.get(second - 1);
        return {
            sampledAt: new Date(now).toISOString(), backpressureBytes,
            currentBufferedConnections: this.buffered.size,
            totals: Object.fromEntries(KINDS.map((kind) => [kind, { ...this.totals[kind] }])),
            bytesPerSecond: Object.fromEntries(KINDS.map((kind) => [kind, current?.[kind] ?? 0])),
        };
    }
    reset() { for (const kind of KINDS)
        Object.assign(this.totals[kind], emptyMetric()); this.buckets.clear(); this.buffered.clear(); }
}
exports.NetworkMetrics = NetworkMetrics;
exports.gameNetworkMetrics = new NetworkMetrics();
function payloadBytes(data) { return typeof data === "string" ? Buffer.byteLength(data) : data.byteLength; }
class NetworkTransport {
    constructor(backpressureBytes, metrics = exports.gameNetworkMetrics) {
        this.backpressureBytes = backpressureBytes;
        this.metrics = metrics;
    }
    send(ws, data, kind, options = {}) {
        if (ws.readyState !== ws_1.WebSocket.OPEN)
            return false;
        if (options.droppable && ws.bufferedAmount >= this.backpressureBytes) {
            this.metrics.recordDropped(kind, ws);
            return false;
        }
        this.metrics.markWritable(ws);
        if (options.binary === undefined)
            ws.send(data);
        else
            ws.send(data, { binary: options.binary });
        this.metrics.recordSent(kind, payloadBytes(data));
        return true;
    }
    remove(ws) { this.metrics.remove(ws); }
    snapshot() { return this.metrics.snapshot(this.backpressureBytes); }
}
exports.NetworkTransport = NetworkTransport;
//# sourceMappingURL=network-transport.js.map