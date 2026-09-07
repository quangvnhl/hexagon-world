import "reflect-metadata";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { BadRequestException, HttpStatus } from "@nestjs/common";
import { firstValueFrom, of } from "rxjs";
import { AdminController, OPS_API_VERSION } from "../src/admin/admin.controller";
import { buildOpsOpenApi, collectOpsOperations, toOpenApiPath } from "../src/admin/ops-openapi";
import { isDryRun, type OpsRequest } from "../src/admin/ops-auth.guard";
import { OpsAuditInterceptor } from "../src/admin/ops-audit.interceptor";
import { OpsKeysService } from "../src/admin/ops-keys.service";
import { opsErrorBody, hintFor } from "../src/admin/ops-errors";
import { resetRuntimeConfigForTests } from "../src/runtime-config";
import type { SupabaseService } from "../src/database/supabase.service";

// doc 35 §C2 (lát c2.2) — hợp đồng máy đọc + `?dry_run=true` + mã lỗi máy đọc được.
//
// Bất biến an toàn số một ở đây: `?dry_run=true` KHÔNG BAO GIỜ được rơi xuống nhánh thật. Nếu nó
// rơi, thì một agent làm ĐÚNG quy trình — luôn thử khô trước — sẽ cấp coin hoặc xoá tài khoản trong
// khi tin rằng mình chỉ đang xem trước. Hỏng theo hướng "người cẩn thận bị phạt".

const ENV = ["SERVER_ROLE", "PORT", "SUPABASE_URL", "SUPABASE_SECRET_KEY", "PLAYER_SESSION_SECRET", "GOOGLE_OAUTH_CLIENT_ID", "GOOGLE_OAUTH_CLIENT_SECRET", "GOOGLE_OAUTH_STATE_SECRET", "TELEGRAM_BOT_TOKEN", "TELEGRAM_WEBHOOK_SECRET", "GAME_REGION"];
const previous = new Map(ENV.map((k) => [k, process.env[k]]));

function env() {
  Object.assign(process.env, {
    SERVER_ROLE: "all", PORT: "8910", SUPABASE_URL: "https://example.supabase.co",
    SUPABASE_SECRET_KEY: "test-secret-key", PLAYER_SESSION_SECRET: "01234567890123456789012345678901",
    GOOGLE_OAUTH_CLIENT_ID: "test.apps.googleusercontent.com", GOOGLE_OAUTH_CLIENT_SECRET: "google-secret",
    GOOGLE_OAUTH_STATE_SECRET: "01234567890123456789012345678901", TELEGRAM_BOT_TOKEN: "bot-token",
    TELEGRAM_WEBHOOK_SECRET: "webhook-secret", GAME_REGION: "local",
  });
  resetRuntimeConfigForTests();
}

afterEach(() => {
  for (const [k, v] of previous) v === undefined ? delete process.env[k] : (process.env[k] = v);
  resetRuntimeConfigForTests();
});

// ---- Danh mục sinh từ chính định tuyến -------------------------------------------------------

describe("collectOpsOperations", () => {
  it("đọc được mọi endpoint có @Ops, kèm đường dẫn đầy đủ", () => {
    const ops = collectOpsOperations(AdminController);
    expect(ops.length).toBeGreaterThanOrEqual(13);
    const grant = ops.find((o) => o.handlerName === "grant");
    expect(grant).toMatchObject({ method: "post", path: "/internal/v1/admin/players/:id/grant-coin" });
    expect(grant?.meta.scope).toBe("wallet:write");
  });

  it("MỌI endpoint của AdminController đều có @Ops — không cái nào lọt ra ngoài hệ thống phạm vi", () => {
    // Kiểm tra này là lưới an toàn cho chính luật "guard từ chối endpoint không khai báo": nó bắt
    // được endpoint bị quên NGAY Ở CI, thay vì đợi lần gọi đầu tiên trong môi trường thật.
    const proto = AdminController.prototype as Record<string, unknown>;
    const handlers = Object.getOwnPropertyNames(proto)
      .filter((n) => n !== "constructor" && typeof proto[n] === "function")
      // Bỏ hàm private (không có metadata định tuyến) — chúng không phải endpoint.
      .filter((n) => Reflect.getMetadata("path", proto[n] as object) !== undefined);
    const scoped = new Set(collectOpsOperations(AdminController).map((o) => o.handlerName));
    expect(handlers.filter((n) => !scoped.has(n))).toEqual([]);
  });
});

describe("toOpenApiPath", () => {
  it("đổi :param của Nest sang {param} của OpenAPI và liệt kê đúng tên", () => {
    expect(toOpenApiPath("/internal/v1/admin/players/:id/grant-coin")).toEqual({
      path: "/internal/v1/admin/players/{id}/grant-coin", params: ["id"],
    });
    expect(toOpenApiPath("/internal/v1/admin/levels")).toEqual({ path: "/internal/v1/admin/levels", params: [] });
  });
});

describe("buildOpsOpenApi", () => {
  const spec = buildOpsOpenApi(AdminController, { version: OPS_API_VERSION }) as Record<string, never>;
  const paths = spec.paths as Record<string, Record<string, Record<string, unknown>>>;

  it("là OpenAPI 3.1 và khai đúng cách xác thực", () => {
    expect(spec.openapi).toBe("3.1.0");
    expect((spec.components as never)["securitySchemes"]).toMatchObject({
      opsApiKey: { type: "apiKey", in: "header", name: "x-admin-key" },
    });
  });

  it("phạm vi trong danh mục lấy TỪ CHÍNH metadata guard đang thi hành", () => {
    // Đây là lý do không dùng @nestjs/swagger: ở đó phạm vi bị khai lần thứ hai và sẽ trôi. Test
    // này khoá cả hai bên vào một nguồn.
    const op = paths["/internal/v1/admin/players/{id}/grant-coin"].post;
    expect(op["x-ops-scope"]).toBe("wallet:write");
    expect(op["x-ops-write"]).toBe(true);
    expect(op["x-ops-unit-kind"]).toBe("coin_granted");
    const fromMeta = collectOpsOperations(AdminController).find((o) => o.handlerName === "grant");
    expect(op["x-ops-scope"]).toBe(fromMeta?.meta.scope);
  });

  it("endpoint ghi khai tham số Idempotency-Key và dry_run", () => {
    const op = paths["/internal/v1/admin/players/{id}/grant-coin"].post;
    const names = (op.parameters as { name: string }[]).map((p) => p.name);
    expect(names).toContain("id");
    expect(names).toContain("Idempotency-Key");
    expect(names).toContain("dry_run");
  });

  it("endpoint ĐỌC không khai Idempotency-Key và không khai 409", () => {
    const op = paths["/internal/v1/admin/levels"].get;
    const names = ((op.parameters ?? []) as { name: string }[]).map((p) => p.name);
    expect(names).not.toContain("Idempotency-Key");
    expect(op.responses).not.toHaveProperty("409");
  });

  it("openapi.json chỉ cần khoá hợp lệ, không cần phạm vi riêng (chống con gà–quả trứng)", () => {
    expect(paths["/internal/v1/admin/openapi.json"].get["x-ops-scope"]).toBe("any");
  });

  it("mọi thao tác đều nêu hình dạng lỗi chuẩn", () => {
    for (const [path, byMethod] of Object.entries(paths)) {
      for (const [method, op] of Object.entries(byMethod)) {
        const responses = op.responses as Record<string, { content?: Record<string, { schema?: { $ref?: string } }> }>;
        expect(responses["401"]?.content?.["application/json"]?.schema?.$ref, `${method} ${path}`)
          .toBe("#/components/schemas/OpsError");
      }
    }
  });
});

// ---- isDryRun ---------------------------------------------------------------------------------

describe("isDryRun — chỉ đúng chuỗi 'true'", () => {
  it("bật với 'true'", () => {
    expect(isDryRun({ query: { dry_run: "true" } } as never)).toBe(true);
  });

  it("KHÔNG bật với 1/yes/on/TRUE/rỗng — gõ nhầm không được thành 'đã làm thật'", () => {
    // Hướng an toàn ở đây là: gõ nhầm ⇒ lời gọi bị TỪ CHỐI vì thiếu Idempotency-Key, chứ không phải
    // âm thầm thực hiện thật. Nới lỏng chỗ này là đổi một lỗi ồn ào lấy một lỗi im lặng.
    for (const v of ["1", "yes", "on", "TRUE", "", undefined]) {
      expect(isDryRun({ query: { dry_run: v } } as never), String(v)).toBe(false);
    }
    expect(isDryRun({ query: {} } as never)).toBe(false);
  });
});

// ---- Interceptor: dry_run --------------------------------------------------------------------

function fakeDb() {
  const audit: Record<string, unknown>[] = [];
  const service = {
    from: () => ({ insert: async (row: Record<string, unknown>) => { audit.push(row); return { data: [row], error: null }; },
                   select: () => ({ eq: () => ({ eq: () => ({ eq: () => ({ maybeSingle: async () => ({ data: null, error: null }) }) }) }) }) }),
    rpc: async () => ({ calls: 0, units: 0 }),
  } as unknown as SupabaseService;
  return { service, audit };
}

function req(over: Partial<OpsRequest> = {}): Partial<OpsRequest> {
  return {
    method: "POST", path: "/internal/v1/admin/players/p1/grant-coin", headers: {},
    params: { id: "p1" }, query: {}, body: { amount: 100 },
    opsActor: { keyId: "key-1", name: "agent-1", actorKind: "agent", scopes: ["wallet:write"], dailyLimits: {}, bootstrap: false },
    opsMeta: { scope: "wallet:write", isWrite: true, dryRun: true, unitKind: "coin_granted" },
    opsPayloadHash: "hash-A", opsUnits: 0, opsDryRun: true, ...over,
  } as Partial<OpsRequest>;
}
const ctx = (r: Partial<OpsRequest>) => ({ switchToHttp: () => ({ getRequest: () => r as OpsRequest }) } as never);

describe("dry_run trong interceptor", () => {
  beforeEach(() => env());

  it("endpoint CHƯA cài dry_run ⇒ TỪ CHỐI trước khi handler chạy", async () => {
    // Bất biến quan trọng nhất của lát này. Handler không được gọi một lần nào.
    const db = fakeDb();
    const handler = vi.fn(() => of({ balance: 999 }));
    const i = new OpsAuditInterceptor(new OpsKeysService(db.service));
    const r = req({ opsMeta: { scope: "wallet:write", isWrite: true } }); // thiếu dryRun: true
    await expect(firstValueFrom(i.intercept(ctx(r), { handle: handler }) as never)).rejects.toThrow(BadRequestException);
    expect(handler).not.toHaveBeenCalled();
    await new Promise((res) => setTimeout(res, 0));
    expect(db.audit[0]).toMatchObject({ status: "denied", dry_run: true, result: { code: "dry_run_unsupported" } });
  });

  it("endpoint có cài ⇒ chạy, ghi vết với dry_run=true", async () => {
    const db = fakeDb();
    const i = new OpsAuditInterceptor(new OpsKeysService(db.service));
    const out = await firstValueFrom(i.intercept(ctx(req()), { handle: () => of({ dryRun: true, predictedBalance: 600 }) }) as never);
    expect(out).toMatchObject({ dryRun: true });
    await new Promise((res) => setTimeout(res, 0));
    expect(db.audit[0]).toMatchObject({ status: "ok", dry_run: true });
  });

  it("thử khô KHÔNG ghi khoá idempotency — nếu ghi thì lời gọi THẬT sau đó bị coi là lặp lại", async () => {
    // Đây là cái bẫy tinh vi nhất: một `dry_run` mang khoá idempotency sẽ chiếm chỗ, và lần gọi
    // thật ngay sau đó trả lại kết quả XEM TRƯỚC rồi không làm gì cả — im lặng nuốt mất thao tác.
    const db = fakeDb();
    const i = new OpsAuditInterceptor(new OpsKeysService(db.service));
    await firstValueFrom(i.intercept(ctx(req({ headers: { "idempotency-key": "i1" } })), { handle: () => of({ dryRun: true }) }) as never);
    await new Promise((res) => setTimeout(res, 0));
    expect(db.audit[0].idempotency_key).toBeNull();
  });
});

// ---- Mã lỗi máy đọc được ----------------------------------------------------------------------

describe("opsErrorBody", () => {
  it("giữ nguyên code/message/retryable khi đã có", () => {
    expect(opsErrorBody({ code: "scope_denied", message: "thiếu phạm vi", retryable: false }, { code: "x", retryable: true }))
      .toMatchObject({ code: "scope_denied", retryable: false });
  });

  it("thiếu retryable ⇒ lấy mặc định theo mã trạng thái, KHÔNG để undefined", () => {
    // `retryable: undefined` là trường hợp tệ nhất cho agent: nó không thể chọn giữa "thử lại" và
    // "dừng", mà cả hai lựa chọn sai đều hỏng.
    const body = opsErrorBody({ code: "database_error", message: "hỏng" }, { code: "internal_error", retryable: true });
    expect(body.retryable).toBe(true);
    expect(typeof body.retryable).toBe("boolean");
  });

  it("tự gắn hint theo mã lỗi để cùng một mã luôn cho cùng một gợi ý", () => {
    expect(opsErrorBody({ code: "daily_call_limit", message: "hết hạn mức" }, { code: "x", retryable: true }).hint)
      .toBe(hintFor("daily_call_limit"));
  });

  it("chuỗi lỗi trần vẫn ra đủ bốn trường", () => {
    const body = opsErrorBody("Internal Server Error", { code: "internal_error", retryable: true });
    expect(body).toMatchObject({ code: "internal_error", retryable: true });
    expect(body.message.length).toBeGreaterThan(0);
  });

  it("mọi mã lỗi mà guard/interceptor ném đều có hint", () => {
    // Mã không có hint là mã bắt người đọc log tự đoán — đúng lúc 2 giờ sáng.
    for (const code of ["invalid_ops_key", "scope_denied", "missing_idempotency_key", "idempotency_key_reused", "daily_call_limit", "daily_unit_limit", "dry_run_unsupported", "endpoint_not_scoped"]) {
      expect(hintFor(code), code).toBeTruthy();
    }
  });
});

describe("hợp đồng phiên bản", () => {
  it("OPS_API_VERSION theo dạng semver và có trong danh mục", () => {
    expect(OPS_API_VERSION).toMatch(/^\d+\.\d+\.\d+$/);
    const spec = buildOpsOpenApi(AdminController, { version: OPS_API_VERSION }) as Record<string, never>;
    expect((spec.info as never)["version"]).toBe(OPS_API_VERSION);
  });

  it("HttpStatus 429 vẫn là mã dùng cho hạn mức", () => {
    expect(HttpStatus.TOO_MANY_REQUESTS).toBe(429);
  });
});
