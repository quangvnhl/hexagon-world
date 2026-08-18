import { BadRequestException, Body, Controller, Delete, Get, Headers, Param, Post, Put, UnauthorizedException } from "@nestjs/common";
import { randomUUID, timingSafeEqual } from "node:crypto";
import { validateLevelDraft, type CampaignLevelDraft } from "@hexagon/shared";
import { SupabaseService } from "../database/supabase.service";
import { runtimeConfig, sha256 } from "../runtime-config";

@Controller("internal/v1/admin")
export class AdminController {
  constructor(private readonly db: SupabaseService) {}

  private authorize(key: string): string {
    const expected = runtimeConfig().adminApiKeyHash;
    const actual = sha256(String(key || ""));
    const a = Buffer.from(actual); const b = Buffer.from(expected);
    if (!expected || a.length !== b.length || !timingSafeEqual(a, b)) throw new UnauthorizedException("invalid_admin_key");
    return actual.slice(0, 12);
  }

  @Post("players/:id/grant-coin") async grant(@Headers("x-admin-key") key: string, @Param("id") playerId: string, @Body() body: { amount?: number; reason?: string; referenceId?: string }) {
    const actor = this.authorize(key);
    const amount = Number(body.amount);
    if (!Number.isSafeInteger(amount) || amount <= 0 || !body.reason) throw new BadRequestException("invalid_grant");
    const balance = await this.db.rpc<number>("admin_grant_coin", { p_player_id: playerId, p_amount: amount, p_admin_actor: actor, p_reason: String(body.reason).slice(0, 200), p_reference_id: body.referenceId || randomUUID() });
    return { playerId, balance };
  }

  @Post("retention/matches") async retention(@Headers("x-admin-key") key: string) {
    this.authorize(key);
    const deleted = await this.db.rpc<number>("purge_old_match_history", { p_retention_days: runtimeConfig().matchRetentionDays });
    return { deleted };
  }

  @Put("catalog/:itemId/price") async setPrice(@Headers("x-admin-key") key: string, @Param("itemId") itemId: string, @Body() body: { platform?: string; currency?: string; amount?: number }) {
    this.authorize(key);
    const platform = String(body.platform ?? "");
    const currency = String(body.currency ?? "");
    const amount = Number(body.amount);
    if (!platform || !["coin", "XTR"].includes(currency) || !Number.isSafeInteger(amount) || amount < 0 || (currency === "XTR" && platform !== "telegram")) throw new BadRequestException("invalid_price");
    const priceId = await this.db.rpc<string>("set_shop_price", { p_item_id: itemId, p_platform: platform, p_currency_code: currency, p_amount: amount });
    return { priceId };
  }

  @Put("catalog/defaults") async defaults(@Headers("x-admin-key") key: string, @Body() body: { colorAssetKey?: string; shapeAssetKey?: string; trailAssetKey?: string }) {
    this.authorize(key);
    if (!body.colorAssetKey || !body.shapeAssetKey || !body.trailAssetKey) throw new BadRequestException("missing_default_assets");
    await this.db.rpc("configure_default_shop_items", { p_color_asset_key: body.colorAssetKey, p_shape_asset_key: body.shapeAssetKey, p_trail_asset_key: body.trailAssetKey });
    return { ok: true };
  }

  @Delete("players/:id") async deletePlayer(@Headers("x-admin-key") key: string, @Param("id") playerId: string) {
    this.authorize(key);
    await this.db.from("player_sessions").update({ revoked_at: new Date().toISOString() }).eq("player_id", playerId);
    const { error } = await this.db.from("players").update({ status: "deleted", display_name: "Deleted Player", deleted_at: new Date().toISOString() }).eq("id", playerId);
    if (error) throw new BadRequestException(error.message);
    return { ok: true, mode: "soft-delete" };
  }

  // ---- Campaign levels (doc 29 §L4) — trình vẽ dùng các endpoint này để tạo/sửa/publish cấp. ----

  /** Liệt kê MỌI cấp (kể cả chưa publish) cho trình vẽ admin. */
  @Get("levels") async listLevels(@Headers("x-admin-key") key: string) {
    this.authorize(key);
    const { data, error } = await this.db.from("campaign_levels")
      .select("id,sort_order,name,config,powerups,unlock_requires,rewards,published,version,updated_at").order("sort_order");
    if (error) throw new BadRequestException(error.message);
    return { levels: data ?? [] };
  }

  /** Tạo/sửa 1 cấp. Validate cấu hình + unlock (tồn tại, không tự trỏ) trước khi upsert. */
  @Post("levels") async upsertLevel(@Headers("x-admin-key") key: string, @Body() draft: CampaignLevelDraft) {
    this.authorize(key);
    const errors = validateLevelDraft(draft);
    if (draft?.unlockRequires === draft?.id) errors.push("unlockRequires không được trỏ chính nó");
    if (errors.length) throw new BadRequestException({ code: "invalid_level", errors });
    if (draft.unlockRequires) {
      const { data } = await this.db.from("campaign_levels").select("id").eq("id", draft.unlockRequires).maybeSingle();
      if (!data) throw new BadRequestException({ code: "invalid_level", errors: [`unlockRequires trỏ id không tồn tại: ${draft.unlockRequires}`] });
    }
    const id = await this.db.rpc<string>("upsert_campaign_level", { p_level: draft });
    return { id };
  }

  /** Bật/tắt publish 1 cấp. */
  @Put("levels/:id/publish") async publishLevel(@Headers("x-admin-key") key: string, @Param("id") id: string, @Body() body: { published?: boolean }) {
    this.authorize(key);
    const published = await this.db.rpc<boolean>("publish_campaign_level", { p_id: id, p_published: body.published !== false });
    return { id, published };
  }

  /** "Xóa" = gỡ publish (an toàn với progress đã có). */
  @Delete("levels/:id") async unpublishLevel(@Headers("x-admin-key") key: string, @Param("id") id: string) {
    this.authorize(key);
    await this.db.rpc("publish_campaign_level", { p_id: id, p_published: false });
    return { id, published: false, mode: "unpublish" };
  }
}
