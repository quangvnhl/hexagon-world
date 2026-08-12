import { Injectable, UnauthorizedException } from "@nestjs/common";
import { randomBytes } from "node:crypto";
import type { Request, Response } from "express";
import { SupabaseService } from "../database/supabase.service";
import { runtimeConfig, sha256 } from "../runtime-config";

export interface AuthPlayer { id: string; displayName: string; platform: string; }

@Injectable()
export class SessionService {
  static readonly COOKIE = "hex_session";
  constructor(private readonly db: SupabaseService) {}

  async create(playerId: string, source: string, res: Response): Promise<string> {
    const cfg = runtimeConfig();
    const token = randomBytes(32).toString("base64url");
    const expiresAt = new Date(Date.now() + cfg.sessionTtlSeconds * 1000).toISOString();
    const { error } = await this.db.from("player_sessions").insert({ player_id: playerId, source, token_hash: sha256(token), expires_at: expiresAt });
    if (error) throw new Error(`Không thể tạo session: ${error.message}`);
    res.cookie(SessionService.COOKIE, token, { httpOnly: true, secure: cfg.cookieSecure, sameSite: "lax", maxAge: cfg.sessionTtlSeconds * 1000, path: "/" });
    return token;
  }

  clear(res: Response): void { res.clearCookie(SessionService.COOKIE, { path: "/" }); }

  tokenFrom(req: Request): string {
    const auth = req.headers.authorization;
    if (auth?.startsWith("Bearer ")) return auth.slice(7).trim();
    return String(req.cookies?.[SessionService.COOKIE] ?? "");
  }

  async resolve(req: Request): Promise<AuthPlayer> {
    const token = this.tokenFrom(req);
    if (!token) throw new UnauthorizedException("missing_session");
    const { data, error } = await this.db.from("player_sessions")
      .select("player_id,source,expires_at,revoked_at,players!inner(id,display_name,status)")
      .eq("token_hash", sha256(token)).is("revoked_at", null).gt("expires_at", new Date().toISOString()).maybeSingle();
    if (error || !data) throw new UnauthorizedException("invalid_session");
    const player = data.players as unknown as { id: string; display_name: string; status: string };
    if (player.status !== "active") throw new UnauthorizedException("player_inactive");
    return { id: player.id, displayName: player.display_name, platform: String(data.source) };
  }

  async revoke(req: Request, res: Response): Promise<void> {
    const token = this.tokenFrom(req);
    if (token) await this.db.from("player_sessions").update({ revoked_at: new Date().toISOString() }).eq("token_hash", sha256(token));
    this.clear(res);
  }
}
