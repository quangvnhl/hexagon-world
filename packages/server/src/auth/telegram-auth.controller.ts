import { BadRequestException, Body, Controller, Post, Res } from "@nestjs/common";
import { createHmac, timingSafeEqual } from "node:crypto";
import type { Response } from "express";
import { IdentityService } from "./identity.service";
import { SessionService } from "./session.service";
import { runtimeConfig } from "../runtime-config";

interface TelegramWebUser { id: number; first_name?: string; last_name?: string; username?: string; }

export function verifyTelegramInitData(initData: string, botToken: string, maxAgeSeconds: number): TelegramWebUser {
  const params = new URLSearchParams(initData);
  const hash = params.get("hash") ?? "";
  params.delete("hash");
  const dataCheck = [...params.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([k, v]) => `${k}=${v}`).join("\n");
  const secret = createHmac("sha256", "WebAppData").update(botToken).digest();
  const expected = createHmac("sha256", secret).update(dataCheck).digest();
  const actual = Buffer.from(hash, "hex");
  if (actual.length !== expected.length || !timingSafeEqual(actual, expected)) throw new BadRequestException("invalid_telegram_signature");
  const authDate = Number(params.get("auth_date"));
  if (!Number.isFinite(authDate) || Math.abs(Date.now() / 1000 - authDate) > maxAgeSeconds) throw new BadRequestException("expired_telegram_init_data");
  try {
    const user = JSON.parse(params.get("user") ?? "null") as TelegramWebUser | null;
    if (!user?.id) throw new Error("missing user");
    return user;
  } catch { throw new BadRequestException("invalid_telegram_user"); }
}

@Controller("v1/auth")
export class TelegramAuthController {
  constructor(private readonly identities: IdentityService, private readonly sessions: SessionService) {}

  @Post("telegram")
  async login(@Body() body: { initData?: string }, @Res({ passthrough: true }) res: Response) {
    const cfg = runtimeConfig();
    if (!body.initData) throw new BadRequestException("missing_init_data");
    const user = verifyTelegramInitData(body.initData, cfg.telegram.botToken, cfg.telegram.initDataMaxAgeSeconds);
    const displayName = [user.first_name, user.last_name].filter(Boolean).join(" ") || user.username || `Telegram ${user.id}`;
    const playerId = await this.identities.createOrGet({ platform: "telegram", provider: "telegram", providerUserId: String(user.id), displayName, username: user.username });
    const token = await this.sessions.create(playerId, "telegram", res);
    return { playerId, sessionToken: token, platform: "telegram" };
  }
}
