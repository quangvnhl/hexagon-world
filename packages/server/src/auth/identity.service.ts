import { Injectable } from "@nestjs/common";
import { SupabaseService } from "../database/supabase.service";

@Injectable()
export class IdentityService {
  constructor(private readonly db: SupabaseService) {}

  createOrGet(input: { platform: string; provider: string; providerUserId: string; displayName: string; username?: string; metadata?: Record<string, unknown> }): Promise<string> {
    return this.db.rpc<string>("create_player_with_defaults", {
      p_platform: input.platform,
      p_provider: input.provider,
      p_provider_user_id: input.providerUserId,
      p_display_name: input.displayName,
      p_provider_username: input.username ?? null,
      p_metadata: input.metadata ?? {},
    });
  }
}
