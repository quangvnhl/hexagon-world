"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __exportStar = (this && this.__exportStar) || function(m, exports) {
    for (var p in m) if (p !== "default" && !Object.prototype.hasOwnProperty.call(exports, p)) __createBinding(exports, m, p);
};
Object.defineProperty(exports, "__esModule", { value: true });
// Barrel của gói dùng chung (@hexagon/shared): toán hex, luật flood fill, GameState
// deterministic, cấu hình, hình học sân, protocol mạng, và spatial hash.
// DÙNG CHUNG giữa client (render/predict) và server (authoritative).
__exportStar(require("./hex"), exports);
__exportStar(require("./floodfill"), exports);
__exportStar(require("./config"), exports);
__exportStar(require("./arena"), exports);
__exportStar(require("./state"), exports);
__exportStar(require("./protocol"), exports);
__exportStar(require("./protocol-version"), exports);
__exportStar(require("./spatialhash"), exports);
__exportStar(require("./totems"), exports);
