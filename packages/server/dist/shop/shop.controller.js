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
exports.ShopController = void 0;
const common_1 = require("@nestjs/common");
const session_service_1 = require("../auth/session.service");
const supabase_service_1 = require("../database/supabase.service");
let ShopController = class ShopController {
    constructor(sessions, db) {
        this.sessions = sessions;
        this.db = db;
    }
    async catalog() {
        const now = new Date().toISOString();
        const { data, error } = await this.db.from("shop_items").select("id,sku,type,asset_key,name,rarity,is_default_free,shop_prices(id,platform,currency_code,amount,starts_at,ends_at)").eq("active", true).eq("shop_prices.active", true).lte("shop_prices.starts_at", now);
        if (error)
            throw new common_1.BadRequestException(error.message);
        const items = (data ?? []).map((item) => {
            const prices = Array.isArray(item.shop_prices) ? item.shop_prices : [];
            return { ...item, shop_prices: prices.filter((price) => !price.ends_at || Date.parse(price.ends_at) > Date.now()) };
        });
        return { items };
    }
    async purchase(req, body) {
        const player = await this.sessions.resolve(req);
        if (!body.itemId || !body.idempotencyKey)
            throw new common_1.BadRequestException("missing_purchase_fields");
        const orderId = await this.db.rpc("purchase_item_with_coin", { p_player_id: player.id, p_platform: player.platform, p_item_id: body.itemId, p_idempotency_key: body.idempotencyKey });
        return { orderId, status: "fulfilled" };
    }
    async loadout(req, body) {
        const player = await this.sessions.resolve(req);
        const ids = [body.colorItemId, body.shapeItemId, body.trailItemId].filter(Boolean);
        const { data } = await this.db.from("player_inventory").select("item_id,shop_items(type,asset_key)").eq("player_id", player.id).in("item_id", ids);
        if ((data?.length ?? 0) !== ids.length)
            throw new common_1.BadRequestException("item_not_owned");
        const byType = new Map();
        for (const row of data ?? []) {
            const item = row.shop_items;
            byType.set(item.type, { id: row.item_id, asset: item.asset_key });
        }
        const patch = { color_item_id: byType.get("color")?.id, shape_item_id: byType.get("shape")?.id, trail_item_id: byType.get("trail")?.id, updated_at: new Date().toISOString() };
        const { error } = await this.db.from("player_loadouts").update(patch).eq("player_id", player.id);
        if (error)
            throw new common_1.BadRequestException(error.message);
        await this.db.from("player_profiles").update({ selected_color: byType.get("color")?.asset, selected_shape: byType.get("shape")?.asset, selected_trail_pattern: byType.get("trail")?.asset, updated_at: new Date().toISOString() }).eq("player_id", player.id);
        return { ok: true };
    }
};
exports.ShopController = ShopController;
__decorate([
    (0, common_1.Get)("shop/catalog"),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", []),
    __metadata("design:returntype", Promise)
], ShopController.prototype, "catalog", null);
__decorate([
    (0, common_1.Post)("shop/purchases"),
    __param(0, (0, common_1.Req)()),
    __param(1, (0, common_1.Body)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, Object]),
    __metadata("design:returntype", Promise)
], ShopController.prototype, "purchase", null);
__decorate([
    (0, common_1.Put)("loadout"),
    __param(0, (0, common_1.Req)()),
    __param(1, (0, common_1.Body)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, Object]),
    __metadata("design:returntype", Promise)
], ShopController.prototype, "loadout", null);
exports.ShopController = ShopController = __decorate([
    (0, common_1.Controller)("v1"),
    __metadata("design:paramtypes", [session_service_1.SessionService, supabase_service_1.SupabaseService])
], ShopController);
//# sourceMappingURL=shop.controller.js.map