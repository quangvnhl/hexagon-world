/** Increment when client and game server wire formats are not mutually compatible. */
export const GAME_PROTOCOL_VERSION = 6;

/**
 * doc 35 §C5 — CỬA SỔ TƯƠNG THÍCH: phiên bản protocol CŨ NHẤT mà server còn nhận.
 *
 * ┌─ VÌ SAO CẦN ────────────────────────────────────────────────────────────────────────────────┐
 * │ Trước hằng này, server so BẰNG NHAU tuyệt đối: deploy một bản mới là ngắt kết nối MỌI client │
 * │ đang mở, giữa ván. doc 35 §A8 nói rõ Telegram Mini App KHÔNG ép cập nhật được, nên tại một   │
 * │ thời điểm luôn có nhiều bản client chạy cùng lúc — tức đó không phải trường hợp hiếm, đó là  │
 * │ trạng thái bình thường của mọi lần phát hành.                                                │
 * └─────────────────────────────────────────────────────────────────────────────────────────────┘
 *
 * ┌─ HẰNG NÀY LÀ MỘT LỜI HỨA, KHÔNG PHẢI MỘT PHÉP MÀU ──────────────────────────────────────────┐
 * │ Khai một cửa sổ KHÔNG làm wire format tương thích. Nó chỉ nói "tôi cam kết bản này còn đọc   │
 * │ được các bản từ N trở đi". Kỷ luật đi kèm, và không có ngoại lệ:                             │
 * │                                                                                              │
 * │   • Thay đổi THÊM VÀO (thêm trường tuỳ chọn, thêm loại bản tin mới):                        │
 * │       tăng `GAME_PROTOCOL_VERSION`, GIỮ NGUYÊN `MIN_SUPPORTED_GAME_PROTOCOL`.                │
 * │   • Thay đổi PHÁ VỠ (đổi nghĩa một trường, bỏ trường, đổi bố cục nhị phân):                  │
 * │       tăng cả hai, đặt MIN = phiên bản mới.                                                  │
 * │                                                                                              │
 * │ Đặt MIN thấp hơn mức thật sự đọc được là tệ hơn không có cửa sổ: client cũ sẽ KẾT NỐI ĐƯỢC   │
 * │ rồi giải mã sai, và lỗi hiện ra ở giữa ván dưới dạng vị trí nhảy loạn — chứ không phải một   │
 * │ thông báo "hãy cập nhật".                                                                    │
 * └─────────────────────────────────────────────────────────────────────────────────────────────┘
 *
 * ĐANG BẰNG `GAME_PROTOCOL_VERSION` — cửa sổ rộng đúng một phiên bản, tức hành vi HÔM NAY KHÔNG
 * ĐỔI. Cố ý: tôi chưa kiểm chứng v5 đọc được bởi server v6, và khai một cửa sổ chưa kiểm chứng
 * chính là cái bẫy vừa mô tả ở trên. Cơ chế đã có; lần tăng THÊM VÀO kế tiếp sẽ dùng được ngay.
 */
export const MIN_SUPPORTED_GAME_PROTOCOL = 6;

/** Server có nhận phiên bản này không. Dùng chung để client và server không lệch cách hiểu. */
export function isProtocolSupported(
  version: unknown,
  current: number = GAME_PROTOCOL_VERSION,
  min: number = MIN_SUPPORTED_GAME_PROTOCOL,
): boolean {
  return Number.isInteger(version) && (version as number) >= min && (version as number) <= current;
}

export interface ProtocolJoinMetadata {
  protocolVersion: number;
}
