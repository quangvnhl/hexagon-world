# Runbook triển khai player backend

## 1. Áp database

Không sửa schema production trực tiếp trên Dashboard. Dùng connection string **Supavisor Session pooler** nếu máy triển khai không có IPv6:

```powershell
npx supabase@latest db push --db-url "$env:SUPABASE_DB_URL" --include-seed
```

Migration: `supabase/migrations/202608120001_player_backend.sql`. Seed chỉ tạo catalog, không đặt giá. Sau khi server control khởi động, ba biến `DEFAULT_FREE_*_ASSET_KEY` được đồng bộ vào catalog.

## 2. Google OAuth

Trong Google Cloud Console tạo OAuth Client loại Web application:

- Authorized JavaScript origin: URL client.
- Authorized redirect URI: giá trị chính xác của `GOOGLE_OAUTH_REDIRECT_URI`.
- Production bắt buộc HTTPS.

Client bắt đầu login tại `/v1/auth/web/google/start`; không chứa Google Client Secret.

## 3. Telegram

Đăng ký webhook cùng secret trong `.env`:

```text
POST https://api.telegram.org/bot<BOT_TOKEN>/setWebhook
url=https://api.example.com/v1/webhooks/telegram
secret_token=<TELEGRAM_WEBHOOK_SECRET>
```

Chỉ webhook `successful_payment` cấp item; trạng thái invoice phía client không có quyền cấp tài sản.

## 4. Admin coin và retention

Tạo admin token ngẫu nhiên, lưu SHA-256 vào `ADMIN_API_KEY_SHA256`. Gửi token thật trong header `x-admin-key`. Không cập nhật `player_wallets` trực tiếp.

- `POST /internal/v1/admin/players/:id/grant-coin`
- `POST /internal/v1/admin/retention/matches`
- `DELETE /internal/v1/admin/players/:id` (soft-delete + revoke session)

Chạy retention hằng ngày từ scheduler/cron bên ngoài. Match cũ hơn 30 ngày được xóa theo cascade.

## 5. Multi-region

- Control plane giữ Supabase, Google, Telegram và private ticket key.
- Game node chỉ giữ public ticket key và `GAME_RESULT_SECRET`.
- Mỗi game node cần volume bền vững tại `GAME_RESULT_SPOOL_DIR`.
- Cập nhật `GAME_REGIONS_JSON` trên control plane khi thêm/bớt vùng.
- Reverse proxy phải chuyển WebSocket path `/game` và endpoint `/health/ping`.

Tham khảo `compose.multiregion.example.yaml`. Không chạy file example nguyên trạng trước khi thay domain và secret.

## 6. Kiểm tra phát hành

1. `/health/live` trả đúng role/region.
2. `/health/ready` của control báo database `true`.
3. Google callback tạo cookie `hex_session` HttpOnly.
4. Telegram `initData` giả/cũ bị từ chối.
5. Guest nhận ticket nhưng `/v1/me`, shop purchase và inventory trả 401.
6. Ticket sai vùng/hết hạn bị WebSocket đóng mã 4003.
7. Double-click purchase và webhook lặp không cấp item hai lần.
8. Tắt control plane trong một trận, xác nhận result còn trong spool và tự gửi lại sau khi control phục hồi.
