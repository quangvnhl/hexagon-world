"use strict";
var __decorate = (this && this.__decorate) || function (decorators, target, key, desc) {
    var c = arguments.length, r = c < 3 ? target : desc === null ? desc = Object.getOwnPropertyDescriptor(target, key) : desc, d;
    if (typeof Reflect === "object" && typeof Reflect.decorate === "function") r = Reflect.decorate(decorators, target, key, desc);
    else for (var i = decorators.length - 1; i >= 0; i--) if (d = decorators[i]) r = (c < 3 ? d(r) : c > 3 ? d(target, key, r) : d(target, key)) || r;
    return c > 3 && r && Object.defineProperty(target, key, r), r;
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.TicketService = void 0;
const common_1 = require("@nestjs/common");
const node_crypto_1 = require("node:crypto");
const runtime_config_1 = require("../runtime-config");
function encode(value) { return Buffer.from(JSON.stringify(value)).toString("base64url"); }
let TicketService = class TicketService {
    issue(input) {
        const cfg = (0, runtime_config_1.runtimeConfig)();
        const now = Math.floor(Date.now() / 1000);
        const payload = { ...input, jti: (0, node_crypto_1.randomUUID)(), iat: now, exp: now + cfg.ticket.ttlSeconds };
        const alg = cfg.ticket.privateKeyBase64 ? "EdDSA" : "HS256";
        if (cfg.role === "control" && alg !== "EdDSA")
            throw new Error("Control plane production cần private key ký region ticket");
        const signingInput = `${encode({ alg, typ: "HGT" })}.${encode(payload)}`;
        const signature = alg === "EdDSA"
            ? (0, node_crypto_1.sign)(null, Buffer.from(signingInput), (0, node_crypto_1.createPrivateKey)(Buffer.from(cfg.ticket.privateKeyBase64, "base64"))).toString("base64url")
            : (0, node_crypto_1.createHmac)("sha256", cfg.sessionSecret).update(signingInput).digest("base64url");
        return `${signingInput}.${signature}`;
    }
    verify(token, expectedRegion = (0, runtime_config_1.runtimeConfig)().region) {
        const [headerPart, payloadPart, signaturePart] = token.split(".");
        if (!headerPart || !payloadPart || !signaturePart)
            throw new common_1.UnauthorizedException("invalid_game_ticket");
        let header;
        let payload;
        try {
            header = JSON.parse(Buffer.from(headerPart, "base64url").toString());
            payload = JSON.parse(Buffer.from(payloadPart, "base64url").toString());
        }
        catch {
            throw new common_1.UnauthorizedException("invalid_game_ticket");
        }
        const cfg = (0, runtime_config_1.runtimeConfig)();
        const signingInput = `${headerPart}.${payloadPart}`;
        let valid = false;
        if (header.alg === "EdDSA" && cfg.ticket.publicKeyBase64) {
            valid = (0, node_crypto_1.verify)(null, Buffer.from(signingInput), (0, node_crypto_1.createPublicKey)(Buffer.from(cfg.ticket.publicKeyBase64, "base64")), Buffer.from(signaturePart, "base64url"));
        }
        else if (header.alg === "HS256" && cfg.role === "all") {
            const expected = (0, node_crypto_1.createHmac)("sha256", cfg.sessionSecret).update(signingInput).digest();
            const actual = Buffer.from(signaturePart, "base64url");
            valid = actual.length === expected.length && (0, node_crypto_1.timingSafeEqual)(actual, expected);
        }
        const now = Math.floor(Date.now() / 1000);
        if (!valid || payload.exp <= now || payload.iat > now + 30)
            throw new common_1.UnauthorizedException("expired_or_invalid_game_ticket");
        if (payload.region !== expectedRegion)
            throw new common_1.BadRequestException("wrong_game_region");
        return payload;
    }
};
exports.TicketService = TicketService;
exports.TicketService = TicketService = __decorate([
    (0, common_1.Injectable)()
], TicketService);
//# sourceMappingURL=ticket.service.js.map