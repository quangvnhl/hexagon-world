import { BadRequestException, Body, Controller, Get, Post, Put, Req } from "@nestjs/common";
import type { Request } from "express";
import { SessionService } from "../auth/session.service";
import { SupabaseService } from "../database/supabase.service";

@Controller("v1")
export class ShopController {
  constructor(private readonly sessions: SessionService, private readonly db: SupabaseService) {}

  @Get("shop/catalog") async catalog() {
    const now = new Date().toISOString();
    const { data, error } = await this.db.from("shop_items").select("id,sku,type,asset_key,name,rarity,is_default_free,shop_prices(id,platform,currency_code,amount,starts_at,ends_at)").eq("active", true).eq("shop_prices.active", true).lte("shop_prices.starts_at", now);
    if (error) throw new BadRequestException(error.message);
    const items = (data ?? []).map((item) => {
      const prices = Array.isArray(item.shop_prices) ? item.shop_prices as Array<{ ends_at: string | null }> : [];
      return { ...item, shop_prices: prices.filter((price) => !price.ends_at || Date.parse(price.ends_at) > Date.now()) };
    });
    return { items };
  }

  @Post("shop/purchases") async purchase(@Req() req: Request, @Body() body: { itemId?: string; idempotencyKey?: string }) {
    const player = await this.sessions.resolve(req);
    if (!body.itemId || !body.idempotencyKey) throw new BadRequestException("missing_purchase_fields");
    const orderId = await this.db.rpc<string>("purchase_item_with_coin", { p_player_id: player.id, p_platform: player.platform, p_item_id: body.itemId, p_idempotency_key: body.idempotencyKey });
    return { orderId, status: "fulfilled" };
  }

  @Put("loadout") async loadout(@Req() req: Request, @Body() body: { colorItemId?: string; shapeItemId?: string; trailItemId?: string }) {
    const player = await this.sessions.resolve(req);
    const ids = [body.colorItemId, body.shapeItemId, body.trailItemId].filter(Boolean) as string[];
    const { data } = await this.db.from("player_inventory").select("item_id,shop_items(type,asset_key)").eq("player_id", player.id).in("item_id", ids);
    if ((data?.length ?? 0) !== ids.length) throw new BadRequestException("item_not_owned");
    const byType = new Map<string, { id: string; asset: string }>();
    for (const row of data ?? []) { const item = row.shop_items as unknown as { type: string; asset_key: string }; byType.set(item.type, { id: row.item_id, asset: item.asset_key }); }
    const patch = { color_item_id: byType.get("color")?.id, shape_item_id: byType.get("shape")?.id, trail_item_id: byType.get("trail")?.id, updated_at: new Date().toISOString() };
    const { error } = await this.db.from("player_loadouts").update(patch).eq("player_id", player.id);
    if (error) throw new BadRequestException(error.message);
    await this.db.from("player_profiles").update({ selected_color: byType.get("color")?.asset, selected_shape: byType.get("shape")?.asset, selected_trail_pattern: byType.get("trail")?.asset, updated_at: new Date().toISOString() }).eq("player_id", player.id);
    return { ok: true };
  }
}
