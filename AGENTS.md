# Quy tắc bắt buộc cho code theo nền tảng

Mọi agent làm việc trong repository này phải đọc và tuân thủ
`.implements/15-telegram-platform-gating-and-adsgram.md` trước khi thêm hoặc sửa
bất kỳ tính năng dành riêng cho Telegram.

Các yêu cầu tối thiểu:

- Không suy luận Telegram từ URL, route, user-agent, hostname, tên tài khoản hoặc
  một cờ do client tự truyền.
- Trước khi tải SDK hay gọi API Telegram/AdsGram, phải xác nhận
  `window.Telegram.WebApp` tồn tại và `initData` có đủ dữ liệu Telegram Mini App.
- Mọi SDK Telegram-only phải được lazy-load sau khi platform gate thành công.
- Web và các platform khác phải tiếp tục hoạt động nếu Telegram/AdsGram không tồn
  tại hoặc bị lỗi (fail-open).
- Logic cấp tài sản/phần thưởng có giá trị phải được backend xác minh; không tin
  `initDataUnsafe`, Telegram ID hoặc kết quả quảng cáo do client tự khai.

