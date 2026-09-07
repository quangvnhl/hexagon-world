import { CanActivate, ExecutionContext, ForbiddenException, HttpException, HttpStatus, Injectable, SetMetadata, UnauthorizedException } from "@nestjs/common";
import { Reflector } from "@nestjs/core";
import type { Request } from "express";
import {
  OpsKeysService,
  hasScope,
  overDailyLimit,
  payloadHash,
  type OpsActor,
  type OpsScope,
} from "./ops-keys.service";

/**
 * doc 35 §C2.1 — cổng vào của Ops API.
 *
 * Guard trả lời đúng một câu: *lời gọi này có được vào không*. Nó chạy TRƯỚC handler nên không
 * thấy kết quả — phần ghi `result` vào vết kiểm toán nằm ở `ops-audit.interceptor.ts`.
 *
 * Header vẫn là `x-admin-key`, KHÔNG đổi tên. Trình vẽ admin
 * (`packages/admin/src/api.ts`) đọc khoá từ một ô nhập và gửi bằng header đó; giữ nguyên tên nghĩa
 * là người dùng chỉ cần dán chuỗi khác, không phải chờ một bản admin mới. Thứ đổi là cái NẰM SAU
 * header — tra trong `ops_api_keys` thay vì so với một hằng trong biến môi trường.
 */

export const OPS_META = "ops:meta";

export interface OpsEndpointMeta {
  scope: OpsScope;
  /** Ghi ⇒ tính vào trần `calls`/ngày, và bắt buộc có `Idempotency-Key`. */
  isWrite: boolean;
  /** Tên loại tài nguyên tiêu thụ, ví dụ `coin_granted`. Bỏ trống nếu lời gọi không tiêu gì. */
  unitKind?: string;
  /** Rút số lượng tiêu thụ từ body — chỉ dùng khi có `unitKind`. */
  units?: (body: Record<string, unknown>) => number;
}

/** Gắn phạm vi + tính chất cho một endpoint. Thiếu decorator này ⇒ guard TỪ CHỐI (xem bên dưới). */
export const Ops = (meta: OpsEndpointMeta) => SetMetadata(OPS_META, meta);

/** Request sau khi qua guard mang thêm bối cảnh cho interceptor. */
export interface OpsRequest extends Request {
  opsActor?: OpsActor;
  opsMeta?: OpsEndpointMeta;
  opsPayloadHash?: string;
  opsUnits?: number;
}

@Injectable()
export class OpsAuthGuard implements CanActivate {
  constructor(private readonly keys: OpsKeysService, private readonly reflector: Reflector) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const req = context.switchToHttp().getRequest<OpsRequest>();
    const meta = this.reflector.get<OpsEndpointMeta | undefined>(OPS_META, context.getHandler());

    // MẶC ĐỊNH LÀ TỪ CHỐI. Thêm một endpoint vào controller mà quên gắn `@Ops({...})` sẽ hỏng ngay
    // lần gọi đầu — thay vì lặng lẽ trở thành một endpoint không phạm vi, không hạn mức, không vết.
    // Đây là chỗ dễ sai nhất khi bề mặt API lớn dần ở C2.3–C2.4.
    if (!meta) throw new ForbiddenException({ code: "endpoint_not_scoped", message: "endpoint chưa khai báo @Ops()", retryable: false });

    // `req.route` chỉ có sau khi express khớp route; dùng path thô làm dự phòng.
    const action = `${req.method} ${(req as { route?: { path?: string } }).route?.path ?? req.path}`;
    const body = (req.body ?? {}) as Record<string, unknown>;
    const hash = payloadHash({ params: req.params ?? {}, query: req.query ?? {}, body });
    const targetId = String((req.params as Record<string, string> | undefined)?.id ?? (req.params as Record<string, string> | undefined)?.itemId ?? "") || null;
    const idempotencyKey = headerOf(req, "idempotency-key");

    const actor = await this.keys.resolve(headerOf(req, "x-admin-key") ?? "");
    if (!actor) {
      // Ghi cả lời gọi bị từ chối, KHÔNG kèm khoá: một chuỗi hỏng vẫn cho biết có ai đang thử.
      await this.keys.record({
        keyId: null, actorKind: "unknown", actorName: "unknown", action, scope: meta.scope,
        targetId, payloadHash: hash, idempotencyKey, isWrite: meta.isWrite, dryRun: false,
        status: "denied", result: { code: "invalid_ops_key" },
      });
      throw new UnauthorizedException({ code: "invalid_ops_key", message: "khoá không hợp lệ hoặc đã bị thu hồi", retryable: false });
    }

    req.opsActor = actor;
    req.opsMeta = meta;
    req.opsPayloadHash = hash;

    const deny = async (code: string, message: string, retryable: boolean) => {
      await this.keys.record({
        keyId: actor.keyId, actorKind: actor.actorKind, actorName: actor.name, action, scope: meta.scope,
        targetId, payloadHash: hash, idempotencyKey, isWrite: meta.isWrite, dryRun: false,
        status: "denied", result: { code },
      });
      return { code, message, retryable };
    };

    if (!hasScope(actor.scopes, meta.scope)) {
      throw new ForbiddenException(await deny("scope_denied", `khoá thiếu phạm vi ${meta.scope}`, false));
    }

    // Ghi mà không có `Idempotency-Key` thì gửi lại vì lỗi mạng sẽ thực hiện lần hai. Bắt buộc ở
    // TẦNG NÀY, không để từng handler tự nhớ — doc 36 R6: "mọi endpoint ghi mới phải có idempotency".
    if (meta.isWrite && !idempotencyKey) {
      throw new ForbiddenException(await deny("missing_idempotency_key", "lời gọi ghi phải có header Idempotency-Key", false));
    }

    const units = meta.unitKind && meta.units ? meta.units(body) : 0;
    req.opsUnits = units;
    const usage = await this.keys.dailyUsage(actor.keyId, meta.unitKind ?? null);
    const limited = overDailyLimit(actor.dailyLimits, usage, { isWrite: meta.isWrite, unitKind: meta.unitKind, units });
    if (limited) {
      // `retryable: true` — hạn mức reset lúc 00:00 UTC, nên đây là "thử lại sau", không phải
      // "sai tham số". Agent phân biệt được hai loại này mới tự xử lý đúng (doc 35 §C2 nguyên tắc 6).
      // `@nestjs/common` không có sẵn TooManyRequestsException ⇒ dựng bằng HttpException + 429.
      throw new HttpException(await deny(limited, "đã chạm hạn mức ngày của khoá này", true), HttpStatus.TOO_MANY_REQUESTS);
    }

    return true;
  }
}

function headerOf(req: Request, name: string): string | null {
  const raw = req.headers?.[name];
  const value = Array.isArray(raw) ? raw[0] : raw;
  return value ? String(value) : null;
}
