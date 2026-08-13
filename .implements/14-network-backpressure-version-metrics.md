# Backpressure, protocol version và network metrics

## Chính sách gửi

`WS_BACKPRESSURE_BYTES` mặc định là 262.144 byte. Khi `WebSocket.bufferedAmount` đạt ngưỡng này, server:

- Bỏ snapshot mới; snapshot kế tiếp là state đầy đủ nên tự coalesce.
- Bỏ territory delta và **không** cập nhật revision/state đã biết của connection; lần gửi sau tính lại diff từ state cũ nên bao phủ toàn bộ thay đổi bị lỡ.
- Bỏ minimap frame vì đây là dữ liệu nhịp thấp, frame kế tiếp thay thế hoàn toàn.
- Không bỏ control message hoặc territory keyframe phục vụ join/resync.

Ngưỡng thấp giảm RAM/độ trễ của slow client nhưng tăng frame bị drop. Theo dõi trước khi chỉnh.

## Protocol version

Client gửi `protocolVersion` trong JSON `join`. Server đóng socket bằng code `4002` cùng lý do `protocol mismatch client=... server=...` nếu thiếu hoặc không trùng `GAME_PROTOCOL_VERSION`. Bump hằng số `GAME_PROTOCOL_VERSION` trong package shared cho wire change không tương thích và deploy client/server đồng bộ. Biến môi trường server hữu ích cho canary hoặc từ chối client cũ có chủ đích.

## Metrics

`GET /health/network` trả cumulative `frames`, `bytes`, `dropped`, bytes/giây gần nhất theo từng loại frame và số connection đang bị backpressure. Endpoint không chứa dữ liệu người chơi nhưng nên được reverse proxy giới hạn cho mạng vận hành/admin.

Các cảnh báo gợi ý:

- `currentBufferedConnections > 0` kéo dài 30 giây.
- Tỷ lệ `snapshot.dropped / (snapshot.frames + snapshot.dropped)` vượt 5%.
- Territory delta drop tăng liên tục; kiểm tra ping, payload AoI và ngưỡng queue.
