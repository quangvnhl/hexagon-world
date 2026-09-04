import {
  BadRequestException,
  Body,
  Controller,
  Get,
  Headers,
  NotFoundException,
  Param,
  Post,
  Req,
  UnauthorizedException,
} from "@nestjs/common";
import { createHash, randomUUID } from "node:crypto";
import type { Request } from "express";
import { SessionService } from "../auth/session.service";
import { ServerAnalyticsService } from "../analytics/server-analytics.service";
import { SupabaseService } from "../database/supabase.service";
import { runtimeConfig } from "../runtime-config";

type ProductKind = "shop_item" | "coin_package";

interface TelegramPaymentUpdate {
  pre_checkout_query?: {
    id: string;
    currency: string;
    total_amount: number;
    invoice_payload: string;
    from: { id: number };
  };
  message?: {
    from?: { id: number };
    successful_payment?: {
      currency: string;
      total_amount: number;
      invoice_payload: string;
      telegram_payment_charge_id: string;
    };
  };
}

interface PaymentOrder {
  id: string;
  player_id: string;
  platform: string;
  product_kind: ProductKind | null;
  coin_package_id: string | null;
  coin_amount: number | null;
  amount: number;
  currency_code: string;
  status: string;
  idempotency_key: string;
  expires_at: string | null;
  players?: { player_identities: Array<{ provider: string; provider_user_id: string }> };
}

const COIN_INVOICE_TTL_MS = 15 * 60 * 1000;

@Controller("v1")
export class TelegramPaymentsController {
  constructor(
    private readonly sessions: SessionService,
    private readonly db: SupabaseService,
    private readonly analytics: ServerAnalyticsService,
  ) {}

  /**
   * Phát `purchase_fulfilled` sau khi RPC đã cộng hàng/coin. Tách khỏi webhook để luồng thanh toán
   * không dài thêm, và để **không bao giờ** một lỗi đo đạc làm webhook trả lỗi — Telegram sẽ gửi
   * lại webhook khi nhận lỗi, tức là một lỗi analytics sẽ biến thành một vòng lặp gửi lại.
   *
   * Đọc lại `purchase_orders` vì hai lý do: lấy `player_id` (câu select ở webhook không có, và
   * không nên thêm vào đó — đường xác thực nên đọc đúng thứ nó cần để quyết định), và lấy
   * `updated_at` mà RPC vừa đặt lúc chuyển sang `fulfilled`, làm `occurred_at` tất định.
   */
  private async emitPurchaseFulfilled(
    order: PaymentOrder,
    payment: { total_amount: number; currency: string; telegram_payment_charge_id: string },
    kind: string,
  ): Promise<void> {
    let playerId: string | null = null;
    let coinAmount = 0;
    let updatedAt: string | null = null;
    try {
      const { data } = await this.db.from("purchase_orders")
        .select("player_id,coin_amount,updated_at").eq("id", order.id).maybeSingle();
      const row = data as { player_id?: string; coin_amount?: number | null; updated_at?: string } | null;
      playerId = row?.player_id ?? null;
      coinAmount = Number(row?.coin_amount ?? 0);
      updatedAt = row?.updated_at ?? null;
    } catch {
      // Đọc lại hỏng thì vẫn phát: mất `player_id` còn hơn mất cả bản ghi doanh thu.
    }
    await this.analytics.emit({
      name: "purchase_fulfilled",
      // Một lần trừ tiền thật có đúng một `telegram_payment_charge_id`.
      dedupe: [payment.telegram_payment_charge_id],
      playerId,
      occurredAt: updatedAt,
      platform: "telegram",
      props: {
        order_id: order.id,
        product_kind: kind,
        provider: "telegram_stars",
        // Số Stars người chơi thật sự trả. `currency` luôn là XTR ở nhánh này (đã kiểm phía trên).
        amount: Number(payment.total_amount),
        currency: payment.currency,
        coin_amount: coinAmount,
      },
    });
  }

  private async botApi(method: string, payload: Record<string, unknown>): Promise<unknown> {
    const response = await fetch(`https://api.telegram.org/bot${runtimeConfig().telegram.botToken}/${method}`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(payload),
    });
    const json = await response.json() as { ok: boolean; result?: unknown; description?: string };
    if (!response.ok || !json.ok) throw new BadRequestException(json.description || `telegram_${method}_failed`);
    return json.result;
  }

  private validateInvoiceInput(body: { idempotencyKey?: string }): string {
    const key = body.idempotencyKey?.trim();
    if (!key || key.length > 128) throw new BadRequestException("invalid_idempotency_key");
    return key;
  }

  private async requireTelegramPlayer(req: Request) {
    const player = await this.sessions.resolve(req);
    // The platform comes from the server-issued session after Telegram initData verification.
    if (player.platform !== "telegram") throw new BadRequestException("telegram_account_required");
    return player;
  }

  private identities(order: PaymentOrder): Array<{ provider: string; provider_user_id: string }> {
    return order.players?.player_identities ?? [];
  }

  private isTelegramOwner(order: PaymentOrder, telegramUserId: number): boolean {
    return this.identities(order).some((identity) =>
      identity.provider === "telegram" && identity.provider_user_id === String(telegramUserId));
  }

  private isExpired(order: Pick<PaymentOrder, "expires_at">): boolean {
    return Boolean(order.expires_at && Date.parse(order.expires_at) <= Date.now());
  }

  @Get("shop/coin-packages")
  async coinPackages() {
    const { data, error } = await this.db.from("coin_packages")
      .select("id,sku,name,coin_amount,stars_amount,sort_order,metadata")
      .eq("active", true)
      .order("sort_order", { ascending: true });
    if (error) throw new BadRequestException(error.message);
    return {
      packages: (data ?? []).map((row) => ({
        id: row.id,
        sku: row.sku,
        name: row.name,
        coinAmount: Number(row.coin_amount),
        starsAmount: Number(row.stars_amount),
        sortOrder: Number(row.sort_order),
        metadata: row.metadata ?? {},
      })),
    };
  }

  /** Existing item invoice endpoint; retained for backward compatibility. */
  @Post("payments/telegram-stars/invoice")
  async invoice(@Req() req: Request, @Body() body: { itemId?: string; idempotencyKey?: string }) {
    const cfg = runtimeConfig();
    if (!cfg.telegram.starsEnabled) throw new BadRequestException("telegram_stars_disabled");
    const player = await this.requireTelegramPlayer(req);
    if (!body.itemId) throw new BadRequestException("missing_invoice_fields");
    const idempotencyKey = this.validateInvoiceInput(body);
    const now = new Date().toISOString();
    const { data: price } = await this.db.from("shop_prices")
      .select("id,item_id,amount,shop_items(name)")
      .eq("item_id", body.itemId)
      .eq("platform", "telegram")
      .eq("currency_code", "XTR")
      .eq("active", true)
      .lte("starts_at", now)
      .or(`ends_at.is.null,ends_at.gt.${now}`)
      .order("starts_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    if (!price) throw new BadRequestException("stars_price_not_found");
    const { data: existing } = await this.db.from("purchase_orders")
      .select("id,status,product_kind,item_id")
      .eq("player_id", player.id)
      .eq("idempotency_key", idempotencyKey)
      .maybeSingle();
    if (existing && ((existing.product_kind ?? "shop_item") !== "shop_item" || existing.item_id !== body.itemId)) {
      throw new BadRequestException("idempotency_key_conflict");
    }
    if (existing && existing.status !== "pending") throw new BadRequestException("invoice_order_not_pending");
    let orderId = existing?.id as string | undefined;
    if (!orderId) {
      orderId = randomUUID();
      const { error } = await this.db.from("purchase_orders").insert({
        id: orderId,
        player_id: player.id,
        platform: "telegram",
        product_kind: "shop_item",
        item_id: body.itemId,
        price_id: price.id,
        amount: price.amount,
        currency_code: "XTR",
        status: "pending",
        idempotency_key: idempotencyKey,
      });
      if (error) throw new BadRequestException(error.message);
    }
    const item = price.shop_items as unknown as { name: string };
    const invoiceUrl = await this.botApi("createInvoiceLink", {
      title: item.name,
      description: `Hexagon World: ${item.name}`,
      payload: orderId,
      currency: "XTR",
      prices: [{ label: item.name, amount: price.amount }],
    });
    return { orderId, invoiceUrl };
  }

  @Post("payments/telegram-stars/coin-invoice")
  async coinInvoice(@Req() req: Request, @Body() body: { packageId?: string; idempotencyKey?: string }) {
    if (!runtimeConfig().telegram.starsEnabled) throw new BadRequestException("telegram_stars_disabled");
    const player = await this.requireTelegramPlayer(req);
    const packageId = body.packageId?.trim();
    if (!packageId) throw new BadRequestException("missing_coin_invoice_fields");
    const idempotencyKey = this.validateInvoiceInput(body);

    const { data: coinPackage, error: packageError } = await this.db.from("coin_packages")
      .select("id,sku,name,coin_amount,stars_amount")
      .eq("id", packageId)
      .eq("active", true)
      .maybeSingle();
    if (packageError) throw new BadRequestException(packageError.message);
    if (!coinPackage) throw new BadRequestException("coin_package_not_found");

    const { data: existing, error: existingError } = await this.db.from("purchase_orders")
      .select("id,status,product_kind,coin_package_id,coin_amount,amount,currency_code,expires_at")
      .eq("player_id", player.id)
      .eq("idempotency_key", idempotencyKey)
      .maybeSingle();
    if (existingError) throw new BadRequestException(existingError.message);
    if (existing && (existing.product_kind !== "coin_package" || existing.coin_package_id !== packageId)) {
      throw new BadRequestException("idempotency_key_conflict");
    }
    if (existing?.status === "fulfilled") {
      return {
        orderId: existing.id,
        invoiceUrl: null,
        status: existing.status,
        expiresAt: existing.expires_at,
      };
    }
    if (existing && (existing.status !== "pending" || this.isExpired(existing))) {
      throw new BadRequestException("invoice_order_not_pending");
    }

    let orderId = existing?.id as string | undefined;
    let expiresAt = existing?.expires_at as string | null | undefined;
    let amount = existing ? Number(existing.amount) : Number(coinPackage.stars_amount);
    let coinAmount = existing ? Number(existing.coin_amount) : Number(coinPackage.coin_amount);
    if (!Number.isSafeInteger(amount) || amount <= 0 || !Number.isSafeInteger(coinAmount) || coinAmount <= 0) {
      throw new BadRequestException("invalid_coin_package_amount");
    }

    if (!orderId) {
      orderId = randomUUID();
      expiresAt = new Date(Date.now() + COIN_INVOICE_TTL_MS).toISOString();
      const { error } = await this.db.from("purchase_orders").insert({
        id: orderId,
        player_id: player.id,
        platform: "telegram",
        product_kind: "coin_package",
        coin_package_id: coinPackage.id,
        coin_amount: coinAmount,
        amount,
        currency_code: "XTR",
        status: "pending",
        idempotency_key: idempotencyKey,
        expires_at: expiresAt,
      });
      if (error) {
        // The database unique key is the final guard against concurrent retries.
        if (error.code !== "23505") throw new BadRequestException(error.message);
        const { data: raced } = await this.db.from("purchase_orders")
          .select("id,status,product_kind,coin_package_id,coin_amount,amount,currency_code,expires_at")
          .eq("player_id", player.id)
          .eq("idempotency_key", idempotencyKey)
          .maybeSingle();
        if (!raced || raced.product_kind !== "coin_package" || raced.coin_package_id !== packageId
          || raced.status !== "pending" || this.isExpired(raced)) {
          throw new BadRequestException("idempotency_key_conflict");
        }
        orderId = raced.id;
        amount = Number(raced.amount);
        coinAmount = Number(raced.coin_amount);
        expiresAt = raced.expires_at;
      }
    }

    const label = `${coinAmount} Coin`;
    const invoiceUrl = await this.botApi("createInvoiceLink", {
      title: coinPackage.name,
      description: `Hexagon World: ${label}`,
      payload: orderId,
      currency: "XTR",
      prices: [{ label, amount }],
    });
    return { orderId, invoiceUrl, status: "pending", expiresAt };
  }

  @Get("payments/orders/:orderId")
  async order(@Req() req: Request, @Param("orderId") orderId: string) {
    const player = await this.sessions.resolve(req);
    const { data, error } = await this.db.from("purchase_orders")
      .select("id,status,product_kind,coin_amount,amount,currency_code,expires_at")
      .eq("id", orderId)
      .eq("player_id", player.id)
      .maybeSingle();
    if (error) throw new BadRequestException(error.message);
    if (!data) throw new NotFoundException("payment_order_not_found");
    return {
      orderId: data.id,
      status: data.status,
      productKind: data.product_kind ?? "shop_item",
      coinAmount: data.coin_amount == null ? null : Number(data.coin_amount),
      amount: Number(data.amount),
      currencyCode: data.currency_code,
      expiresAt: data.expires_at,
    };
  }

  @Post("webhooks/telegram")
  async webhook(@Headers("x-telegram-bot-api-secret-token") secret: string, @Body() update: TelegramPaymentUpdate) {
    if (secret !== runtimeConfig().telegram.webhookSecret) {
      throw new UnauthorizedException("invalid_telegram_webhook_secret");
    }
    const checkout = update.pre_checkout_query;
    if (checkout) {
      let ok = false;
      let errorMessage = "Order khong hop le";
      const { data } = await this.db.from("purchase_orders")
        .select("id,amount,currency_code,status,platform,product_kind,expires_at,players!inner(player_identities(provider,provider_user_id))")
        .eq("id", checkout.invoice_payload)
        .maybeSingle();
      const order = data as unknown as PaymentOrder | null;
      if (order
        && checkout.currency === "XTR"
        && order.platform === "telegram"
        && order.currency_code === "XTR"
        && Number(order.amount) === checkout.total_amount
        && order.status === "pending"
        && !this.isExpired(order)
        && (order.product_kind === "coin_package" || (order.product_kind ?? "shop_item") === "shop_item")) {
        ok = this.isTelegramOwner(order, checkout.from.id);
        if (!ok) errorMessage = "Order khong thuoc tai khoan Telegram nay";
      }
      await this.botApi("answerPreCheckoutQuery", {
        pre_checkout_query_id: checkout.id,
        ok,
        ...(ok ? {} : { error_message: errorMessage }),
      });
      return { ok: true };
    }

    const payment = update.message?.successful_payment;
    if (payment) {
      const { data } = await this.db.from("purchase_orders")
        .select("id,amount,currency_code,status,platform,product_kind,expires_at,players!inner(player_identities(provider,provider_user_id))")
        .eq("id", payment.invoice_payload)
        .maybeSingle();
      const order = data as unknown as PaymentOrder | null;
      if (!order
        || payment.currency !== "XTR"
        || order.platform !== "telegram"
        || order.currency_code !== "XTR"
        || Number(order.amount) !== payment.total_amount
        // Telegram webhooks are at-least-once. A duplicate fulfilled order must
        // reach the idempotent RPC so the same charge is acknowledged safely.
        || !["pending", "fulfilled"].includes(order.status)
        || (update.message?.from && !this.isTelegramOwner(order, update.message.from.id))) {
        throw new BadRequestException("invalid_successful_payment");
      }
      const params = {
        p_order_id: payment.invoice_payload,
        p_charge_id: payment.telegram_payment_charge_id,
        p_amount: payment.total_amount,
        p_raw_event_hash: createHash("sha256").update(JSON.stringify(update)).digest("hex"),
      };
      const kind = order.product_kind === "coin_package" ? "coin_package" : (order.product_kind ?? "shop_item");
      if (kind === "coin_package") {
        await this.db.rpc("fulfill_telegram_stars_coin_order", params);
      } else if (kind === "shop_item") {
        await this.db.rpc("fulfill_telegram_stars_order", params);
      } else {
        throw new BadRequestException("unsupported_payment_product_kind");
      }

      // doc 35 §A1.4 — DOANH THU. Đây là sự kiện quan trọng nhất trong cả lát: nó là con số duy
      // nhất trong hệ thống mà không ai ngoài Telegram và server này được quyền khai.
      //
      // Webhook Telegram là at-least-once (chính khối `if` phía trên đã phải nhận cả đơn đã
      // `fulfilled` vì lý do đó). Nên `dedupe` dùng `charge_id` của Telegram — một lần trừ tiền
      // thật có đúng một charge id — và `occurred_at` đọc `purchase_orders.updated_at` mà RPC vừa
      // đặt, chứ không dùng đồng hồ. Hai thứ đó cùng lặp lại ⇒ database khử trùng thật sự, và báo
      // cáo doanh thu không nhân đôi vì Telegram gửi lại webhook.
      void this.emitPurchaseFulfilled(order, payment, kind);
    }
    return { ok: true };
  }
}
