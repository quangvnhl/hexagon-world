# 00 — Game Design

## Tên tạm: Hexagon World

Thể loại: chiến thuật / hành động casual .io — chiếm lãnh thổ trên lưới lục giác.
Tham chiếu: hexanaut.io, paper.io, splix.io.

## Mục tiêu tối thượng

- Chiếm **≥ 20% diện tích bản đồ** → trở thành **King**.
- Giữ được ngôi King liên tục trong **3 phút** → thắng chung cuộc.
- Nếu tụt xuống dưới 20% → mất ngôi, đồng hồ King reset.

## Cơ chế lõi

### 1. Lãnh thổ & mở rộng
- Người chơi khởi đầu với một cụm ô lục giác nhỏ (vùng an toàn).
- Khi di chuyển **ra ngoài** vùng của mình, nhân vật để lại **đuôi (trail)** —
  một chuỗi ô/đường sáng.
- Khi đường đi **khép kín** trở lại lãnh thổ cũ: mọi ô nằm **bên trong** vòng vừa
  vẽ (kể cả các ô của đuôi) sẽ đổi màu và thuộc về người chơi.
- Thuật toán xác định "ô bên trong": flood fill từ biên ngoài (xem
  [03-hex-math.md](03-hex-math.md) và `floodfill`).

### 2. An toàn
- Khi đang **đứng trong vùng của mình**, người chơi bất khả xâm phạm (không có đuôi,
  không thể bị cắt).

### 3. Tiêu diệt & bị tiêu diệt
- Đang ở ngoài (đang có đuôi) mà **đuôi bị cắt** (đối thủ hoặc chính mình đi qua một
  ô thuộc đuôi) → **chết**, mất toàn bộ đuôi và **mất lãnh thổ** (reset về cụm nhỏ).
- **Không được tự đâm vào đuôi của mình.** (MVP: chặn quay đầu 180° để tránh chết oan;
  đâm vào đoạn đuôi cũ vẫn = chết.)

## Totem & vật phẩm (giai đoạn sau MVP)

| Vật phẩm | Hiệu ứng |
|----------|----------|
| Cổng dịch chuyển (Teleport gate) | Dịch chuyển tức thời về sát rìa vùng an toàn khi nguy hiểm |
| Totem làm chậm (Slow totem) | Đặt trong vùng của mình → tạo aura làm chậm đối thủ đi vào |
| Tháp do thám (Spy Radar) | Mở rộng tầm nhìn trên minimap |

## Điều khiển

- **Web (PC):** chuột điều hướng — hướng di chuyển = hướng từ nhân vật tới con trỏ.
- **Mobile:** joystick ảo + nút kỹ năng dùng vật phẩm.

## Phạm vi MVP (bản này)

Chỉ single-player, local, **không** multiplayer/bot:
1. Lưới lục giác render bằng WebGL (Three.js/R3F), camera top-down.
2. Nhân vật là **cube 3D** di chuyển **liên tục** (pixel), tự tiến về phía con trỏ,
   xoay đầu theo hướng đi.
3. Ra ngoài vùng → hiện **đuôi** là đường **line mượt** (đường đi liên tục nội suy
   thành chuỗi hex liền mạch để tính chiếm đất).
4. Khép vòng về lãnh thổ → **flood fill** chiếm các ô bên trong.
5. Tự cắt đuôi → chết & reset.
6. HUD: % diện tích đã chiếm, trạng thái King khi ≥ 20%.

DoD của MVP: người chơi đi ra ngoài, vẽ một vòng, quay về và thấy toàn bộ vùng bên
trong đổi sang màu của mình; %-diện tích cập nhật đúng.
