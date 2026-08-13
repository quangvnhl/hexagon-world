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
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
require("reflect-metadata");
const core_1 = require("@nestjs/core");
const cookie_parser_1 = __importDefault(require("cookie-parser"));
const dotenv_1 = __importDefault(require("dotenv"));
const node_fs_1 = require("node:fs");
const node_path_1 = require("node:path");
const runtime_config_1 = require("./runtime-config");
const envPath = [process.env.ENV_FILE, (0, node_path_1.resolve)(process.cwd(), ".env"), (0, node_path_1.resolve)(__dirname, "../../../.env")].find((path) => Boolean(path && (0, node_fs_1.existsSync)(path)));
if (envPath)
    dotenv_1.default.config({ path: envPath, quiet: true });
async function bootstrap() {
    const { AppModule } = await Promise.resolve().then(() => __importStar(require("./app.module")));
    const cfg = (0, runtime_config_1.runtimeConfig)();
    const app = await core_1.NestFactory.create(AppModule, {
        logger: ["log", "warn", "error"],
    });
    app.use((0, cookie_parser_1.default)());
    app.enableCors({
        origin(origin, callback) {
            if (!origin || cfg.corsAllowedOrigins.includes(origin))
                callback(null, true);
            else
                callback(new Error(`CORS origin không được phép: ${origin}`), false);
        },
        credentials: true,
    });
    app.enableShutdownHooks();
    await app.listen(cfg.port, "0.0.0.0");
    console.log(`[Hexagon] role=${cfg.role} region=${cfg.region} port=${cfg.port}`);
}
void bootstrap();
//# sourceMappingURL=main.js.map