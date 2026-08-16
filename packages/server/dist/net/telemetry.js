"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.serverTelemetry = exports.ServerTelemetry = void 0;
const SAMPLE_CAP = 4096;
function quantile(sortedAsc, q) {
    if (sortedAsc.length === 0)
        return 0;
    if (sortedAsc.length === 1)
        return sortedAsc[0];
    const pos = (sortedAsc.length - 1) * q;
    const lo = Math.floor(pos);
    const hi = Math.ceil(pos);
    if (lo === hi)
        return sortedAsc[lo];
    const frac = pos - lo;
    return sortedAsc[lo] * (1 - frac) + sortedAsc[hi] * frac;
}
class Reservoir {
    constructor() {
        this.samples = [];
        this.max = 0;
        this.count = 0;
    }
    add(value) {
        this.count++;
        if (value > this.max)
            this.max = value;
        if (this.samples.length >= SAMPLE_CAP)
            this.samples.shift();
        this.samples.push(value);
    }
    stats() {
        const sorted = [...this.samples].sort((a, b) => a - b);
        return {
            p50: quantile(sorted, 0.5),
            p95: quantile(sorted, 0.95),
            max: this.max,
            count: this.count,
        };
    }
    reset() {
        this.samples.length = 0;
        this.max = 0;
        this.count = 0;
    }
}
class ServerTelemetry {
    constructor() {
        this.stepMs = new Reservoir();
        this.lagMs = new Reservoir();
        this.tickTotal = 0;
        this.tickBehind = 0;
        this.roomsActive = 0;
        this.inputDropped = 0;
        this.textFlood = 0;
        this.textDisconnect = 0;
        this.ipRejected = 0;
    }
    recordTickStep(ms) {
        if (Number.isFinite(ms) && ms >= 0)
            this.stepMs.add(ms);
    }
    recordEventLoopLag(ms) {
        if (Number.isFinite(ms) && ms >= 0)
            this.lagMs.add(ms);
    }
    recordTick(steps, clamped) {
        if (steps <= 0)
            return;
        this.tickTotal += steps;
        if (steps >= 2 || clamped)
            this.tickBehind++;
    }
    setRoomsActive(count) {
        this.roomsActive = Math.max(0, Math.round(count));
    }
    incInputDropped(count = 1) { this.inputDropped += count; }
    incTextFlood(count = 1) { this.textFlood += count; }
    incTextDisconnect(count = 1) { this.textDisconnect += count; }
    incIpRejected(count = 1) { this.ipRejected += count; }
    snapshot(now = Date.now()) {
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
    reset() {
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
exports.ServerTelemetry = ServerTelemetry;
exports.serverTelemetry = new ServerTelemetry();
//# sourceMappingURL=telemetry.js.map