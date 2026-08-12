# Báo cáo triển khai player backend

Ngày triển khai: 2026-08-12

## Đã hoàn thành

- NestJS HTTP control plane và WebSocket game server dùng chung codebase nhưng tách bằng `SERVER_ROLE=control|game|all`.
- Google OAuth 2.0 authorization-code flow trực tiếp qua control plane; session game opaque 1 ngày, cookie HttpOnly.
- Xác minh Telegram Mini App `initData` server-side và tài khoản Telegram tách khỏi web.
- Regional directory, đo RTT client, ticket ngắn hạn ký Ed25519 ở production/HMAC local, game node xác minh offline.
- Guest theo thiết bị được chơi nhưng không có tài khoản, ví, inventory hoặc API backend.
- Supabase migration cho player, identity, session, profile, stats, match, catalog, price, wallet ledger, inventory, loadout, order và Telegram payment.
- PostgreSQL RPC nguyên tử cho tạo tài khoản/default assets, admin grant, mua coin, Stars fulfillment, giá shop, kết quả trận và retention.
- Shop trên Welcome: catalog, balance, inventory, mua coin, Telegram Stars và trang bị item.
- Một item mặc định miễn phí cho mỗi nhóm color/shape/trail, chọn bằng env/admin API.
- Telegram Stars chỉ cấp item từ webhook `successful_payment`, unique charge ID chống cấp trùng.
- Kết quả trận từ game region có HMAC, idempotency và file spool bền vững qua container restart.
- Retention lịch sử trận tự chạy mỗi 24 giờ với mặc định 30 ngày.
- Admin API: cấp coin có audit, cấu hình giá/default item, retention và soft-delete account.
- Docker local role `all` và compose example tách control/game Singapore.
- Bảo vệ file `.env` và Google `client_secret_*.json` khỏi Git.

## Xác minh đã chạy

- Shared/server/client TypeScript typecheck: đạt.
- Server tests: 4/4 đạt, gồm WebSocket integration, regional ticket và Telegram signature.
- Client tests: 15/15 đạt.
- Production build toàn monorepo: đạt.
- HTTP `/health/live`: đạt.
- WebSocket `/game` ping/pong: đạt.
- Guest ticket → authenticated WebSocket join: đạt.
- YAML parse `compose.yaml` và `compose.multiregion.example.yaml`: đạt.

## Chưa hoàn tất do hạ tầng ngoài code

Migration chưa được áp lên Supabase. `SUPABASE_DB_URL` hiện trỏ tới hostname direct `db.<project>.supabase.co` và môi trường triển khai trả `ENOTFOUND`. Hãy lấy connection string **Supavisor Session pooler** trong Dashboard, cập nhật `SUPABASE_DB_URL`, rồi chạy:

```powershell
$line = Get-Content .env | Where-Object { $_ -like 'SUPABASE_DB_URL=*' } | Select-Object -First 1
$dbUrl = $line.Substring('SUPABASE_DB_URL='.Length)
npx supabase@latest db push --db-url $dbUrl --include-seed
```

Các khóa production tách vùng còn cần thay placeholder: admin key hash, game result secret và Ed25519 regional keypair. Local `SERVER_ROLE=all` hoạt động bằng fallback an toàn; role production tách riêng sẽ fail-fast nếu thiếu key.

Webhook Telegram chưa thể đăng ký khi chưa có URL HTTPS public của control plane. Google OAuth production cũng cần redirect URI public khớp tuyệt đối Google Cloud Console.
