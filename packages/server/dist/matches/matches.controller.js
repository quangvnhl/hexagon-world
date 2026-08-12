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
exports.MatchesController = void 0;
const common_1 = require("@nestjs/common");
const node_crypto_1 = require("node:crypto");
const supabase_service_1 = require("../database/supabase.service");
const runtime_config_1 = require("../runtime-config");
let MatchesController = class MatchesController {
    constructor(db) {
        this.db = db;
    }
    async result(signature, body) {
        const secret = (0, runtime_config_1.runtimeConfig)().gameResultSecret;
        const expected = (0, node_crypto_1.createHmac)("sha256", secret).update(JSON.stringify(body)).digest();
        const actual = Buffer.from(String(signature || ""), "hex");
        if (!secret || actual.length !== expected.length || !(0, node_crypto_1.timingSafeEqual)(actual, expected))
            throw new common_1.UnauthorizedException("invalid_game_signature");
        const inserted = await this.db.rpc("record_match_result", { p_payload: body });
        return { inserted };
    }
};
exports.MatchesController = MatchesController;
__decorate([
    (0, common_1.Post)("match-results"),
    __param(0, (0, common_1.Headers)("x-game-signature")),
    __param(1, (0, common_1.Body)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [String, Object]),
    __metadata("design:returntype", Promise)
], MatchesController.prototype, "result", null);
exports.MatchesController = MatchesController = __decorate([
    (0, common_1.Controller)("internal/v1"),
    __metadata("design:paramtypes", [supabase_service_1.SupabaseService])
], MatchesController);
//# sourceMappingURL=matches.controller.js.map