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

Chỉ webhook `successful_payment` cấp item hoặc cộng coin; trạng thái invoice phía client
không có quyền cấp tài sản. Luồng coin package và checklist đối soát nằm tại
[`18-telegram-stars-coin-packages.md`](18-telegram-stars-coin-packages.md).

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

Với một node đặt ở Đông Nam Á, cấu hình tối thiểu có thể là:

```dotenv
GAME_REGION=sea
GAME_REGION_NAME=Southeast Asia
GAME_PUBLIC_WS_URL=wss://beeking.ws.cukinacha.com/game
GAME_PUBLIC_PING_URL=https://beeking.ws.cukinacha.com/health/ping
```

`GAME_REGION` là mã kỹ thuật và phải khớp giữa region trong control plane,
ticket và game node. `GAME_REGION_NAME` chỉ là tên hiển thị. Với deployment
`SERVER_ROLE=all`, không cần đặt `GAME_REGIONS_JSON`; fallback sẽ dùng bộ bốn
biến `GAME_REGION*`/`GAME_PUBLIC_*` ở trên.

Client web và Telegram Mini App gọi API qua CORS. `CORS_ALLOWED_ORIGINS` phải
chứa **origin của URL Mini App/client**, không phải origin của Telegram và
không kèm path hoặc dấu `/` cuối. Ví dụ:

```dotenv
CORS_ALLOWED_ORIGINS=https://beeking.cukinacha.com
```

Tham khảo `compose.multiregion.example.yaml`. Không chạy file example nguyên trạng trước khi thay domain và secret.

## 6. Kiểm tra phát hành

### 6.1 Gate cấu hình offline bắt buộc

Trước khi build/deploy staging hoặc production, materialize secret vào **các file env tạm,
được Git bỏ qua** và chạy gate cục bộ. Gate không gọi mạng, không đăng ký webhook, không
chạy migration và không in giá trị secret:

```powershell
pnpm release:check -- `
  --target staging `
  --control deploy/control.staging.env `
  --game deploy/game-sg.staging.env
```

Production dùng `--target production`. Có thể truyền `--game` nhiều lần khi một release có
nhiều region. Lệnh phải kết thúc với exit code `0` trước khi pipeline được phép deploy.

Gate kiểm tra:

- `NODE_ENV=production`, role được tách `control`/`game`; từ chối `SERVER_ROLE=all`.
- Secret bắt buộc không rỗng, không còn placeholder và có hình dạng/độ dài tối thiểu.
- Game node không nhận Supabase, Google, Telegram, session, admin hoặc private ticket key.
- URL public dùng `https:`/`wss:`, không còn localhost và có đúng callback/game/health path.
- Mỗi game region có trong `GAME_REGIONS_JSON`, không trùng region trong release set.
- Public ticket key của game khớp private ticket key của control plane.
- `GAME_RESULT_SECRET` khớp giữa control/game và `GAME_PROTOCOL_VERSION` khớp shared/client.

Ed25519 env dùng **Base64 của toàn bộ nội dung PEM**: private key PKCS8 PEM cho control và
public key SPKI PEM cho game. Không dùng Base64 của DER thô vì runtime hiện giải mã Base64
rồi đưa PEM bytes vào `node:crypto`.

Chi tiết vận hành và tích hợp CI/CD: [`21-backend-release-gate.md`](21-backend-release-gate.md).

### 6.2 Smoke test sau deploy

1. `/health/live` trả đúng role/region.
2. `/health/ready` của control báo database `true`.
3. Google callback tạo cookie `hex_session` HttpOnly.
4. Telegram `initData` giả/cũ bị từ chối.
5. Guest nhận ticket nhưng `/v1/me`, shop purchase và inventory trả 401.
6. Ticket sai vùng/hết hạn bị WebSocket đóng mã 4003.
7. Double-click purchase và webhook lặp không cấp item hai lần.
8. Tắt control plane trong một trận, xác nhận result còn trong spool và tự gửi lại sau khi control phục hồi.
