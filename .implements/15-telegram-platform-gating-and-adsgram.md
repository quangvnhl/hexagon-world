# Telegram platform gating và AdsGram

## Phạm vi bắt buộc

Tài liệu này là contract bắt buộc đối với mọi thay đổi dành riêng cho Telegram.
Mục tiêu là bảo đảm web và các platform hiện tại/tương lai không tải hoặc gọi code
Telegram ngoài ý muốn.

## Nguồn xác định platform

Client chỉ được coi là đang chạy trong Telegram Mini App khi đồng thời có:

1. `window.Telegram.WebApp` do Telegram WebApp SDK cung cấp.
2. `Telegram.WebApp.initData` không rỗng và có cấu trúc tối thiểu gồm `auth_date`,
   `user` và `hash`.

Không được dùng riêng lẻ URL, route, hostname, query tự đặt, user-agent,
`initDataUnsafe`, tên người dùng hoặc `player.platform` do client tự truyền để mở
code Telegram-only. Backend vẫn phải xác minh chữ ký `initData` bằng bot token
trước khi cấp session, tài sản hoặc phần thưởng có giá trị.

Điểm kiểm tra chuẩn phía client là `getTelegramWebApp()` trong
`packages/client/src/lib/telegram.ts`. Không tạo lại platform detection rải rác
trong component.

## Ranh giới triển khai

- Telegram/AdsGram SDK phải lazy-load sau khi platform gate thành công.
- Component dùng adapter/hook tập trung; không gọi trực tiếp `window.Adsgram`.
- Khi gate thất bại, thiếu Block ID, SDK lỗi, timeout hoặc không có quảng cáo:
  không làm hỏng hoặc chặn luồng chơi của platform nào.
- Không đưa bot token, AdsGram token/secret hay khóa ký vào `NEXT_PUBLIC_*`.
- Block ID là public identifier và được phép nằm trong `NEXT_PUBLIC_*`.

## Placement AdsGram ban đầu

### Reward — Lobby Random

- Biến: `NEXT_PUBLIC_ADSGRAM_REWARDED_LOBBY_RANDOM_BLOCK_ID`.
- Chỉ hiện nút tự nguyện ở Welcome/Lobby khi platform gate thành công và Block ID
  tồn tại.
- Hiện tại chưa cấu hình Reward URL và chưa có contract phần thưởng backend. Chỉ
  dùng callback hoàn tất phía client để báo trạng thái; không cấp coin, XP, item
  hoặc quyền lợi gameplay.
- Khi bổ sung phần thưởng có giá trị, phải thiết kế endpoint/RPC idempotent và xác
  minh server trước; không được mở rộng trực tiếp từ callback client.

### Interstitial — End Game

- Biến: `NEXT_PUBLIC_ADSGRAM_INTERSTITIAL_END_GAME_BLOCK_ID`.
- Chỉ yêu cầu hiển thị đúng một lần khi một ván đã có người đạt King và ván chuyển
  sang trạng thái kết thúc.
- Không hiển thị ở popup chết, trong thời gian hiệu ứng chết, khi yêu cầu hồi sinh,
  khi chọn khán giả hoặc giữa lúc ván còn diễn ra.
- Lỗi quảng cáo phải fail-open và giữ nguyên màn tổng kết/nút chơi lại.

## Checklist review

Trước khi merge code Telegram-only, reviewer phải xác nhận:

- [ ] SDK không xuất hiện trong network/bundle execution của web ngoài Telegram.
- [ ] Platform gate dùng helper chuẩn và chạy trước việc load/call SDK.
- [ ] Không có nhánh quảng cáo trong death/revive flow.
- [ ] End-game interstitial có guard một lần mỗi ván và điều kiện King.
- [ ] Thiếu env hoặc SDK lỗi không chặn game.
- [ ] Không có secret trong client bundle.

