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
const COIN_INVOICE_TTL_MS = 15 * 60 * 1000;
let TelegramPaymentsController = class TelegramPaymentsController {
    constructor(sessions, db) {
        this.sessions = sessions;
        this.db = db;
    }
    async botApi(method, payload) {
        const response = await fetch(`https://api.telegram.org/bot${(0, runtime_config_1.runtimeConfig)().telegram.botToken}/${method}`, {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify(payload),
        });
        const json = await response.json();
        if (!response.ok || !json.ok)
            throw new common_1.BadRequestException(json.description || `telegram_${method}_failed`);
        return json.result;
    }
    validateInvoiceInput(body) {
        const key = body.idempotencyKey?.trim();
        if (!key || key.length > 128)
            throw new common_1.BadRequestException("invalid_idempotency_key");
        return key;
    }
    async requireTelegramPlayer(req) {
        const player = await this.sessions.resolve(req);
        if (player.platform !== "telegram")
            throw new common_1.BadRequestException("telegram_account_required");
        return player;
    }
    identities(order) {
        return order.players?.player_identities ?? [];
    }
    isTelegramOwner(order, telegramUserId) {
        return this.identities(order).some((identity) => identity.provider === "telegram" && identity.provider_user_id === String(telegramUserId));
    }
    isExpired(order) {
        return Boolean(order.expires_at && Date.parse(order.expires_at) <= Date.now());
    }
    async coinPackages() {
        const { data, error } = await this.db.from("coin_packages")
            .select("id,sku,name,coin_amount,stars_amount,sort_order,metadata")
            .eq("active", true)
            .order("sort_order", { ascending: true });
        if (error)
            throw new common_1.BadRequestException(error.message);
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
    async invoice(req, body) {
        const cfg = (0, runtime_config_1.runtimeConfig)();
        if (!cfg.telegram.starsEnabled)
            throw new common_1.BadRequestException("telegram_stars_disabled");
        const player = await this.requireTelegramPlayer(req);
        if (!body.itemId)
            throw new common_1.BadRequestException("missing_invoice_fields");
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
        if (!price)
            throw new common_1.BadRequestException("stars_price_not_found");
        const { data: existing } = await this.db.from("purchase_orders")
            .select("id,status,product_kind,item_id")
            .eq("player_id", player.id)
            .eq("idempotency_key", idempotencyKey)
            .maybeSingle();
        if (existing && ((existing.product_kind ?? "shop_item") !== "shop_item" || existing.item_id !== body.itemId)) {
            throw new common_1.BadRequestException("idempotency_key_conflict");
        }
        if (existing && existing.status !== "pending")
            throw new common_1.BadRequestException("invoice_order_not_pending");
        let orderId = existing?.id;
        if (!orderId) {
            orderId = (0, node_crypto_1.randomUUID)();
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
            if (error)
                throw new common_1.BadRequestException(error.message);
        }
        const item = price.shop_items;
        const invoiceUrl = await this.botApi("createInvoiceLink", {
            title: item.name,
            description: `Hexagon World: ${item.name}`,
            payload: orderId,
            currency: "XTR",
            prices: [{ label: item.name, amount: price.amount }],
        });
        return { orderId, invoiceUrl };
    }
    async coinInvoice(req, body) {
        if (!(0, runtime_config_1.runtimeConfig)().telegram.starsEnabled)
            throw new common_1.BadRequestException("telegram_stars_disabled");
        const player = await this.requireTelegramPlayer(req);
        const packageId = body.packageId?.trim();
        if (!packageId)
            throw new common_1.BadRequestException("missing_coin_invoice_fields");
        const idempotencyKey = this.validateInvoiceInput(body);
        const { data: coinPackage, error: packageError } = await this.db.from("coin_packages")
            .select("id,sku,name,coin_amount,stars_amount")
            .eq("id", packageId)
            .eq("active", true)
            .maybeSingle();
        if (packageError)
            throw new common_1.BadRequestException(packageError.message);
        if (!coinPackage)
            throw new common_1.BadRequestException("coin_package_not_found");
        const { data: existing, error: existingError } = await this.db.from("purchase_orders")
            .select("id,status,product_kind,coin_package_id,coin_amount,amount,currency_code,expires_at")
            .eq("player_id", player.id)
            .eq("idempotency_key", idempotencyKey)
            .maybeSingle();
        if (existingError)
            throw new common_1.BadRequestException(existingError.message);
        if (existing && (existing.product_kind !== "coin_package" || existing.coin_package_id !== packageId)) {
            throw new common_1.BadRequestException("idempotency_key_conflict");
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
            throw new common_1.BadRequestException("invoice_order_not_pending");
        }
        let orderId = existing?.id;
        let expiresAt = existing?.expires_at;
        let amount = existing ? Number(existing.amount) : Number(coinPackage.stars_amount);
        let coinAmount = existing ? Number(existing.coin_amount) : Number(coinPackage.coin_amount);
        if (!Number.isSafeInteger(amount) || amount <= 0 || !Number.isSafeInteger(coinAmount) || coinAmount <= 0) {
            throw new common_1.BadRequestException("invalid_coin_package_amount");
        }
        if (!orderId) {
            orderId = (0, node_crypto_1.randomUUID)();
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
                if (error.code !== "23505")
                    throw new common_1.BadRequestException(error.message);
                const { data: raced } = await this.db.from("purchase_orders")
                    .select("id,status,product_kind,coin_package_id,coin_amount,amount,currency_code,expires_at")
                    .eq("player_id", player.id)
                    .eq("idempotency_key", idempotencyKey)
                    .maybeSingle();
                if (!raced || raced.product_kind !== "coin_package" || raced.coin_package_id !== packageId
                    || raced.status !== "pending" || this.isExpired(raced)) {
                    throw new common_1.BadRequestException("idempotency_key_conflict");
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
    async order(req, orderId) {
        const player = await this.sessions.resolve(req);
        const { data, error } = await this.db.from("purchase_orders")
            .select("id,status,product_kind,coin_amount,amount,currency_code,expires_at")
            .eq("id", orderId)
            .eq("player_id", player.id)
            .maybeSingle();
        if (error)
            throw new common_1.BadRequestException(error.message);
        if (!data)
            throw new common_1.NotFoundException("payment_order_not_found");
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
    async webhook(secret, update) {
        if (secret !== (0, runtime_config_1.runtimeConfig)().telegram.webhookSecret) {
            throw new common_1.UnauthorizedException("invalid_telegram_webhook_secret");
        }
        const checkout = update.pre_checkout_query;
        if (checkout) {
            let ok = false;
            let errorMessage = "Order khong hop le";
            const { data } = await this.db.from("purchase_orders")
                .select("id,amount,currency_code,status,platform,product_kind,expires_at,players!inner(player_identities(provider,provider_user_id))")
                .eq("id", checkout.invoice_payload)
                .maybeSingle();
            const order = data;
            if (order
                && checkout.currency === "XTR"
                && order.platform === "telegram"
                && order.currency_code === "XTR"
                && Number(order.amount) === checkout.total_amount
                && order.status === "pending"
                && !this.isExpired(order)
                && (order.product_kind === "coin_package" || (order.product_kind ?? "shop_item") === "shop_item")) {
                ok = this.isTelegramOwner(order, checkout.from.id);
                if (!ok)
                    errorMessage = "Order khong thuoc tai khoan Telegram nay";
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
            const order = data;
            if (!order
                || payment.currency !== "XTR"
                || order.platform !== "telegram"
                || order.currency_code !== "XTR"
                || Number(order.amount) !== payment.total_amount
                || !["pending", "fulfilled"].includes(order.status)
                || (update.message?.from && !this.isTelegramOwner(order, update.message.from.id))) {
                throw new common_1.BadRequestException("invalid_successful_payment");
            }
            const params = {
                p_order_id: payment.invoice_payload,
                p_charge_id: payment.telegram_payment_charge_id,
                p_amount: payment.total_amount,
                p_raw_event_hash: (0, node_crypto_1.createHash)("sha256").update(JSON.stringify(update)).digest("hex"),
            };
            if (order.product_kind === "coin_package") {
                await this.db.rpc("fulfill_telegram_stars_coin_order", params);
            }
            else if ((order.product_kind ?? "shop_item") === "shop_item") {
                await this.db.rpc("fulfill_telegram_stars_order", params);
            }
            else {
                throw new common_1.BadRequestException("unsupported_payment_product_kind");
            }
        }
        return { ok: true };
    }
};
exports.TelegramPaymentsController = TelegramPaymentsController;
__decorate([
    (0, common_1.Get)("shop/coin-packages"),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", []),
    __metadata("design:returntype", Promise)
], TelegramPaymentsController.prototype, "coinPackages", null);
__decorate([
    (0, common_1.Post)("payments/telegram-stars/invoice"),
    __param(0, (0, common_1.Req)()),
    __param(1, (0, common_1.Body)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, Object]),
    __metadata("design:returntype", Promise)
], TelegramPaymentsController.prototype, "invoice", null);
__decorate([
    (0, common_1.Post)("payments/telegram-stars/coin-invoice"),
    __param(0, (0, common_1.Req)()),
    __param(1, (0, common_1.Body)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, Object]),
    __metadata("design:returntype", Promise)
], TelegramPaymentsController.prototype, "coinInvoice", null);
__decorate([
    (0, common_1.Get)("payments/orders/:orderId"),
    __param(0, (0, common_1.Req)()),
    __param(1, (0, common_1.Param)("orderId")),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, String]),
    __metadata("design:returntype", Promise)
], TelegramPaymentsController.prototype, "order", null);
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