"use strict";
var __decorate = (this && this.__decorate) || function (decorators, target, key, desc) {
    var c = arguments.length, r = c < 3 ? target : desc === null ? desc = Object.getOwnPropertyDescriptor(target, key) : desc, d;
    if (typeof Reflect === "object" && typeof Reflect.decorate === "function") r = Reflect.decorate(decorators, target, key, desc);
    else for (var i = decorators.length - 1; i >= 0; i--) if (d = decorators[i]) r = (c < 3 ? d(r) : c > 3 ? d(target, key, r) : d(target, key)) || r;
    return c > 3 && r && Object.defineProperty(target, key, r), r;
};
var __metadata = (this && this.__metadata) || function (k, v) {
    if (typeof Reflect === "object" && typeof Reflect.metadata === "function") return Reflect.metadata(k, v);
};
var __param = (this && this.__param) || function (paramIndex, decorator) {
    return function (target, key) { decorator(target, key, paramIndex); }
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.TelegramPaymentsController = void 0;
const common_1 = require("@nestjs/common");
const node_crypto_1 = require("node:crypto");
const session_service_1 = require("../auth/session.service");
const supabase_service_1 = require("../database/supabase.service");
const runtime_config_1 = require("../runtime-config");
let TelegramPaymentsController = class TelegramPaymentsController {
    constructor(sessions, db) {
        this.sessions = sessions;
        this.db = db;
    }
    async botApi(method, payload) {
        const response = await fetch(`https://api.telegram.org/bot${(0, runtime_config_1.runtimeConfig)().telegram.botToken}/${method}`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(payload) });
        const json = await response.json();
        if (!response.ok || !json.ok)
            throw new common_1.BadRequestException(json.description || `telegram_${method}_failed`);
        return json.result;
    }
    async invoice(req, body) {
        const cfg = (0, runtime_config_1.runtimeConfig)();
        if (!cfg.telegram.starsEnabled)
            throw new common_1.BadRequestException("telegram_stars_disabled");
        const player = await this.sessions.resolve(req);
        if (player.platform !== "telegram")
            throw new common_1.BadRequestException("telegram_account_required");
        if (!body.itemId || !body.idempotencyKey)
            throw new common_1.BadRequestException("missing_invoice_fields");
        const now = new Date().toISOString();
        const { data: price } = await this.db.from("shop_prices").select("id,item_id,amount,shop_items(name)").eq("item_id", body.itemId).eq("platform", "telegram").eq("currency_code", "XTR").eq("active", true).lte("starts_at", now).or(`ends_at.is.null,ends_at.gt.${now}`).order("starts_at", { ascending: false }).limit(1).maybeSingle();
        if (!price)
            throw new common_1.BadRequestException("stars_price_not_found");
        const { data: existing } = await this.db.from("purchase_orders").select("id,status").eq("player_id", player.id).eq("idempotency_key", body.idempotencyKey).maybeSingle();
        let orderId = existing?.id;
        if (!orderId) {
            orderId = (0, node_crypto_1.randomUUID)();
            const { error } = await this.db.from("purchase_orders").insert({ id: orderId, player_id: player.id, platform: "telegram", item_id: body.itemId, price_id: price.id, amount: price.amount, currency_code: "XTR", status: "pending", idempotency_key: body.idempotencyKey });
            if (error)
                throw new common_1.BadRequestException(error.message);
        }
        const item = price.shop_items;
        const invoiceUrl = await this.botApi("createInvoiceLink", { title: item.name, description: `Hexagon World: ${item.name}`, payload: orderId, currency: "XTR", prices: [{ label: item.name, amount: price.amount }] });
        return { orderId, invoiceUrl };
    }
    async webhook(secret, update) {
        if (secret !== (0, runtime_config_1.runtimeConfig)().telegram.webhookSecret)
            throw new common_1.UnauthorizedException("invalid_telegram_webhook_secret");
        const checkout = update.pre_checkout_query;
        if (checkout) {
            let ok = false;
            let errorMessage = "Order không hợp lệ";
            const { data: order } = await this.db.from("purchase_orders").select("id,amount,currency_code,status,players!inner(player_identities(provider,provider_user_id))").eq("id", checkout.invoice_payload).maybeSingle();
            if (order && order.currency_code === "XTR" && Number(order.amount) === checkout.total_amount && order.status === "pending") {
                const identities = order.players.player_identities;
                ok = identities.some((i) => i.provider === "telegram" && i.provider_user_id === String(checkout.from.id));
                if (!ok)
                    errorMessage = "Order không thuộc tài khoản Telegram này";
            }
            await this.botApi("answerPreCheckoutQuery", { pre_checkout_query_id: checkout.id, ok, ...(ok ? {} : { error_message: errorMessage }) });
            return { ok: true };
        }
        const payment = update.message?.successful_payment;
        if (payment) {
            await this.db.rpc("fulfill_telegram_stars_order", { p_order_id: payment.invoice_payload, p_charge_id: payment.telegram_payment_charge_id, p_amount: payment.total_amount, p_raw_event_hash: (0, node_crypto_1.createHash)("sha256").update(JSON.stringify(update)).digest("hex") });
        }
        return { ok: true };
    }
};
exports.TelegramPaymentsController = TelegramPaymentsController;
__decorate([
    (0, common_1.Post)("payments/telegram-stars/invoice"),
    __param(0, (0, common_1.Req)()),
    __param(1, (0, common_1.Body)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, Object]),
    __metadata("design:returntype", Promise)
], TelegramPaymentsController.prototype, "invoice", null);
__decorate([
    (0, common_1.Post)("webhooks/telegram"),
    __param(0, (0, common_1.Headers)("x-telegram-bot-api-secret-token")),
    __param(1, (0, common_1.Body)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [String, Object]),
    __metadata("design:returntype", Promise)
], TelegramPaymentsController.prototype, "webhook", null);
exports.TelegramPaymentsController = TelegramPaymentsController = __decorate([
    (0, common_1.Controller)("v1"),
    __metadata("design:paramtypes", [session_service_1.SessionService, supabase_service_1.SupabaseService])
], TelegramPaymentsController);
//# sourceMappingURL=telegram-payments.controller.js.map