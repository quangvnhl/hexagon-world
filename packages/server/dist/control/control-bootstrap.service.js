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
var ControlBootstrapService_1;
Object.defineProperty(exports, "__esModule", { value: true });
exports.ControlBootstrapService = void 0;
const common_1 = require("@nestjs/common");
const supabase_service_1 = require("../database/supabase.service");
const runtime_config_1 = require("../runtime-config");
let ControlBootstrapService = ControlBootstrapService_1 = class ControlBootstrapService {
    constructor(db) {
        this.db = db;
        this.logger = new common_1.Logger(ControlBootstrapService_1.name);
        this.retentionTimer = null;
    }
    onModuleInit() {
        const startupTimer = setTimeout(() => void this.bootstrapPersistence(), 0);
        startupTimer.unref();
    }
    async bootstrapPersistence() {
        const defaults = (0, runtime_config_1.runtimeConfig)().defaultAssets;
        try {
            await this.db.rpc("configure_default_shop_items", { p_color_asset_key: defaults.color, p_shape_asset_key: defaults.shape, p_trail_asset_key: defaults.trail });
        }
        catch (error) {
            this.logger.warn(`Chưa thể đồng bộ default catalog: ${error instanceof Error ? error.message : String(error)}`);
        }
        await this.runRetention();
        this.retentionTimer = setInterval(() => void this.runRetention(), 24 * 60 * 60 * 1000);
        this.retentionTimer.unref();
    }
    async runRetention() {
        try {
            await this.db.rpc("purge_old_match_history", { p_retention_days: (0, runtime_config_1.runtimeConfig)().matchRetentionDays });
        }
        catch (error) {
            this.logger.warn(`Retention match history chưa chạy được: ${error instanceof Error ? error.message : String(error)}`);
        }
    }
    onApplicationShutdown() { if (this.retentionTimer)
        clearInterval(this.retentionTimer); this.retentionTimer = null; }
};
exports.ControlBootstrapService = ControlBootstrapService;
exports.ControlBootstrapService = ControlBootstrapService = ControlBootstrapService_1 = __decorate([
    (0, common_1.Injectable)(),
    __metadata("design:paramtypes", [supabase_service_1.SupabaseService])
], ControlBootstrapService);
//# sourceMappingURL=control-bootstrap.service.js.map