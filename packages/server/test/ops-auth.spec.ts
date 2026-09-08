import "reflect-metadata";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ConflictException, ForbiddenException, HttpException, UnauthorizedException } from "@nestjs/common";
import { firstValueFrom, of, throwError } from "rxjs";
import { resetRuntimeConfigForTests, sha256 } from "../src/runtime-config";
import {
  OpsKeysService,
  SCOPE_ALL,
  generateOpsKey,
  hasScope,
  keyUnusableReason,
  overDailyLimit,
  payloadHash,
  sanitizeScopes,
} from "../src/admin/ops-keys.service";
import { Ops, OpsAuthGuard, OPS_META, type OpsEndpointMeta, type OpsRequest } from "../src/admin/ops-auth.guard";
import { OpsAuditInterceptor } from "../src/admin/ops-audit.interceptor";
import type { SupabaseService } from "../src/database/supabase.service";

// doc 35 §C2.1 — nền Ops API. Đây là quyền GHI vào tiền và tài khoản người chơi, sắp giao cho một
// tác nhân không có người ngồi cạnh (§C2 rủi ro). Ba loại lỗi được canh ở đây, và cả ba đều im lặng:
//
//   1. Một endpoint LỌT ra ngoài hệ thống phạm vi ⇒ không phạm vi, không hạn mức, không vết.
//   2. Hạn mức hoặc phạm vi "mở" khi có sự cố phụ (database lỗi, mốc thời gian hỏng).
//   3. Chống lặp trông như chạy nhưng không chạy ⇒ cấp coin hai lần vì một lần thử lại.

const ENV = ["SERVER_ROLE", "PORT", "SUPABASE_URL", "SUPABASE_SECRET_KEY", "PLAYER_SESSION_SECRET", "GOOGLE_OAUTH_CLIENT_ID", "GOOGLE_OAUTH_CLIENT_SECRET", "GOOGLE_OAUTH_STATE_SECRET", "TELEGRAM_BOT_TOKEN", "TELEGRAM_WEBHOOK_SECRET", "GAME_REGION", "ADMIN_API_KEY_SHA256"];
const previous = new Map(ENV.map((k) => [k, process.env[k]]));

function env(extra: Record<string, string> = {}) {
  Object.assign(process.env, {
    SERVER_ROLE: "all", PORT: "8910", SUPABASE_URL: "https://example.supabase.co",
    SUPABASE_SECRET_KEY: "test-secret-key", PLAYER_SESSION_SECRET: "01234567890123456789012345678901",
    GOOGLE_OAUTH_CLIENT_ID: "test.apps.googleusercontent.com", GOOGLE_OAUTH_CLIENT_SECRET: "google-secret",
    GOOGLE_OAUTH_STATE_SECRET: "01234567890123456789012345678901", TELEGRAM_BOT_TOKEN: "bot-token",
    TELEGRAM_WEBHOOK_SECRET: "webhook-secret", GAME_REGION: "local", ...extra,
  });
  resetRuntimeConfigForTests();
}

afterEach(() => {
  for (const [k, v] of previous) v === undefined ? delete process.env[k] : (process.env[k] = v);
  resetRuntimeConfigForTests();
});

// ---- DB giả: bảng trong bộ nhớ + builder thenable giống supabase-js ---------------------------

interface Tables { ops_api_keys: Record<string, unknown>[]; ops_audit_log: Record<string, unknown>[] }

function fakeDb(
  seed: Partial<Tables> = {},
  // `selectError` mo phong dung hanh vi that cua supabase-js: truy van hong KHONG nem, no tra ve
  // `{ data: null, error }`. Do la ly do mot loi database co the bi doc nham thanh "khong co du lieu".
  opts: { rpcThrows?: boolean; usage?: { calls: number; units: number }; selectError?: boolean } = {},
) {
  const tables: Tables = { ops_api_keys: seed.ops_api_keys ?? [], ops_audit_log: seed.ops_audit_log ?? [] };
  function builder(name: keyof Tables) {
    let rows = [...tables[name]];
    let mode: "select" | "insert" | "update" = "select";
    let patch: Record<string, unknown> = {};
    const api: Record<string, unknown> = {};
    const chain = (fn: () => void) => { fn(); return api; };
    Object.assign(api, {
      select: () => api,
      order: () => api,
      limit: (n: number) => chain(() => { rows = rows.slice(0, n); }),
      eq: (col: string, val: unknown) => chain(() => { rows = rows.filter((r) => r[col] === val); }),
      is: (col: string, val: unknown) => chain(() => { rows = rows.filter((r) => (r[col] ?? null) === val); }),
      or: () => api,
      insert: (row: Record<string, unknown>) => chain(() => { mode = "insert"; patch = { id: `id-${tables[name].length + 1}`, ...row }; }),
      update: (row: Record<string, unknown>) => chain(() => { mode = "update"; patch = row; }),
      maybeSingle: async () =>
        opts.selectError ? { data: null, error: { message: "mat ket noi" } } : { data: rows[0] ?? null, error: null },
      single: async () => {
        if (mode === "insert") { tables[name].push(patch); return { data: patch, error: null }; }
        return { data: rows[0] ?? null, error: null };
      },
      then: (resolve: (v: { data: unknown; error: null }) => unknown) => {
        if (mode === "insert") { tables[name].push(patch); return Promise.resolve({ data: [patch], error: null }).then(resolve); }
        if (mode === "update") { for (const r of rows) Object.assign(r, patch); return Promise.resolve({ data: rows, error: null }).then(resolve); }
        if (opts.selectError) return Promise.resolve({ data: null, error: { message: "mat ket noi" } } as unknown as { data: unknown; error: null }).then(resolve);
        return Promise.resolve({ data: rows, error: null }).then(resolve);
      },
    });
    return api;
  }
  const service = {
    from: (name: string) => builder(name as keyof Tables),
    rpc: async () => {
      if (opts.rpcThrows) throw new Error("database down");
      return opts.usage ?? { calls: 0, units: 0 };
    },
  } as unknown as SupabaseService;
  return { service, tables };
}

function liveKey(over: Record<string, unknown> = {}) {
  return {
    id: "key-1", name: "agent-1", actor_kind: "agent", key_hash: sha256("hxops_live"),
    scopes: ["wallet:write"], daily_limits: {}, expires_at: null, revoked_at: null, ...over,
  };
}

// ---- Logic thuần -----------------------------------------------------------------------------

describe("keyUnusableReason — mặc định đóng", () => {
  it("khoá bình thường dùng được", () => {
    expect(keyUnusableReason({ revoked_at: null, expires_at: null })).toBeNull();
  });

  it("thu hồi hoặc hết hạn ⇒ từ chối", () => {
    expect(keyUnusableReason({ revoked_at: "2026-01-01T00:00:00Z", expires_at: null })).toBe("key_revoked");
    expect(keyUnusableReason({ revoked_at: null, expires_at: "2020-01-01T00:00:00Z" })).toBe("key_expired");
  });

  it("mốc hết hạn HỎNG ⇒ coi như đã hết hạn, KHÔNG phải sống mãi", () => {
    // Đây là chỗ dễ sai theo hướng nguy hiểm: `Date.parse("rác") > now` là false, nên một cách viết
    // ngây thơ sẽ cho khoá hỏng dữ liệu trở thành khoá vĩnh viễn.
    expect(keyUnusableReason({ revoked_at: null, expires_at: "khong-phai-ngay" })).toBe("key_expired");
  });
});

describe("hasScope", () => {
  it("khớp đúng tên, hoặc khoá bootstrap có *", () => {
    expect(hasScope(["wallet:write"], "wallet:write")).toBe(true);
    expect(hasScope([SCOPE_ALL], "players:write")).toBe(true);
  });

  it("thiếu phạm vi ⇒ false; mảng rỗng ⇒ false", () => {
    expect(hasScope(["players:read"], "wallet:write")).toBe(false);
    expect(hasScope([], "wallet:write")).toBe(false);
  });
});

describe("overDailyLimit — hai trần tách nhau", () => {
  it("không khai hạn mức ⇒ không chặn", () => {
    expect(overDailyLimit({}, { calls: 999, units: 999 }, { isWrite: true })).toBeNull();
  });

  it("trần SỐ LẦN chỉ tính lời gọi ghi", () => {
    expect(overDailyLimit({ calls: 2 }, { calls: 2, units: 0 }, { isWrite: true })).toBe("daily_call_limit");
    // Đọc nhiều không được làm cạn hạn mức ghi.
    expect(overDailyLimit({ calls: 2 }, { calls: 2, units: 0 }, { isWrite: false })).toBeNull();
  });

  it("trần LƯỢNG tính cả phần sắp cấp, không chỉ phần đã cấp", () => {
    // 40.000 đã cấp + 20.000 sắp cấp > trần 50.000 ⇒ chặn TRƯỚC khi cấp.
    expect(overDailyLimit({ coin_granted: 50_000 }, { calls: 1, units: 40_000 }, { isWrite: true, unitKind: "coin_granted", units: 20_000 })).toBe("daily_unit_limit");
    expect(overDailyLimit({ coin_granted: 50_000 }, { calls: 1, units: 40_000 }, { isWrite: true, unitKind: "coin_granted", units: 5_000 })).toBeNull();
  });

  it("chặn được cả hai kiểu lạm dụng: một lần thật to, và rất nhiều lần nhỏ", () => {
    expect(overDailyLimit({ coin_granted: 1000 }, { calls: 0, units: 0 }, { isWrite: true, unitKind: "coin_granted", units: 5000 })).toBe("daily_unit_limit");
    expect(overDailyLimit({ calls: 10 }, { calls: 10, units: 10 }, { isWrite: true, unitKind: "coin_granted", units: 1 })).toBe("daily_call_limit");
  });
});

describe("overDailyLimit — trần ghi nhầm kiểu vẫn phải là trần", () => {
  // `daily_limits` là jsonb do người gọi API đặt. Trước khi ép kiểu, `"50"` trượt `Number.isFinite`
  // và biến thành KHÔNG CÓ TRẦN — im lặng, và đúng hướng nguy hiểm.
  it("trần calls dạng chuỗi vẫn chặn", () => {
    expect(overDailyLimit({ calls: "50" } as unknown as Record<string, number>, { calls: 50, units: 0 }, { isWrite: true })).toBe("daily_call_limit");
  });

  it("trần đơn vị dạng chuỗi vẫn chặn", () => {
    expect(overDailyLimit({ coin_granted: "1000" } as unknown as Record<string, number>, { calls: 0, units: 900 }, { isWrite: true, unitKind: "coin_granted", units: 200 })).toBe("daily_unit_limit");
  });

  it("không đặt trần thì vẫn là không có trần", () => {
    expect(overDailyLimit({}, { calls: 999_999, units: 999_999 }, { isWrite: true, unitKind: "coin_granted", units: 10 })).toBeNull();
  });
});

describe("payloadHash", () => {
  it("KHÔNG phụ thuộc thứ tự khoá — nếu không thì chống lặp vô dụng", () => {
    expect(payloadHash({ a: 1, b: { c: 2, d: 3 } })).toBe(payloadHash({ b: { d: 3, c: 2 }, a: 1 }));
  });

  it("đổi giá trị ⇒ đổi hash", () => {
    expect(payloadHash({ amount: 100 })).not.toBe(payloadHash({ amount: 101 }));
  });
});

describe("sanitizeScopes", () => {
  it("bỏ tên lạ, bỏ trùng, và KHÔNG BAO GIỜ cấp '*'", () => {
    // `*` cấp được qua API thì mọi giới hạn phạm vi bên dưới chỉ còn là gợi ý.
    expect(sanitizeScopes(["wallet:write", "wallet:write", "linh-tinh", SCOPE_ALL])).toEqual(["wallet:write"]);
    expect(sanitizeScopes("wallet:write")).toEqual([]);
  });
});

describe("generateOpsKey", () => {
  it("có tiền tố nhận diện và không trùng nhau", () => {
    const a = generateOpsKey(); const b = generateOpsKey();
    expect(a.startsWith("hxops_")).toBe(true);
    expect(a).not.toBe(b);
    expect(a.length).toBeGreaterThan(40);
  });
});

// ---- OpsKeysService --------------------------------------------------------------------------

describe("resolve — chuỗi x-admin-key cũ TỰ CHẾT", () => {
  beforeEach(() => env({ ADMIN_API_KEY_SHA256: sha256("legacy-shared-key") }));

  it("khoá thật hợp lệ ⇒ ra tác nhân đúng", async () => {
    const svc = new OpsKeysService(fakeDb({ ops_api_keys: [liveKey()] }).service);
    const actor = await svc.resolve("hxops_live");
    expect(actor?.keyId).toBe("key-1");
    expect(actor?.actorKind).toBe("agent");
    expect(actor?.bootstrap).toBe(false);
  });

  it("khoá đã thu hồi ⇒ null, KHÔNG rơi xuống nhánh bootstrap", async () => {
    const svc = new OpsKeysService(fakeDb({ ops_api_keys: [liveKey({ revoked_at: "2026-01-01T00:00:00Z" })] }).service);
    expect(await svc.resolve("hxops_live")).toBeNull();
  });

  it("CHƯA có khoá thật ⇒ chuỗi cũ còn dùng được (đường vào để tạo khoá đầu tiên)", async () => {
    const svc = new OpsKeysService(fakeDb({ ops_api_keys: [] }).service);
    const actor = await svc.resolve("legacy-shared-key");
    expect(actor?.bootstrap).toBe(true);
    expect(actor?.scopes).toEqual([SCOPE_ALL]);
  });

  it("ĐÃ có khoá thật ⇒ chuỗi cũ CHẾT — đây là cách 'gỡ x-admin-key' của cổng Pha 6", async () => {
    // Không có biến môi trường nào để quên tắt, không cần ai nhớ dọn. Tạo khoá thật đầu tiên là
    // hành động gỡ chuỗi dùng chung.
    const svc = new OpsKeysService(fakeDb({ ops_api_keys: [liveKey()] }).service);
    expect(await svc.resolve("legacy-shared-key")).toBeNull();
  });

  it("chuỗi rỗng hoặc sai ⇒ null", async () => {
    const svc = new OpsKeysService(fakeDb().service);
    expect(await svc.resolve("")).toBeNull();
    expect(await svc.resolve("sai-be-bet")).toBeNull();
  });

  it("KHÔNG cấu hình ADMIN_API_KEY_SHA256 ⇒ không có bootstrap nào cả", async () => {
    env({ ADMIN_API_KEY_SHA256: "" });
    const svc = new OpsKeysService(fakeDb().service);
    expect(await svc.resolve("")).toBeNull();
    expect(await svc.resolve("bat-ky-chuoi-nao")).toBeNull();
  });

  // Ba bài dưới đây khoá lại một lỗ MỞ ra do `db.from(...)` không ném khi truy vấn hỏng: nó trả
  // `{ data: null, error }`. Bản đầu của lát này bỏ qua `error`, nên "không đọc được bảng khoá"
  // trông y hệt "không có khoá nào khớp" — và rơi thẳng xuống nhánh bootstrap.
  it("database hỏng + khoá THẬT hợp lệ ⇒ null, KHÔNG cấp gì cả", async () => {
    const svc = new OpsKeysService(fakeDb({ ops_api_keys: [liveKey()] }, { selectError: true }).service);
    expect(await svc.resolve("hxops_live")).toBeNull();
  });

  it("database hỏng + chuỗi CŨ ⇒ null: hỏng không được làm chuỗi đã chết sống lại với quyền *", async () => {
    // Đây là hướng hỏng đáng sợ nhất của lát này. Nếu ở đây trả về tác nhân bootstrap thì mỗi lần
    // database chập là một cửa sổ toàn quyền cho một chuỗi lẽ ra đã bị gỡ.
    const svc = new OpsKeysService(fakeDb({ ops_api_keys: [liveKey()] }, { selectError: true }).service);
    expect(await svc.resolve("legacy-shared-key")).toBeNull();
  });

  it("hasActiveKey hỏng ⇒ true (đóng bootstrap), không phải false (mở)", async () => {
    const svc = new OpsKeysService(fakeDb({ ops_api_keys: [] }, { selectError: true }).service);
    expect(await svc.hasActiveKey()).toBe(true);
  });
});

describe("dailyUsage — hỏng thì ĐÓNG", () => {
  beforeEach(() => env());

  it("database ném ⇒ báo ĐÃ CHẠM TRẦN, không phải 'chưa dùng gì'", async () => {
    // Nếu chỗ này trả 0 khi lỗi thì một sự cố database sẽ trở thành đường vòng qua mọi hạn mức.
    const svc = new OpsKeysService(fakeDb({}, { rpcThrows: true }).service);
    const usage = await svc.dailyUsage("key-1", "coin_granted");
    expect(usage.calls).toBe(Number.MAX_SAFE_INTEGER);
    expect(overDailyLimit({ calls: 10 }, usage, { isWrite: true })).toBe("daily_call_limit");
  });

  it("khoá bootstrap (không có id) ⇒ 0, vì nó cũng không có hạn mức nào", async () => {
    const svc = new OpsKeysService(fakeDb().service);
    expect(await svc.dailyUsage(null)).toEqual({ calls: 0, units: 0 });
  });
});

describe("record — không bao giờ làm hỏng nghiệp vụ", () => {
  beforeEach(() => env());

  it("ghi vết hỏng ⇒ nuốt, KHÔNG ném", async () => {
    const boom = { from: () => ({ insert: () => { throw new Error("mat ket noi"); } }) } as unknown as SupabaseService;
    const svc = new OpsKeysService(boom);
    await expect(svc.record({
      keyId: "k", actorKind: "agent", actorName: "a", action: "POST /x", scope: "wallet:write",
      targetId: null, payloadHash: "h", idempotencyKey: null, isWrite: true, dryRun: false,
      status: "ok", result: {},
    })).resolves.toBeUndefined();
  });
});

// ---- Guard -----------------------------------------------------------------------------------

function ctx(req: Partial<OpsRequest>) {
  return { switchToHttp: () => ({ getRequest: () => req as OpsRequest }), getHandler: () => () => undefined } as never;
}
function reflector(meta: OpsEndpointMeta | undefined) {
  return { get: () => meta } as never;
}
function request(over: Partial<OpsRequest> = {}): Partial<OpsRequest> {
  return { method: "POST", path: "/internal/v1/admin/x", headers: {}, params: {}, query: {}, body: {}, ...over } as Partial<OpsRequest>;
}

describe("OpsAuthGuard", () => {
  beforeEach(() => env({ ADMIN_API_KEY_SHA256: sha256("legacy-shared-key") }));

  it("endpoint QUÊN khai báo @Ops ⇒ TỪ CHỐI, không phải cho qua", async () => {
    // Đây là bất biến quan trọng nhất của cả lát: bề mặt Ops API sẽ còn lớn nhiều ở C2.3–C2.4, và
    // một endpoint lọt ra ngoài hệ thống phạm vi là một endpoint không hạn mức, không vết.
    const guard = new OpsAuthGuard(new OpsKeysService(fakeDb().service), reflector(undefined));
    await expect(guard.canActivate(ctx(request()))).rejects.toThrow(ForbiddenException);
  });

  it("khoá sai ⇒ 401 VÀ ghi một hàng denied (biết có người đang thử)", async () => {
    const db = fakeDb();
    const guard = new OpsAuthGuard(new OpsKeysService(db.service), reflector({ scope: "wallet:write", isWrite: true }));
    await expect(guard.canActivate(ctx(request({ headers: { "x-admin-key": "sai" } })))).rejects.toThrow(UnauthorizedException);
    expect(db.tables.ops_audit_log).toHaveLength(1);
    expect(db.tables.ops_audit_log[0]).toMatchObject({ status: "denied", result: { code: "invalid_ops_key" } });
    // Không được ghi lại chính chuỗi khoá vào vết.
    expect(JSON.stringify(db.tables.ops_audit_log[0])).not.toContain("sai");
  });

  it("thiếu phạm vi ⇒ 403 kèm mã máy đọc được", async () => {
    const db = fakeDb({ ops_api_keys: [liveKey({ scopes: ["players:read"] })] });
    const guard = new OpsAuthGuard(new OpsKeysService(db.service), reflector({ scope: "wallet:write", isWrite: true }));
    await expect(guard.canActivate(ctx(request({ headers: { "x-admin-key": "hxops_live", "idempotency-key": "i1" } }))))
      .rejects.toMatchObject({ response: { code: "scope_denied", retryable: false } });
  });

  it("lời gọi GHI thiếu Idempotency-Key ⇒ chặn ở tầng guard, không để handler tự nhớ", async () => {
    const db = fakeDb({ ops_api_keys: [liveKey()] });
    const guard = new OpsAuthGuard(new OpsKeysService(db.service), reflector({ scope: "wallet:write", isWrite: true }));
    await expect(guard.canActivate(ctx(request({ headers: { "x-admin-key": "hxops_live" } }))))
      .rejects.toMatchObject({ response: { code: "missing_idempotency_key" } });
  });

  it("lời gọi ĐỌC không cần Idempotency-Key", async () => {
    const db = fakeDb({ ops_api_keys: [liveKey({ scopes: ["levels:read"] })] });
    const guard = new OpsAuthGuard(new OpsKeysService(db.service), reflector({ scope: "levels:read", isWrite: false }));
    await expect(guard.canActivate(ctx(request({ method: "GET", headers: { "x-admin-key": "hxops_live" } })))).resolves.toBe(true);
  });

  it("chạm hạn mức ⇒ 429 và retryable=true (thử lại sau ≠ sai tham số)", async () => {
    const db = fakeDb({ ops_api_keys: [liveKey({ daily_limits: { coin_granted: 1000 } })] }, { usage: { calls: 0, units: 900 } });
    const guard = new OpsAuthGuard(new OpsKeysService(db.service), reflector({
      scope: "wallet:write", isWrite: true, unitKind: "coin_granted", units: (b) => Number(b.amount) || 0,
    }));
    const req = request({ headers: { "x-admin-key": "hxops_live", "idempotency-key": "i1" }, body: { amount: 500 } });
    await expect(guard.canActivate(ctx(req))).rejects.toThrow(HttpException);
    await expect(guard.canActivate(ctx(req))).rejects.toMatchObject({ response: { code: "daily_unit_limit", retryable: true } });
  });

  it("đường thuận: gắn tác nhân + số lượng vào request cho interceptor dùng lại", async () => {
    const db = fakeDb({ ops_api_keys: [liveKey()] });
    const guard = new OpsAuthGuard(new OpsKeysService(db.service), reflector({
      scope: "wallet:write", isWrite: true, unitKind: "coin_granted", units: (b) => Number(b.amount) || 0,
    }));
    const req = request({ headers: { "x-admin-key": "hxops_live", "idempotency-key": "i1" }, body: { amount: 250 } });
    await expect(guard.canActivate(ctx(req))).resolves.toBe(true);
    expect((req as OpsRequest).opsActor?.name).toBe("agent-1");
    expect((req as OpsRequest).opsUnits).toBe(250);
  });

  it("decorator @Ops gắn metadata dưới đúng khoá mà guard đọc", () => {
    // Gọi thẳng decorator thay vì dùng cú pháp `@Ops` trong test: cú pháp decorator cần cấu hình
    // biên dịch riêng, mà thứ cần kiểm ở đây là KHOÁ metadata — nếu guard và decorator dùng hai
    // khoá khác nhau thì mọi endpoint sẽ rơi vào nhánh "chưa khai báo @Ops".
    const target = { run() { return 1; } };
    (Ops({ scope: "levels:publish", isWrite: true }) as (t: unknown, k: string, d: PropertyDescriptor) => void)(
      target, "run", Object.getOwnPropertyDescriptor(target, "run") as PropertyDescriptor);
    expect(Reflect.getMetadata(OPS_META, target.run)).toMatchObject({ scope: "levels:publish", isWrite: true });
  });
});

// ---- Interceptor -----------------------------------------------------------------------------

function interceptCtx(req: Partial<OpsRequest>) {
  return { switchToHttp: () => ({ getRequest: () => req as OpsRequest }) } as never;
}
function actorReq(over: Partial<OpsRequest> = {}): Partial<OpsRequest> {
  return {
    method: "POST", path: "/internal/v1/admin/players/p1/grant-coin", headers: { "idempotency-key": "i1" },
    params: { id: "p1" }, query: {}, body: { amount: 100 },
    opsActor: { keyId: "key-1", name: "agent-1", actorKind: "agent", scopes: ["wallet:write"], dailyLimits: {}, bootstrap: false },
    opsMeta: { scope: "wallet:write", isWrite: true, unitKind: "coin_granted" },
    opsPayloadHash: "hash-A", opsUnits: 100, ...over,
  } as Partial<OpsRequest>;
}

describe("OpsAuditInterceptor", () => {
  beforeEach(() => env());

  it("thành công ⇒ ghi vết status=ok kèm kết quả", async () => {
    const db = fakeDb();
    const it0 = new OpsAuditInterceptor(new OpsKeysService(db.service));
    const out = await firstValueFrom(it0.intercept(interceptCtx(actorReq()), { handle: () => of({ balance: 500 }) }) as never);
    expect(out).toEqual({ balance: 500 });
    await new Promise((r) => setTimeout(r, 0));
    expect(db.tables.ops_audit_log[0]).toMatchObject({ status: "ok", is_write: true, units: 100, unit_kind: "coin_granted", target_id: "p1" });
  });

  it("handler NÉM ⇒ vẫn ghi vết status=error rồi ném tiếp", async () => {
    // Vết chỉ có lời gọi thành công là vết kể chuyện một chiều: khi truy sự cố, câu hỏi đầu tiên
    // thường là "đã có ai thử và trượt chưa".
    const db = fakeDb();
    const it0 = new OpsAuditInterceptor(new OpsKeysService(db.service));
    const run = firstValueFrom(it0.intercept(interceptCtx(actorReq()), { handle: () => throwError(() => new Error("rpc failed")) }) as never);
    await expect(run).rejects.toThrow("rpc failed");
    await new Promise((r) => setTimeout(r, 0));
    expect(db.tables.ops_audit_log[0]).toMatchObject({ status: "error" });
  });

  it("gửi LẠI cùng Idempotency-Key + cùng payload ⇒ trả kết quả cũ, KHÔNG chạy handler lần hai", async () => {
    const db = fakeDb({ ops_audit_log: [{ key_id: "key-1", idempotency_key: "i1", status: "ok", payload_hash: "hash-A", result: { balance: 500 } }] });
    const handler = vi.fn(() => of({ balance: 999 }));
    const it0 = new OpsAuditInterceptor(new OpsKeysService(db.service));
    const out = await firstValueFrom(it0.intercept(interceptCtx(actorReq()), { handle: handler }) as never);
    // Đây là bất biến chống cấp coin hai lần vì một lần thử lại do mạng.
    expect(out).toEqual({ balance: 500 });
    expect(handler).not.toHaveBeenCalled();
  });

  it("cùng Idempotency-Key nhưng payload KHÁC ⇒ 409, không im lặng trả kết quả cũ", async () => {
    // Trả kết quả cũ ở đây sẽ nuốt mất thao tác người gọi vừa yêu cầu — hỏng theo kiểu không ai thấy.
    const db = fakeDb({ ops_audit_log: [{ key_id: "key-1", idempotency_key: "i1", status: "ok", payload_hash: "hash-KHAC", result: { balance: 500 } }] });
    const handler = vi.fn(() => of({ balance: 999 }));
    const it0 = new OpsAuditInterceptor(new OpsKeysService(db.service));
    await expect(firstValueFrom(it0.intercept(interceptCtx(actorReq()), { handle: handler }) as never)).rejects.toThrow(ConflictException);
    expect(handler).not.toHaveBeenCalled();
  });

  it("lời gọi ĐỌC (không có Idempotency-Key) vẫn chạy và vẫn để lại vết", async () => {
    const db = fakeDb();
    const it0 = new OpsAuditInterceptor(new OpsKeysService(db.service));
    const req = actorReq({ method: "GET", headers: {}, opsMeta: { scope: "levels:read", isWrite: false } });
    await firstValueFrom(it0.intercept(interceptCtx(req), { handle: () => of({ levels: [] }) }) as never);
    await new Promise((r) => setTimeout(r, 0));
    expect(db.tables.ops_audit_log[0]).toMatchObject({ status: "ok", is_write: false });
  });

  it("thiếu guard (không có opsActor) ⇒ đi tiếp nhưng KHÔNG giả vờ đã ghi vết", async () => {
    const db = fakeDb();
    const it0 = new OpsAuditInterceptor(new OpsKeysService(db.service));
    const out = await firstValueFrom(it0.intercept(interceptCtx({ headers: {} }), { handle: () => of({ ok: true }) }) as never);
    expect(out).toEqual({ ok: true });
    expect(db.tables.ops_audit_log).toHaveLength(0);
  });
});
