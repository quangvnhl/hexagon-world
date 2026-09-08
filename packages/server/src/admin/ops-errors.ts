import { ArgumentsHost, Catch, ExceptionFilter, HttpException, HttpStatus, Logger } from "@nestjs/common";
import type { Response } from "express";

/**
 * doc 35 §C2 nguyên tắc 6 — *"lỗi máy đọc được: `{ code, message, hint, retryable }` — agent phân
 * biệt được 'sai tham số' với 'thử lại sau'."*
 *
 * Vì sao `retryable` là trường quan trọng nhất ở đây: một agent gặp lỗi chỉ có hai hành vi đúng —
 * **thử lại** hoặc **dừng và báo người**. Đoán sai chiều nào cũng hỏng, và hỏng theo kiểu tệ:
 *   * Coi lỗi tham số là tạm thời ⇒ vòng lặp thử lại vô hạn trên một lời gọi không bao giờ thành công.
 *   * Coi lỗi tạm thời là vĩnh viễn ⇒ bỏ dở một việc vận hành đang cần làm, và báo nhầm nguyên nhân.
 *
 * `hint` là câu dành cho *người đọc log lúc 2 giờ sáng*, không phải cho máy phân nhánh.
 */
export interface OpsErrorBody {
  code: string;
  message: string;
  hint?: string;
  retryable: boolean;
}

/** Chuẩn hoá một thân lỗi bất kỳ về đúng bốn trường. */
export function opsErrorBody(input: unknown, fallback: { code: string; retryable: boolean }): OpsErrorBody {
  const raw = (input && typeof input === "object" ? input : {}) as Record<string, unknown>;
  const code = typeof raw.code === "string" && raw.code ? raw.code : fallback.code;
  return {
    code,
    message: typeof raw.message === "string" && raw.message ? raw.message : String(input ?? code),
    ...(typeof raw.hint === "string" && raw.hint ? { hint: raw.hint } : hintFor(code) ? { hint: hintFor(code) } : {}),
    retryable: typeof raw.retryable === "boolean" ? raw.retryable : fallback.retryable,
  };
}

/**
 * Gợi ý mặc định theo mã lỗi. Đặt ở một chỗ thay vì rải trong từng handler: cùng một mã lỗi phải
 * cho cùng một gợi ý, nếu không thì `hint` chỉ là thêm chữ chứ không thêm thông tin.
 */
const HINTS: Record<string, string> = {
  invalid_ops_key: "Khoá sai, đã thu hồi, hoặc đã hết hạn. Tạo khoá mới bằng POST ops/keys.",
  scope_denied: "Khoá này không có phạm vi cần thiết. Xem GET ops/keys để biết khoá đang có gì.",
  missing_idempotency_key: "Thêm header Idempotency-Key (một UUID mới cho mỗi thao tác khác nhau).",
  idempotency_key_reused: "Khoá idempotency này đã dùng cho payload khác. Sinh khoá mới cho thao tác mới.",
  daily_call_limit: "Hạn mức reset lúc 00:00 UTC. Chờ, hoặc nhờ người nâng daily_limits của khoá.",
  daily_unit_limit: "Hạn mức reset lúc 00:00 UTC. Chờ, hoặc chia nhỏ số lượng qua nhiều ngày.",
  dry_run_unsupported: "Endpoint này chưa cài dry_run. Bỏ ?dry_run=true, hoặc dùng endpoint đọc để xem trước.",
  endpoint_not_scoped: "Lỗi lập trình phía server: endpoint thiếu decorator @Ops(). Báo người phát triển.",
  database_error: "Sự cố tạm thời phía database. Thử lại sau vài giây.",
};

export function hintFor(code: string): string | undefined {
  return HINTS[code];
}

/** Ném lỗi Ops đúng dạng, không phải nhớ hình dạng ở từng nơi gọi. */
export function opsThrow(status: HttpStatus, body: OpsErrorBody): never {
  throw new HttpException(body, status);
}

/**
 * Bọc MỌI lỗi thoát ra khỏi Ops API về đúng bốn trường.
 *
 * Có mặt vì phần lớn lỗi ở đây KHÔNG do code của controller ném: chúng đến từ `SupabaseService`
 * (`ServiceUnavailableException`), từ pipe của Nest, hoặc từ một `TypeError` không lường trước.
 * Nếu chỉ những lỗi tự viết mới có `{code,...}` thì hợp đồng lỗi chỉ đúng ở đường thuận — đúng lúc
 * agent cần nó nhất thì nó lại không có.
 */
@Catch()
export class OpsErrorFilter implements ExceptionFilter {
  private readonly logger = new Logger("ops-api");

  catch(exception: unknown, host: ArgumentsHost): void {
    const res = host.switchToHttp().getResponse<Response>();
    const status = exception instanceof HttpException ? exception.getStatus() : HttpStatus.INTERNAL_SERVER_ERROR;
    const raw = exception instanceof HttpException ? exception.getResponse() : null;

    // 5xx = phía chúng tôi hỏng ⇒ mặc định ĐÁNG thử lại. 4xx = người gọi sai ⇒ thử lại vô ích.
    // Mặc định theo mã trạng thái thay vì theo từng chỗ ném: chỗ nào quên khai `retryable` vẫn ra
    // câu trả lời hợp lý thay vì `undefined`.
    const fallback = { code: status >= 500 ? "internal_error" : "bad_request", retryable: status >= 500 || status === 429 };
    const body = opsErrorBody(typeof raw === "string" ? { message: raw } : raw, fallback);

    if (status >= 500) {
      // Chỉ log 5xx: 4xx là chuyện bình thường của một API có kiểm tra đầu vào, log hết sẽ chôn
      // vùi đúng thứ cần thấy.
      this.logger.error(`${body.code}: ${body.message}`);
    }
    res.status(status).json(body);
  }
}
