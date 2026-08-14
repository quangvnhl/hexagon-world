# Báo cáo sẵn sàng đóng Pha 4

Ngày kiểm chứng: 2026-08-14.

## Kết luận

Phần code trong repository của Pha 4 đã đạt gate tự động. Dự án chưa được đánh dấu hoàn tất
Pha 4 và chưa chuyển chính thức sang Pha 5 vì còn hai gate chỉ có thể xác nhận trên hạ tầng thật:

1. áp migration và seed lên Supabase staging/production;
2. chạy E2E HTTPS production cho Google OAuth, Telegram auth/Stars webhook và match-result.

## Công việc hoàn tất trong đợt chuẩn bị

- Bot online không còn dùng `MAX_PLAYERS`/`ONLINE_BOTS` từ env. Mỗi room nhận capacity
  deterministic trong khoảng 12–16 từ `packages/server/src/config.ts`; test vẫn có override.
- Lobby không tự bắt đầu sau JOIN. Người chơi có thể Sẵn sàng, Hủy sẵn sàng hoặc Rời phòng;
  trận chỉ bắt đầu khi đủ người và toàn bộ người đang kết nối đã ready.
- Socket rớt được tự reconnect theo backoff 0,5/1/2/4/8 giây. Server giữ room, seat và state
  trong grace 30 giây bằng opaque token chỉ lưu trong memory; protocol/ticket/token lỗi không retry.
- Cancel chủ động không reconnect và giải phóng ghế ngay.
- Client có watchdog và server có heartbeat 5 giây để phát hiện socket `OPEN` giả sau khi mất
  mạng; reconnect token được phép thay thế socket cũ đang treo mà không tạo thêm ghế.
- Có release gate offline kiểm tra role split, secret isolation, HTTPS/WSS, OAuth path, region,
  Ed25519 key pair, match-result secret và protocol version mà không gọi mạng hoặc in secret.

## Kết quả kiểm chứng repository

| Gate | Kết quả |
|---|---|
| Shared Vitest | 64/64 |
| Client Vitest | 58/58 |
| Server Vitest/integration | 37/37 |
| Release gate tests | 5/5 |
| Shared logic verification | 93/93 |
| Typecheck toàn workspace | Đạt |
| Production build shared/server/client | Đạt |
| `git diff --check` | Đạt |

Integration server bao phủ việc lobby chưa ready không phát snapshot, ready mới bắt đầu,
resume đúng room/seat trong grace và cancel giải phóng room ngay.

## Hai gate hạ tầng còn lại

### Supabase

- Chạy ba migration trong `supabase/migrations` cùng `supabase/seed.sql` trên staging.
- Xác nhận `/health/ready` báo database true và test RPC catalog/wallet/inventory/progression.
- Sau khi staging đạt mới lặp lại quy trình đã duyệt cho production.

### HTTPS production E2E

- Google callback đúng URI đã đăng ký và tạo cookie session HttpOnly.
- Telegram initData hợp lệ/giả/cũ được phân loại đúng; webhook secret hoạt động.
- Stars webhook lặp không cấp tài sản/coin hai lần.
- Game result được spool khi control plane lỗi và gửi lại đúng một lần khi phục hồi.
- CORS, region directory, WSS `/game`, protocol v5 và reconnect được smoke test qua proxy thật.

Trước deploy, chạy `pnpm release:check` theo
[21-backend-release-gate.md](21-backend-release-gate.md). Gate offline chỉ là điều kiện cần,
không phải bằng chứng rằng migration, DNS/TLS, OAuth console hoặc Telegram webhook đã hoạt động.

## Công việc Pha 5 có thể chuẩn bị song song

- Thiết kế sanity check input và rate limit chống gian lận.
- Chuẩn bị kịch bản load/soak 8 người thật + 16 bot, Radar bật/tắt và reconnect churn.
- Xác định metric/SLO trước khi quyết định Redis, FlatBuffers hoặc WebRTC.

Không đánh dấu các công việc chuẩn bị trên là hoàn tất Pha 5 trước khi hai gate Pha 4 ở trên đạt.
