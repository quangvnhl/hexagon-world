// doc 35 §A4 (lát a4.2) — báo cáo lỗi phía client.
//
// ┌─ BA QUYẾT ĐỊNH, VÀ VÌ SAO ───────────────────────────────────────────────────────────────────┐
// │ 1. TRUNG TÍNH NHÀ CUNG CẤP. GlitchTip nói đúng giao thức Sentry, nên cùng một SDK chạy được  │
// │    với cả hai — khác nhau đúng một chuỗi DSN. Chọn nhà cung cấp vì thế KHÔNG chặn code, và   │
// │    đổi nhà cung cấp về sau chỉ là đổi biến môi trường.                                        │
// │ 2. DSN RỖNG = TẮT HẲN, và SDK không được TẢI VỀ. Đo trên bản build ngày 2026-09-08: SDK ra   │
// │    3 chunk, tổng 455 KB, và KHÔNG chunk nào nằm trong `app-build-manifest` của bất kỳ trang   │
// │    nào — tức có trên đĩa nhưng trình duyệt không lấy, trừ khi `import()` dưới đây chạy.        │
// │ 3. LÀM SẠCH BẰNG MÃ DÙNG CHUNG với server (`@hexagon/shared/error-scrub`). Hai bản chép tay   │
// │    sẽ lệch, và bên lệch là bên rò — mà rò ở đây nghĩa là `initData` nằm trong hệ thống của    │
// │    bên thứ ba, ngoài tầm xoá của chúng ta.                                                    │
// └───────────────────────────────────────────────────────────────────────────────────────────────┘
//
// KHÔNG BAO GIỜ làm hỏng game: mọi lỗi trong chính bộ báo lỗi đều bị nuốt. Cùng nguyên tắc với
// `analytics.ts` — mất một báo cáo là chuyện nhỏ, ném lỗi giữa vòng lặp game là chuyện lớn.

import { scrubErrorEvent } from "@hexagon/shared";

/** DSN của Sentry hoặc GlitchTip. Rỗng ⇒ tắt hẳn. */
const DSN = process.env.NEXT_PUBLIC_ERROR_DSN ?? "";

/**
 * Bản phát hành. Gắn `release` là thứ khiến một báo cáo lỗi trả lời được câu hỏi đầu tiên khi truy
 * sự cố: *bản nào?* — doc 35 §A8 nói rõ Telegram Mini App KHÔNG ép cập nhật được, nên tại một thời
 * điểm luôn có nhiều bản client đang chạy cùng lúc.
 */
const RELEASE = process.env.NEXT_PUBLIC_BUILD_ID ?? "dev";

let started = false;

/** Có bật báo cáo lỗi không. Tách ra để test và để giao diện biết mà không phải đoán. */
export function errorReportingEnabled(dsn: string = DSN): boolean {
  return dsn.trim().length > 0;
}

/**
 * Bật báo cáo lỗi. Gọi nhiều lần vô hại.
 *
 * Bất đồng bộ và KHÔNG cần `await`: không có gì trong game phụ thuộc vào việc nó đã sẵn sàng, và
 * bắt màn hình đầu chờ tải một SDK là đổi một lợi ích không thấy được lấy một thiệt hại thấy được.
 */
export async function initErrorReporting(): Promise<void> {
  if (started || !errorReportingEnabled()) return;
  started = true;
  try {
    // `import()` động: đây là dòng DUY NHẤT kéo 455 KB kia về, và nó chỉ chạy khi đã có DSN thật.
    const Sentry = await import("@sentry/browser");
    Sentry.init({
      dsn: DSN,
      release: RELEASE,
      // Không lấy mẫu hiệu năng: lát này chỉ cần LỖI. Bật tracing là một quyết định về chi phí và
      // về quyền riêng tư, và nó phải được cân nhắc riêng chứ không đi kèm miễn phí.
      tracesSampleRate: 0,
      // Mặc định của SDK là gắn IP và một số thông tin người dùng. Tắt.
      sendDefaultPii: false,
      beforeSend: (event) => scrubErrorEvent(event as unknown as Record<string, unknown>) as never,
      beforeBreadcrumb: (crumb) => scrubErrorEvent(crumb as unknown as Record<string, unknown>) as never,
    });
  } catch {
    // Không tải được SDK (mạng chặn, CDN hỏng) ⇒ chơi tiếp như chưa có gì.
  }
}
