"use strict";
var __decorate = (this && this.__decorate) || function (decorators, target, key, desc) {
    var c = arguments.length, r = c < 3 ? target : desc === null ? desc = Object.getOwnPropertyDescriptor(target, key) : desc, d;
    if (typeof Reflect === "object" && typeof Reflect.decorate === "function") r = Reflect.decorate(decorators, target, key, desc);
    else for (var i = decorators.length - 1; i >= 0; i--) if (d = decorators[i]) r = (c < 3 ? d(r) : c > 3 ? d(target, key, r) : d(target, key)) || r;
    return c > 3 && r && Object.defineProperty(target, key, r), r;
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.GameModule = exports.GatewayService = void 0;
const common_1 = require("@nestjs/common");
const net_server_1 = require("../net/net-server");
const config_1 = require("../config");
let GatewayService = class GatewayService {
    constructor() {
        this.net = null;
    }
    async onModuleInit() {
        const port = Number(process.env.PORT ?? config_1.DEFAULT_PORT);
        this.net = new net_server_1.NetServer({ port, tickRate: config_1.TICK_RATE });
        await this.net.start();
        console.log(`[Hexagon] Server AUTHORITATIVE đang chạy — cổng ${this.net.port}, ` +
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
    (0, common_1.Injectable)()
], GatewayService);
let GameModule = class GameModule {
};
exports.GameModule = GameModule;
exports.GameModule = GameModule = __decorate([
    (0, common_1.Module)({
        providers: [GatewayService],
    })
], GameModule);
//# sourceMappingURL=game.module.js.map