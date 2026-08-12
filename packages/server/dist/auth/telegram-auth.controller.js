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
exports.TelegramAuthController = void 0;
exports.verifyTelegramInitData = verifyTelegramInitData;
const common_1 = require("@nestjs/common");
const node_crypto_1 = require("node:crypto");
const identity_service_1 = require("./identity.service");
const session_service_1 = require("./session.service");
const runtime_config_1 = require("../runtime-config");
function verifyTelegramInitData(initData, botToken, maxAgeSeconds) {
    const params = new URLSearchParams(initData);
    const hash = params.get("hash") ?? "";
    params.delete("hash");
    const dataCheck = [...params.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([k, v]) => `${k}=${v}`).join("\n");
    const secret = (0, node_crypto_1.createHmac)("sha256", "WebAppData").update(botToken).digest();
    const expected = (0, node_crypto_1.createHmac)("sha256", secret).update(dataCheck).digest();
    const actual = Buffer.from(hash, "hex");
    if (actual.length !== expected.length || !(0, node_crypto_1.timingSafeEqual)(actual, expected))
        throw new common_1.BadRequestException("invalid_telegram_signature");
    const authDate = Number(params.get("auth_date"));
    if (!Number.isFinite(authDate) || Math.abs(Date.now() / 1000 - authDate) > maxAgeSeconds)
        throw new common_1.BadRequestException("expired_telegram_init_data");
    try {
        const user = JSON.parse(params.get("user") ?? "null");
        if (!user?.id)
            throw new Error("missing user");
        return user;
    }
    catch {
        throw new common_1.BadRequestException("invalid_telegram_user");
    }
}
let TelegramAuthController = class TelegramAuthController {
    constructor(identities, sessions) {
        this.identities = identities;
        this.sessions = sessions;
    }
    async login(body, res) {
        const cfg = (0, runtime_config_1.runtimeConfig)();
        if (!body.initData)
            throw new common_1.BadRequestException("missing_init_data");
        const user = verifyTelegramInitData(body.initData, cfg.telegram.botToken, cfg.telegram.initDataMaxAgeSeconds);
        const displayName = [user.first_name, user.last_name].filter(Boolean).join(" ") || user.username || `Telegram ${user.id}`;
        const playerId = await this.identities.createOrGet({ platform: "telegram", provider: "telegram", providerUserId: String(user.id), displayName, username: user.username });
        const token = await this.sessions.create(playerId, "telegram", res);
        return { playerId, sessionToken: token, platform: "telegram" };
    }
};
exports.TelegramAuthController = TelegramAuthController;
__decorate([
    (0, common_1.Post)("telegram"),
    __param(0, (0, common_1.Body)()),
    __param(1, (0, common_1.Res)({ passthrough: true })),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, Object]),
    __metadata("design:returntype", Promise)
], TelegramAuthController.prototype, "login", null);
exports.TelegramAuthController = TelegramAuthController = __decorate([
    (0, common_1.Controller)("v1/auth"),
    __metadata("design:paramtypes", [identity_service_1.IdentityService, session_service_1.SessionService])
], TelegramAuthController);
//# sourceMappingURL=telegram-auth.controller.js.map