import { BadRequestException, Body, Controller, Delete, Get, NotFoundException, Param, Post, Put, Query, Req, UseGuards, UseInterceptors } from "@nestjs/common";
import { randomUUID } from "node:crypto";
import { validateLevelDraft, type CampaignLevelDraft } from "@hexagon/shared";
import { SupabaseService } from "../database/supabase.service";
import { runtimeConfig } from "../runtime-config";
import { Ops, OpsAuthGuard, type OpsRequest } from "./ops-auth.guard";
import { OpsAuditInterceptor } from "./ops-audit.interceptor";
import { OpsKeysService, sanitizeScopes } from "./ops-keys.service";

/**
 * doc 35 §C2.1 — Ops API.
 *
 * ĐỔI SO VỚI TRƯỚC: mọi endpoint từng nhận `@Headers("x-admin-key")` rồi tự gọi `authorize()`.
 * Cách đó có ba chỗ hỏng, và cả ba đều thuộc loại "quên một lần là mở toang":
 *   1. Endpoint mới quên gọi `authorize()` ⇒ **public**. Không có gì nhắc.
 *   2. Mọi khoá làm được mọi việc — không tách được quyền của người với quyền của agent.
 *   3. Không có vết. Số dư sai thì không có gì để truy.
 *
 * Nay: `OpsAuthGuard` chặn mọi handler và **từ chối endpoint không khai báo `@Ops({...})`**, nên
 * quên khai báo là hỏng ngay chứ không phải mở toang. `OpsAuditInterceptor` ghi vết mọi lời gọi và
 * xử lý `Idempotency-Key` ở một chỗ duy nhất.
 */
@Controller("internal/v1/admin")
@UseGuards(OpsAuthGuard)
@UseInterceptors(OpsAuditInterceptor)
export class AdminController {
  constructor(private readonly db: SupabaseService, private readonly keys: OpsKeysService) {}

  // ---- Ví ---------------------------------------------------------------------------------------

  @Post("players/:id/grant-coin")
  @Ops({ scope: "wallet:write", isWrite: true, unitKind: "coin_granted", units: (b) => Number(b.amount) || 0 })
  async grant(@Req() req: OpsRequest, @Param("id") playerId: string, @Body() body: { amount?: number; reason?: string; referenceId?: string }) {
    const amount = Number(body.amount);
    if (!Number.isSafeInteger(amount) || amount <= 0 || !body.reason) throw new BadRequestException({ code: "invalid_grant", message: "amount phải là số nguyên dương và reason bắt buộc", retryable: false });
    const balance = await this.db.rpc<number>("admin_grant_coin", {
      p_player_id: playerId,
      p_amount: amount,
      // Vết ở tầng RPC giờ mang TÊN khoá thay vì 12 ký tự đầu của một hash dùng chung — đọc
      // `wallet_ledger` là biết ai cấp, không cần đối chiếu sang bảng khác.
      p_admin_actor: actorTag(req),
      p_reason: String(body.reason).slice(0, 200),
      p_reference_id: body.referenceId || randomUUID(),
    });
    return { playerId, balance, granted: amount };
  }

  // ---- Hệ thống ---------------------------------------------------------------------------------

  @Post("retention/matches")
  @Ops({ scope: "ops:admin", isWrite: true })
  async retention() {
    const deleted = await this.db.rpc<number>("purge_old_match_history", { p_retention_days: runtimeConfig().matchRetentionDays });
    return { deleted };
  }

  // ---- Catalog ----------------------------------------------------------------------------------

  @Put("catalog/:itemId/price")
  @Ops({ scope: "catalog:write", isWrite: true })
  async setPrice(@Param("itemId") itemId: string, @Body() body: { platform?: string; currency?: string; amount?: number }) {
    const platform = String(body.platform ?? "");
    const currency = String(body.currency ?? "");
    const amount = Number(body.amount);
    if (!platform || !["coin", "XTR"].includes(currency) || !Number.isSafeInteger(amount) || amount < 0 || (currency === "XTR" && platform !== "telegram")) {
      throw new BadRequestException({ code: "invalid_price", message: "platform/currency/amount không hợp lệ", retryable: false });
    }
    const priceId = await this.db.rpc<string>("set_shop_price", { p_item_id: itemId, p_platform: platform, p_currency_code: currency, p_amount: amount });
    return { priceId };
  }

  @Put("catalog/defaults")
  @Ops({ scope: "catalog:write", isWrite: true })
  async defaults(@Body() body: { colorAssetKey?: string; shapeAssetKey?: string; trailAssetKey?: string }) {
    if (!body.colorAssetKey || !body.shapeAssetKey || !body.trailAssetKey) throw new BadRequestException({ code: "missing_default_assets", message: "thiếu color/shape/trail asset key", retryable: false });
    await this.db.rpc("configure_default_shop_items", { p_color_asset_key: body.colorAssetKey, p_shape_asset_key: body.shapeAssetKey, p_trail_asset_key: body.trailAssetKey });
    return { ok: true };
  }

  // ---- Người chơi -------------------------------------------------------------------------------

  @Delete("players/:id")
  @Ops({ scope: "players:write", isWrite: true })
  async deletePlayer(@Param("id") playerId: string) {
    await this.db.from("player_sessions").update({ revoked_at: new Date().toISOString() }).eq("player_id", playerId);
    const { error } = await this.db.from("players").update({ status: "deleted", display_name: "Deleted Player", deleted_at: new Date().toISOString() }).eq("id", playerId);
    if (error) throw new BadRequestException({ code: "delete_failed", message: error.message, retryable: true });
    return { ok: true, mode: "soft-delete" };
  }

  // ---- Campaign levels (doc 29 §L4) -------------------------------------------------------------

  /** Liệt kê MỌI cấp (kể cả chưa publish) cho trình vẽ admin. */
  @Get("levels")
  @Ops({ scope: "levels:read", isWrite: false })
  async listLevels() {
    const { data, error } = await this.db.from("campaign_levels")
      .select("id,sort_order,name,config,powerups,unlock_requires,rewards,published,version,updated_at").order("sort_order");
    if (error) throw new BadRequestException({ code: "list_failed", message: error.message, retryable: true });
    return { levels: data ?? [] };
  }

  /** Tạo/sửa 1 cấp. Validate cấu hình + unlock (tồn tại, không tự trỏ) trước khi upsert. */
  @Post("levels")
  @Ops({ scope: "levels:write", isWrite: true })
  async upsertLevel(@Body() draft: CampaignLevelDraft) {
    const errors = validateLevelDraft(draft);
    if (draft?.unlockRequires === draft?.id) errors.push("unlockRequires không được trỏ chính nó");
    if (errors.length) throw new BadRequestException({ code: "invalid_level", message: "cấu hình cấp không hợp lệ", errors, retryable: false });
    if (draft.unlockRequires) {
      const { data } = await this.db.from("campaign_levels").select("id").eq("id", draft.unlockRequires).maybeSingle();
      if (!data) throw new BadRequestException({ code: "invalid_level", message: `unlockRequires trỏ id không tồn tại: ${draft.unlockRequires}`, retryable: false });
    }
    const id = await this.db.rpc<string>("upsert_campaign_level", { p_level: draft });
    return { id };
  }

  /** Bật/tắt publish 1 cấp. */
  @Put("levels/:id/publish")
  @Ops({ scope: "levels:publish", isWrite: true })
  async publishLevel(@Param("id") id: string, @Body() body: { published?: boolean }) {
    const published = await this.db.rpc<boolean>("publish_campaign_level", { p_id: id, p_published: body.published !== false });
    return { id, published };
  }

  /** "Xóa" = gỡ publish (an toàn với progress đã có). */
  @Delete("levels/:id")
  @Ops({ scope: "levels:publish", isWrite: true })
  async unpublishLevel(@Param("id") id: string) {
    await this.db.rpc("publish_campaign_level", { p_id: id, p_published: false });
    return { id, published: false, mode: "unpublish" };
  }

  // ---- Quản lý chính Ops API --------------------------------------------------------------------
  //
  // Có mặt để việc gỡ chuỗi dùng chung KHÔNG cần ai chạy SQL tay: đăng nhập bằng chuỗi cũ, tạo khoá
  // thật đầu tiên, và chuỗi cũ tự chết ngay lúc đó (xem `OpsKeysService.resolve`).

  @Post("ops/keys")
  @Ops({ scope: "keys:write", isWrite: true })
  async createKey(@Req() req: OpsRequest, @Body() body: { name?: string; actorKind?: string; scopes?: unknown; dailyLimits?: Record<string, number>; expiresAt?: string }) {
    const name = String(body.name ?? "").trim();
    if (!name) throw new BadRequestException({ code: "missing_name", message: "khoá phải có tên để còn truy được về sau", retryable: false });
    const actorKind = body.actorKind === "agent" ? "agent" : "human";
    const scopes = sanitizeScopes(body.scopes);
    if (scopes.length === 0) throw new BadRequestException({ code: "empty_scopes", message: "phải cấp ít nhất một phạm vi hợp lệ", retryable: false });
    const created = await this.keys.createKey({
      name, actorKind, scopes,
      dailyLimits: body.dailyLimits ?? (actorKind === "agent" ? { calls: 200, coin_granted: 50_000 } : {}),
      expiresAt: body.expiresAt ?? null,
      createdBy: actorTag(req),
    });
    // `key` chỉ xuất hiện đúng ở đây, đúng một lần. Server lưu hash, không lưu khoá.
    return { id: created.id, key: created.key, name, actorKind, scopes, warning: "Chuỗi khoá chỉ hiện MỘT LẦN — lưu lại ngay, không đọc lại được." };
  }

  @Get("ops/keys")
  @Ops({ scope: "keys:read", isWrite: false })
  async listKeys() {
    return { keys: await this.keys.listKeys() };
  }

  @Delete("ops/keys/:id")
  @Ops({ scope: "keys:write", isWrite: true })
  async revokeKey(@Param("id") id: string) {
    const revoked = await this.keys.revokeKey(id);
    // Thu hồi khoá đã thu hồi không phải lỗi, nhưng thu hồi khoá KHÔNG TỒN TẠI thì có: nó thường
    // nghĩa là đang thu hồi nhầm id và tin rằng đã xong.
    if (!revoked) throw new NotFoundException({ code: "key_not_found_or_revoked", message: "không có khoá còn hiệu lực với id này", retryable: false });
    return { id, revoked: true };
  }

  @Get("ops/audit")
  @Ops({ scope: "audit:read", isWrite: false })
  async audit(@Query("limit") limit?: string) {
    const n = Math.min(Math.max(Number(limit) || 50, 1), 500);
    return { entries: await this.keys.recentAudit(n) };
  }
}

/** Nhãn tác nhân dùng trong `wallet_ledger` và `created_by`. Ngắn, đọc được, không lộ khoá. */
function actorTag(req: OpsRequest): string {
  const actor = req.opsActor;
  if (!actor) return "unknown";
  return `${actor.actorKind}:${actor.name}`.slice(0, 100);
}
