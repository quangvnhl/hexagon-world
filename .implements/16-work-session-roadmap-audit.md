# Báo cáo cửa sổ làm việc và rà soát roadmap

Ngày chốt: 2026-08-13.

## 1. Phạm vi báo cáo

Tài liệu này tổng hợp các kết quả đã có trong cửa sổ phát triển hiện tại dựa trên code,
tài liệu triển khai, lịch sử Git và kiểm thử chạy lại tại workspace. Trạng thái “đã làm”
nghĩa là đã có hiện thực trong repository; trạng thái production chỉ được công nhận khi có
kiểm chứng trên hạ tầng thật.

## 2. Kết quả đã đạt được

### Gameplay và hiển thị

- Hex grid có độ dày, hiệu ứng nhún, hiệu ứng chết bằng particle cùng màu nhân vật và delay popup.
- Welcome gọn hơn: tab màu/model/đuôi, chọn model GLB, preview 3D và xử lý bố cục mobile.
- Hỗ trợ các model tùy chọn gồm fly, bee và ladybug; màu trail đồng bộ nhân vật, chỉ đổi pattern.
- Đã xử lý joystick/camera mobile, HUD Telegram, minimap nhỏ/chậm hơn và tối ưu tải khi nhiều bot.
- Luật va đầu trên ô trung lập chuyển sang xét cùng `HexKey`, không phụ thuộc collider/khoảng cách;
  mọi người trong cùng ô chết đồng thời và mất đất. Có test cho hai và ba người.
- Đã xử lý vòng đời render multiplayer khi chết/hồi sinh: dọn object cũ và không phát lại particle
  chỉ vì entity xuất hiện lại trong snapshot.
- Minimap/leaderboard/player count đã tách khỏi danh sách entity bị AoI lọc để tránh sai màu, thiếu
  người gần/xa hoặc thừa ghế trống.

### Multiplayer và Pha 3

- Snapshot và territory dùng protocol nhị phân `DataView`.
- `TERRITORY_DELTA` có `baseRevision/revision`, upsert/remove, full keyframe khi join/resync và
  tự fallback full frame nếu delta không còn lợi hơn.
- Entity AoI lọc snapshot theo `ENTITY_AOI_RADIUS`, mặc định 60 world units; luôn giữ self/KING.
- Người chết hiện nhận toàn bộ entity đang tham gia để spectator vẫn hoạt động. Đây là giải pháp
  tương thích tạm thời, chưa phải spectator interest target hoàn chỉnh.
- HUD tổng người chơi lấy roster + bot count, không lấy `snapshot.entities.length`.

### Backend, tài khoản và Pha 4

- Control plane HTTP và game WebSocket dùng chung codebase nhưng có thể deploy riêng bằng
  `SERVER_ROLE=control|game|all`.
- Có Google OAuth cho web, xác minh Telegram `initData`, guest theo thiết bị và phân tách tài khoản
  theo platform.
- Đã có schema/RPC Supabase cho player, session, match history, catalog, price, wallet, inventory,
  loadout, order, Telegram Stars và admin grant coin.
- Đã bổ sung progression: rule XP/level cấu hình trong DB, XP ledger idempotent và `GET /v1/me`.
- Store/Lobby cơ bản, trang bị asset, mua bằng coin và luồng Telegram Stars đã có trong code.
- Telegram Web App SDK, fullscreen/swipe guard/back button/haptic và lớp cô lập AdsGram theo
  platform đã được xây dựng; quảng cáo fail-open cho web.

### Docker, region và kết nối production

- Compose V2, client port 3890 và server port 8910 đã được cấu hình.
- `/v1/regions` hỗ trợ `GAME_REGION`, `GAME_REGION_NAME`, public WebSocket URL và ping URL.
- Với máy chủ Đông Nam Á, cấu hình chuẩn là `GAME_REGION=sea` và
  `GAME_REGION_NAME=Southeast Asia`; ID phải khớp giữa control plane, ticket và game node.
- Đã chẩn đoán lỗi Telegram “Failed to fetch” là CORS production: request không có `Origin` trả
  200 nhưng request/preflight có `Origin` trả 500. Client đã bỏ header JSON không cần thiết cho GET,
  nhưng production vẫn bắt buộc đặt chính xác `CORS_ALLOWED_ORIGINS` và recreate container.

## 3. Kết quả kiểm chứng tại thời điểm chốt

| Kiểm chứng | Kết quả |
|---|---|
| `pnpm test` | Đạt: shared 54, client 31, server 13 |
| `pnpm test:integration` | Đạt |
| `pnpm build` | Đạt: shared, NestJS server, Next.js production |
| `pnpm verify:logic` | Đạt: 93 pass, 0 fail |

Các lỗi `verify:logic` đã được xử lý bằng cách viết lại ca tự-cắt để chạm đoạn đuôi cũ nằm ngoài
`SELF_TRAIL_GRACE`, và so vị trí tường với `WALL_LIMIT` vật lý thay vì inradius dùng render.
Không nới lỏng luật gameplay; cổng logic hiện xanh 93/0.

## 4. Hạng mục còn tồn đọng

### Gate Pha 3 đã hoàn thành

1. Territory AoI theo camera có hysteresis/vùng đệm; minimap dùng keyframe toàn bản đồ riêng khoảng
   200 ms và không phụ thuộc stream render camera.
2. Spectator có interest target. Snapshot absence là despawn authoritative; client xóa interpolation,
   alive baseline và particle state khi entity rời AoI, enter lại như spawn sạch.
3. Backpressure theo `WebSocket.bufferedAmount`, protocol version bắt buộc và metric bytes/giây,
   frame/drop theo loại message tại `/health/network`.
4. Cổng `verify:logic` xanh 93/0.

### Bắt buộc để đóng phần lõi Pha 4

1. Áp migration backend và progression lên Supabase staging, chạy seed và kiểm thử RPC thật.
2. E2E HTTPS production cho Google OAuth, Telegram auth, Stars webhook, session 1 ngày, ghi kết
   quả trận và retention.
3. Hoàn thiện lobby ở mức beta: ready, cancel, reconnect và xử lý mất kết nối.
4. Xác nhận CORS, public region directory, WebSocket ticket/join trên Telegram production.

### Có thể hoãn hoặc bỏ khỏi gate hiện tại

- **FlatBuffers:** hoãn. Protocol hiện đã binary; chỉ chuyển khi metric chỉ ra serialization/GC là
  bottleneck. Chuyển sớm tăng codegen và chi phí tương thích protocol.
- **WebRTC DataChannel:** bỏ qua ở hiện tại. Giữ làm phương án nghiên cứu nếu số đo WebSocket cho
  thấy head-of-line blocking hoặc latency không đạt.
- **Totem:** hoãn sau beta vì là mở rộng gameplay, không chặn độ ổn định multiplayer/backend.
- **Private room/party:** hoãn sau khi ready/cancel/reconnect ổn định.
- **Redis realtime leaderboard/matchmaking:** hoãn khi chỉ chạy một game node; trở thành bắt buộc
  trước horizontal scale nhiều node/vùng.

## 5. Đánh giá chuyển pha

**Pha 3 đã đủ điều kiện đóng và dự án có thể tập trung chính thức vào Pha 4. Chưa đủ điều kiện
chuyển sang Pha 5** vì Pha 4 chưa được chứng minh bằng migration/E2E trên hạ tầng production và
lobby reconnect chưa hoàn thiện.

Có thể bắt đầu công việc Pha 5 dạng chuẩn bị không phụ thuộc (thiết kế metrics, kịch bản load test,
sanity-check đầu vào), nhưng không nên đánh dấu Pha 3/Pha 4 hoàn tất hoặc phát hành production cho
tới khi các gate trên đạt.

## 6. Thứ tự đề xuất

1. Sửa cổng `verify:logic` và phân loại regression va tường.
2. Thêm protocol version, backpressure và bandwidth metrics trước để có baseline.
3. Hoàn thiện spectator/entity lifecycle, sau đó territory camera AoI + minimap keyframe chậm.
4. Deploy Supabase staging, chạy migration/seed và auth/shop/progression E2E.
5. Hoàn thiện reconnect lobby và smoke test Telegram production.
6. Chạy load test; dùng số liệu để quyết định có cần FlatBuffers, Redis hoặc WebRTC hay không.
