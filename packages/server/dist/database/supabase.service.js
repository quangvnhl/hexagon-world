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
exports.SupabaseService = void 0;
const common_1 = require("@nestjs/common");
const supabase_js_1 = require("@supabase/supabase-js");
const runtime_config_1 = require("../runtime-config");
let SupabaseService = class SupabaseService {
    constructor() {
        const cfg = (0, runtime_config_1.runtimeConfig)();
        this.client = (0, supabase_js_1.createClient)(cfg.supabaseUrl || "http://127.0.0.1", cfg.supabaseKey || "game-node-without-database", {
            auth: { autoRefreshToken: false, persistSession: false, detectSessionInUrl: false },
        });
    }
    from(table) { return this.client.from(table); }
    async rpc(fn, params) {
        const { data, error } = await this.client.rpc(fn, params);
        if (error)
            throw new common_1.ServiceUnavailableException({ code: "database_error", message: error.message });
        return data;
    }
    async health() {
        const { error } = await this.client.from("shop_items").select("id", { head: true, count: "exact" }).limit(1);
        return !error;
    }
};
exports.SupabaseService = SupabaseService;
exports.SupabaseService = SupabaseService = __decorate([
    (0, common_1.Injectable)(),
    __metadata("design:paramtypes", [])
], SupabaseService);
//# sourceMappingURL=supabase.service.js.map