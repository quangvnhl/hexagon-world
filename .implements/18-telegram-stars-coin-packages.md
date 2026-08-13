# Telegram Stars — gói mua coin

## Phạm vi

Triển khai ba gói coin chỉ dành cho tài khoản Telegram Mini App:

| SKU | Coin | Giá Stars |
|---|---:|---:|
| `starter` | 100 | 25 XTR |
| `popular` | 500 | 100 XTR |
| `mega` | 1.200 | 200 XTR |

Giá và lượng coin nằm trong database, không hardcode làm nguồn sự thật ở client.

## Platform gate bắt buộc

Luồng này phải tuân thủ
[`15-telegram-platform-gating-and-adsgram.md`](15-telegram-platform-gating-and-adsgram.md).
Client chỉ render và gọi `openInvoice` khi `getTelegramWebApp()` thành công, đồng thời
session backend đã được server xác định thuộc platform `telegram`. URL, user-agent hoặc
giá trị platform do client tự khai không có quyền mở luồng thanh toán.

## Contract thanh toán

1. Client đọc danh sách gói đang active từ backend.
2. Từ thao tác click của người dùng, client yêu cầu backend tạo coin order và invoice XTR.
3. Order snapshot cả số Stars và số coin, có hạn sử dụng và idempotency key.
4. Webhook `pre_checkout_query` xác minh order, số tiền, hạn dùng và Telegram identity,
   sau đó trả lời Telegram trong giới hạn 10 giây.
5. Chỉ webhook `successful_payment` được gọi RPC nguyên tử để ghi payment transaction,
   tăng ví coin, ghi wallet ledger và chuyển order sang `fulfilled`.
6. `openInvoice` trả `paid` hoặc `pending` chỉ kích hoạt việc đọc lại order để cập nhật UX;
   callback client tuyệt đối không cấp coin.

`telegram_payment_charge_id` và ledger reference phải idempotent. Webhook lặp không được
cộng coin lần hai. Coin thuộc player namespace Telegram hiện tại, không tự động hợp nhất
hoặc chuyển sang tài khoản web/platform khác.

Hạn order được kiểm tra khi tạo invoice và tại `pre_checkout_query`. Nếu Telegram đã gửi
`successful_payment`, backend vẫn phải fulfillment kể cả update đến sau hạn order để tránh
trường hợp người chơi đã bị trừ Stars nhưng không nhận coin.

## API

- `GET /v1/shop/coin-packages`: danh sách gói active.
- `POST /v1/payments/telegram-stars/coin-invoice`: tạo order + invoice link từ `packageId`
  và `idempotencyKey`.
- `GET /v1/payments/orders/:orderId`: chỉ owner của order đọc trạng thái để đồng bộ UX.
- `POST /v1/webhooks/telegram`: nguồn xác nhận payment có thẩm quyền.

## Kiểm thử và phát hành

- Ngoài Telegram không render coin packages và không gọi Telegram API.
- Tài khoản web/guest không tạo được invoice.
- Giá hoặc lượng coin do client giả mạo không ảnh hưởng order.
- Sai Telegram user, sai XTR amount, order hết hạn hoặc inactive package bị từ chối.
- Hai request cùng idempotency key và webhook lặp không tạo quyền lợi trùng.
- Callback giả `paid` không cộng coin; chỉ order `fulfilled` mới refresh số dư.
- Kiểm thử trên Telegram Stars test environment trước production.
- Production phải có HTTPS webhook + secret token, `/terms`, `/paysupport`, đối soát và
  quy trình `refundStarPayment`.
