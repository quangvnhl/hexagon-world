// doc 35 §A4 (lát a4.2) — làm sạch PII trước khi gửi báo cáo lỗi ra ngoài.
//
// Đặt ở `shared` vì client và server phải làm SẠCH GIỐNG NHAU. Hai bản chép tay sẽ lệch, và bên
// lệch là bên rò — mà "rò" ở đây nghĩa là `initData` của Telegram hoặc một token nằm trong hệ thống
// của bên thứ ba, ngoài tầm xoá của chúng ta.
//
// ┌─ THỨ NÀY KHÁC `sanitizeProps` Ở CHỖ NÀO ─────────────────────────────────────────────────────┐
// │ `sanitizeProps` (analytics) lọc props do CHÍNH TA viết ra: ta biết trước có những khoá nào.   │
// │ Báo cáo lỗi thì ngược lại — nội dung do ngoại lệ quyết định, và nó kéo theo bất cứ thứ gì có │
// │ trong ngăn xếp: URL đầy đủ kèm query, thân request, biến cục bộ. Nên ở đây phải đi ĐỆ QUY và  │
// │ mặc định là nghi ngờ, chứ không phải lọc theo một danh sách khoá đã biết.                     │
// └───────────────────────────────────────────────────────────────────────────────────────────────┘

import { FORBIDDEN_PROP_KEYS } from "./analytics";

/** Giá trị thay thế. Giữ lại DẤU VẾT rằng có thứ gì đó đã bị xoá — trường biến mất hẳn thì người
 *  đọc log tưởng nó chưa bao giờ tồn tại và đi tìm nhầm chỗ. */
export const REDACTED = "[da-xoa]";

/** Độ sâu tối đa khi đi đệ quy. Ngoại lệ có thể mang cấu trúc vòng hoặc rất sâu. */
const MAX_DEPTH = 8;
/** Cắt chuỗi quá dài — một thân request 1 MB trong báo cáo lỗi không giúp ai chẩn đoán gì. */
const MAX_STRING = 2_000;

/**
 * Khoá CHỈ nguy hiểm trong báo cáo lỗi, cộng thêm vào `FORBIDDEN_PROP_KEYS`.
 *
 * `FORBIDDEN_PROP_KEYS` viết cho props analytics — thứ do CHÍNH TA đặt tên, và ở đó không bao giờ
 * có header HTTP. Báo cáo lỗi thì kéo theo cả `request.headers`, và `authorization`/`cookie` chính
 * là hai chỗ credential nằm nhiều nhất. Bài test viết cho lát này bắt được đúng chỗ đó.
 *
 * Cố ý KHÔNG thêm `key` trần: nó sẽ xoá cả `asset_key`, `level_key`, `idempotency_key` — những thứ
 * vô hại mà lại đúng là thứ cần để chẩn đoán. Xoá quá tay làm báo cáo lỗi vô dụng, và một báo cáo
 * vô dụng thì người ta ngừng đọc.
 */
const ERROR_ONLY_FORBIDDEN = [
  "authorization",
  "cookie",
  "secret",
  "credential",
  "apikey",
  "api_key",
  "admin-key",
  "signature",
  "bearer",
] as const;

function isForbidden(key: string): boolean {
  const k = key.toLowerCase();
  return FORBIDDEN_PROP_KEYS.some((bad) => k.includes(bad))
    || ERROR_ONLY_FORBIDDEN.some((bad) => k.includes(bad));
}

/**
 * Xoá phần truy vấn khỏi URL, giữ lại đường dẫn.
 *
 * Query string là chỗ PII lọt ra nhiều nhất trong báo cáo lỗi: `?token=`, `?anonId=`, `?email=`.
 * Giữ đường dẫn vì đó mới là thứ cần để biết lỗi xảy ra ở đâu.
 */
export function scrubUrl(raw: string): string {
  const cut = raw.search(/[?#]/);
  return cut === -1 ? raw : `${raw.slice(0, cut)}?${REDACTED}`;
}

/**
 * Làm sạch một giá trị bất kỳ trong báo cáo lỗi.
 *
 * Luật, theo đúng thứ tự áp dụng:
 *   1. Khoá nghi PII (khớp CHUỖI CON, không phân biệt hoa thường) ⇒ thay bằng `REDACTED`.
 *      Khớp chuỗi con nên `userEmail`, `user_email`, `initDataRaw` đều dính.
 *   2. Chuỗi trông như URL ⇒ cắt query.
 *   3. Chuỗi quá dài ⇒ cắt.
 *   4. Object/mảng ⇒ đi tiếp, tới `MAX_DEPTH`.
 *
 * KHÔNG bao giờ ném: một lỗi trong bộ làm sạch sẽ nuốt mất chính báo cáo lỗi cần gửi.
 */
export function scrubValue(value: unknown, depth = 0): unknown {
  if (depth > MAX_DEPTH) return REDACTED;
  if (value === null || value === undefined) return value;

  if (typeof value === "string") {
    const s = /^[a-z][a-z0-9+.-]*:\/\//i.test(value) ? scrubUrl(value) : value;
    return s.length > MAX_STRING ? `${s.slice(0, MAX_STRING)}…` : s;
  }
  if (typeof value === "number" || typeof value === "boolean") return value;

  if (Array.isArray(value)) return value.map((v) => scrubValue(v, depth + 1));

  if (typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      out[k] = isForbidden(k) ? REDACTED : scrubValue(v, depth + 1);
    }
    return out;
  }

  // Hàm, symbol, bigint: không có giá trị chẩn đoán và không tuần tự hoá được đáng tin.
  return REDACTED;
}

/**
 * Làm sạch một sự kiện lỗi trước khi gửi. Dùng chung cho cả `beforeSend` của client lẫn server.
 *
 * Trả về `null` khi không có gì để gửi — bên gọi hiểu đó là "bỏ sự kiện này".
 */
export function scrubErrorEvent<T extends Record<string, unknown>>(event: T | null | undefined): T | null {
  if (!event) return null;
  try {
    return scrubValue(event) as T;
  } catch {
    // Thà mất một báo cáo lỗi còn hơn để bộ làm sạch hỏng rồi gửi đi nguyên bản chưa lọc.
    return null;
  }
}
