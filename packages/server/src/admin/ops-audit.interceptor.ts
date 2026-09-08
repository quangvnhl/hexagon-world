import { BadRequestException, CallHandler, ConflictException, ExecutionContext, Injectable, NestInterceptor } from "@nestjs/common";
import { hintFor } from "./ops-errors";
import { Observable, from, of, switchMap, tap, catchError, throwError } from "rxjs";
import { OpsKeysService } from "./ops-keys.service";
import type { OpsRequest } from "./ops-auth.guard";

/**
 * doc 35 §C2.1 nguyên tắc 4 — *"mọi lời gọi ghi vào `ops_audit_log`. KHÔNG có ngoại lệ."*
 *
 * Vì sao là interceptor chứ không phải guard: guard chạy trước handler nên không bao giờ thấy kết
 * quả, mà vết kiểm toán phải ghi cả `result`. Vì sao không để từng handler tự ghi: "không có ngoại
 * lệ" mà phụ thuộc vào việc người viết endpoint sau nhớ gọi một hàm thì đó là *quy ước*, không phải
 * *bảo đảm* — và endpoint bị quên sẽ đúng là endpoint nguy hiểm nhất.
 *
 * Interceptor này cũng là nơi CHỐNG LẶP xảy ra, vì cùng lý do: nó là chỗ duy nhất nhìn thấy cả
 * request lẫn response.
 */
@Injectable()
export class OpsAuditInterceptor implements NestInterceptor {
  constructor(private readonly keys: OpsKeysService) {}

  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    const req = context.switchToHttp().getRequest<OpsRequest>();
    const actor = req.opsActor;
    const meta = req.opsMeta;
    // Guard luôn chạy trước và luôn đặt hai giá trị này. Không có ⇒ ai đó gắn interceptor mà quên
    // guard: đi tiếp thay vì ném, nhưng cũng không giả vờ đã ghi vết.
    if (!actor || !meta) return next.handle();

    const action = `${req.method} ${(req as { route?: { path?: string } }).route?.path ?? req.path}`;
    const params = (req.params ?? {}) as Record<string, string>;
    const dryRun = req.opsDryRun === true;

    // doc 35 §C2.5 — MẶC ĐỊNH TỪ CHỐI, và từ chối TRƯỚC KHI handler chạy.
    //
    // Đây là bất biến an toàn quan trọng nhất của lát này. Nếu `?dry_run=true` rơi xuống nhánh thật
    // trên một endpoint chưa cài, thì một agent làm ĐÚNG quy trình — luôn thử khô trước khi làm
    // thật — sẽ cấp coin hoặc xoá tài khoản trong khi tin rằng mình chỉ đang xem trước. Hỏng theo
    // hướng "người cẩn thận bị phạt" là hướng tệ nhất.
    if (dryRun && !meta.dryRun) {
      const body = { code: "dry_run_unsupported", message: `endpoint này chưa cài dry_run`, hint: hintFor("dry_run_unsupported"), retryable: false };
      void this.keys.record({
        keyId: actor.keyId, actorKind: actor.actorKind, actorName: actor.name, action,
        scope: meta.scope, targetId: String(params.id ?? params.itemId ?? "") || null,
        payloadHash: req.opsPayloadHash ?? "", idempotencyKey: headerOf(req, "idempotency-key"),
        isWrite: meta.isWrite, dryRun: true, status: "denied", result: body,
      });
      return throwError(() => new BadRequestException(body));
    }
    const base = {
      keyId: actor.keyId,
      actorKind: actor.actorKind,
      actorName: actor.name,
      action,
      scope: meta.scope,
      targetId: String(params.id ?? params.itemId ?? "") || null,
      payloadHash: req.opsPayloadHash ?? "",
      idempotencyKey: headerOf(req, "idempotency-key"),
      isWrite: meta.isWrite,
      dryRun,
      units: req.opsUnits ?? 0,
      unitKind: meta.unitKind ?? null,
    };

    // Thử khô KHÔNG đi qua chống lặp: nó không thực hiện gì nên không có gì để khử trùng, và nếu
    // nó ghi một hàng `ok` mang khoá idempotency thì lần gọi THẬT sau đó sẽ bị coi là lặp lại và
    // không bao giờ chạy — im lặng nuốt mất chính thao tác mà người ta vừa xem trước xong.
    if (dryRun) {
      return next.handle().pipe(
        tap({ next: (result) => { void this.keys.record({ ...base, idempotencyKey: null, status: "ok", result: asRecord(result) }); } }),
        catchError((err: unknown) => {
          void this.keys.record({ ...base, idempotencyKey: null, status: "error", result: { message: messageOf(err) } });
          return throwError(() => err);
        }),
      );
    }

    return from(this.keys.findReplay(base.keyId, base.idempotencyKey)).pipe(
      switchMap((prior) => {
        if (prior) {
          // Cùng khoá idempotency nhưng payload KHÁC = lỗi của người gọi, không phải lần thử lại.
          // Trả kết quả cũ trong trường hợp này sẽ im lặng bỏ qua thao tác họ vừa yêu cầu.
          if (prior.payload_hash !== base.payloadHash) {
            return from(this.keys.record({ ...base, status: "denied", result: { code: "idempotency_key_reused" } })).pipe(
              switchMap(() => throwError(() => new ConflictException({
                code: "idempotency_key_reused",
                message: "Idempotency-Key đã dùng cho một payload khác",
                retryable: false,
              }))),
            );
          }
          return from(this.keys.record({ ...base, status: "replay", result: {} })).pipe(
            switchMap(() => of(prior.result)),
          );
        }

        return next.handle().pipe(
          tap({
            next: (result) => {
              // `void` có chủ ý: response không chờ ghi vết. Thao tác đã xảy ra rồi — bắt người gọi
              // đợi thêm một lượt ghi database không làm nó an toàn hơn.
              void this.keys.record({ ...base, status: "ok", result: asRecord(result) });
            },
          }),
          catchError((err: unknown) => {
            // Hỏng cũng phải ghi. Vết kiểm toán chỉ có lời gọi thành công là vết kể chuyện một chiều:
            // khi truy sự cố, thứ cần biết trước tiên thường là "đã có ai thử và trượt chưa".
            void this.keys.record({ ...base, status: "error", result: { message: messageOf(err) } });
            return throwError(() => err);
          }),
        );
      }),
    );
  }
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : { value: value ?? null };
}

function messageOf(err: unknown): string {
  const raw = err instanceof Error ? err.message : String(err);
  return raw.slice(0, 500);
}

function headerOf(req: OpsRequest, name: string): string | null {
  const raw = req.headers?.[name];
  const value = Array.isArray(raw) ? raw[0] : raw;
  return value ? String(value) : null;
}
