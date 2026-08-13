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
Object.defineProperty(exports, "__esModule", { value: true });
exports.HealthController = void 0;
const common_1 = require("@nestjs/common");
const supabase_service_1 = require("./database/supabase.service");
const runtime_config_1 = require("./runtime-config");
const network_transport_1 = require("./net/network-transport");
const config_1 = require("./config");
let HealthController = class HealthController {
    constructor(db) {
        this.db = db;
    }
    live() { return { ok: true, role: (0, runtime_config_1.runtimeConfig)().role, region: (0, runtime_config_1.runtimeConfig)().region }; }
    ping() { return { ok: true, region: (0, runtime_config_1.runtimeConfig)().region, time: Date.now() }; }
    network() { return network_transport_1.gameNetworkMetrics.snapshot(config_1.WS_BACKPRESSURE_BYTES); }
    publicConfig() {
        const cfg = (0, runtime_config_1.runtimeConfig)();
        return {
            googleRedirectUri: cfg.google.redirectUri,
            postLoginRedirectUri: cfg.google.postLoginRedirectUri,
            regions: cfg.regions,
        };
    }
    async ready() { const database = (0, runtime_config_1.runtimeConfig)().role === "game" ? true : await this.db.health(); return { ok: database, database }; }
};
exports.HealthController = HealthController;
__decorate([
    (0, common_1.Get)("live"),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", []),
    __metadata("design:returntype", void 0)
], HealthController.prototype, "live", null);
__decorate([
    (0, common_1.Get)("ping"),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", []),
    __metadata("design:returntype", void 0)
], HealthController.prototype, "ping", null);
__decorate([
    (0, common_1.Get)("network"),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", []),
    __metadata("design:returntype", void 0)
], HealthController.prototype, "network", null);
__decorate([
    (0, common_1.Get)("public-config"),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", []),
    __metadata("design:returntype", void 0)
], HealthController.prototype, "publicConfig", null);
__decorate([
    (0, common_1.Get)("ready"),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", []),
    __metadata("design:returntype", Promise)
], HealthController.prototype, "ready", null);
exports.HealthController = HealthController = __decorate([
    (0, common_1.Controller)("health"),
    __metadata("design:paramtypes", [supabase_service_1.SupabaseService])
], HealthController);
//# sourceMappingURL=health.controller.js.map