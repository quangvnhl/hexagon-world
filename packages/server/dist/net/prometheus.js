"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.collectProcessMetrics = collectProcessMetrics;
exports.renderPrometheus = renderPrometheus;
const FRAME_KINDS = [
    "control",
    "snapshot",
    "territory_keyframe",
    "territory_delta",
    "territory_minimap",
];
function collectProcessMetrics() {
    const mem = process.memoryUsage();
    const cpu = process.cpuUsage();
    return {
        rssBytes: mem.rss,
        heapUsedBytes: mem.heapUsed,
        heapTotalBytes: mem.heapTotal,
        cpuSecondsTotal: (cpu.user + cpu.system) / 1e6,
        uptimeSeconds: process.uptime(),
    };
}
function line(name, value, labels) {
    const safe = Number.isFinite(value) ? value : 0;
    if (!labels)
        return `${name} ${safe}`;
    const rendered = Object.entries(labels)
        .map(([k, v]) => `${k}="${v}"`)
        .join(",");
    return `${name}{${rendered}} ${safe}`;
}
function renderPrometheus(network, telemetry, proc) {
    const out = [];
    out.push("# HELP hexworld_ws_frames_total Outbound ws frames sent, by kind.");
    out.push("# TYPE hexworld_ws_frames_total counter");
    for (const kind of FRAME_KINDS)
        out.push(line("hexworld_ws_frames_total", network.totals[kind].frames, { kind }));
    out.push("# HELP hexworld_ws_bytes_total Outbound ws bytes sent, by kind.");
    out.push("# TYPE hexworld_ws_bytes_total counter");
    for (const kind of FRAME_KINDS)
        out.push(line("hexworld_ws_bytes_total", network.totals[kind].bytes, { kind }));
    out.push("# HELP hexworld_ws_dropped_total Outbound ws frames dropped by backpressure, by kind.");
    out.push("# TYPE hexworld_ws_dropped_total counter");
    for (const kind of FRAME_KINDS)
        out.push(line("hexworld_ws_dropped_total", network.totals[kind].dropped, { kind }));
    out.push("# HELP hexworld_ws_bytes_per_second Recent outbound throughput, by kind.");
    out.push("# TYPE hexworld_ws_bytes_per_second gauge");
    for (const kind of FRAME_KINDS)
        out.push(line("hexworld_ws_bytes_per_second", network.bytesPerSecond[kind], { kind }));
    out.push("# HELP hexworld_ws_buffered_connections Connections currently over the backpressure threshold.");
    out.push("# TYPE hexworld_ws_buffered_connections gauge");
    out.push(line("hexworld_ws_buffered_connections", network.currentBufferedConnections));
    out.push("# HELP hexworld_ws_backpressure_bytes Configured backpressure threshold in bytes.");
    out.push("# TYPE hexworld_ws_backpressure_bytes gauge");
    out.push(line("hexworld_ws_backpressure_bytes", network.backpressureBytes));
    const t = telemetry.tick;
    out.push("# HELP hexworld_tick_step_ms stepRoom duration in milliseconds (all rooms).");
    out.push("# TYPE hexworld_tick_step_ms summary");
    out.push(line("hexworld_tick_step_ms", t.stepMs.p50, { quantile: "0.5" }));
    out.push(line("hexworld_tick_step_ms", t.stepMs.p95, { quantile: "0.95" }));
    out.push(line("hexworld_tick_step_ms_max", t.stepMs.max));
    out.push(line("hexworld_tick_step_ms_count", t.stepMs.count));
    out.push("# HELP hexworld_eventloop_lag_ms Event-loop scheduling lag in milliseconds.");
    out.push("# TYPE hexworld_eventloop_lag_ms summary");
    out.push(line("hexworld_eventloop_lag_ms", t.eventLoopLagMs.p50, { quantile: "0.5" }));
    out.push(line("hexworld_eventloop_lag_ms", t.eventLoopLagMs.p95, { quantile: "0.95" }));
    out.push(line("hexworld_eventloop_lag_ms_max", t.eventLoopLagMs.max));
    out.push(line("hexworld_eventloop_lag_ms_count", t.eventLoopLagMs.count));
    out.push("# HELP hexworld_tick_total Total simulation steps executed.");
    out.push("# TYPE hexworld_tick_total counter");
    out.push(line("hexworld_tick_total", t.total));
    out.push("# HELP hexworld_tick_behind_total Loops that ran >=2 steps or were clamped at dt*5.");
    out.push("# TYPE hexworld_tick_behind_total counter");
    out.push(line("hexworld_tick_behind_total", t.behind));
    out.push("# HELP hexworld_rooms_active Rooms currently alive (including waiting rooms).");
    out.push("# TYPE hexworld_rooms_active gauge");
    out.push(line("hexworld_rooms_active", t.roomsActive));
    const ac = telemetry.antiCheat;
    out.push("# HELP hexworld_ws_input_dropped_total Binary input frames dropped by per-connection rate limit.");
    out.push("# TYPE hexworld_ws_input_dropped_total counter");
    out.push(line("hexworld_ws_input_dropped_total", ac.inputDropped));
    out.push("# HELP hexworld_ws_text_flood_total Text frames rejected by per-connection rate limit.");
    out.push("# TYPE hexworld_ws_text_flood_total counter");
    out.push(line("hexworld_ws_text_flood_total", ac.textFlood));
    out.push("# HELP hexworld_ws_text_disconnect_total Sockets closed for repeated text flooding.");
    out.push("# TYPE hexworld_ws_text_disconnect_total counter");
    out.push(line("hexworld_ws_text_disconnect_total", ac.textDisconnect));
    out.push("# HELP hexworld_ws_ip_rejected_total New connections refused by the per-IP cap.");
    out.push("# TYPE hexworld_ws_ip_rejected_total counter");
    out.push(line("hexworld_ws_ip_rejected_total", ac.ipRejected));
    out.push("# HELP hexworld_process_resident_memory_bytes Resident set size in bytes.");
    out.push("# TYPE hexworld_process_resident_memory_bytes gauge");
    out.push(line("hexworld_process_resident_memory_bytes", proc.rssBytes));
    out.push("# HELP hexworld_process_heap_used_bytes V8 heap used in bytes.");
    out.push("# TYPE hexworld_process_heap_used_bytes gauge");
    out.push(line("hexworld_process_heap_used_bytes", proc.heapUsedBytes));
    out.push("# HELP hexworld_process_heap_total_bytes V8 heap total in bytes.");
    out.push("# TYPE hexworld_process_heap_total_bytes gauge");
    out.push(line("hexworld_process_heap_total_bytes", proc.heapTotalBytes));
    out.push("# HELP hexworld_process_cpu_seconds_total Total user+system CPU time in seconds.");
    out.push("# TYPE hexworld_process_cpu_seconds_total counter");
    out.push(line("hexworld_process_cpu_seconds_total", proc.cpuSecondsTotal));
    out.push("# HELP hexworld_process_uptime_seconds Process uptime in seconds.");
    out.push("# TYPE hexworld_process_uptime_seconds gauge");
    out.push(line("hexworld_process_uptime_seconds", proc.uptimeSeconds));
    return out.join("\n") + "\n";
}
//# sourceMappingURL=prometheus.js.map