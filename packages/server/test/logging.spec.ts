import { describe, expect, it, vi } from "vitest";
import {
  MAX_LOG_STRING,
  NestPinoLogger,
  REDACTED,
  REQUEST_ID_HEADER,
  createLogger,
  redactFields,
  requestLogger,
  resolveRequestId,
  safePath,
} from "../src/logging";

// doc 35 §A4 — log có cấu trúc + request_id. Điều được bảo vệ ở đây: bí mật bị che ở TẦNG CODE
// (không dặn miệng), và mỗi request HTTP để lại đúng MỘT dòng nối được với báo lỗi của người chơi.

/** Đích ghi giả: gom từng dòng JSON pino xuất ra. */
function sink() {
  const lines: string[] = [];
  return {
    lines,
    write: (chunk: string) => { lines.push(chunk); },
    json: () => lines.map((l) => JSON.parse(l) as Record<string, unknown>),
  };
}

describe("redactFields", () => {
  it("che khoá bí mật, không phân biệt hoa thường và theo chuỗi con", () => {
    const out = redactFields({
      Authorization: "Bearer abc",
      "x-auth-token": "t",
      cookie: "hex_session=1",
      initData: "user=...",
      userEmail: "a@b.c",
      method: "GET",
    });
    expect(out.Authorization).toBe(REDACTED);
    expect(out["x-auth-token"]).toBe(REDACTED);
    expect(out.cookie).toBe(REDACTED);
    expect(out.initData).toBe(REDACTED);
    expect(out.userEmail).toBe(REDACTED);
    expect(out.method).toBe("GET");
  });

  it("cắt chuỗi quá dài — một payload lớn không được nuốt cả file log", () => {
    const out = redactFields({ body: "x".repeat(MAX_LOG_STRING + 100) });
    expect(String(out.body).length).toBe(MAX_LOG_STRING + 1); // + ký tự "…"
  });

  it("đi một tầng lồng nhau rồi dừng — không đệ quy vô hạn trên dữ liệu ngoài", () => {
    const out = redactFields({ a: { token: "x", b: { token: "y" } } });
    const a = out.a as Record<string, unknown>;
    expect(a.token).toBe(REDACTED);
    // Tầng thứ hai giữ nguyên object, không đi tiếp.
    expect(a.b).toEqual({ token: "y" });
  });

  it("giữ nguyên số, boolean, null", () => {
    expect(redactFields({ n: 1, b: false, z: null })).toEqual({ n: 1, b: false, z: null });
  });
});

describe("resolveRequestId", () => {
  it("nhận id hợp lệ từ header (nối được log qua nhiều dịch vụ)", () => {
    expect(resolveRequestId("abc-123_x.y")).toBe("abc-123_x.y");
  });

  it("từ chối id có ký tự lạ và tự sinh — header đến từ ngoài, có thể phá vỡ định dạng log", () => {
    const id = resolveRequestId('bad"\n{"level":50}');
    expect(id).not.toContain("\n");
    expect(id).toMatch(/^[0-9a-f-]{36}$/);
  });

  it("thiếu header ⇒ tự sinh", () => {
    expect(resolveRequestId(undefined)).toMatch(/^[0-9a-f-]{36}$/);
  });
});

describe("safePath", () => {
  it("bỏ query string (query có thể mang tham số nhận dạng)", () => {
    expect(safePath("/v1/config?anonId=a-1&build=x")).toBe("/v1/config");
    expect(safePath("/v1/events")).toBe("/v1/events");
  });
});

describe("createLogger", () => {
  it("mỗi dòng là JSON có đủ trường nền", () => {
    const s = sink();
    createLogger({ role: "control", region: "sg", destination: s }).info({ a: 1 }, "xin chào");
    const [line] = s.json();
    expect(line.service).toBe("hexagon-server");
    expect(line.role).toBe("control");
    expect(line.region).toBe("sg");
    expect(line.msg).toBe("xin chào");
    expect(line.a).toBe(1);
    expect(typeof line.time).toBe("string");
  });

  it("mức log lọc được — debug bị bỏ khi level=info", () => {
    const s = sink();
    const logger = createLogger({ level: "info", destination: s });
    logger.debug("không được xuất hiện");
    logger.info("có");
    expect(s.json().map((l) => l.msg)).toEqual(["có"]);
  });
});

describe("NestPinoLogger", () => {
  it("Logger sẵn có của Nest cũng ra JSON, giữ context", () => {
    const s = sink();
    const nest = new NestPinoLogger(createLogger({ destination: s }));
    nest.log("khởi động xong", "GatewayService");
    nest.error("hỏng rồi", "MatchResultReporter");
    const out = s.json();
    expect(out[0].msg).toBe("khởi động xong");
    expect(out[0].context).toBe("GatewayService");
    expect(out[1].level).toBe(50);
  });
});

describe("requestLogger", () => {
  /** `req`/`res` giả đủ dùng cho middleware: chỉ cần headers, url, statusCode và sự kiện finish. */
  function http(url: string, status: number, headers: Record<string, string> = {}) {
    let finish: (() => void) | null = null;
    const res = {
      statusCode: status,
      headers: {} as Record<string, string>,
      setHeader(k: string, v: string) { this.headers[k] = v; },
      on(event: string, fn: () => void) { if (event === "finish") finish = fn; },
    };
    const req = { headers, url, originalUrl: url, method: "GET" };
    return { req, res, finish: () => finish?.() };
  }

  it("ghi ĐÚNG MỘT dòng khi response kết thúc, có đủ trường tra cứu", () => {
    const s = sink();
    const mw = requestLogger(createLogger({ destination: s }));
    const { req, res, finish } = http("/v1/config?anonId=a-1", 200);
    const next = vi.fn();

    mw(req as never, res as never, next);
    expect(next).toHaveBeenCalledTimes(1);
    expect(s.lines).toHaveLength(0); // chưa kết thúc thì chưa log

    finish();
    const [line] = s.json();
    expect(line.msg).toBe("http");
    expect(line.method).toBe("GET");
    expect(line.path).toBe("/v1/config");
    expect(line.status).toBe(200);
    expect(typeof line.duration_ms).toBe("number");
    expect(typeof line.request_id).toBe("string");
  });

  it("trả request_id về response để người báo lỗi nối được với dòng log", () => {
    const s = sink();
    const mw = requestLogger(createLogger({ destination: s }));
    const { req, res, finish } = http("/v1/events", 201, { [REQUEST_ID_HEADER]: "tu-proxy-1" });
    mw(req as never, res as never, vi.fn());
    finish();
    expect(res.headers[REQUEST_ID_HEADER]).toBe("tu-proxy-1");
    expect(s.json()[0].request_id).toBe("tu-proxy-1");
  });

  it("5xx ⇒ mức error, 4xx ⇒ warn, 2xx ⇒ info (lọc đúng bên nào có lỗi)", () => {
    const s = sink();
    const mw = requestLogger(createLogger({ destination: s }));
    for (const status of [200, 404, 500]) {
      const { req, res, finish } = http("/x", status);
      mw(req as never, res as never, vi.fn());
      finish();
    }
    expect(s.json().map((l) => l.level)).toEqual([30, 40, 50]);
  });

  it("KHÔNG log cookie/authorization dù chúng nằm trong request", () => {
    const s = sink();
    const mw = requestLogger(createLogger({ destination: s }));
    const { req, res, finish } = http("/v1/me", 200, { cookie: "hex_session=bimat", authorization: "Bearer bimat" });
    mw(req as never, res as never, vi.fn());
    finish();
    expect(s.lines.join("")).not.toContain("bimat");
  });
});
