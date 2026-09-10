import { BadRequestException, ConflictException, Body, Controller, Delete, Get, NotFoundException, Param, Post, Put, Query, Req, UseFilters, UseGuards, UseInterceptors } from "@nestjs/common";
import { randomUUID } from "node:crypto";
import { REMOTE_CONFIG_DEFAULTS, validateLevelDraft, type CampaignLevelDraft } from "@hexagon/shared";
import { SupabaseService } from "../database/supabase.service";
import { runtimeConfig } from "../runtime-config";
import { Ops, OpsAuthGuard, type OpsRequest } from "./ops-auth.guard";
import { buildOpsOpenApi } from "./ops-openapi";
import { OpsAuditInterceptor } from "./ops-audit.interceptor";
import { OpsKeysService, sanitizeScopes } from "./ops-keys.service";
import { OpsErrorFilter } from "./ops-errors";

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
// Bọc mọi lỗi thoát ra khỏi Ops API về `{ code, message, hint, retryable }` — kể cả lỗi KHÔNG do
// controller này ném (SupabaseService, pipe của Nest, TypeError không lường trước). Hợp đồng lỗi
// chỉ đúng ở đường thuận là hợp đồng không dùng được đúng lúc agent cần nó nhất.
@UseFilters(OpsErrorFilter)
export class AdminController {
  constructor(private readonly db: SupabaseService, private readonly keys: OpsKeysService) {}

  // ---- Ví ---------------------------------------------------------------------------------------

  @Post("players/:id/grant-coin")
  @Ops({ scope: "wallet:write", isWrite: true, dryRun: true, unitKind: "coin_granted", units: (b) => Number(b.amount) || 0 })
  async grant(@Req() req: OpsRequest, @Param("id") playerId: string, @Body() body: { amount?: number; reason?: string; referenceId?: string }) {
    const amount = Number(body.amount);
    if (!Number.isSafeInteger(amount) || amount <= 0 || !body.reason) throw new BadRequestException({ code: "invalid_grant", message: "amount phải là số nguyên dương và reason bắt buộc", retryable: false });
    if (req.opsDryRun) {
      // Xem truớc phải kiểm ĐÚNG NHỮNG GÌ lời gọi thật kiểm (ở trên) rồi mới đọc trạng thái hiện
      // tại. Một `dry_run` luôn trả “ổn” còn tệ hơn không có dry_run: nó dạy người dùng tin nó.
      const { data } = await this.db.from("player_wallets").select("balance").eq("player_id", playerId).eq("currency_code", "coin").maybeSingle();
      const current = Number((data as { balance?: number } | null)?.balance ?? 0);
      return { dryRun: true, playerId, currentBalance: current, granted: amount, predictedBalance: current + amount, playerFound: data !== null };
    }
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
  @Ops({ scope: "ops:admin", isWrite: true, dryRun: true })
  async retention(@Req() req: OpsRequest) {
    const days = runtimeConfig().matchRetentionDays;
    if (req.opsDryRun) {
      const cutoff = new Date(Date.now() - Math.max(1, days) * 86_400_000).toISOString();
      const { count } = await this.db.from("matches").select("id", { count: "exact", head: true }).lt("ended_at", cutoff);
      return { dryRun: true, retentionDays: days, cutoff, wouldDelete: Number(count ?? 0) };
    }
    const deleted = await this.db.rpc<number>("purge_old_match_history", { p_retention_days: days });
    return { deleted };
  }

  // ---- Remote config (doc 35 §A2 — lát a2.3) ----------------------------------------------------
  //
  // `a2.1` dựng bảng + đường ĐỌC cho client (`GET /v1/config`), nhưng không có đường GHI nào cả:
  // đổi một tham số kinh tế vẫn phải vào SQL Editor. Gate đóng Pha 6 đòi "đổi 1 tham số kinh tế
  // không cần deploy" — vào database bằng tay thì đúng chữ mà sai tinh thần: không có vết, không
  // có xác nhận, và người bấm lúc 2 giờ sáng là người dễ gõ nhầm nhất.
  //
  // Lịch sử KHÔNG ghi ở đây: `202609030002` đã có trigger `remote_config_write_audit()` ghi cả giá
  // trị TRƯỚC và SAU. Ghi thêm một lần nữa ở tầng ứng dụng là tạo ra hai nguồn sự thật cho cùng một
  // câu hỏi, và chúng sẽ lệch nhau vào đúng lúc cần tra.

  @Get("config")
  @Ops({ scope: "config:write", isWrite: false })
  async listConfig() {
    const { data } = await this.db.from("remote_config")
      .select("key,value,audience,version,updated_at,updated_by").order("key");
    return { rows: (data as unknown[]) ?? [] };
  }

  /**
   * doc 35 §B9 — coin PHÁT HÀNH theo nguồn vs coin TIÊU theo sink, theo ngày UTC.
   *
   * Dùng scope `analytics:read` chứ không đẻ thêm `economy:read`: đây là một báo cáo tổng hợp
   * chỉ đọc, không có PII, và thêm một scope cho một endpoint là nở phạm vi mà không mua thêm
   * được sự an toàn nào.
   *
   * `unclassifiedEntries` được nâng lên tận đầu ra chứ không nằm im trong một cột: nó là câu
   * "có một nguồn tiền mà bảng này không biết". Một bảng kinh tế bỏ sót nguồn phát vẫn hiện tỉ
   * lệ lạm phát trông LÀNH MẠNH, và đó là kiểu sai nguy hiểm nhất — nó không giống lỗi.
   */
  @Get("economy/daily")
  @Ops({ scope: "analytics:read", isWrite: false })
  async economyDaily(@Query("days") days?: string, @Query("currency") currency?: string) {
    const soNgay = Math.min(Math.max(Number(days) || 30, 1), 365);
    const tu = new Date(Date.now() - soNgay * 86_400_000).toISOString().slice(0, 10);

    let tong = this.db.from("economy_daily_summary")
      .select("day,currency_code,issued,spent,net,inflation_ratio,unclassified_entries,unclassified_kinds")
      .gte("day", tu).order("day", { ascending: false });
    let chiTiet = this.db.from("economy_daily")
      .select("day,currency_code,reference_type,source_group,reason,flow,unclassified,entries,players,net,volume")
      .gte("day", tu).order("day", { ascending: false });
    if (currency) { tong = tong.eq("currency_code", currency); chiTiet = chiTiet.eq("currency_code", currency); }

    const [{ data: summary }, { data: detail }] = await Promise.all([tong, chiTiet]);
    const rows = (summary as { unclassified_entries: number }[]) ?? [];
    return {
      days: soNgay,
      summary: rows,
      detail: (detail as unknown[]) ?? [],
      // Tổng gộp để người đọc (và agent) không phải tự cộng mới biết có vấn đề.
      unclassifiedEntries: rows.reduce((a, r) => a + Number(r.unclassified_entries || 0), 0),
    };
  }

  @Get("config/:key/history")
  @Ops({ scope: "config:write", isWrite: false })
  async configHistory(@Param("key") key: string) {
    const { data } = await this.db.from("remote_config_audit")
      .select("id,key,old_value,new_value,old_audience,new_audience,changed_at,changed_by")
      .eq("key", key).order("changed_at", { ascending: false }).limit(20);
    return { history: (data as unknown[]) ?? [] };
  }

  /**
   * Ghi một khoá. `version` là bắt buộc và phải khớp bản đang có — cột đó tồn tại từ `a2.1` với
   * đúng ghi chú "để trang admin phát hiện ghi đè lẫn nhau", và đây là chỗ nó được dùng.
   *
   * Vì sao khoá lạc quan chứ không phải "ai ghi sau thắng": hai người cùng mở trang trong một sự
   * cố là chuyện thường, và mất một thay đổi kill-switch vì người kia bấm sau nửa giây là kiểu
   * hỏng không ai truy ra được.
   */
  @Put("config/:key")
  @Ops({ scope: "config:write", isWrite: true, dryRun: true })
  async setConfig(
    @Req() req: OpsRequest,
    @Param("key") key: string,
    @Body() body: { value?: unknown; audience?: unknown; version?: number },
  ) {
    if (!key || key.length > 128) {
      throw new BadRequestException({ code: "invalid_config_key", message: "khoá rỗng hoặc quá dài", retryable: false });
    }
    if (body.value === undefined) {
      throw new BadRequestException({ code: "missing_value", message: "thiếu `value`", retryable: false });
    }

    const { data } = await this.db.from("remote_config")
      .select("key,value,audience,version").eq("key", key).maybeSingle();
    const current = data as { value?: unknown; audience?: unknown; version?: number } | null;

    if (req.opsDryRun) {
      return {
        dryRun: true, key, exists: current !== null,
        currentVersion: current?.version ?? null,
        currentValue: current?.value ?? null,
        nextValue: body.value,
        // Khoá chưa có trong `REMOTE_CONFIG_DEFAULTS` KHÔNG bị chặn — thêm cấu hình trước khi phát
        // hành client dùng nó là việc hợp lệ. Nhưng nói ra, vì gõ nhầm tên khoá thì im lặng và
        // không bao giờ có tác dụng gì.
        knownKey: Object.prototype.hasOwnProperty.call(REMOTE_CONFIG_DEFAULTS, key),
      };
    }

    // Khoá lạc quan. Khoá CHƯA có ⇒ đòi `version` là 0 để người gọi phải cố ý tạo mới.
    const expected = current?.version ?? 0;
    if (Number(body.version) !== expected) {
      throw new ConflictException({
        code: "config_version_conflict",
        message: `bản đang có là version ${expected}, bạn gửi ${body.version}`,
        retryable: false,
        currentVersion: expected,
      });
    }

    const patch = {
      key,
      value: body.value,
      audience: body.audience ?? null,
      version: expected + 1,
      updated_at: new Date().toISOString(),
      updated_by: req.opsActor?.name ?? "ops",
    };
    const { error } = await this.db.from("remote_config").upsert(patch, { onConflict: "key" });
    if (error) throw new BadRequestException({ code: "config_write_failed", message: error.message, retryable: true });
    return { ok: true, key, version: patch.version };
  }

  // ---- Catalog ----------------------------------------------------------------------------------

  @Put("catalog/:itemId/price")
  @Ops({ scope: "catalog:write", isWrite: true, dryRun: true })
  async setPrice(@Req() req: OpsRequest, @Param("itemId") itemId: string, @Body() body: { platform?: string; currency?: string; amount?: number }) {
    const platform = String(body.platform ?? "");
    const currency = String(body.currency ?? "");
    const amount = Number(body.amount);
    if (!platform || !["coin", "XTR"].includes(currency) || !Number.isSafeInteger(amount) || amount < 0 || (currency === "XTR" && platform !== "telegram")) {
      throw new BadRequestException({ code: "invalid_price", message: "platform/currency/amount không hợp lệ", retryable: false });
    }
    if (req.opsDryRun) {
      const { data } = await this.db.from("shop_prices").select("id,amount,currency_code,active")
        .eq("item_id", itemId).eq("platform", platform).eq("currency_code", currency).eq("active", true).maybeSingle();
      const current = data as { amount?: number } | null;
      return { dryRun: true, itemId, platform, currency, currentAmount: current ? Number(current.amount) : null, nextAmount: amount, hasCurrentPrice: current !== null };
    }
    const priceId = await this.db.rpc<string>("set_shop_price", { p_item_id: itemId, p_platform: platform, p_currency_code: currency, p_amount: amount });
    return { priceId };
  }

  @Put("catalog/defaults")
  @Ops({ scope: "catalog:write", isWrite: true, dryRun: true })
  async defaults(@Req() req: OpsRequest, @Body() body: { colorAssetKey?: string; shapeAssetKey?: string; trailAssetKey?: string }) {
    if (!body.colorAssetKey || !body.shapeAssetKey || !body.trailAssetKey) throw new BadRequestException({ code: "missing_default_assets", message: "thiếu color/shape/trail asset key", retryable: false });
    if (req.opsDryRun) {
      const keys = [body.colorAssetKey, body.shapeAssetKey, body.trailAssetKey];
      const { data } = await this.db.from("shop_items").select("id,asset_key").in("asset_key", keys);
      const found = new Set(((data ?? []) as { asset_key: string }[]).map((r) => r.asset_key));
      // Điểm có ích nhất của lần xem trước này: chỉ ra `asset_key` nào KHÔNG tồn tại, trước khi
      // lời gọi thật đặt mặc định trỏ vào một vật phẩm không có.
      return { dryRun: true, requested: keys, missing: keys.filter((k) => !found.has(String(k))) };
    }
    await this.db.rpc("configure_default_shop_items", { p_color_asset_key: body.colorAssetKey, p_shape_asset_key: body.shapeAssetKey, p_trail_asset_key: body.trailAssetKey });
    return { ok: true };
  }

  // ---- Người chơi -------------------------------------------------------------------------------

  @Delete("players/:id")
  @Ops({ scope: "players:write", isWrite: true, dryRun: true })
  async deletePlayer(@Req() req: OpsRequest, @Param("id") playerId: string) {
    if (req.opsDryRun) {
      const { data } = await this.db.from("players").select("id,display_name,status,created_at").eq("id", playerId).maybeSingle();
      const row = data as { status?: string; display_name?: string } | null;
      const { count } = await this.db.from("player_sessions").select("id", { count: "exact", head: true }).eq("player_id", playerId).is("revoked_at", null);
      return { dryRun: true, playerId, found: row !== null, currentStatus: row?.status ?? null, currentName: row?.display_name ?? null, sessionsWouldRevoke: Number(count ?? 0), effect: "soft-delete" };
    }
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
      .select("id,sort_order,name,config,powerups,unlock_requires,rewards,published,published_at,version,updated_at").order("sort_order");
    if (error) throw new BadRequestException({ code: "list_failed", message: error.message, retryable: true });
    return { levels: data ?? [] };
  }

  /** Tạo/sửa 1 cấp. Validate cấu hình + unlock (tồn tại, không tự trỏ) trước khi upsert. */
  @Post("levels")
  @Ops({ scope: "levels:write", isWrite: true, dryRun: true })
  async upsertLevel(@Req() req: OpsRequest, @Body() draft: CampaignLevelDraft) {
    const errors = validateLevelDraft(draft);
    if (draft?.unlockRequires === draft?.id) errors.push("unlockRequires không được trỏ chính nó");
    if (errors.length) throw new BadRequestException({ code: "invalid_level", message: "cấu hình cấp không hợp lệ", errors, retryable: false });
    if (draft.unlockRequires) {
      const { data } = await this.db.from("campaign_levels").select("id").eq("id", draft.unlockRequires).maybeSingle();
      if (!data) throw new BadRequestException({ code: "invalid_level", message: `unlockRequires trỏ id không tồn tại: ${draft.unlockRequires}`, retryable: false });
    }
    if (req.opsDryRun) {
      const { data } = await this.db.from("campaign_levels").select("id,version,published").eq("id", draft.id).maybeSingle();
      const existing = data as { version?: number; published?: boolean } | null;
      return { dryRun: true, id: draft.id, valid: true, mode: existing ? "update" : "create", currentVersion: existing?.version ?? null, currentlyPublished: existing?.published ?? false };
    }
    const id = await this.db.rpc<string>("upsert_campaign_level", { p_level: draft });
    return { id };
  }

  /**
   * Bật/tắt publish 1 cấp, kèm LỊCH tuỳ chọn (doc 35 §D4).
   *
   * `publishedAt` ở tương lai = đã duyệt nhưng chưa tới giờ ⇒ người chơi chưa thấy. Không kèm
   * `publishedAt` thì giữ nguyên hành vi cũ: ra ngay. Gỡ publish luôn xoá lịch (xem RPC).
   */
  @Put("levels/:id/publish")
  @Ops({ scope: "levels:publish", isWrite: true, dryRun: true })
  async publishLevel(
    @Req() req: OpsRequest,
    @Param("id") id: string,
    @Body() body: { published?: boolean; publishedAt?: string | null },
  ) {
    const published = body.published !== false;
    // Một chuỗi ngày gõ sai mà đi tới database sẽ thành `null` — tức là "ra ngay" — đúng thứ
    // ngược lại với ý định của người đặt lịch. Chặn ở đây và nói rõ.
    const at = body.publishedAt ?? null;
    if (at !== null && Number.isNaN(Date.parse(at))) {
      throw new BadRequestException({
        code: "invalid_published_at", message: "publishedAt phải là mốc thời gian ISO 8601", retryable: false,
      });
    }
    if (req.opsDryRun) return this.previewPublish(id, published, at);
    return this.db.rpc<{ id: string; published: boolean; publishedAt: string | null; live: boolean }>(
      "publish_campaign_level", { p_id: id, p_published: published, p_published_at: published ? at : null },
    );
  }

  /** "Xóa" = gỡ publish (an toàn với progress đã có). */
  @Delete("levels/:id")
  @Ops({ scope: "levels:publish", isWrite: true, dryRun: true })
  async unpublishLevel(@Req() req: OpsRequest, @Param("id") id: string) {
    if (req.opsDryRun) return this.previewPublish(id, false);
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

  /**
   * doc 35 §C2 nguyên tắc 2 — hợp đồng máy đọc được.
   *
   * `anyKey: true`: cần khoá hợp lệ nhưng KHÔNG cần phạm vi nào. Bắt phải có một phạm vi riêng để
   * đọc được danh mục sẽ tạo ra bài toán con gà–quả trứng: agent không biết mình thiếu gì cho tới
   * khi đọc được danh mục, mà đọc danh mục lại cần được cấp trước. Danh mục không tiết lộ dữ liệu
   * người chơi — nó chỉ nói *những endpoint nào tồn tại*.
   */
  @Get("openapi.json")
  @Ops({ scope: "keys:read", isWrite: false, anyKey: true })
  openapi() {
    cachedSpec ??= buildOpsOpenApi(AdminController, { version: OPS_API_VERSION });
    return cachedSpec;
  }

  // ---- Cấm người chơi (doc 35 §C3) ---------------------------------------------------------------
  //
  // Scope `bans:write` đã có trong `OPS_SCOPES` từ lát c2.1 nhưng CHƯA endpoint nào dùng — tức là
  // một quyền cấp được mà không làm được gì. Đây là chỗ nó có nghĩa.
  //
  // Thi hành KHÔNG nằm ở đây: `ban_player` đặt `players.status = 'suspended'`, và
  // `SessionService.resolve` vốn đã từ chối mọi phiên không `active`. RPC còn thu hồi phiên đang mở
  // ngay lập tức — không có bước đó thì lệnh cấm chỉ có hiệu lực khi phiên hết hạn, tức tới 24 giờ sau.

  @Get("bans")
  @Ops({ scope: "players:read", isWrite: false })
  async listBans(@Query("active") active?: string) {
    let q = this.db.from("player_bans")
      .select("id,player_id,reason,until,actor,created_at,lifted_at,lifted_by")
      .order("created_at", { ascending: false }).limit(100);
    if (active !== "false") q = q.is("lifted_at", null);
    const { data, error } = await q;
    if (error) throw new BadRequestException({ code: "bans_read_failed", message: error.message, retryable: true });
    return { bans: data ?? [] };
  }

  @Post("players/:id/ban")
  @Ops({ scope: "bans:write", isWrite: true, dryRun: true })
  async ban(@Req() req: OpsRequest, @Param("id") playerId: string, @Body() body: { reason?: string; until?: string | null }) {
    const reason = String(body.reason ?? "").trim();
    if (!reason) throw new BadRequestException({ code: "reason_required", message: "reason bắt buộc — một lệnh cấm không có lý do là một lệnh cấm không bảo vệ được khi bị khiếu nại", retryable: false });

    // `until` vắng mặt HOẶC null ⇒ vĩnh viễn. Chuỗi rỗng cũng vậy — agent hay gửi "" thay cho null.
    let until: string | null = null;
    if (body.until !== undefined && body.until !== null && String(body.until).trim() !== "") {
      const t = Date.parse(String(body.until));
      if (!Number.isFinite(t)) throw new BadRequestException({ code: "invalid_until", message: "until phải là mốc thời gian ISO, hoặc bỏ trống để cấm vĩnh viễn", retryable: false });
      if (t <= Date.now()) throw new BadRequestException({ code: "until_in_past", message: "until nằm trong quá khứ ⇒ lệnh cấm hết hiệu lực ngay khi tạo", retryable: false });
      until = new Date(t).toISOString();
    }

    if (req.opsDryRun) {
      // Xem trước phải kiểm ĐÚNG những gì lời gọi thật kiểm (ở trên) rồi mới đọc trạng thái.
      const { data } = await this.db.from("players").select("id,display_name,status").eq("id", playerId).maybeSingle();
      const row = data as { display_name?: string; status?: string } | null;
      const { data: cur } = await this.db.from("player_bans").select("id,reason,until").eq("player_id", playerId).is("lifted_at", null).maybeSingle();
      return {
        dryRun: true, playerId, playerFound: row !== null,
        displayName: row?.display_name ?? null, currentStatus: row?.status ?? null,
        // `deleted` KHÔNG cấm được: lật nó sang suspended là dựng lại một tài khoản người ta đã
        // yêu cầu xoá, và `purge_deleted_players` sẽ không còn nhận ra nó.
        wouldFail: row === null ? "player_not_found" : row.status === "deleted" ? "player_deleted" : null,
        replacesActiveBan: cur ?? null,
        until, permanent: until === null,
      };
    }
    return this.db.rpc("ban_player", { p_player_id: playerId, p_reason: reason.slice(0, 500), p_until: until, p_actor: actorTag(req) });
  }

  @Delete("players/:id/ban")
  @Ops({ scope: "bans:write", isWrite: true, dryRun: true })
  async unban(@Req() req: OpsRequest, @Param("id") playerId: string) {
    if (req.opsDryRun) {
      const { data } = await this.db.from("players").select("id,status").eq("id", playerId).maybeSingle();
      const row = data as { status?: string } | null;
      const { data: cur } = await this.db.from("player_bans").select("id,reason,until,created_at").eq("player_id", playerId).is("lifted_at", null).maybeSingle();
      return {
        dryRun: true, playerId, playerFound: row !== null, currentStatus: row?.status ?? null,
        activeBan: cur ?? null,
        // Nói rõ "không có gì để gỡ" thay vì trả ổn — agent cần phân biệt được hai chuyện đó.
        noop: cur === null,
      };
    }
    return this.db.rpc("unban_player", { p_player_id: playerId, p_actor: actorTag(req) });
  }

  /** Dùng chung cho publish và unpublish — hai endpoint, một phép xem trước. */
  private async previewPublish(id: string, next: boolean, nextAt: string | null = null) {
    const { data } = await this.db.from("campaign_levels").select("id,published,published_at,name").eq("id", id).maybeSingle();
    const row = data as { published?: boolean; published_at?: string | null; name?: string } | null;
    const atSau = next ? nextAt : null;
    return {
      dryRun: true, id, found: row !== null, name: row?.name ?? null,
      from: row?.published ?? null, to: next,
      publishedAtFrom: row?.published_at ?? null, publishedAtTo: atSau,
      // Trả lời thẳng câu mà người đặt lịch thực sự hỏi: sau lời gọi này người chơi có thấy không.
      liveAfter: next && (atSau === null || Date.parse(atSau) <= Date.now()),
      // `noop` cho agent biết lời gọi thật sẽ không đổi gì — đủ để nó bỏ qua thay vì gọi vô ích.
      // Phải xét CẢ lịch: publish một cấp đã publish nhưng đổi ngày hẹn KHÔNG phải là không đổi gì.
      noop: row !== null && row.published === next && (row.published_at ?? null) === atSau,
    };
  }
}

/** Tăng khi ĐỔI Ý NGHĨA của một endpoint. Thêm endpoint mới thì không cần tăng. */
export const OPS_API_VERSION = "1.0.0";

/** Bản OpenAPI dựng một lần rồi dùng lại — nó chỉ phụ thuộc metadata tĩnh của class. */
let cachedSpec: Record<string, unknown> | null = null;

/** Nhãn tác nhân dùng trong `wallet_ledger` và `created_by`. Ngắn, đọc được, không lộ khoá. */
function actorTag(req: OpsRequest): string {
  const actor = req.opsActor;
  if (!actor) return "unknown";
  return `${actor.actorKind}:${actor.name}`.slice(0, 100);
}
