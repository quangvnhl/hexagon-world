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
exports.GameModule = exports.GatewayService = void 0;
const common_1 = require("@nestjs/common");
const core_1 = require("@nestjs/core");
const net_server_1 = require("../net/net-server");
const config_1 = require("../config");
const runtime_config_1 = require("../runtime-config");
const ticket_service_1 = require("../regions/ticket.service");
const match_result_reporter_service_1 = require("../matches/match-result-reporter.service");
let GatewayService = class GatewayService {
    constructor(adapter, tickets, results) {
        this.adapter = adapter;
        this.tickets = tickets;
        this.results = results;
        this.net = null;
    }
    async onModuleInit() {
        const cfg = (0, runtime_config_1.runtimeConfig)();
        const port = Number(process.env.PORT ?? config_1.DEFAULT_PORT);
        this.net = new net_server_1.NetServer({
            port,
            tickRate: config_1.TICK_RATE,
            httpServer: this.adapter.httpAdapter.getHttpServer(),
            path: cfg.role === "all" ? undefined : "/game",
            requireTicket: cfg.role === "game",
            authenticateTicket: (token) => this.tickets.verify(token, cfg.region),
            region: cfg.region,
            serverVersion: process.env.npm_package_version ?? "0.1.0",
            onMatchResult: (result) => this.results.report(result),
        });
        await this.net.start();
        console.log(`[Hexagon] Server AUTHORITATIVE region=${cfg.region} chuẩn bị trên cổng ${port}, ` +
            `${config_1.TICK_RATE} Hz. Phòng tạo khi có người vào ` +
            `(tối đa ${config_1.MAX_PLAYERS} ghế người + ${config_1.BOT_COUNT} bot), ` +
            `đóng khi hết người hoặc hết ván.`);
    }
    async onApplicationShutdown() {
        if (this.net) {
            await this.net.close();
            this.net = null;
        }
    }
};
exports.GatewayService = GatewayService;
exports.GatewayService = GatewayService = __decorate([
    (0, common_1.Injectable)(),
    __metadata("design:paramtypes", [core_1.HttpAdapterHost, ticket_service_1.TicketService, match_result_reporter_service_1.MatchResultReporter])
], GatewayService);
let GameModule = class GameModule {
};
exports.GameModule = GameModule;
exports.GameModule = GameModule = __decorate([
    (0, common_1.Module)({
        providers: [GatewayService, ticket_service_1.TicketService, match_result_reporter_service_1.MatchResultReporter],
    })
], GameModule);
//# sourceMappingURL=game.module.js.map