import { Controller, Get } from "@nestjs/common";
import { opsMetrics } from "./ops-metrics";
import { SupabaseService } from "./database/supabase.service";
import { runtimeConfig } from "./runtime-config";
import { gameNetworkMetrics } from "./net/network-transport";
import { WS_BACKPRESSURE_BYTES } from "./config";

@Controller("health")
export class HealthController {
  constructor(private readonly db: SupabaseService) {}
  @Get("live") live() { return { ok: true, role: runtimeConfig().role, region: runtimeConfig().region }; }
  @Get("ping") ping() { return { ok: true, region: runtimeConfig().region, time: Date.now() }; }
  /** Internal operational counters; expose only behind the deployment's admin/proxy ACL. */
  @Get("network") network() { return gameNetworkMetrics.snapshot(WS_BACKPRESSURE_BYTES); }
  /** Public URLs only. Useful for verifying the environment actually loaded by a deployed container. */
  @Get("public-config") publicConfig() {
    const cfg = runtimeConfig();
    return {
      googleRedirectUri: cfg.google.redirectUri,
      postLoginRedirectUri: cfg.google.postLoginRedirectUri,
      regions: cfg.regions,
    };
  }
  @Get("ready") async ready() {
    const database = runtimeConfig().role === "game" ? true : await this.db.health();
    // doc 35 §C1 — `/health/ready` là MỘT LẦN HỎI; alert cần một CHUỖI THỜI GIAN. Ghi lại đây để
    // `hexworld_db_ready` trong `/metrics` phản ánh lần kiểm gần nhất.
    opsMetrics.setDbReady(database);
    return { ok: database, database };
  }
}
