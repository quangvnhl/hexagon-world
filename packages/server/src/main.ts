import "reflect-metadata";
import { NestFactory } from "@nestjs/core";
import cookieParser from "cookie-parser";
import dotenv from "dotenv";
import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { runtimeConfig } from "./runtime-config";

const envPath = [process.env.ENV_FILE, resolve(process.cwd(), ".env"), resolve(__dirname, "../../../.env")].find((path): path is string => Boolean(path && existsSync(path)));
if (envPath) dotenv.config({ path: envPath, quiet: true });

/**
 * Bootstrap server thuần WebSocket (KHÔNG HTTP platform).
 *
 * Dùng `createApplicationContext` để chỉ khởi tạo DI + vòng đời (onModuleInit của
 * GatewayService sẽ mở NetServer). Bật shutdown hooks để đóng socket sạch khi nhận
 * SIGINT/SIGTERM.
 */
async function bootstrap(): Promise<void> {
  // Import sau khi .env đã nạp vì AppModule chọn control/game modules theo SERVER_ROLE.
  const { AppModule } = await import("./app.module");
  const cfg = runtimeConfig();
  const app = await NestFactory.create(AppModule, {
    logger: ["log", "warn", "error"],
  });
  app.use(cookieParser());
  app.enableCors({ origin: new URL(cfg.google.postLoginRedirectUri).origin, credentials: true });
  app.enableShutdownHooks();
  await app.listen(cfg.port, "0.0.0.0");
  // eslint-disable-next-line no-console
  console.log(`[Hexagon] role=${cfg.role} region=${cfg.region} port=${cfg.port}`);
}

void bootstrap();
