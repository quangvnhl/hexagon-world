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
exports.RegionsController = void 0;
const common_1 = require("@nestjs/common");
const shared_1 = require("@hexagon/shared");
const session_service_1 = require("../auth/session.service");
const supabase_service_1 = require("../database/supabase.service");
const runtime_config_1 = require("../runtime-config");
const ticket_service_1 = require("./ticket.service");
let RegionsController = class RegionsController {
    constructor(sessions, tickets, db) {
        this.sessions = sessions;
        this.tickets = tickets;
        this.db = db;
    }
    regions() { return { regions: (0, runtime_config_1.runtimeConfig)().regions }; }
    guest(body) {
        const region = this.assertRegion(body.region);
        const guestId = String(body.guestId ?? "").trim();
        if (!/^[A-Za-z0-9_-]{16,128}$/.test(guestId))
            throw new common_1.BadRequestException("invalid_guest_id");
        const appearance = (0, shared_1.sanitizePlayerAppearance)(body.appearance);
        return { ticket: this.tickets.issue({ playerId: null, guestId, isGuest: true, platform: "web", displayName: String(body.displayName || "Guest").slice(0, 32), region, appearance }), region };
    }
    async authenticated(req, body) {
        const player = await this.sessions.resolve(req);
        const region = this.assertRegion(body.region);
        const { data } = await this.db.from("player_profiles").select("selected_color,selected_shape,selected_trail_pattern").eq("player_id", player.id).maybeSingle();
        const savedAppearance = { colorIndex: Number(String(data?.selected_color ?? "color:0").split(":")[1] ?? 0), shape: String(data?.selected_shape ?? "shape:cube").replace("shape:", ""), trailPattern: String(data?.selected_trail_pattern ?? "trail:solid").replace("trail:", "") };
        const appearance = (0, shared_1.sanitizePlayerAppearance)(body.appearance ?? savedAppearance);
        return { ticket: this.tickets.issue({ playerId: player.id, guestId: null, isGuest: false, platform: player.platform, displayName: player.displayName, region, appearance }), region };
    }
    assertRegion(value) {
        const region = String(value || (0, runtime_config_1.runtimeConfig)().regions[0]?.id || "local");
        if (!(0, runtime_config_1.runtimeConfig)().regions.some((r) => r.id === region))
            throw new common_1.BadRequestException("unknown_region");
        return region;
    }
};
exports.RegionsController = RegionsController;
__decorate([
    (0, common_1.Get)("regions"),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", []),
    __metadata("design:returntype", void 0)
], RegionsController.prototype, "regions", null);
__decorate([
    (0, common_1.Post)("game-tickets/guest"),
    __param(0, (0, common_1.Body)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object]),
    __metadata("design:returntype", void 0)
], RegionsController.prototype, "guest", null);
__decorate([
    (0, common_1.Post)("game-tickets"),
    __param(0, (0, common_1.Req)()),
    __param(1, (0, common_1.Body)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, Object]),
    __metadata("design:returntype", Promise)
], RegionsController.prototype, "authenticated", null);
exports.RegionsController = RegionsController = __decorate([
    (0, common_1.Controller)("v1"),
    __metadata("design:paramtypes", [session_service_1.SessionService, ticket_service_1.TicketService, supabase_service_1.SupabaseService])
], RegionsController);
//# sourceMappingURL=regions.controller.js.map