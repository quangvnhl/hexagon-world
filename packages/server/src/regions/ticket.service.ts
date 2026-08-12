import { BadRequestException, Injectable, UnauthorizedException } from "@nestjs/common";
import { createHmac, createPrivateKey, createPublicKey, randomUUID, sign, timingSafeEqual, verify } from "node:crypto";
import type { PlayerAppearance } from "@hexagon/shared";
import { runtimeConfig } from "../runtime-config";

export interface GameTicketPayload {
  jti: string;
  playerId: string | null;
  guestId: string | null;
  isGuest: boolean;
  platform: string;
  displayName: string;
  region: string;
  appearance: PlayerAppearance;
  iat: number;
  exp: number;
}

function encode(value: unknown): string { return Buffer.from(JSON.stringify(value)).toString("base64url"); }

@Injectable()
export class TicketService {
  issue(input: Omit<GameTicketPayload, "jti" | "iat" | "exp">): string {
    const cfg = runtimeConfig();
    const now = Math.floor(Date.now() / 1000);
    const payload: GameTicketPayload = { ...input, jti: randomUUID(), iat: now, exp: now + cfg.ticket.ttlSeconds };
    const alg = cfg.ticket.privateKeyBase64 ? "EdDSA" : "HS256";
    if (cfg.role === "control" && alg !== "EdDSA") throw new Error("Control plane production cần private key ký region ticket");
    const signingInput = `${encode({ alg, typ: "HGT" })}.${encode(payload)}`;
    const signature = alg === "EdDSA"
      ? sign(null, Buffer.from(signingInput), createPrivateKey(Buffer.from(cfg.ticket.privateKeyBase64, "base64"))).toString("base64url")
      : createHmac("sha256", cfg.sessionSecret).update(signingInput).digest("base64url");
    return `${signingInput}.${signature}`;
  }

  verify(token: string, expectedRegion = runtimeConfig().region): GameTicketPayload {
    const [headerPart, payloadPart, signaturePart] = token.split(".");
    if (!headerPart || !payloadPart || !signaturePart) throw new UnauthorizedException("invalid_game_ticket");
    let header: { alg?: string }; let payload: GameTicketPayload;
    try { header = JSON.parse(Buffer.from(headerPart, "base64url").toString()); payload = JSON.parse(Buffer.from(payloadPart, "base64url").toString()); }
    catch { throw new UnauthorizedException("invalid_game_ticket"); }
    const cfg = runtimeConfig();
    const signingInput = `${headerPart}.${payloadPart}`;
    let valid = false;
    if (header.alg === "EdDSA" && cfg.ticket.publicKeyBase64) {
      valid = verify(null, Buffer.from(signingInput), createPublicKey(Buffer.from(cfg.ticket.publicKeyBase64, "base64")), Buffer.from(signaturePart, "base64url"));
    } else if (header.alg === "HS256" && cfg.role === "all") {
      const expected = createHmac("sha256", cfg.sessionSecret).update(signingInput).digest();
      const actual = Buffer.from(signaturePart, "base64url");
      valid = actual.length === expected.length && timingSafeEqual(actual, expected);
    }
    const now = Math.floor(Date.now() / 1000);
    if (!valid || payload.exp <= now || payload.iat > now + 30) throw new UnauthorizedException("expired_or_invalid_game_ticket");
    if (payload.region !== expectedRegion) throw new BadRequestException("wrong_game_region");
    return payload;
  }
}
