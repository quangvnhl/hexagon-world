/**
 * doc 35 §C4 — DỮ KIỆN của ba trang pháp lý, tách khỏi câu chữ.
 *
 * Vì sao một file riêng: `/terms`, `/privacy`, `/paysupport` nhắc lại cùng một bộ dữ kiện (ai vận
 * hành, liên hệ ở đâu, giữ dữ liệu bao lâu). Chép ba lần thì sớm muộn ba trang sẽ nói ba điều khác
 * nhau — và trang pháp lý tự mâu thuẫn thì tệ hơn là không có trang.
 *
 * ⚠️ HAI Ô BẮT BUỘC NGƯỜI ĐIỀN. Agent KHÔNG tự bịa được, vì đây là lời khẳng định về việc AI
 * CHỊU TRÁCH NHIỆM PHÁP LÝ — bịa một pháp nhân là tạo ra một tổ chức không tồn tại. Để trống thì
 * cả ba trang tự hiện băng cảnh báo đỏ (xem `legalIsPublishable`), nên một trang chưa điền KHÔNG
 * thể lặng lẽ trông như trang thật.
 */
export interface LegalFacts {
  /** Tên pháp nhân hoặc cá nhân chịu trách nhiệm vận hành. BẮT BUỘC. */
  operator: string;
  /** Email hỗ trợ người chơi — Telegram Stars YÊU CẦU có kênh liên hệ hoạt động. BẮT BUỘC. */
  contactEmail: string;
  /** Kênh phụ (tuỳ chọn): @username của bot/tài khoản hỗ trợ trên Telegram. */
  contactTelegram: string;
  /** Luật áp dụng và nơi giải quyết tranh chấp. */
  jurisdiction: string;
  /** Tuổi tối thiểu. 13 khớp với điều kiện của chính Telegram. */
  minAge: number;
  /** Số ngày nhận yêu cầu hoàn Stars kể từ lúc giao dịch thành công. */
  refundWindowDays: number;
  /** Hạn giữ sự kiện phân tích — khớp `purge_old_analytics_events` trong migration. */
  analyticsRetentionDays: number;
  /** Số ngày giữ tài khoản ở trạng thái đã xoá trước khi xoá hẳn. */
  deletionGraceDays: number;
  /** Ngày cập nhật gần nhất, hiện ở chân mỗi trang. */
  updatedAt: string;
}

export const LEGAL: LegalFacts = {
  // ↓↓↓ ĐIỀN HAI Ô NÀY TRƯỚC KHI PHÁT HÀNH ↓↓↓
  operator: "",
  contactEmail: "",
  // ↑↑↑ ĐIỀN HAI Ô NÀY TRƯỚC KHI PHÁT HÀNH ↑↑↑
  contactTelegram: "",
  jurisdiction: "Việt Nam",
  minAge: 13,
  refundWindowDays: 14,
  // Khớp mặc định của `purge_old_analytics_events(p_keep_days default 90)`. Đổi ở đây mà quên đổi
  // trong database là hứa một đằng làm một nẻo.
  analyticsRetentionDays: 90,
  deletionGraceDays: 30,
  updatedAt: "2026-09-04",
};

/** Trang chỉ được coi là phát hành được khi hai ô bắt buộc đã có. */
export function legalIsPublishable(facts: LegalFacts = LEGAL): boolean {
  return facts.operator.trim().length > 0 && facts.contactEmail.trim().length > 0;
}

/** Tên hiện trên trang khi chưa điền — cố tình xấu và dễ thấy, không phải tên nghe như thật. */
export const LEGAL_OPERATOR_PLACEHOLDER = "[CHƯA ĐIỀN TÊN ĐƠN VỊ VẬN HÀNH]";
export const LEGAL_EMAIL_PLACEHOLDER = "[CHƯA ĐIỀN EMAIL HỖ TRỢ]";

export function operatorName(facts: LegalFacts = LEGAL): string {
  return facts.operator.trim() || LEGAL_OPERATOR_PLACEHOLDER;
}

export function contactEmail(facts: LegalFacts = LEGAL): string {
  return facts.contactEmail.trim() || LEGAL_EMAIL_PLACEHOLDER;
}

/**
 * Dữ liệu game THẬT SỰ thu thập, đọc từ schema database chứ không từ trí nhớ.
 * Nguồn: `supabase/migrations/202608120001_player_backend.sql` (players, player_identities,
 * player_sessions), `202609030001_analytics_events.sql`, `202608130002_..._coin_packages.sql`.
 *
 * Danh sách này là thứ trang `/privacy` in ra. Thêm cột chứa dữ liệu người dùng ở database mà quên
 * cập nhật đây = trang riêng tư nói sai sự thật.
 */
export interface DataItem {
  what: string;
  why: string;
  keptFor: string;
}

export const DATA_COLLECTED: readonly DataItem[] = [
  {
    what: "Mã số Telegram, tên hiển thị và @username của bạn",
    why: "Để nhận ra bạn khi quay lại và hiện tên trong trận. Nhận từ Telegram khi bạn mở game — game không hỏi mật khẩu và không bao giờ thấy mật khẩu Telegram của bạn.",
    keptFor: "Cho tới khi bạn xoá tài khoản",
  },
  {
    what: "Tiến độ chơi: cấp đã qua, sao, điểm, năng lượng, coin, vật phẩm",
    why: "Là chính nội dung game của bạn.",
    keptFor: "Cho tới khi bạn xoá tài khoản",
  },
  {
    what: "Lịch sử trận: kết quả, số hạ gục, đất chiếm được",
    why: "Tính điểm, xếp hạng, và phát hiện gian lận.",
    keptFor: "Cho tới khi bạn xoá tài khoản",
  },
  {
    what: "Giao dịch Telegram Stars: số Stars, gói đã mua, mã giao dịch của Telegram",
    why: "Giao hàng đúng gói, xử lý hoàn tiền, và nghĩa vụ kế toán.",
    keptFor: "Theo hạn lưu trữ chứng từ của pháp luật, kể cả sau khi xoá tài khoản",
  },
  {
    what: "Sự kiện sử dụng ẩn danh: mở app, chọn chế độ, bắt đầu/kết thúc trận, các bước hướng dẫn",
    why: "Biết chỗ nào trong game đang khó hoặc hỏng. Gắn với một mã thiết bị ngẫu nhiên, không phải danh tính của bạn.",
    keptFor: `${LEGAL.analyticsRetentionDays} ngày, rồi xoá tự động`,
  },
  {
    what: "Phiên đăng nhập (cookie) và địa chỉ IP trong log máy chủ",
    why: "Giữ bạn đăng nhập và chặn lạm dụng. IP không được ghép vào hồ sơ người chơi.",
    keptFor: "Phiên: tới khi hết hạn hoặc đăng xuất. Log: ngắn hạn cho vận hành.",
  },
];

/** Những thứ game CỐ Ý không làm. Nói rõ cũng quan trọng ngang việc liệt kê thứ có thu thập. */
export const DATA_NOT_COLLECTED: readonly string[] = [
  "Không thu thập vị trí, danh bạ, ảnh, micro hay camera.",
  "Không bán và không cho thuê dữ liệu của bạn.",
  "Không dùng mạng quảng cáo theo dõi xuyên ứng dụng.",
  "Không nhận và không lưu số thẻ ngân hàng — mọi khoản thanh toán do Telegram xử lý.",
  "Sự kiện phân tích được lọc bỏ email, tên hiển thị và token ở cả hai phía trước khi ghi.",
];
