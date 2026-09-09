import { Injectable } from "@nestjs/common";
import { sanitizeDisplayName } from "@hexagon/shared";
import { SupabaseService } from "../database/supabase.service";

@Injectable()
export class IdentityService {
  constructor(private readonly db: SupabaseService) {}

  createOrGet(input: { platform: string; provider: string; providerUserId: string; displayName: string; username?: string; metadata?: Record<string, unknown> }): Promise<string> {
    return this.db.rpc<string>("create_player_with_defaults", {
      p_platform: input.platform,
      p_provider: input.provider,
      p_provider_user_id: input.providerUserId,
      // doc 35 §C3 — tên LƯU TRỮ cũng phải sạch, không chỉ tên phát ra roster: nó còn đi vào
      // ticket vùng, vào `roster`, và vào bảng admin. Seed lấy `providerUserId` để cùng một người
      // luôn nhận cùng một tên thay thế giữa các lần đăng nhập.
      p_display_name: sanitizeDisplayName(input.displayName, input.providerUserId).name,
      p_provider_username: input.username ?? null,
      p_metadata: input.metadata ?? {},
    });
  }
}
