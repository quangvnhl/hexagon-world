import { Controller, Get } from "@nestjs/common";
import { SupabaseService } from "./database/supabase.service";
import { runtimeConfig } from "./runtime-config";

@Controller("health")
export class HealthController {
  constructor(private readonly db: SupabaseService) {}
  @Get("live") live() { return { ok: true, role: runtimeConfig().role, region: runtimeConfig().region }; }
  @Get("ping") ping() { return { ok: true, region: runtimeConfig().region, time: Date.now() }; }
  @Get("ready") async ready() { const database = runtimeConfig().role === "game" ? true : await this.db.health(); return { ok: database, database }; }
}
