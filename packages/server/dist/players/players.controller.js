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
exports.PlayersController = void 0;
const common_1 = require("@nestjs/common");
const session_service_1 = require("../auth/session.service");
const supabase_service_1 = require("../database/supabase.service");
let PlayersController = class PlayersController {
    constructor(sessions, db) {
        this.sessions = sessions;
        this.db = db;
    }
    async me(req) {
        const player = await this.sessions.resolve(req);
        const [profile, stats, progression, wallets, inventory, loadout] = await Promise.all([
            this.db.from("player_profiles").select("*").eq("player_id", player.id).single(),
            this.db.from("player_stats").select("*").eq("player_id", player.id).single(),
            this.db.from("player_progression").select("total_xp,level,updated_at").eq("player_id", player.id).single(),
            this.db.from("player_wallets").select("currency_code,balance").eq("player_id", player.id),
            this.db.from("player_inventory").select("quantity,created_at,shop_items(id,sku,type,asset_key,name,rarity)").eq("player_id", player.id),
            this.db.from("player_loadouts").select("*").eq("player_id", player.id).single(),
        ]);
        return { player, profile: profile.data, stats: stats.data, progression: progression.data, wallets: wallets.data ?? [], inventory: inventory.data ?? [], loadout: loadout.data };
    }
    async profile(req, body) {
        const player = await this.sessions.resolve(req);
        const name = String(body.displayName ?? "").trim();
        if (name.length < 1 || name.length > 32)
            throw new common_1.BadRequestException("invalid_display_name");
        const { error } = await this.db.from("players").update({ display_name: name }).eq("id", player.id);
        if (error)
            throw new common_1.BadRequestException(error.message);
        return { ok: true, displayName: name };
    }
};
exports.PlayersController = PlayersController;
__decorate([
    (0, common_1.Get)("me"),
    __param(0, (0, common_1.Req)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object]),
    __metadata("design:returntype", Promise)
], PlayersController.prototype, "me", null);
__decorate([
    (0, common_1.Patch)("me/profile"),
    __param(0, (0, common_1.Req)()),
    __param(1, (0, common_1.Body)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, Object]),
    __metadata("design:returntype", Promise)
], PlayersController.prototype, "profile", null);
exports.PlayersController = PlayersController = __decorate([
    (0, common_1.Controller)("v1"),
    __metadata("design:paramtypes", [session_service_1.SessionService, supabase_service_1.SupabaseService])
], PlayersController);
//# sourceMappingURL=players.controller.js.map