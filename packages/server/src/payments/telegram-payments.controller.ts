import { BadRequestException, Body, Controller, Headers, Post, Req, UnauthorizedException } from "@nestjs/common";
import { createHash, randomUUID } from "node:crypto";
import type { Request } from "express";
import { SessionService } from "../auth/session.service";
import { SupabaseService } from "../database/supabase.service";
import { runtimeConfig } from "../runtime-config";

interface TelegramPaymentUpdate {
  pre_checkout_query?: { id: string; currency: string; total_amount: number; invoice_payload: string; from: { id: number } };
  message?: { successful_payment?: { currency: string; total_amount: number; invoice_payload: string; telegram_payment_charge_id: string } };
}

@Controller("v1")
export class TelegramPaymentsController {
  constructor(private readonly sessions: SessionService, private readonly db: SupabaseService) {}

  private async botApi(method: string, payload: Record<string, unknown>) {
    const response = await fetch(`https://api.telegram.org/bot${runtimeConfig().telegram.botToken}/${method}`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(payload) });
    const json = await response.json() as { ok: boolean; result?: unknown; description?: string };
    if (!response.ok || !json.ok) throw new BadRequestException(json.description || `telegram_${method}_failed`);
    return json.result;
  }

  @Post("payments/telegram-stars/invoice")
  async invoice(@Req() req: Request, @Body() body: { itemId?: string; idempotencyKey?: string }) {
    const cfg = runtimeConfig();
    if (!cfg.telegram.starsEnabled) throw new BadRequestException("telegram_stars_disabled");
    const player = await this.sessions.resolve(req);
    if (player.platform !== "telegram") throw new BadRequestException("telegram_account_required");
    if (!body.itemId || !body.idempotencyKey) throw new BadRequestException("missing_invoice_fields");
    const now = new Date().toISOString();
    const { data: price } = await this.db.from("shop_prices").select("id,item_id,amount,shop_items(name)").eq("item_id", body.itemId).eq("platform", "telegram").eq("currency_code", "XTR").eq("active", true).lte("starts_at", now).or(`ends_at.is.null,ends_at.gt.${now}`).order("starts_at", { ascending: false }).limit(1).maybeSingle();
    if (!price) throw new BadRequestException("stars_price_not_found");
    const { data: existing } = await this.db.from("purchase_orders").select("id,status").eq("player_id", player.id).eq("idempotency_key", body.idempotencyKey).maybeSingle();
    let orderId = existing?.id as string | undefined;
    if (!orderId) {
      orderId = randomUUID();
      const { error } = await this.db.from("purchase_orders").insert({ id: orderId, player_id: player.id, platform: "telegram", item_id: body.itemId, price_id: price.id, amount: price.amount, currency_code: "XTR", status: "pending", idempotency_key: body.idempotencyKey });
      if (error) throw new BadRequestException(error.message);
    }
    const item = price.shop_items as unknown as { name: string };
    const invoiceUrl = await this.botApi("createInvoiceLink", { title: item.name, description: `Hexagon World: ${item.name}`, payload: orderId, currency: "XTR", prices: [{ label: item.name, amount: price.amount }] });
    return { orderId, invoiceUrl };
  }

  @Post("webhooks/telegram")
  async webhook(@Headers("x-telegram-bot-api-secret-token") secret: string, @Body() update: TelegramPaymentUpdate) {
    if (secret !== runtimeConfig().telegram.webhookSecret) throw new UnauthorizedException("invalid_telegram_webhook_secret");
    const checkout = update.pre_checkout_query;
    if (checkout) {
      let ok = false; let errorMessage = "Order không hợp lệ";
      const { data: order } = await this.db.from("purchase_orders").select("id,amount,currency_code,status,players!inner(player_identities(provider,provider_user_id))").eq("id", checkout.invoice_payload).maybeSingle();
      if (order && order.currency_code === "XTR" && Number(order.amount) === checkout.total_amount && order.status === "pending") {
        const identities = (order.players as unknown as { player_identities: { provider: string; provider_user_id: string }[] }).player_identities;
        ok = identities.some((i) => i.provider === "telegram" && i.provider_user_id === String(checkout.from.id));
        if (!ok) errorMessage = "Order không thuộc tài khoản Telegram này";
      }
      await this.botApi("answerPreCheckoutQuery", { pre_checkout_query_id: checkout.id, ok, ...(ok ? {} : { error_message: errorMessage }) });
      return { ok: true };
    }
    const payment = update.message?.successful_payment;
    if (payment) {
      await this.db.rpc("fulfill_telegram_stars_order", { p_order_id: payment.invoice_payload, p_charge_id: payment.telegram_payment_charge_id, p_amount: payment.total_amount, p_raw_event_hash: createHash("sha256").update(JSON.stringify(update)).digest("hex") });
    }
    return { ok: true };
  }
}
