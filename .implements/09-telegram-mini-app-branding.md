# Thiết lập nền và loading screen Telegram Mini App

## Màu đã dùng trong ứng dụng

- Background, Telegram header và bottom bar: `#0a0e16`
- Accent xanh: `#31b0ff`
- Accent vàng: `#ffd23f`
- Chữ sáng: `#e8eefc`

Runtime SDK đã gọi `setHeaderColor`, `setBackgroundColor` và `setBottomBarColor` trong `packages/client/src/lib/telegram.ts`.

## Loading screen native của Telegram

Loading screen xuất hiện trước khi web app tải do Telegram quản lý, nên không thể upload bằng code trong repository. File chuẩn bị sẵn để upload là:

`packages/client/public/telegram-loading.svg`

Trong Telegram mở:

1. `@BotFather` → `/mybots`.
2. Chọn bot của game.
3. `Bot Settings` → `Configure Mini App` → `Enable Mini App`.
4. Mở phần cấu hình loading/splash screen.
5. Upload `telegram-loading.svg`.
6. Đặt màu nền cho cả Light và Dark là `#0a0e16`.

`app/loading.tsx` dùng cùng logo và màu làm loading fallback sau khi HTML/Next.js đã bắt đầu chạy.
