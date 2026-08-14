# Online room, bot quota và King countdown

## Cấu hình

- `MAX_ONLINE_PLAYERS`: mặc định và tối đa 8 người thật, clamp trong `1..8`.
- `MAX_PLAYERS`: số bot mục tiêu cố định mỗi room, clamp trong `12..16`.
- `ONLINE_BOTS`: tên cũ chỉ còn được đọc làm fallback tương thích; deployment mới dùng `MAX_PLAYERS`.
- `ONLINE_BOT_JOIN_INTERVAL_MS`: khoảng cách kích hoạt bot, mặc định 1.500 ms.
- `KING_ROOM_DURATION_SECONDS`: deadline cấp room, mặc định 180 giây.

Bot capacity được tạo sẵn nhưng park. Khi room bắt đầu, server kích hoạt lần lượt cho tới đúng `MAX_PLAYERS`, mỗi interval chỉ kích hoạt tối đa một bot để tránh spike. Số bot không còn tăng/giảm theo số người thật trong room.

## Admission và nhiều room

Game node tìm room chưa kết thúc, chưa có King countdown và còn ghế. Room đầy hoặc bị khóa không trả lỗi `4001`; join được chuyển sang room phù hợp khác hoặc tạo room mới lazy. Room đang chơi vẫn nhận late join nếu còn ghế và chưa khóa.

## King deadline

`GameRoom` sở hữu timer online riêng và tiếp tục xuất nó qua trường snapshot `kingHold` hiện có:

- King đầu tiên bắt đầu countdown và khóa admission/revive/bot activation.
- King A chuyển thẳng sang King B giữ nguyên thời gian.
- King biến mất hoàn toàn hủy countdown, reset toàn bộ thời lượng và mở admission.
- Chỉ King hiện tại khi countdown về 0 mới được `declareWinner`; không còn thắng sớm vì population.

`GameState` dùng chung vẫn giữ rule single-player cũ. Wrapper online chủ động vô hiệu hóa kết quả sớm/holder timer sau mỗi tick, nên không cần thay shared protocol/state trong lát cắt này.

## Vận hành

Sau khi chỉnh biến môi trường phải recreate game container. Theo dõi nhiệt/CPU trước khi tăng `MAX_PLAYERS`; bot được stagger để tránh spike spawn nhưng tổng simulation cost vẫn tăng theo số bot active.

## King sống cuối cùng

Nếu KING là thực thể còn sống duy nhất và room đã có ít nhất hai thực thể tham gia, server công nhận thắng ngay. Các đối thủ đã chết không thể hồi sinh trong lúc room bị KING khóa nên chờ hết countdown không thể làm thay đổi kết quả. Các trường hợp còn từ hai thực thể sống trở lên vẫn dùng countdown cấp room như cũ.
