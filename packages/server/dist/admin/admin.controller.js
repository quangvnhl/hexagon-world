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
exports.AdminController = void 0;
const common_1 = require("@nestjs/common");
const node_crypto_1 = require("node:crypto");
const shared_1 = require("@hexagon/shared");
const supabase_service_1 = require("../database/supabase.service");
const runtime_config_1 = require("../runtime-config");
let AdminController = class AdminController {
    constructor(db) {
        this.db = db;
    }
    authorize(key) {
        const expected = (0, runtime_config_1.runtimeConfig)().adminApiKeyHash;
        const actual = (0, runtime_config_1.sha256)(String(key || ""));
        const a = Buffer.from(actual);
        const b = Buffer.from(expected);
        if (!expected || a.length !== b.length || !(0, node_crypto_1.timingSafeEqual)(a, b))
            throw new common_1.UnauthorizedException("invalid_admin_key");
        return actual.slice(0, 12);
    }
    async grant(key, playerId, body) {
        const actor = this.authorize(key);
        const amount = Number(body.amount);
        if (!Number.isSafeInteger(amount) || amount <= 0 || !body.reason)
            throw new common_1.BadRequestException("invalid_grant");
        const balance = await this.db.rpc("admin_grant_coin", { p_player_id: playerId, p_amount: amount, p_admin_actor: actor, p_reason: String(body.reason).slice(0, 200), p_reference_id: body.referenceId || (0, node_crypto_1.randomUUID)() });
        return { playerId, balance };
    }
    async retention(key) {
        this.authorize(key);
        const deleted = await this.db.rpc("purge_old_match_history", { p_retention_days: (0, runtime_config_1.runtimeConfig)().matchRetentionDays });
        return { deleted };
    }
    async setPrice(key, itemId, body) {
        this.authorize(key);
        const platform = String(body.platform ?? "");
        const currency = String(body.currency ?? "");
        const amount = Number(body.amount);
        if (!platform || !["coin", "XTR"].includes(currency) || !Number.isSafeInteger(amount) || amount < 0 || (currency === "XTR" && platform !== "telegram"))
            throw new common_1.BadRequestException("invalid_price");
        const priceId = await this.db.rpc("set_shop_price", { p_item_id: itemId, p_platform: platform, p_currency_code: currency, p_amount: amount });
        return { priceId };
    }
    async defaults(key, body) {
        this.authorize(key);
        if (!body.colorAssetKey || !body.shapeAssetKey || !body.trailAssetKey)
            throw new common_1.BadRequestException("missing_default_assets");
        await this.db.rpc("configure_default_shop_items", { p_color_asset_key: body.colorAssetKey, p_shape_asset_key: body.shapeAssetKey, p_trail_asset_key: body.trailAssetKey });
        return { ok: true };
    }
    async deletePlayer(key, playerId) {
        this.authorize(key);
        await this.db.from("player_sessions").update({ revoked_at: new Date().toISOString() }).eq("player_id", playerId);
        const { error } = await this.db.from("players").update({ status: "deleted", display_name: "Deleted Player", deleted_at: new Date().toISOString() }).eq("id", playerId);
        if (error)
            throw new common_1.BadRequestException(error.message);
        return { ok: true, mode: "soft-delete" };
    }
    async listLevels(key) {
        this.authorize(key);
        const { data, error } = await this.db.from("campaign_levels")
            .select("id,sort_order,name,config,powerups,unlock_requires,rewards,published,version,updated_at").order("sort_order");
        if (error)
            throw new common_1.BadRequestException(error.message);
        return { levels: data ?? [] };
    }
    async upsertLevel(key, draft) {
        this.authorize(key);
        const errors = (0, shared_1.validateLevelDraft)(draft);
        if (draft?.unlockRequires === draft?.id)
            errors.push("unlockRequires không được trỏ chính nó");
        if (errors.length)
            throw new common_1.BadRequestException({ code: "invalid_level", errors });
        if (draft.unlockRequires) {
            const { data } = await this.db.from("campaign_levels").select("id").eq("id", draft.unlockRequires).maybeSingle();
            if (!data)
                throw new common_1.BadRequestException({ code: "invalid_level", errors: [`unlockRequires trỏ id không tồn tại: ${draft.unlockRequires}`] });
        }
        const id = await this.db.rpc("upsert_campaign_level", { p_level: draft });
        return { id };
    }
    async publishLevel(key, id, body) {
        this.authorize(key);
        const published = await this.db.rpc("publish_campaign_level", { p_id: id, p_published: body.published !== false });
        return { id, published };
    }
    async unpublishLevel(key, id) {
        this.authorize(key);
        await this.db.rpc("publish_campaign_level", { p_id: id, p_published: false });
        return { id, published: false, mode: "unpublish" };
    }
};
exports.AdminController = AdminController;
__decorate([
    (0, common_1.Post)("players/:id/grant-coin"),
    __param(0, (0, common_1.Headers)("x-admin-key")),
    __param(1, (0, common_1.Param)("id")),
    __param(2, (0, common_1.Body)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [String, String, Object]),
    __metadata("design:returntype", Promise)
], AdminController.prototype, "grant", null);
__decorate([
    (0, common_1.Post)("retention/matches"),
    __param(0, (0, common_1.Headers)("x-admin-key")),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [String]),
    __metadata("design:returntype", Promise)
], AdminController.prototype, "retention", null);
__decorate([
    (0, common_1.Put)("catalog/:itemId/price"),
    __param(0, (0, common_1.Headers)("x-admin-key")),
    __param(1, (0, common_1.Param)("itemId")),
    __param(2, (0, common_1.Body)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [String, String, Object]),
    __metadata("design:returntype", Promise)
], AdminController.prototype, "setPrice", null);
__decorate([
    (0, common_1.Put)("catalog/defaults"),
    __param(0, (0, common_1.Headers)("x-admin-key")),
    __param(1, (0, common_1.Body)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [String, Object]),
    __metadata("design:returntype", Promise)
], AdminController.prototype, "defaults", null);
__decorate([
    (0, common_1.Delete)("players/:id"),
    __param(0, (0, common_1.Headers)("x-admin-key")),
    __param(1, (0, common_1.Param)("id")),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [String, String]),
    __metadata("design:returntype", Promise)
], AdminController.prototype, "deletePlayer", null);
__decorate([
    (0, common_1.Get)("levels"),
    __param(0, (0, common_1.Headers)("x-admin-key")),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [String]),
    __metadata("design:returntype", Promise)
], AdminController.prototype, "listLevels", null);
__decorate([
    (0, common_1.Post)("levels"),
    __param(0, (0, common_1.Headers)("x-admin-key")),
    __param(1, (0, common_1.Body)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [String, Object]),
    __metadata("design:returntype", Promise)
], AdminController.prototype, "upsertLevel", null);
__decorate([
    (0, common_1.Put)("levels/:id/publish"),
    __param(0, (0, common_1.Headers)("x-admin-key")),
    __param(1, (0, common_1.Param)("id")),
    __param(2, (0, common_1.Body)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [String, String, Object]),
    __metadata("design:returntype", Promise)
], AdminController.prototype, "publishLevel", null);
__decorate([
    (0, common_1.Delete)("levels/:id"),
    __param(0, (0, common_1.Headers)("x-admin-key")),
    __param(1, (0, common_1.Param)("id")),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [String, String]),
    __metadata("design:returntype", Promise)
], AdminController.prototype, "unpublishLevel", null);
exports.AdminController = AdminController = __decorate([
    (0, common_1.Controller)("internal/v1/admin"),
    __metadata("design:paramtypes", [supabase_service_1.SupabaseService])
], AdminController);
//# sourceMappingURL=admin.controller.js.map