"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
require("reflect-metadata");
const core_1 = require("@nestjs/core");
const app_module_1 = require("./app.module");
async function bootstrap() {
    const app = await core_1.NestFactory.createApplicationContext(app_module_1.AppModule, {
        logger: ["log", "warn", "error"],
    });
    app.enableShutdownHooks();
    console.log("[Hexagon] Ứng dụng đã khởi tạo. Nhấn Ctrl+C để dừng.");
}
void bootstrap();
//# sourceMappingURL=main.js.map