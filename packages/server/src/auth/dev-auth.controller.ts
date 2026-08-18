import { Body, Controller, ForbiddenException, Post, Req, Res } from "@nestjs/common";
import type { Request, Response } from "express";
import { IdentityService } from "./identity.service";
import { SessionService } from "./session.service";
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
  constructor(private readonly identities: IdentityService, private readonly sessions: SessionService) {}

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
    return { ok: true, playerId, displayName: name };
  }
}
