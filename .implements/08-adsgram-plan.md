# Kế hoạch tích hợp AdsGram cho Hexagon World

## Mục tiêu và nguyên tắc UX

- Chỉ tải AdsGram khi ứng dụng thật sự chạy trong Telegram Mini App theo contract
  [15-telegram-platform-gating-and-adsgram.md](15-telegram-platform-gating-and-adsgram.md)
  và placement tương ứng đã có Block ID.
- Không hiện quảng cáo giữa lúc người chơi đang điều khiển, trong 2 giây hiệu ứng chết, hoặc khi trận online còn đang diễn ra.
- Không biến quảng cáo thành lợi thế pay-to-win trong chế độ Nhiều người.
- Mọi lỗi tải/hiển thị quảng cáo phải fail-open: đóng trạng thái loading và cho người chơi tiếp tục bình thường.

## Vị trí quảng cáo đề xuất

### Giai đoạn 1 — Rewarded (ưu tiên)

Thêm nút tự nguyện `Xem quảng cáo nhận thưởng` ở popup sau khi chết, chỉ sau khi popup đã hiện. Phần thưởng nên là vật phẩm ngoài trận (coin, skin trial hoặc điểm cosmetic), không hồi sinh đặc quyền trong trận online. Nếu muốn thử hồi sinh có thưởng, chỉ áp dụng Chơi đơn và giới hạn một lần mỗi ván.

### Giai đoạn 2 — Interstitial

Chỉ hiện tại điểm ngắt tự nhiên: sau màn tổng kết thắng/thua hoặc khi người chơi chủ động quay về Welcome. Giới hạn tối thiểu 3–5 phút giữa hai lần hiển thị và không hiện trong phiên đầu tiên. Không gắn interstitial trực tiếp vào nút Back của Telegram vì sẽ khiến thao tác thoát có cảm giác bị giữ lại.

### Giai đoạn 3 — Task/native

Có thể đặt trong Welcome dưới dạng mục `Nhiệm vụ nhận thưởng`; không đặt đè lên Canvas, joystick, minimap hay HUD.

## Kiến trúc triển khai

1. Đăng ký publisher/platform và tạo riêng Block ID cho Rewarded, Interstitial và Task trong AdsGram Partner.
2. Dùng hai biến placement ban đầu:
   `NEXT_PUBLIC_ADSGRAM_REWARDED_LOBBY_RANDOM_BLOCK_ID` và
   `NEXT_PUBLIC_ADSGRAM_INTERSTITIAL_END_GAME_BLOCK_ID`; không hardcode ID trong component.
3. Tạo `src/lib/adsgram.ts` làm adapter duy nhất: lazy-load SDK, khởi tạo controller một lần, chống gọi `show()` đồng thời, timeout và chuẩn hóa kết quả.
4. Tạo `AdProvider`/hook ở cấp `app/page.tsx`; UI chỉ gửi intent (`showRewarded`, `showInterstitial`) và không truy cập `window.Adsgram` trực tiếp.
5. Thêm state machine `idle → loading → showing → rewarded/closed/error`, khóa joystick/input khi quảng cáo đang phủ màn hình và tự mở khóa ở `finally`.
6. Ghi analytics tối thiểu: `ad_requested`, `ad_started`, `ad_rewarded`, `ad_skipped`, `ad_error`, kèm format, placement, session và thời gian từ lần xem trước.

## Bảo mật phần thưởng

- Backend phải xác thực `Telegram.WebApp.initData` bằng bot token; không tin `initDataUnsafe` hoặc Telegram ID do client tự gửi.
- Phần thưởng có giá trị phải được cấp ở server với khóa idempotency để tránh nhận lặp khi refresh/retry.
- Khi quy mô đủ lớn, cấu hình Reward URL/server callback của AdsGram và đối soát sự kiện client với callback server.
- Không đưa bot token, AdsGram secret hoặc khóa ký vào biến `NEXT_PUBLIC_*`.

## Kiểm thử và phát hành

- Dùng Block ID test trước; kiểm tra Telegram Android, iOS và Desktop, cả mạng chậm/mất mạng.
- Kiểm tra các nhánh: đóng quảng cáo, xem hết, SDK không tải, không có inventory, app background/foreground và double tap.
- Rollout theo feature flag 5% → 25% → 100%; theo dõi retention, thời lượng phiên, lỗi SDK, FPS/nhiệt và doanh thu trên mỗi người dùng.
- Chỉ tăng tần suất sau khi retention và tỷ lệ thoát tại placement ổn định.

## Trạng thái triển khai ban đầu

- Reward Lobby Random và Interstitial End Game đã có contract placement.
- Reward URL chưa có; callback client không được cấp coin/XP/item.
- Interstitial chỉ chạy sau end-game có KING, không chạy ở death/revive.
- Trước khi cấp reward có giá trị vẫn cần quyết định phần thưởng, Reward URL hoặc
  endpoint xác minh tương ứng và cơ chế idempotent backend.
