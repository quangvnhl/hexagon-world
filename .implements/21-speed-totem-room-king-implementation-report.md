# Báo cáo triển khai Speed, Totem, room và King countdown

Ngày hoàn tất code: 2026-08-14.

## Phạm vi đã hoàn thành

### Gameplay authoritative

- Tốc độ nền nội suy từ `SPEED.BY_KING_PCT.MIN` tới `MAX` theo phần trăm tiến tới ngưỡng King.
- Totem Speed cộng tốc độ theo số Totem đang sở hữu; Totem Slow của đối thủ override tốc độ; Totem Radar cấp quyền xem minimap toàn phòng.
- Totem được sinh deterministic từ match seed, không đè vùng spawn và đổi chủ theo chủ sở hữu ô đất hiện tại.
- Tính toán modifier và số ô sở hữu được cache theo `territoryRevision`, tránh quét toàn bộ lãnh thổ mỗi entity mỗi tick.

### Protocol và client

- Protocol game tăng lên v4; snapshot truyền `effectiveSpeed`, số Totem Speed, Radar và countdown cấp room.
- Scoreboard không còn chứa tọa độ. Server gửi luồng minimap riêng theo từng connection.
- Không Radar: payload và UI minimap chỉ giữ self cùng territory/trail của self. Có Radar: hiển thị toàn bộ entity và territory/trail.
- Client prediction và reconciliation phát lại input bằng đúng tốc độ authoritative của từng input.
- Totem được render theo ba instanced batch; HUD hiển thị tốc độ, Totem Speed, Radar và vùng Slow.

### Room online, bot và kết thúc trận

- Tối đa 8 người thật mỗi room; người thứ 9 hoặc người join khi room bị King lock được chuyển sang room khác.
- Mỗi room chọn deterministic một bot capacity trong `12..16` từ `roomId`; không dùng env `MAX_PLAYERS`/`ONLINE_BOTS` và không còn quota tỷ lệ theo số người thật. Bot vẫn được kích hoạt lần lượt để tránh spike.
- Bot được kích hoạt lần lượt theo interval, không xuất hiện đồng loạt.
- Khi có King, room khóa người mới, bot mới, bot respawn và human revive. King A đổi trực tiếp sang King B không reset countdown.
- Khi không còn King, countdown reset và room mở lại. Chỉ King hoàn thành countdown mới kết thúc trận.
- Sau match end, server dừng input/simulation, report kết quả một lần; client chỉ hiện hành động **Quay về Lobby** và chủ động ngắt kết nối.

## Cấu hình

```env
MAX_ONLINE_PLAYERS=8
ONLINE_BOT_JOIN_INTERVAL_MS=1500
KING_ROOM_DURATION_SECONDS=180
GAME_PROTOCOL_VERSION=4
```

> Cập nhật sau báo cáo: Lobby ready/cancel/reconnect là thay đổi wire không tương thích,
> vì vậy protocol hiện tại đã tăng lên v5. Giá trị v4 phía trên chỉ mô tả lát cắt Totem ban đầu.

Gameplay dùng các giá trị trong `packages/shared/src/config.ts`: `SPEED.BY_KING_PCT` và `TOTEMS`.
Khoảng bot online `12..16` nằm trực tiếp trong `packages/server/src/config.ts`; `welcome.botCount` phản ánh capacity thực tế của room.

## Kiểm chứng tự động

- Shared: 60 test đạt; kiểm chứng logic thủ công 93/93.
- Client: 51 test đạt; typecheck đạt.
- Server: 40 test đạt; typecheck đạt.
- Production build toàn workspace đạt.
- Integration bao phủ privacy Radar, 8+1 client tách room, King admission lock, bot quota/stagger, countdown chuyển King/reset và protocol mismatch.

## Kiểm tra vận hành còn phải thực hiện trước production

Đây là kiểm tra môi trường, không phải phần code còn thiếu:

- Soak test room 8 người thật + 16 bot trên hạ tầng staging.
- Đo FPS/nhiệt trên thiết bị mobile thật với Radar bật/tắt.
- Xác nhận protocol hiện tại được cấu hình đồng nhất trên toàn bộ client/game node và recreate container sau khi đổi env.
- Chạy E2E HTTPS qua proxy production, bao gồm matchmaking nhiều room và quay về Lobby sau match end.

Totem teleport gate chưa nằm trong lát cắt này và tiếp tục được hoãn khỏi gate beta.
