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
var SessionService_1;
Object.defineProperty(exports, "__esModule", { value: true });
exports.SessionService = void 0;
const common_1 = require("@nestjs/common");
const node_crypto_1 = require("node:crypto");
const supabase_service_1 = require("../database/supabase.service");
const runtime_config_1 = require("../runtime-config");
let SessionService = SessionService_1 = class SessionService {
    constructor(db) {
        this.db = db;
    }
    async create(playerId, source, res) {
        const cfg = (0, runtime_config_1.runtimeConfig)();
        const token = (0, node_crypto_1.randomBytes)(32).toString("base64url");
        const expiresAt = new Date(Date.now() + cfg.sessionTtlSeconds * 1000).toISOString();
        const { error } = await this.db.from("player_sessions").insert({ player_id: playerId, source, token_hash: (0, runtime_config_1.sha256)(token), expires_at: expiresAt });
        if (error)
            throw new Error(`Không thể tạo session: ${error.message}`);
        res.cookie(SessionService_1.COOKIE, token, { httpOnly: true, secure: cfg.cookieSecure, sameSite: "lax", maxAge: cfg.sessionTtlSeconds * 1000, path: "/" });
        return token;
    }
    clear(res) { res.clearCookie(SessionService_1.COOKIE, { path: "/" }); }
    tokenFrom(req) {
        const auth = req.headers.authorization;
        if (auth?.startsWith("Bearer "))
            return auth.slice(7).trim();
        return String(req.cookies?.[SessionService_1.COOKIE] ?? "");
    }
    async resolve(req) {
        const token = this.tokenFrom(req);
        if (!token)
            throw new common_1.UnauthorizedException("missing_session");
        const { data, error } = await this.db.from("player_sessions")
            .select("player_id,source,expires_at,revoked_at,players!inner(id,display_name,status)")
            .eq("token_hash", (0, runtime_config_1.sha256)(token)).is("revoked_at", null).gt("expires_at", new Date().toISOString()).maybeSingle();
        if (error || !data)
            throw new common_1.UnauthorizedException("invalid_session");
        const player = data.players;
        if (player.status !== "active")
            throw new common_1.UnauthorizedException("player_inactive");
        return { id: player.id, displayName: player.display_name, platform: String(data.source) };
    }
    async revoke(req, res) {
        const token = this.tokenFrom(req);
        if (token)
            await this.db.from("player_sessions").update({ revoked_at: new Date().toISOString() }).eq("token_hash", (0, runtime_config_1.sha256)(token));
        this.clear(res);
    }
};
exports.SessionService = SessionService;
SessionService.COOKIE = "hex_session";
exports.SessionService = SessionService = SessionService_1 = __decorate([
    (0, common_1.Injectable)(),
    __metadata("design:paramtypes", [supabase_service_1.SupabaseService])
], SessionService);
//# sourceMappingURL=session.service.js.map