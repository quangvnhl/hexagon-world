# Báo cáo hoàn thành Pha 3 — Tối ưu mạng

Ngày đóng pha: 2026-08-13.

## Kết luận

Pha 3 đã hoàn thành các gate bắt buộc và đủ điều kiện chuyển trọng tâm phát triển sang Pha 4.
Protocol vẫn dùng binary `DataView`; FlatBuffers và WebRTC được hoãn có chủ đích cho tới khi metric
production chứng minh cần thiết.

## Territory delta, AoI và minimap

- Territory có full keyframe khi join/resync và delta theo revision cho từng connection.
- Scene 3D chỉ nhận territory quanh camera/focus, mặc định bán kính 48 world units và hysteresis 10.
- Client chỉ gửi focus mới khi camera dịch ít nhất 6 units và cách lần gửi trước ít nhất 150 ms.
- Minimap nhận full-map frame riêng (`TERRITORY_MINIMAP`, tag 105) mỗi 5 tick, khoảng 208 ms ở 24 Hz.
- Delta bị drop do backpressure không làm tiến revision; lần sau server tính lại từ state đã xác nhận.

## Entity và spectator lifecycle

- Entity snapshot được lọc quanh self hoặc spectator target, luôn giữ self và KING.
- Người chết mặc định bám leader và có thể chuyển target bằng nút Trước/Sau; revive trả focus về self.
- Snapshot là tập authoritative của AoI. Entity vắng ở snapshot mới được coi là despawn, xóa khỏi
  toàn bộ interpolation buffer và alive/effect baseline.
- Entity enter lại được dựng như spawn mới, không kéo vị trí cũ và không phát particle cho cái chết
  xảy ra ngoài AoI.
- Disconnect/reconnect xóa snapshot, roster, world UI và territory cũ để không còn ghost object.

## Backpressure, version và quan sát mạng

- Join bắt buộc mang `GAME_PROTOCOL_VERSION`; mismatch bị đóng bằng WebSocket code 4002 trước khi
  server cấp ghế hoặc tạo phòng.
- Khi `bufferedAmount >= WS_BACKPRESSURE_BYTES`, snapshot, territory delta và minimap có thể bị bỏ;
  control frame và territory keyframe không bị bỏ.
- `/health/network` trả frames, bytes, dropped frames, bytes/giây theo message type và số connection
  đang bị backpressure. Production nên đặt endpoint này sau admin/proxy ACL.
- Cấu hình triển khai: `ENTITY_AOI_RADIUS`, `TERRITORY_AOI_RADIUS`,
  `TERRITORY_AOI_HYSTERESIS`, `WS_BACKPRESSURE_BYTES`, `GAME_PROTOCOL_VERSION`.

## Kiểm chứng đóng pha

| Cổng | Kết quả |
|---|---|
| Shared Vitest | 54/54 |
| Client Vitest | 31/31 |
| Server Vitest/integration | 13/13 |
| Shared logic verification | 93/93 |
| Typecheck toàn workspace | Đạt |
| Production build shared/server/client | Đạt |
| Runtime smoke test | Đạt: `/health/live` và `/health/network`, role `all`, region `sea` |

Các test mới bao phủ protocol minimap, territory AoI/hysteresis, camera-interest throttling,
protocol mismatch, slow client/backpressure metrics, spectator target/respawn, entity enter/leave
AoI và interpolation remove/re-enter.

## Quyết định kỹ thuật

- **FlatBuffers:** chưa triển khai. `DataView` đã binary và delta/AoI giảm tải trực tiếp hơn; chỉ đổi
  khi metric cho thấy serialization/GC là bottleneck.
- **WebRTC DataChannel:** chưa triển khai. Chỉ xem lại nếu số liệu production cho thấy WebSocket
  head-of-line blocking hoặc latency không đạt yêu cầu.
- **Tombstone frame riêng:** chưa cần. Authoritative snapshot absence cùng cleanup interpolation/effect
  là semantics despawn đã được định nghĩa và kiểm thử.

## Việc chuyển sang Pha 4

Ưu tiên tiếp theo là áp migration/seed Supabase trên staging, chạy OAuth/Telegram Stars/match-result
E2E HTTPS, rồi hoàn thiện ready/cancel/reconnect của lobby. Redis, party/private room và totem không
chặn beta hiện tại theo quyết định trong roadmap.

## Hồi quy đã phát hiện sau khi đóng pha

Territory AoI làm `GameState.owned` phía client chỉ còn là số ô đang render quanh camera, nhưng HUD
cá nhân, camera zoom và hiệu ứng chiếm đất ban đầu vẫn dùng `owned.size` như tổng điểm. Khi camera
đổi vùng AoI, phần trăm nhảy và spark xuất hiện dù server không ghi nhận lần chiếm đất mới.

Đã sửa bằng cách dùng `world_ui.score` authoritative cho HUD, King và particle capture; snapshot
self score là fallback trước frame `world_ui` đầu tiên. Online Effects chờ baseline authoritative,
không suy diễn điểm từ territory AoI. Có regression test xác nhận thay đổi số ô render 8 → 17 → 2
vẫn giữ score server 42; client hiện đạt 34 test và production build xanh.
