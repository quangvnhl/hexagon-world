import { Controller, Get, Header } from "@nestjs/common";
import { gameNetworkMetrics } from "./net/network-transport";
import { serverTelemetry } from "./net/telemetry";
import { collectProcessMetrics, renderPrometheus } from "./net/prometheus";
import { WS_BACKPRESSURE_BYTES } from "./config";

/**
 * Pha 5 · B3 — Endpoint Prometheus text ở `GET /metrics`.
 *
 * Gom network (gameNetworkMetrics) + tick (serverTelemetry) + B1 + process. Giữ NGUYÊN
 * `/health/network` cho tương thích. Đây là HỢP ĐỒNG scrape: tên metric ổn định `hexworld_*`.
 */
@Controller()
export class MetricsController {
  @Get("metrics")
  @Header("Content-Type", "text/plain; version=0.0.4")
  metrics(): string {
    return renderPrometheus(
      gameNetworkMetrics.snapshot(WS_BACKPRESSURE_BYTES),
      serverTelemetry.snapshot(),
      collectProcessMetrics(),
    );
  }
}
