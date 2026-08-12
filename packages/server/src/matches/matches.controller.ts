import { Body, Controller, Headers, Post, UnauthorizedException } from "@nestjs/common";
import { createHmac, timingSafeEqual } from "node:crypto";
import { SupabaseService } from "../database/supabase.service";
import { runtimeConfig } from "../runtime-config";

@Controller("internal/v1")
export class MatchesController {
  constructor(private readonly db: SupabaseService) {}
  @Post("match-results") async result(@Headers("x-game-signature") signature: string, @Body() body: Record<string, unknown>) {
    const secret = runtimeConfig().gameResultSecret;
    const expected = createHmac("sha256", secret).update(JSON.stringify(body)).digest();
    const actual = Buffer.from(String(signature || ""), "hex");
    if (!secret || actual.length !== expected.length || !timingSafeEqual(actual, expected)) throw new UnauthorizedException("invalid_game_signature");
    const inserted = await this.db.rpc<boolean>("record_match_result", { p_payload: body });
    return { inserted };
  }
}
