# Báo cáo triển khai tiếp Pha 3–4

Ngày cập nhật: 2026-08-13.

## Pha 3 đã triển khai

- `TERRITORY_DELTA` binary giữ `baseRevision/revision`, hỗ trợ upsert/remove.
- Mỗi kết nối giữ cache lãnh thổ riêng. JOIN/resync nhận full keyframe; các nhịp sau nhận delta.
- Client từ chối delta sai revision và gửi `territory_resync` để nhận full keyframe mới.
- Nếu delta lớn hơn full frame, server tự gửi full keyframe.
- Snapshot entity được lọc theo `ENTITY_AOI_RADIUS` (mặc định 60 world units), luôn giữ self và KING.
- Khi self chết, server tạm gửi toàn bộ entity đang tham gia để giữ spectator hoạt động cho tới khi có interest target.
- HUD tính tổng người chơi từ roster + bot count, không dùng số entity đã lọc trong snapshot.

## Pha 4 đã triển khai thêm

- Migration progression riêng, không sửa migration backend gốc.
- Công thức XP cấu hình trong `progression_rules`; level curve cấu hình trong `progression_levels`.
- XP chỉ cấp cho player authenticated, ghi ledger theo event/match và giữ idempotency của match result.
- `GET /v1/me` trả thêm stats và progression.

## Kiểm chứng

- Shared: 49 tests.
- Server: 6 tests.
- Client: 18 tests.
- Typecheck cả ba package và production build phải đạt trước khi phát hành.

## Cập nhật đóng Pha 3

Territory camera AoI/minimap stream, spectator entity lifecycle, backpressure, protocol version và
bandwidth metrics đã hoàn thành. Xem [17-phase-3-completion-report.md](17-phase-3-completion-report.md).

Ưu tiên còn lại thuộc Pha 4: áp migration progression trên Supabase staging và chạy SQL/RPC/auth/
payment E2E thật; hoàn thiện ready/cancel/reconnect. Redis và totem được hoãn theo roadmap.

FlatBuffers và WebRTC vẫn để sau khi đo băng thông thực tế; DataView + delta/AoI hiện đem lại lợi ích trực tiếp hơn.
