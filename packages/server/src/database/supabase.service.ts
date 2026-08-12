import { Injectable, ServiceUnavailableException } from "@nestjs/common";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { runtimeConfig } from "../runtime-config";

@Injectable()
export class SupabaseService {
  private readonly client: SupabaseClient;

  constructor() {
    const cfg = runtimeConfig();
    this.client = createClient(cfg.supabaseUrl || "http://127.0.0.1", cfg.supabaseKey || "game-node-without-database", {
      auth: { autoRefreshToken: false, persistSession: false, detectSessionInUrl: false },
    });
  }

  from(table: string) { return this.client.from(table); }

  async rpc<T = unknown>(fn: string, params: Record<string, unknown>): Promise<T> {
    const { data, error } = await this.client.rpc(fn, params);
    if (error) throw new ServiceUnavailableException({ code: "database_error", message: error.message });
    return data as T;
  }

  async health(): Promise<boolean> {
    const { error } = await this.client.from("shop_items").select("id", { head: true, count: "exact" }).limit(1);
    return !error;
  }
}
