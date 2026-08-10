import "reflect-metadata";
import { NestFactory } from "@nestjs/core";
import { AppModule } from "./app.module";

/**
 * Bootstrap server thuần WebSocket (KHÔNG HTTP platform).
 *
 * Dùng `createApplicationContext` để chỉ khởi tạo DI + vòng đời (onModuleInit của
 * GatewayService sẽ mở NetServer). Bật shutdown hooks để đóng socket sạch khi nhận
 * SIGINT/SIGTERM.
 */
async function bootstrap(): Promise<void> {
  const app = await NestFactory.createApplicationContext(AppModule, {
    // Giữ log gọn; tuỳ chỉnh nếu cần chi tiết hơn.
    logger: ["log", "warn", "error"],
  });
  app.enableShutdownHooks();
  // eslint-disable-next-line no-console
  console.log("[Hexagon] Ứng dụng đã khởi tạo. Nhấn Ctrl+C để dừng.");
}

void bootstrap();
