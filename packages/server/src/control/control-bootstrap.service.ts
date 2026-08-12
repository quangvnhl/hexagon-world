import { Injectable, Logger, type OnApplicationShutdown, type OnModuleInit } from "@nestjs/common";
import { SupabaseService } from "../database/supabase.service";
import { runtimeConfig } from "../runtime-config";

@Injectable()
export class ControlBootstrapService implements OnModuleInit, OnApplicationShutdown {
  private readonly logger = new Logger(ControlBootstrapService.name);
  private retentionTimer: NodeJS.Timeout | null = null;
  constructor(private readonly db: SupabaseService) {}
  async onModuleInit(): Promise<void> {
    const defaults = runtimeConfig().defaultAssets;
    try {
      await this.db.rpc("configure_default_shop_items", { p_color_asset_key: defaults.color, p_shape_asset_key: defaults.shape, p_trail_asset_key: defaults.trail });
    } catch (error) {
      this.logger.warn(`Chưa thể đồng bộ default catalog: ${error instanceof Error ? error.message : String(error)}`);
    }
    await this.runRetention();
    this.retentionTimer = setInterval(() => void this.runRetention(), 24 * 60 * 60 * 1000);
    this.retentionTimer.unref();
  }

  private async runRetention(): Promise<void> {
    try { await this.db.rpc("purge_old_match_history", { p_retention_days: runtimeConfig().matchRetentionDays }); }
    catch (error) { this.logger.warn(`Retention match history chưa chạy được: ${error instanceof Error ? error.message : String(error)}`); }
  }
  onApplicationShutdown(): void { if (this.retentionTimer) clearInterval(this.retentionTimer); this.retentionTimer = null; }
}
