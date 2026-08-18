import { randomUUID } from "node:crypto";
import { Body, Controller, ForbiddenException, Post, Req, Res } from "@nestjs/common";
import type { Request, Response } from "express";
import { IdentityService } from "./identity.service";
import { SessionService } from "./session.service";
import { SupabaseService } from "../database/supabase.service";
import { runtimeConfig } from "../runtime-config";

/**
 * Đăng nhập DEV — chỉ để thử local (Campaign cần session để đọc năng lượng/tiến độ).
 *
 * CHẶN CHẶT production: yêu cầu env `DEV_LOGIN=true` VÀ `NODE_ENV !== "production"`
 * (cookieSecure=false). Production không đặt `DEV_LOGIN` ⇒ endpoint luôn 403, kể cả khi
 * NODE_ENV bị cấu hình sai. Tạo/nhận một player "dev:<tên>" rồi cấp cookie session.
 */
@Controller("v1/auth")
export class DevAuthController {
  constructor(
    private readonly identities: IdentityService,
    private readonly sessions: SessionService,
    private readonly db: SupabaseService,
  ) {}

  @Post("dev") async dev(@Req() req: Request, @Res({ passthrough: true }) res: Response, @Body() body: { name?: string }) {
    const cfg = runtimeConfig();
    if (process.env.DEV_LOGIN !== "true" || cfg.cookieSecure) {
      throw new ForbiddenException("dev_login_disabled");
    }
    const name = String(body.name ?? "Dev").trim().slice(0, 16) || "Dev";
    const playerId = await this.identities.createOrGet({
      platform: "dev",
      provider: "dev",
      providerUserId: `dev:${name.toLowerCase()}`,
      displayName: name,
    });
    await this.sessions.create(playerId, "dev", res);
    // Tặng coin mỗi lần đăng nhập dev để thử mua năng lượng/shop (ref ngẫu nhiên ⇒ cộng dồn).
    try {
      await this.db.rpc("admin_grant_coin", {
        p_player_id: playerId, p_amount: 1000, p_admin_actor: "dev-login",
        p_reason: "dev top-up", p_reference_id: randomUUID(),
      });
    } catch { /* không chặn đăng nhập nếu grant lỗi */ }
    return { ok: true, playerId, displayName: name };
  }
}
