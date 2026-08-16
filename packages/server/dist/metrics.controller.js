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
exports.MetricsController = void 0;
const common_1 = require("@nestjs/common");
const network_transport_1 = require("./net/network-transport");
const telemetry_1 = require("./net/telemetry");
const prometheus_1 = require("./net/prometheus");
const config_1 = require("./config");
let MetricsController = class MetricsController {
    metrics() {
        return (0, prometheus_1.renderPrometheus)(network_transport_1.gameNetworkMetrics.snapshot(config_1.WS_BACKPRESSURE_BYTES), telemetry_1.serverTelemetry.snapshot(), (0, prometheus_1.collectProcessMetrics)());
    }
};
exports.MetricsController = MetricsController;
__decorate([
    (0, common_1.Get)("metrics"),
    (0, common_1.Header)("Content-Type", "text/plain; version=0.0.4"),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", []),
    __metadata("design:returntype", String)
], MetricsController.prototype, "metrics", null);
exports.MetricsController = MetricsController = __decorate([
    (0, common_1.Controller)()
], MetricsController);
//# sourceMappingURL=metrics.controller.js.map