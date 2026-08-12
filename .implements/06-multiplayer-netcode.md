# 06 — Multiplayer Netcode (thiết kế cho Pha 2+)

> **Trạng thái (Pha 2 — xem [REPORT-pha-2.md](REPORT-pha-2.md)):** ĐÃ có server
> authoritative + `ws` thuần, SNAPSHOT nhị phân (DataView) kèm `ackSeq`, client-side
> prediction/reconciliation + interpolation, và spatial hashing va chạm đầu. **CÒN LẠI cho
> Pha 3:** delta compression theo ô lãnh thổ, area-of-interest, và WebRTC DataChannel.

## Mô hình: Server Authoritative

- Server là **nguồn chân lý**. Client gửi **ý định (input)**, không gửi vị trí.
- Mỗi GameRoom chạy game loop cố định: **tick 20–30 Hz** (33–50 ms).
- Mỗi tick: cập nhật mọi người chơi → kiểm tra va chạm → tạo **snapshot** → broadcast.

## Thông điệp (message types)

Client → Server:
- `JOIN {name, colorIndex, trailPattern, shape}`
- `INPUT {seq, dirIndex}`  // hướng mong muốn (0..5) + số thứ tự để reconcile
- `USE_ITEM {itemId}`
- `PING {t}`

Server → Client:
- `WELCOME {playerId, mapRadius, seed}`
- `SNAPSHOT {tick, ackSeq, selfPrep, kingHold, entities[]}`  // mỗi entity gồm cả
  `colorIndex`, `trailPatternIndex`, `shapeIndex`; tận dụng byte padding nên vẫn 20 byte/entity.
  `kingHold` =
  giây còn phải giữ ngôi KING để thắng (server tính; wire = deciseconds u16) → client
  đếm ngược đồng hồ 3 phút ở HUD (client KHÔNG chạy mô phỏng nên phải nhận số này).
- `EVENT {type: DEATH|KING|WIN, ...}`
- `PONG {t}`

## Snapshot & băng thông

- **Binary** bắt buộc. Ưu tiên đọc/ghi qua `DataView`, sau nâng FlatBuffers.
- Toạ độ hex là số nguyên nhỏ → dùng varint / int16.
- **Delta compression:** chỉ gửi ô thay đổi màu (captured/lost) thay vì toàn map.
- **Area of Interest (AoI):** mỗi client chỉ nhận thực thể trong vùng nhìn quanh mình
  (query qua spatial hash).

## Client-side prediction + interpolation

- **Prediction:** client tự chạy `tick()` cho đầu của mình theo input, không chờ server.
- **Reconciliation:** khi nhận snapshot (có `ackSeq`), tua lại và replay input chưa được
  xác nhận.
- **Interpolation:** thực thể của người khác render trễ ~100 ms và nội suy giữa 2
  snapshot cho mượt.
- **Làm mượt hoà giải (error-offset decay) — chống giật 24Hz:** `predicted` là nguồn
  chân lý vật lý (bị GÁN CỨNG mỗi snapshot). Nhưng đầu người chơi KHÔNG render thẳng
  `predicted`; thay vào đó `Predictor.getRenderHead()` trả `predicted + err`, với `err`
  = độ lệch giữa "đang hiển thị" và "dự đoán mới" được NẠP mỗi lần hoà giải rồi GIẢM
  DẦN theo hằng số thời gian `SMOOTH_TAU` (~0.09s). Nhờ đó các hiệu chỉnh nhỏ mỗi
  snapshot (24Hz) được rải ra nhiều frame 60fps → hết "giật" (đặc biệt khi trượt sát
  tường). Lệch lớn (> `SNAP_DIST`, hoặc hướng > `SNAP_HEADING`) → SNAP ngay (spawn/hồi
  sinh/teleport, không trượt cả sân). Xem `packages/client/src/net/prediction.ts`.
- **Luôn dự đoán mỗi frame khi ĐANG CHƠI:** server đi tiếp mỗi tick theo heading cuối,
  nên client phải `sendInput` (⇒ dự đoán tiến) MỖI FRAME, kể cả khi con trỏ nằm trong
  dead-zone (không có hướng mới) — giữ hướng cuối. Tránh lệch tích luỹ do "bỏ frame dự
  đoán" rồi bị snapshot kéo giật. Lúc CHUẨN BỊ (prep) chỉ `sendAim` (không dự đoán tiến).

## Spatial partitioning (chống O(n²))

- **Spatial hashing:** `bucket = floor(q / B), floor(r / B)` với B ~ 8.
- Va chạm cắt đuôi: với mỗi đầu người chơi, chỉ quét trail trong 9 bucket lân cận.
- Cập nhật bucket khi trail thêm ô mới.

## Transport

1. **Giai đoạn đầu:** `ws` thuần trên TCP — đơn giản, đủ tốt để ra bản chơi được.
2. **Nâng cấp:** **WebRTC DataChannel** cấu hình `ordered:false, maxRetransmits:0`
   (unreliable, UDP-like) cho luồng vị trí → tránh head-of-line blocking. Cần signaling
   (dùng chính `ws`) + STUN/TURN.

## Tick & thời gian
- Server dùng bộ đếm tick cố định; không phụ thuộc `setInterval` trôi — bù thời gian
  bằng accumulator.
- Gửi `serverTick` trong snapshot để client đồng bộ đồng hồ (clock sync qua ping).

## Chống gian lận
- Bỏ mọi input phi lý (đổi hướng quá nhanh, vượt tốc độ).
- Không tin bất kỳ toạ độ nào từ client.
- Rate-limit message; kick khi vi phạm.

## Mở rộng
- Nhiều GameRoom trên nhiều tiến trình/máy; Redis pub/sub cho matchmaking &
  leaderboard; sticky routing người chơi → room.
