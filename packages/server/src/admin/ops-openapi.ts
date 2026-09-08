import { RequestMethod } from "@nestjs/common";
// `PATH_METADATA` / `METHOD_METADATA` nằm ở entry `constants`, không nằm trong barrel gốc của
// @nestjs/common. Đây chính là hai khoá mà `@Controller()` / `@Post()` ghi vào — đọc lại chúng là
// cách duy nhất để danh mục sinh ra từ ĐỊNH TUYẾN THẬT thay vì từ một bản khai thứ hai.
import { METHOD_METADATA, PATH_METADATA } from "@nestjs/common/constants";
import { OPS_META, type OpsEndpointMeta } from "./ops-auth.guard";

/**
 * doc 35 §C2 nguyên tắc 2 — *"hợp đồng máy đọc: agent tự khám phá endpoint/tham số, không cần nhúng
 * tri thức vào prompt."*
 *
 * ĐỔI SO VỚI KẾ HOẠCH: doc 35 đề xuất `@nestjs/swagger`. Ở đây sinh thẳng từ chính metadata
 * `@Ops({...})` mà guard đang dùng, vì một lý do quyết định:
 *
 *   **Spec không thể lệch khỏi thứ đang thực sự được thi hành.** Với `@nestjs/swagger`, phạm vi và
 *   hạn mức sẽ được khai lại lần thứ hai trong các decorator tài liệu — và hai bản khai đó sẽ trôi
 *   khỏi nhau. Một tài liệu nói `wallet:write` trong khi guard đòi `players:write` là loại sai
 *   không ai phát hiện cho tới lúc agent gọi thật và trượt.
 *
 * Đổi lại thì mất phần schema chi tiết của body (swagger sinh được từ DTO). Chấp nhận: thứ agent
 * cần trước tiên là *endpoint nào tồn tại, cần phạm vi gì, có ghi không, có dry_run không* — và bốn
 * thứ đó ở đây luôn đúng theo định nghĩa.
 */

const METHOD_NAMES: Record<number, string> = {
  [RequestMethod.GET]: "get",
  [RequestMethod.POST]: "post",
  [RequestMethod.PUT]: "put",
  [RequestMethod.DELETE]: "delete",
  [RequestMethod.PATCH]: "patch",
};

export interface OpsOperation {
  method: string;
  path: string;
  meta: OpsEndpointMeta;
  handlerName: string;
}

/** Đọc mọi handler có `@Ops({...})` trên một controller. Thuần, không chạm Nest runtime. */
export function collectOpsOperations(controller: new (...args: never[]) => unknown): OpsOperation[] {
  const base = String(Reflect.getMetadata(PATH_METADATA, controller) ?? "").replace(/^\/|\/$/g, "");
  const proto = controller.prototype as Record<string, unknown>;
  const out: OpsOperation[] = [];
  for (const name of Object.getOwnPropertyNames(proto)) {
    if (name === "constructor") continue;
    const handler = proto[name];
    if (typeof handler !== "function") continue;
    const meta = Reflect.getMetadata(OPS_META, handler) as OpsEndpointMeta | undefined;
    if (!meta) continue;
    const methodId = Reflect.getMetadata(METHOD_METADATA, handler) as number | undefined;
    const method = METHOD_NAMES[methodId ?? RequestMethod.GET];
    if (!method) continue;
    const sub = String(Reflect.getMetadata(PATH_METADATA, handler) ?? "").replace(/^\/|\/$/g, "");
    out.push({ method, path: `/${[base, sub].filter(Boolean).join("/")}`, meta, handlerName: name });
  }
  return out.sort((a, b) => (a.path === b.path ? a.method.localeCompare(b.method) : a.path.localeCompare(b.path)));
}

/** `players/:id/grant-coin` → `players/{id}/grant-coin` + danh sách tham số đường dẫn. */
export function toOpenApiPath(path: string): { path: string; params: string[] } {
  const params: string[] = [];
  const converted = path.replace(/:([A-Za-z0-9_]+)/g, (_m, name: string) => {
    params.push(name);
    return `{${name}}`;
  });
  return { path: converted, params };
}

const ERROR_REF = { $ref: "#/components/schemas/OpsError" };

export function buildOpsOpenApi(controller: new (...args: never[]) => unknown, opts: { version: string }): Record<string, unknown> {
  const paths: Record<string, Record<string, unknown>> = {};

  for (const op of collectOpsOperations(controller)) {
    const { path, params } = toOpenApiPath(op.path);
    const parameters: Record<string, unknown>[] = params.map((name) => ({
      name, in: "path", required: true, schema: { type: "string" },
    }));

    if (op.meta.isWrite) {
      parameters.push({
        name: "Idempotency-Key", in: "header",
        // Không bắt buộc theo nghĩa OpenAPI vì `?dry_run=true` không cần — nhưng mô tả nói rõ.
        required: false,
        schema: { type: "string" },
        description: "Bắt buộc cho lời gọi THẬT (bỏ được khi dry_run=true). Gửi lại cùng khoá + cùng payload ⇒ trả kết quả cũ; cùng khoá + payload khác ⇒ 409.",
      });
    }
    if (op.meta.dryRun) {
      parameters.push({
        name: "dry_run", in: "query", required: false,
        schema: { type: "string", enum: ["true"] },
        description: "true ⇒ trả kết quả DỰ KIẾN, không đổi dữ liệu. Chỉ đúng chuỗi 'true' mới bật.",
      });
    }

    paths[path] ??= {};
    paths[path][op.method] = {
      operationId: op.handlerName,
      tags: [op.meta.scope.split(":")[0]],
      summary: `${op.meta.isWrite ? "Ghi" : "Đọc"} · phạm vi ${op.meta.scope}`,
      security: [{ opsApiKey: [] }],
      ...(parameters.length ? { parameters } : {}),
      // Phần agent thật sự cần để quyết định: có gọi được không, có đổi dữ liệu không, thử khô được không.
      "x-ops-scope": op.meta.anyKey ? "any" : op.meta.scope,
      "x-ops-write": op.meta.isWrite,
      "x-ops-dry-run": op.meta.dryRun === true,
      ...(op.meta.unitKind ? { "x-ops-unit-kind": op.meta.unitKind } : {}),
      ...(op.meta.isWrite ? { requestBody: { required: false, content: { "application/json": { schema: { type: "object" } } } } } : {}),
      responses: {
        "200": { description: "OK", content: { "application/json": { schema: { type: "object" } } } },
        "400": { description: "Tham số sai, hoặc dry_run chưa được cài", content: { "application/json": { schema: ERROR_REF } } },
        "401": { description: "Khoá không hợp lệ / đã thu hồi / hết hạn", content: { "application/json": { schema: ERROR_REF } } },
        "403": { description: "Thiếu phạm vi, hoặc thiếu Idempotency-Key", content: { "application/json": { schema: ERROR_REF } } },
        ...(op.meta.isWrite ? { "409": { description: "Idempotency-Key dùng lại cho payload khác", content: { "application/json": { schema: ERROR_REF } } } } : {}),
        "429": { description: "Chạm hạn mức ngày của khoá (retryable)", content: { "application/json": { schema: ERROR_REF } } },
      },
    };
  }

  return {
    openapi: "3.1.0",
    info: {
      title: "Hexagon World — Ops API",
      version: opts.version,
      description:
        "API vận hành, dùng chung cho NGƯỜI và AI AGENT (doc 35 §C2). Mọi lời gọi cần header " +
        "`x-admin-key` là một khoá trong `ops_api_keys`. Mọi lời gọi đều để lại vết trong " +
        "`ops_audit_log`, kể cả lời gọi bị từ chối. Lỗi luôn có dạng { code, message, hint, retryable } " +
        "— `retryable` phân biệt 'thử lại sau' với 'sai tham số'.",
    },
    components: {
      securitySchemes: { opsApiKey: { type: "apiKey", in: "header", name: "x-admin-key" } },
      schemas: {
        OpsError: {
          type: "object",
          required: ["code", "message", "retryable"],
          properties: {
            code: { type: "string", description: "Mã máy đọc được, ổn định qua các phiên bản." },
            message: { type: "string" },
            hint: { type: "string", description: "Gợi ý cho người đọc log, không dùng để phân nhánh." },
            retryable: { type: "boolean", description: "true ⇒ thử lại sau có thể thành công. false ⇒ thử lại vô ích." },
          },
        },
      },
    },
    security: [{ opsApiKey: [] }],
    paths,
  };
}
