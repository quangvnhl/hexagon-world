import { Controller, Post, Req, Res } from "@nestjs/common";
import type { Request, Response } from "express";
import { SessionService } from "./session.service";

@Controller("v1/auth")
export class AuthController {
  constructor(private readonly sessions: SessionService) {}
  @Post("logout") async logout(@Req() req: Request, @Res({ passthrough: true }) res: Response) {
    await this.sessions.revoke(req, res);
    return { ok: true };
  }
  @Post("refresh") async refresh(@Req() req: Request, @Res({ passthrough: true }) res: Response) {
    const player = await this.sessions.resolve(req);
    await this.sessions.revoke(req, res);
    const sessionToken = await this.sessions.create(player.id, player.platform, res);
    return { ok: true, sessionToken };
  }
}
