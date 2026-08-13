import { BadRequestException, Body, Controller, Get, Patch, Req } from "@nestjs/common";
import type { Request } from "express";
import { SessionService } from "../auth/session.service";
import { SupabaseService } from "../database/supabase.service";

@Controller("v1")
export class PlayersController {
  constructor(private readonly sessions: SessionService, private readonly db: SupabaseService) {}

  @Get("me") async me(@Req() req: Request) {
    const player = await this.sessions.resolve(req);
    const [profile, stats, progression, wallets, inventory, loadout] = await Promise.all([
      this.db.from("player_profiles").select("*").eq("player_id", player.id).single(),
      this.db.from("player_stats").select("*").eq("player_id", player.id).single(),
      this.db.from("player_progression").select("total_xp,level,updated_at").eq("player_id", player.id).single(),
      this.db.from("player_wallets").select("currency_code,balance").eq("player_id", player.id),
      this.db.from("player_inventory").select("quantity,created_at,shop_items(id,sku,type,asset_key,name,rarity)").eq("player_id", player.id),
      this.db.from("player_loadouts").select("*").eq("player_id", player.id).single(),
    ]);
    return { player, profile: profile.data, stats: stats.data, progression: progression.data, wallets: wallets.data ?? [], inventory: inventory.data ?? [], loadout: loadout.data };
  }

  @Patch("me/profile") async profile(@Req() req: Request, @Body() body: { displayName?: string }) {
    const player = await this.sessions.resolve(req);
    const name = String(body.displayName ?? "").trim();
    if (name.length < 1 || name.length > 32) throw new BadRequestException("invalid_display_name");
    const { error } = await this.db.from("players").update({ display_name: name }).eq("id", player.id);
    if (error) throw new BadRequestException(error.message);
    return { ok: true, displayName: name };
  }
}
