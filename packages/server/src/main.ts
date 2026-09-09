import "reflect-metadata";
import { NestFactory } from "@nestjs/core";
import { scrubErrorEvent } from "@hexagon/shared";
import { json } from "express";
import cookieParser from "cookie-parser";
import dotenv from "dotenv";
import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { runtimeConfig } from "./runtime-config";
import { NestPinoLogger, createLogger, requestLogger } from "./logging";

const envPath = [process.env.ENV_FILE, resolve(process.cwd(), ".env"), resolve(__dirname, "../../../.env")].find((path): path is string => Boolean(path && existsSync(path)));
if (envPath) dotenv.config({ path: envPath, quiet: true });

/**
 * Bootstrap server thuần WebSocket (KHÔNG HTTP platform).
 *
 * Dùng `createApplicationContext` để chỉ khởi tạo DI + vòng đời (onModuleInit của
 * GatewayService sẽ mở NetServer). Bật shutdown hooks để đóng socket sạch khi nhận
 * SIGINT/SIGTERM.
 */
/**
 * doc 35 §A4 (lát a4.2) — báo cáo lỗi phía server.
 *
 * Cùng ba quyết định với client (xem `packages/client/src/lib/errorReporting.ts`): trung tính nhà
 * cung cấp (GlitchTip nói đúng giao thức Sentry), DSN rỗng ⇒ tắt hẳn và KHÔNG tải SDK, và làm sạch
 * bằng mã dùng chung ở `@hexagon/shared`.
 *
 * Gọi TRƯỚC `NestFactory.create`: một lỗi lúc dựng DI cũng là lỗi cần biết, và đó lại đúng loại lỗi
 * làm server không lên được — tức là loại không ai thấy nếu bộ báo lỗi bật sau.
 */
async function initErrorReporting(release: string): Promise<void> {
  const dsn = process.env.ERROR_DSN ?? "";
  if (dsn.trim().length === 0) return;
  try {
    const Sentry = await import("@sentry/node");
    Sentry.init({
      dsn,
      release,
      tracesSampleRate: 0,
      sendDefaultPii: false,
      beforeSend: (event) => scrubErrorEvent(event as unknown as Record<string, unknown>) as never,
      beforeBreadcrumb: (crumb) => scrubErrorEvent(crumb as unknown as Record<string, unknown>) as never,
    });
  } catch {
    // Không bật được bộ báo lỗi KHÔNG được phép làm server không khởi động.
  }
}

async function bootstrap(): Promise<void> {
  // Import sau khi .env đã nạp vì AppModule chọn control/game modules theo SERVER_ROLE.
  const { AppModule } = await import("./app.module");
  const cfg = runtimeConfig();
  await initErrorReporting(process.env.BUILD_ID ?? "dev");
  const logger = createLogger({ role: cfg.role, region: cfg.region });
  const app = await NestFactory.create(AppModule, {
    // Mọi `Logger` sẵn có trong code cũng đi qua đây ⇒ ra JSON, không phải sửa từng chỗ gọi.
    logger: new NestPinoLogger(logger),
  });
  // Trần thân request, ĐẶT TƯỜNG MINH. Mặc định của body-parser là 100 KB, và `inputTrace` của
  // lát a3.3 làm thân `campaign/complete` nặng 79,1 KB cho một ván 90 giây — tức là ván dài hơn
  // ~115 giây sẽ nhận 413 và người chơi mất phần thưởng. `MAX_TRACE_FRAMES` chặn ở 307,2 KB, nên
  // 512 KB là trần có chỗ thở mà vẫn chặn payload dựng để làm kiệt bộ nhớ.
  app.use(json({ limit: "512kb" }));
  app.use(cookieParser());
  app.use(requestLogger(logger));
  app.enableCors({
    origin(origin, callback) {
      // Requests without Origin are server-to-server/health checks. Browser origins must be explicit.
      if (!origin || cfg.corsAllowedOrigins.includes(origin)) callback(null, true);
      else callback(new Error(`CORS origin không được phép: ${origin}`), false);
    },
    credentials: true,
  });
  app.enableShutdownHooks();
  await app.listen(cfg.port, "0.0.0.0");
  // Chỉ gắn WebSocket sau khi HTTP server thật đã được tạo và listen. Khởi tạo
  // gateway trong onModuleInit có thể nhận `undefined` từ ExpressAdapter, khiến
  // nó mở một listener standalone trùng PORT với Nest.
  if (cfg.role !== "control") {
    const { GatewayService } = await import("./game/game.module");
    await app.get(GatewayService).start();
  }
  logger.info({ role: cfg.role, region: cfg.region, port: cfg.port }, "server đã sẵn sàng");
}

void bootstrap();
