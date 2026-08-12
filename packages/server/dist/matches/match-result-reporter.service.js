"use strict";
var __decorate = (this && this.__decorate) || function (decorators, target, key, desc) {
    var c = arguments.length, r = c < 3 ? target : desc === null ? desc = Object.getOwnPropertyDescriptor(target, key) : desc, d;
    if (typeof Reflect === "object" && typeof Reflect.decorate === "function") r = Reflect.decorate(decorators, target, key, desc);
    else for (var i = decorators.length - 1; i >= 0; i--) if (d = decorators[i]) r = (c < 3 ? d(r) : c > 3 ? d(target, key, r) : d(target, key)) || r;
    return c > 3 && r && Object.defineProperty(target, key, r), r;
};
var MatchResultReporter_1;
Object.defineProperty(exports, "__esModule", { value: true });
exports.MatchResultReporter = void 0;
const common_1 = require("@nestjs/common");
const node_crypto_1 = require("node:crypto");
const node_fs_1 = require("node:fs");
const node_path_1 = require("node:path");
const runtime_config_1 = require("../runtime-config");
let MatchResultReporter = MatchResultReporter_1 = class MatchResultReporter {
    constructor() {
        this.logger = new common_1.Logger(MatchResultReporter_1.name);
        this.attempts = new Map();
        this.timers = new Set();
    }
    onModuleInit() {
        const cfg = (0, runtime_config_1.runtimeConfig)();
        if (!cfg.gameResultSecret)
            return;
        (0, node_fs_1.mkdirSync)(this.root(), { recursive: true });
        for (const name of (0, node_fs_1.readdirSync)(this.root()).filter((v) => v.endsWith(".json"))) {
            try {
                const result = JSON.parse((0, node_fs_1.readFileSync)((0, node_path_1.join)(this.root(), name), "utf8"));
                void this.deliver(result);
            }
            catch {
                this.logger.warn(`Bỏ qua match spool hỏng: ${name}`);
            }
        }
    }
    async report(result) {
        const cfg = (0, runtime_config_1.runtimeConfig)();
        if (!cfg.gameResultSecret)
            return;
        (0, node_fs_1.mkdirSync)(this.root(), { recursive: true });
        const target = this.file(result.eventId);
        if (!(0, node_fs_1.existsSync)(target)) {
            const temp = `${target}.tmp`;
            (0, node_fs_1.writeFileSync)(temp, JSON.stringify(result), { encoding: "utf8", flag: "wx" });
            (0, node_fs_1.renameSync)(temp, target);
        }
        await this.deliver(result);
    }
    root() { return (0, node_path_1.resolve)((0, runtime_config_1.runtimeConfig)().gameResultSpoolDir); }
    file(eventId) { return (0, node_path_1.join)(this.root(), `${eventId.replace(/[^a-f0-9-]/gi, "")}.json`); }
    async deliver(result) {
        const cfg = (0, runtime_config_1.runtimeConfig)();
        const body = JSON.stringify(result);
        const signature = (0, node_crypto_1.createHmac)("sha256", cfg.gameResultSecret).update(body).digest("hex");
        try {
            const response = await fetch(`${cfg.controlPlaneUrl}/internal/v1/match-results`, { method: "POST", headers: { "content-type": "application/json", "x-game-signature": signature }, body, signal: AbortSignal.timeout(5000) });
            if (!response.ok)
                throw new Error(`HTTP ${response.status}`);
            (0, node_fs_1.rmSync)(this.file(result.eventId), { force: true });
            this.attempts.delete(result.eventId);
        }
        catch (error) {
            const attempt = (this.attempts.get(result.eventId) ?? 0) + 1;
            this.attempts.set(result.eventId, attempt);
            const timer = setTimeout(() => { this.timers.delete(timer); void this.deliver(result); }, Math.min(60000, 1000 * 2 ** Math.min(attempt, 6)));
            timer.unref();
            this.timers.add(timer);
            if (attempt === 1 || attempt % 10 === 0)
                this.logger.warn(`Match ${result.matchId} đang chờ gửi lại: ${error instanceof Error ? error.message : String(error)}`);
        }
    }
};
exports.MatchResultReporter = MatchResultReporter;
exports.MatchResultReporter = MatchResultReporter = MatchResultReporter_1 = __decorate([
    (0, common_1.Injectable)()
], MatchResultReporter);
//# sourceMappingURL=match-result-reporter.service.js.map