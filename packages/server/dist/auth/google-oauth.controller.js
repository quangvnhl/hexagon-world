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
exports.GoogleOAuthController = void 0;
const common_1 = require("@nestjs/common");
const node_crypto_1 = require("node:crypto");
const google_auth_library_1 = require("google-auth-library");
const identity_service_1 = require("./identity.service");
const session_service_1 = require("./session.service");
const runtime_config_1 = require("../runtime-config");
const STATE_COOKIE = "hex_oauth_state";
const NONCE_COOKIE = "hex_oauth_nonce";
function signedState(secret) {
    const raw = (0, node_crypto_1.randomBytes)(24).toString("base64url");
    const sig = (0, node_crypto_1.createHmac)("sha256", secret).update(raw).digest("base64url");
    return `${raw}.${sig}`;
}
function validState(value, secret) {
    const [raw, sig] = value.split(".");
    if (!raw || !sig)
        return false;
    const expected = (0, node_crypto_1.createHmac)("sha256", secret).update(raw).digest();
    const actual = Buffer.from(sig, "base64url");
    return actual.length === expected.length && (0, node_crypto_1.timingSafeEqual)(actual, expected);
}
let GoogleOAuthController = class GoogleOAuthController {
    constructor(identities, sessions) {
        this.identities = identities;
        this.sessions = sessions;
    }
    client() {
        const cfg = (0, runtime_config_1.runtimeConfig)().google;
        return new google_auth_library_1.OAuth2Client(cfg.clientId, cfg.clientSecret, cfg.redirectUri);
    }
    start(res) {
        const cfg = (0, runtime_config_1.runtimeConfig)();
        const state = signedState(cfg.google.stateSecret);
        const nonce = (0, node_crypto_1.randomBytes)(24).toString("base64url");
        const cookie = { httpOnly: true, secure: cfg.cookieSecure, sameSite: "lax", maxAge: cfg.google.stateTtlSeconds * 1000, path: "/v1/auth/web/google/callback" };
        res.cookie(STATE_COOKIE, state, cookie);
        res.cookie(NONCE_COOKIE, nonce, cookie);
        const url = this.client().generateAuthUrl({ access_type: "online", scope: cfg.google.scopes.split(/\s+/), state, prompt: "select_account", include_granted_scopes: false, nonce });
        res.redirect(url);
    }
    async callback(code, state, oauthError, req, res) {
        const cfg = (0, runtime_config_1.runtimeConfig)();
        if (oauthError)
            throw new common_1.BadRequestException(`google_oauth_${oauthError}`);
        const cookieState = String(req.cookies?.[STATE_COOKIE] ?? "");
        const nonce = String(req.cookies?.[NONCE_COOKIE] ?? "");
        if (!code || !state || state !== cookieState || !validState(state, cfg.google.stateSecret) || !nonce)
            throw new common_1.BadRequestException("invalid_oauth_state");
        res.clearCookie(STATE_COOKIE, { path: "/v1/auth/web/google/callback" });
        res.clearCookie(NONCE_COOKIE, { path: "/v1/auth/web/google/callback" });
        const client = this.client();
        const { tokens } = await client.getToken(code);
        if (!tokens.id_token)
            throw new common_1.BadRequestException("missing_google_id_token");
        const ticket = await client.verifyIdToken({ idToken: tokens.id_token, audience: cfg.google.clientId });
        const payload = ticket.getPayload();
        if (!payload?.sub || payload.nonce !== nonce)
            throw new common_1.BadRequestException("invalid_google_id_token");
        const displayName = String(payload.name || payload.email || "Google Player");
        const playerId = await this.identities.createOrGet({ platform: "web", provider: "google", providerUserId: payload.sub, displayName, username: payload.email, metadata: { email: payload.email, picture: payload.picture } });
        await this.sessions.create(playerId, "web", res);
        res.redirect(cfg.google.postLoginRedirectUri);
    }
};
exports.GoogleOAuthController = GoogleOAuthController;
__decorate([
    (0, common_1.Get)("start"),
    __param(0, (0, common_1.Res)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object]),
    __metadata("design:returntype", void 0)
], GoogleOAuthController.prototype, "start", null);
__decorate([
    (0, common_1.Get)("callback"),
    __param(0, (0, common_1.Query)("code")),
    __param(1, (0, common_1.Query)("state")),
    __param(2, (0, common_1.Query)("error")),
    __param(3, (0, common_1.Req)()),
    __param(4, (0, common_1.Res)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [String, String, String, Object, Object]),
    __metadata("design:returntype", Promise)
], GoogleOAuthController.prototype, "callback", null);
exports.GoogleOAuthController = GoogleOAuthController = __decorate([
    (0, common_1.Controller)("v1/auth/web/google"),
    __metadata("design:paramtypes", [identity_service_1.IdentityService, session_service_1.SessionService])
], GoogleOAuthController);
//# sourceMappingURL=google-oauth.controller.js.map