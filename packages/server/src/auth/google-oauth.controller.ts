import { BadRequestException, Controller, Get, Query, Req, Res } from "@nestjs/common";
import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import { OAuth2Client } from "google-auth-library";
import type { Request, Response } from "express";
import { IdentityService } from "./identity.service";
import { SessionService } from "./session.service";
import { runtimeConfig } from "../runtime-config";

const STATE_COOKIE = "hex_oauth_state";
const NONCE_COOKIE = "hex_oauth_nonce";

function signedState(secret: string): string {
  const raw = randomBytes(24).toString("base64url");
  const sig = createHmac("sha256", secret).update(raw).digest("base64url");
  return `${raw}.${sig}`;
}

function validState(value: string, secret: string): boolean {
  const [raw, sig] = value.split(".");
  if (!raw || !sig) return false;
  const expected = createHmac("sha256", secret).update(raw).digest();
  const actual = Buffer.from(sig, "base64url");
  return actual.length === expected.length && timingSafeEqual(actual, expected);
}

@Controller("v1/auth/web/google")
export class GoogleOAuthController {
  constructor(private readonly identities: IdentityService, private readonly sessions: SessionService) {}

  private client(): OAuth2Client {
    const cfg = runtimeConfig().google;
    return new OAuth2Client(cfg.clientId, cfg.clientSecret, cfg.redirectUri);
  }

  @Get("start")
  start(@Res() res: Response): void {
    const cfg = runtimeConfig();
    const state = signedState(cfg.google.stateSecret);
    const nonce = randomBytes(24).toString("base64url");
    const cookie = { httpOnly: true, secure: cfg.cookieSecure, sameSite: "lax" as const, maxAge: cfg.google.stateTtlSeconds * 1000, path: "/v1/auth/web/google/callback" };
    res.cookie(STATE_COOKIE, state, cookie);
    res.cookie(NONCE_COOKIE, nonce, cookie);
    const url = this.client().generateAuthUrl({ access_type: "online", scope: cfg.google.scopes.split(/\s+/), state, prompt: "select_account", include_granted_scopes: false, nonce } as Parameters<OAuth2Client["generateAuthUrl"]>[0]);
    res.redirect(url);
  }

  @Get("callback")
  async callback(@Query("code") code: string, @Query("state") state: string, @Query("error") oauthError: string, @Req() req: Request, @Res() res: Response): Promise<void> {
    const cfg = runtimeConfig();
    if (oauthError) throw new BadRequestException(`google_oauth_${oauthError}`);
    const cookieState = String(req.cookies?.[STATE_COOKIE] ?? "");
    const nonce = String(req.cookies?.[NONCE_COOKIE] ?? "");
    if (!code || !state || state !== cookieState || !validState(state, cfg.google.stateSecret) || !nonce) throw new BadRequestException("invalid_oauth_state");
    res.clearCookie(STATE_COOKIE, { path: "/v1/auth/web/google/callback" });
    res.clearCookie(NONCE_COOKIE, { path: "/v1/auth/web/google/callback" });
    const client = this.client();
    const { tokens } = await client.getToken(code);
    if (!tokens.id_token) throw new BadRequestException("missing_google_id_token");
    const ticket = await client.verifyIdToken({ idToken: tokens.id_token, audience: cfg.google.clientId });
    const payload = ticket.getPayload();
    if (!payload?.sub || payload.nonce !== nonce) throw new BadRequestException("invalid_google_id_token");
    const displayName = String(payload.name || payload.email || "Google Player");
    const playerId = await this.identities.createOrGet({ platform: "web", provider: "google", providerUserId: payload.sub, displayName, username: payload.email, metadata: { email: payload.email, picture: payload.picture } });
    await this.sessions.create(playerId, "web", res);
    res.redirect(cfg.google.postLoginRedirectUri);
  }
}
