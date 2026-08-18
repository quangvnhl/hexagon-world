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
exports.CampaignController = void 0;
const common_1 = require("@nestjs/common");
const shared_1 = require("@hexagon/shared");
const session_service_1 = require("../auth/session.service");
const supabase_service_1 = require("../database/supabase.service");
function toLevel(r) {
    return {
        id: r.id, order: r.sort_order, name: r.name,
        config: (r.config ?? {}),
        powerups: (r.powerups ?? []),
        unlock: { requires: r.unlock_requires },
        rewards: r.rewards,
    };
}
let CampaignController = class CampaignController {
    constructor(sessions, db) {
        this.sessions = sessions;
        this.db = db;
    }
    async levels() {
        return { levels: await this.publishedLevels() };
    }
    async progress(req) {
        const player = await this.sessions.resolve(req);
        const { data, error } = await this.db.from("player_level_progress")
            .select("level_id,status,stars,best_score,completed_at").eq("player_id", player.id);
        if (error)
            throw new common_1.BadRequestException(error.message);
        return { progress: (data ?? []) };
    }
    async start(req, body) {
        const player = await this.sessions.resolve(req);
        if (!body.levelId || !body.idempotencyKey)
            throw new common_1.BadRequestException("missing_start_fields");
        const levels = await this.publishedLevels();
        if (!levels.some((l) => l.id === body.levelId))
            throw new common_1.BadRequestException("unknown_level");
        const cleared = await this.clearedSet(player.id);
        if (!(0, shared_1.isUnlockedIn)(levels, body.levelId, cleared))
            throw new common_1.ForbiddenException("level_locked");
        return this.db.rpc("start_campaign_level", {
            p_player_id: player.id, p_level_id: body.levelId, p_idempotency_key: body.idempotencyKey,
        });
    }
    async complete(req, body) {
        const player = await this.sessions.resolve(req);
        if (!body.playId)
            throw new common_1.BadRequestException("missing_play_id");
        if (body.objectiveMet !== true)
            throw new common_1.BadRequestException("objective_not_met");
        const { data: play, error } = await this.db.from("campaign_plays")
            .select("id,level_id,completed_at").eq("id", body.playId).eq("player_id", player.id).single();
        if (error || !play)
            throw new common_1.BadRequestException("play_not_found");
        const { data: level } = await this.db.from("campaign_levels")
            .select("rewards").eq("id", play.level_id).single();
        if (!level)
            throw new common_1.BadRequestException("unknown_level");
        return this.db.rpc("complete_campaign_level", {
            p_play_id: body.playId,
            p_player_id: player.id,
            p_stars: Math.max(0, Math.min(3, Math.floor(body.stars ?? 1))),
            p_score: Math.max(0, Math.floor(body.score ?? 0)),
            p_rewards: level.rewards,
        });
    }
    async publishedLevels() {
        const { data, error } = await this.db.from("campaign_levels")
            .select("id,sort_order,name,config,powerups,unlock_requires,rewards").eq("published", true).order("sort_order");
        if (error)
            throw new common_1.BadRequestException(error.message);
        return (data ?? []).map(toLevel);
    }
    async clearedSet(playerId) {
        const { data } = await this.db.from("player_level_progress").select("level_id").eq("player_id", playerId).eq("status", "cleared");
        return new Set((data ?? []).map((r) => r.level_id));
    }
};
exports.CampaignController = CampaignController;
__decorate([
    (0, common_1.Get)("campaign/levels"),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", []),
    __metadata("design:returntype", Promise)
], CampaignController.prototype, "levels", null);
__decorate([
    (0, common_1.Get)("campaign/progress"),
    __param(0, (0, common_1.Req)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object]),
    __metadata("design:returntype", Promise)
], CampaignController.prototype, "progress", null);
__decorate([
    (0, common_1.Post)("campaign/start"),
    __param(0, (0, common_1.Req)()),
    __param(1, (0, common_1.Body)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, Object]),
    __metadata("design:returntype", Promise)
], CampaignController.prototype, "start", null);
__decorate([
    (0, common_1.Post)("campaign/complete"),
    __param(0, (0, common_1.Req)()),
    __param(1, (0, common_1.Body)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, Object]),
    __metadata("design:returntype", Promise)
], CampaignController.prototype, "complete", null);
exports.CampaignController = CampaignController = __decorate([
    (0, common_1.Controller)("v1"),
    __metadata("design:paramtypes", [session_service_1.SessionService, supabase_service_1.SupabaseService])
], CampaignController);
//# sourceMappingURL=campaign.controller.js.map