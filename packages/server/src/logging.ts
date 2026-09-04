import { randomUUID } from "node:crypto";
import type { LoggerService } from "@nestjs/common";
import type { NextFunction, Request, Response } from "express";
import pino, { type Logger as PinoLogger } from "pino";

/**
 * Log có cấu trúc + request_id (doc 35 §A4, lát a4.3).
 *
 * Trước lát này log là `console.log` với chuỗi tiếng Việt ghép tay. Đọc bằng mắt thì được; tìm
 * "tất cả lỗi của một người chơi trong 5 phút vừa rồi" thì không. Mỗi dòng giờ là một JSON có
 * cùng bộ trường nền, nên grep/jq/log aggregator đều dùng được.
 *
 * Ba quyết định:
 *
 * 1. **Đường nóng gameplay KHÔNG log.** Vòng lặp chạy 24 Hz cho mọi phòng; log mỗi tick sẽ tự tạo
 *    ra một cơn bão I/O đúng lúc server đang bận nhất — nghĩa là công cụ chẩn đoán sẽ góp phần
 *    gây ra sự cố mà nó đáng lẽ giúp chẩn đoán. Đường nóng chỉ ĐẾM (đã có ở `net/telemetry.ts`).
 *    Ở đây chỉ log control plane: HTTP, khởi động, tắt máy, lỗi.
 * 2. **Bí mật bị che ở TẦNG CODE, không dặn miệng.** `redactFields` chặn theo chuỗi con, không
 *    phân biệt hoa thường, nên `Authorization`, `authorization`, `x-auth-token` đều bị che. Cùng
 *    tinh thần với `FORBIDDEN_PROP_KEYS` của analytics.
 * 3. **`request_id` đi xuyên suốt.** Nhận từ header nếu có (proxy/khách gửi lên), không thì tự
 *    sinh, và LUÔN trả lại trong response. Không có nó thì một báo lỗi của người chơi không nối
 *    được với dòng log tương ứng.
 */

/** Khoá bị che trong log. So khớp theo chuỗi con, không phân biệt hoa thường. */
export const REDACT_KEYS: readonly string[] = [
  "authorization",
  "cookie",
  "token",
  "secret",
  "password",
  "apikey",
  "api_key",
  "initdata",
  "session",
  "email",
];

export const REDACTED = "[đã che]";

/** Trần độ dài giá trị chuỗi trong log — chống việc một payload lớn nuốt cả file log. */
export const MAX_LOG_STRING = 512;

function isSecretKey(key: string): boolean {
  const k = key.toLowerCase();
  return REDACT_KEYS.some((bad) => k.includes(bad));
}

/**
 * Che bí mật và cắt chuỗi dài. Chỉ đi MỘT tầng lồng nhau: log sâu hơn thế thì đằng nào cũng khó
 * đọc, và đệ quy không giới hạn trên dữ liệu ngoài là một cách hay để tự treo tiến trình.
 */
export function redactFields(fields: Record<string, unknown>, depth = 0): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(fields)) {
    if (isSecretKey(key)) {
      out[key] = REDACTED;
      continue;
    }
    if (typeof value === "string") {
      out[key] = value.length > MAX_LOG_STRING ? `${value.slice(0, MAX_LOG_STRING)}…` : value;
      continue;
    }
    if (value && typeof value === "object" && !Array.isArray(value) && depth < 1) {
      out[key] = redactFields(value as Record<string, unknown>, depth + 1);
      continue;
    }
    out[key] = value;
  }
  return out;
}

/** Id request. Nhận từ header nếu hợp lệ, không thì sinh mới. */
export function resolveRequestId(headerValue: unknown): string {
  if (typeof headerValue === "string") {
    // Chỉ nhận chuỗi "lành": header đến từ ngoài nên có thể chứa ký tự phá vỡ định dạng log.
    const clean = headerValue.trim().slice(0, 64);
    if (/^[A-Za-z0-9._-]+$/.test(clean)) return clean;
  }
  return randomUUID();
}

/** Bỏ query string khỏi đường dẫn ghi log — query có thể mang tham số nhận dạng. */
export function safePath(url: string): string {
  const q = url.indexOf("?");
  return q >= 0 ? url.slice(0, q) : url;
}

export interface LoggerOptions {
  level?: string;
  role?: string;
  region?: string;
  /** Chỉ dùng cho test: nơi ghi ra thay vì stdout. */
  destination?: { write: (chunk: string) => void };
}

export function createLogger(options: LoggerOptions = {}): PinoLogger {
  const base = {
    service: "hexagon-server",
    role: options.role ?? "all",
    region: options.region ?? "unknown",
  };
  const config = {
    level: options.level ?? process.env.LOG_LEVEL ?? "info",
    base,
    // Thời gian ISO thay vì epoch ms: log được đọc bởi người trước khi được đọc bởi máy.
    timestamp: () => `,"time":"${new Date().toISOString()}"`,
  };
  return options.destination ? pino(config, options.destination as never) : pino(config);
}

/** Nối logger của Nest vào pino để mọi `Logger` sẵn có trong code cũng ra JSON. */
export class NestPinoLogger implements LoggerService {
  constructor(private readonly logger: PinoLogger) {}

  private write(level: "info" | "warn" | "error" | "debug", message: unknown, params: unknown[]): void {
    const context = typeof params.at(-1) === "string" ? (params.at(-1) as string) : undefined;
    this.logger[level]({ context }, typeof message === "string" ? message : JSON.stringify(message));
  }

  log(message: unknown, ...params: unknown[]): void { this.write("info", message, params); }
  warn(message: unknown, ...params: unknown[]): void { this.write("warn", message, params); }
  error(message: unknown, ...params: unknown[]): void { this.write("error", message, params); }
  debug(message: unknown, ...params: unknown[]): void { this.write("debug", message, params); }
  verbose(message: unknown, ...params: unknown[]): void { this.write("debug", message, params); }
}

/** Tên header mang request id. Dùng chung cho cả nhận vào lẫn trả ra. */
export const REQUEST_ID_HEADER = "x-request-id";

/**
 * Middleware ghi MỘT dòng cho mỗi request HTTP, lúc response kết thúc (để biết status + thời gian).
 * Gắn `request_id` vào cả `req` (cho code phía sau dùng) lẫn response header (cho người báo lỗi).
 */
export function requestLogger(logger: PinoLogger) {
  return function requestLoggerMiddleware(req: Request, res: Response, next: NextFunction): void {
    const requestId = resolveRequestId(req.headers[REQUEST_ID_HEADER]);
    (req as Request & { requestId?: string }).requestId = requestId;
    res.setHeader(REQUEST_ID_HEADER, requestId);

    const startedAt = Date.now();
    res.on("finish", () => {
      const fields = redactFields({
        request_id: requestId,
        method: req.method,
        path: safePath(req.originalUrl ?? req.url ?? ""),
        status: res.statusCode,
        duration_ms: Date.now() - startedAt,
      });
      // 5xx là lỗi của mình, 4xx là lỗi phía gọi — mức log khác nhau để lọc cho đúng.
      if (res.statusCode >= 500) logger.error(fields, "http");
      else if (res.statusCode >= 400) logger.warn(fields, "http");
      else logger.info(fields, "http");
    });

    next();
  };
}
