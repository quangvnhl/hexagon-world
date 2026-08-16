import { beforeEach, describe, expect, it } from "vitest";
import { ServerTelemetry, serverTelemetry } from "../src/net/telemetry";
import { collectProcessMetrics, renderPrometheus } from "../src/net/prometheus";
import { NetworkMetrics } from "../src/net/network-transport";

describe("ServerTelemetry", () => {
  it("tính p50/p95 thời lượng tick và đếm tick behind", () => {
    const t = new ServerTelemetry();
    for (let i = 1; i <= 100; i++) t.recordTickStep(i); // 1..100 ms
    t.recordTick(1, false); // bình thường
    t.recordTick(3, false); // ≥2 bước → behind
    t.recordTick(1, true); // bị kẹp dt*5 → behind
    t.setRoomsActive(4);
    const snap = t.snapshot();
    expect(snap.tick.stepMs.p50).toBeCloseTo(50.5, 5);
    expect(snap.tick.stepMs.p95).toBeCloseTo(95.05, 5);
    expect(snap.tick.stepMs.max).toBe(100);
    expect(snap.tick.total).toBe(5); // 1 + 3 + 1
    expect(snap.tick.behind).toBe(2);
    expect(snap.tick.roomsActive).toBe(4);
  });

  it("đếm sự kiện B1 và reset sạch", () => {
    const t = new ServerTelemetry();
    t.incInputDropped();
    t.incInputDropped(2);
    t.incTextFlood();
    t.incTextDisconnect();
    t.incIpRejected();
    let snap = t.snapshot();
    expect(snap.antiCheat).toEqual({ inputDropped: 3, textFlood: 1, textDisconnect: 1, ipRejected: 1 });
    t.reset();
    snap = t.snapshot();
    expect(snap.antiCheat).toEqual({ inputDropped: 0, textFlood: 0, textDisconnect: 0, ipRejected: 0 });
    expect(snap.tick.stepMs.count).toBe(0);
  });
});

describe("Prometheus renderer", () => {
  it("expose đủ hợp đồng metric hexworld_* với định dạng hợp lệ", () => {
    serverTelemetry.reset();
    serverTelemetry.recordTickStep(2.5);
    serverTelemetry.recordEventLoopLag(1.2);
    serverTelemetry.recordTick(1, false);
    serverTelemetry.setRoomsActive(2);
    serverTelemetry.incInputDropped(4);

    const net = new NetworkMetrics();
    const text = renderPrometheus(
      net.snapshot(262144),
      serverTelemetry.snapshot(),
      collectProcessMetrics(),
    );

    // Metric có khối HELP/TYPE riêng (summary _max/_count là sub-line, không có HELP/TYPE).
    const documented = [
      "hexworld_ws_frames_total",
      "hexworld_ws_bytes_total",
      "hexworld_ws_dropped_total",
      "hexworld_ws_bytes_per_second",
      "hexworld_ws_buffered_connections",
      "hexworld_ws_backpressure_bytes",
      "hexworld_tick_step_ms",
      "hexworld_eventloop_lag_ms",
      "hexworld_tick_total",
      "hexworld_tick_behind_total",
      "hexworld_rooms_active",
      "hexworld_ws_input_dropped_total",
      "hexworld_ws_text_flood_total",
      "hexworld_ws_text_disconnect_total",
      "hexworld_ws_ip_rejected_total",
      "hexworld_process_resident_memory_bytes",
      "hexworld_process_heap_used_bytes",
      "hexworld_process_heap_total_bytes",
      "hexworld_process_cpu_seconds_total",
      "hexworld_process_uptime_seconds",
    ];
    for (const name of documented) {
      expect(text, `thiếu HELP cho ${name}`).toContain(`# HELP ${name} `);
      expect(text, `thiếu TYPE cho ${name}`).toContain(`# TYPE ${name} `);
    }
    // Sub-line của summary vẫn phải hiện diện.
    for (const sub of ["hexworld_tick_step_ms_max", "hexworld_tick_step_ms_count", "hexworld_eventloop_lag_ms_max", "hexworld_eventloop_lag_ms_count"]) {
      expect(text, `thiếu sub-line ${sub}`).toContain(sub + " ");
    }
    expect(text).toContain('hexworld_ws_frames_total{kind="snapshot"}');
    expect(text).toContain('hexworld_tick_step_ms{quantile="0.5"}');
    expect(text).toContain("hexworld_rooms_active 2");
    expect(text).toContain("hexworld_ws_input_dropped_total 4");
    expect(text.endsWith("\n")).toBe(true);
  });
});
