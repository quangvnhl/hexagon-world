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
exports.DevAuthController = void 0;
const node_crypto_1 = require("node:crypto");
const common_1 = require("@nestjs/common");
const identity_service_1 = require("./identity.service");
const session_service_1 = require("./session.service");
const supabase_service_1 = require("../database/supabase.service");
const runtime_config_1 = require("../runtime-config");
let DevAuthController = class DevAuthController {
    constructor(identities, sessions, db) {
        this.identities = identities;
        this.sessions = sessions;
        this.db = db;
    }
    async dev(req, res, body) {
        const cfg = (0, runtime_config_1.runtimeConfig)();
        if (process.env.DEV_LOGIN !== "true" || cfg.cookieSecure) {
            throw new common_1.ForbiddenException("dev_login_disabled");
        }
        const name = String(body.name ?? "Dev").trim().slice(0, 16) || "Dev";
        const playerId = await this.identities.createOrGet({
            platform: "dev",
            provider: "dev",
            providerUserId: `dev:${name.toLowerCase()}`,
            displayName: name,
        });
        await this.sessions.create(playerId, "dev", res);
        try {
            await this.db.rpc("admin_grant_coin", {
                p_player_id: playerId, p_amount: 1000, p_admin_actor: "dev-login",
                p_reason: "dev top-up", p_reference_id: (0, node_crypto_1.randomUUID)(),
            });
        }
        catch { }
        return { ok: true, playerId, displayName: name };
    }
};
exports.DevAuthController = DevAuthController;
__decorate([
    (0, common_1.Post)("dev"),
    __param(0, (0, common_1.Req)()),
    __param(1, (0, common_1.Res)({ passthrough: true })),
    __param(2, (0, common_1.Body)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, Object, Object]),
    __metadata("design:returntype", Promise)
], DevAuthController.prototype, "dev", null);
exports.DevAuthController = DevAuthController = __decorate([
    (0, common_1.Controller)("v1/auth"),
    __metadata("design:paramtypes", [identity_service_1.IdentityService,
        session_service_1.SessionService,
        supabase_service_1.SupabaseService])
], DevAuthController);
//# sourceMappingURL=dev-auth.controller.js.map