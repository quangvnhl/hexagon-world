# 00 — Game Design

## Tên tạm: Hexagon World

Thể loại: chiến thuật / hành động casual .io — chiếm lãnh thổ trên lưới lục giác.
Tham chiếu: hexanaut.io, paper.io, splix.io.

## Mục tiêu tối thượng

- Chiếm **≥ 20% diện tích bản đồ** → trở thành **King**.
- Giữ được ngôi King liên tục trong **3 phút** → thắng chung cuộc.
- Nếu tụt xuống dưới 20% → mất ngôi, đồng hồ King reset.
- **Thắng do đấu loại:** khi phòng đã có King mà **chỉ còn 1 thực thể sống** → người đó
  thắng **ngay** (không cần chờ hết giờ). `GameState.winnerId` cho biết ai thắng.

## Cơ chế lõi

### 1. Lãnh thổ & mở rộng
- Người chơi **spawn tại một ô ngẫu nhiên chưa bị chiếm**; ô đó + 6 ô kề (tổng **7
  ô**) mặc định thuộc về người chơi (vùng an toàn khởi đầu). Điểm spawn phải **cách mọi
  lãnh thổ đã chiếm ≥ `CONFIG.SPAWN_CLEARANCE`** (cube distance) — **tuân thủ tuyệt đối,
  không nới lỏng** và không đè lên ô đất đã có. **Nếu không còn vị trí hợp lệ → KHÔNG cho
  hồi sinh** (popup báo "bản đồ đã đủ ô đất, chưa có chỗ"); chỉ hồi sinh lại khi đã có ô
  trống hợp lệ.
- **3 giây chuẩn bị** khi vào trận / hồi sinh: nhân vật đứng yên, người chơi chỉ
  xoay hướng để chọn hướng xuất phát; hết giờ mới bắt đầu di chuyển.
- Khi di chuyển **ra ngoài** vùng của mình, nhân vật để lại **đuôi (trail)** —
  một chuỗi ô/đường sáng. **Đường sáng bắt đầu ngay tại vị trí đầu nhân vật khi vừa
  bước vào ô trung lập ĐẦU TIÊN** (bắt đầu "bình thường", KHÔNG kéo về tâm ô) — điểm
  neo vẫn nằm TRONG ô trung lập đầu tiên nên không thò ngược vào lãnh thổ. (Chỉ khi
  một bước nhảy qua nhiều ô cùng lúc mới lùi về tâm ô trung lập đầu để bảo toàn ràng
  buộc này.)
- Khi đường đi **khép kín** trở lại lãnh thổ cũ: mọi ô nằm **bên trong** vòng vừa
  vẽ (kể cả các ô của đuôi) sẽ đổi màu và thuộc về người chơi.
- Thuật toán xác định "ô bên trong": flood fill từ biên ngoài (xem
  [03-hex-math.md](03-hex-math.md) và `floodfill`).

### 2. An toàn
- Khi đang **đứng trong vùng của mình**, người chơi bất khả xâm phạm (không có đuôi,
  không thể bị cắt).
- **Va chạm tường (move-then-clamp):** mỗi frame đầu dịch theo hướng đang nhìn rồi
  `clampInside` kéo điểm đích về trong lục giác lồi. Nhờ vậy đầu **tự trượt dọc tường**
  và **dừng hẳn ở góc**, KHÔNG bao giờ sinh vận tốc lùi → hết lỗi húc thẳng vào
  tường/góc bị đẩy ngược vào ô đuôi của mình rồi **chết oan "tự đâm đuôi"**.

### 2z. Gỡ lỗi va chạm tường (DEBUG)
- `CONFIG.DEBUG.COLLISION_VECTORS` = true → `CollisionDebug` vẽ **vector vật lý** ngay
  tại đầu người chơi để thấy vì sao chết khi đi lướt sát biên: **xanh dương** = hướng
  đi mong muốn, **đỏ** = pháp tuyến (các) tường đang áp sát, **xanh lá** = hướng trượt
  kết quả. HUD hiện chú thích màu. Đặt `false` để tắt hoàn toàn (component không mount).
- Cùng cờ đó, `ArenaCollider` vẽ **BIÊN VA CHẠM thật dạng stroke vector**: đường viền
  lục giác nối 6 đỉnh collider (bán kính ngoại tiếp `ARENA_R`) + mũi tên **pháp tuyến 6
  tường** (tại `ARENA_INRADIUS`) hướng ra ngoài. Đây chính là ranh giới mà `clampInside`
  giữ đầu ở trong (KHÁC với `BorderRim` chỉ là hình hiển thị) → nhìn ra ngay nơi đầu bị
  chặn/trượt. Dùng chung cho cả chơi đơn (`game.human`) và online (ghế người cục bộ qua
  prop `entityId` của `CollisionDebug`).
- `CollisionDebug` còn vẽ **COLLIDER của cube người chơi dạng stroke vector**: viền hình
  VUÔNG footprint (cạnh `CUBE_SIZE`, xoay theo heading, màu lam) + vòng tròn **bán kính
  va chạm đầu** `KILL_RADIUS` (màu vàng) — vùng phân xử va đầu (chủ đất hạ kẻ xâm nhập /
  đâm đầu ngoài sân).

### 2a. Hiển thị lãnh thổ
- Ô trung lập vẫn render dạng **lưới lục giác** (mỗi ô = 1 instance, scale 0.92 để lộ
  khe = vạch cell).
- Vì số thực thể (tới 21) > số màu (6) nên **hai người trùng màu** có thể giáp nhau và
  nhìn như một khối. Ở **cạnh chung giữa hai ô cùng màu nhưng khác chủ**, vẽ một **vạch
  vàng dày, phát sáng** (`TerritoryBorders`, quad + additive blending; chỉnh bề rộng/độ
  sáng ở `CONFIG.BORDER`) để phân tách.
- **Minimap phân biệt rõ ta/địch:** ô đất **đối thủ vẽ MỜ** (alpha thấp), ô đất
  **người chơi vẽ ĐÈ LÊN, đậm và hơi to hơn** → lãnh thổ mình luôn nổi bật.
- **Minimap không khung:** bỏ nhãn "BẢN ĐỒ" và khung viền hộp; minimap được **cắt theo
  hình lục giác của sân** (chỉ còn nền + viền lục giác mảnh), không phải hộp chữ nhật.

### 2b. Bots (đối kháng — đã có ở bản này)
- Sân sinh thêm **N bot** (`CONFIG.BOT_COUNT`), mỗi bot là một thực thể như người
  chơi (có lãnh thổ, đuôi, chết/hồi sinh). Bot AI theo **FSM 4 trạng thái**
  (`EXPAND` bành trướng · `RETURN` về khép vòng · `HUNT` chủ động cắt đuôi đối thủ ·
  `FLEE` rút lui khi bị áp sát), có **né đuôi mình + né tường**, và **độ khó tham số
  hoá** (`CONFIG.BOT_DIFFICULTY`: aggression/vision/skill/reaction — gán luân phiên
  cho từng bot).
- Chiếm đất bằng flood fill sẽ **cướp cả ô của đối thủ** nằm trong vòng vừa khép.
- Bot chết sẽ **tự hồi sinh** sau `CONFIG.BOT.RESPAWN_DELAY` giây; người chơi hồi
  sinh thủ công qua popup.

### 2c. Khoá phòng khi có KING
- Khi **đã có KING** (một thực thể còn sống đạt ≥ `KING_PCT`), **phòng bị KHOÁ**: bot chết
  **không tự hồi sinh** và người chơi **không bấm Hồi sinh được** (`GameState.roomLocked()`).
  Những ai còn sống trong phòng phải **đối kháng với nhau**.
- Khi **hết KING** (King bị mất ngôi do tụt dưới ngưỡng hoặc bị hạ), **phòng mở lại** →
  cho hồi sinh/tham gia như thường.

### 3. Tiêu diệt & bị tiêu diệt
- Đang ở ngoài (đang có đuôi) mà **đuôi bị cắt** (đối thủ hoặc chính mình đi qua một
  ô thuộc đuôi) → **chết**, mất toàn bộ đuôi và **toàn bộ lãnh thổ**. Hiện **popup
  "Bạn đã chết"** với 2 lựa chọn: **Hồi sinh** (spawn lại: ô ngẫu nhiên hợp lệ + 3s
  chuẩn bị) hoặc **Xem** (khán giả). Đã chọn **Xem** thì **không hồi sinh được nữa**,
  camera bám thực thể dẫn đầu, phải **chờ hết ván** (có người thắng) mới chơi lại.
- **Popup chết còn báo LÝ DO chết + bản đồ đất đã chiếm:** `Entity.deathCause`
  (`self` tự cắt đuôi · `cut` bị đối thủ cắt đuôi — kèm tên `killerId` · `headIntruder`
  bị chủ đất húc đầu khi xâm nhập · `headMutual` đâm đầu trực diện cùng chết) và
  `Entity.lastTerritory`/`lastPct` (ảnh chụp lãnh thổ ngay trước khi chết) → popup vẽ
  một bản đồ nhỏ các ô từng chiếm.
- **Đâm vào đuôi đối thủ ở BẤT KỲ ô nào → đối thủ chết**, kể cả khi đoạn đuôi đó đang
  nằm trong lãnh thổ của mình (luật cắt đuôi ưu tiên trước cả việc "về đất chiếm").
- **Va chạm ĐẦU trên sân nhà:** khi đầu đối thủ đứng trên **ô đất của mình** và sát đầu
  mình (≤ `CONFIG.KILL_RADIUS`) → **đối thủ (kẻ xâm nhập) chết**; chủ đất bất khả xâm
  phạm trên sân nhà.
- **Va chạm ĐẦU khi cả hai ở NGOÀI sân nhà** (ô trung lập / đất bên thứ ba): hai đầu sát
  nhau → **cả hai cùng chết** và mất sạch đất (đất về trung lập).
- **Hạ đối thủ → chiếm sạch đất của họ:** khi một thực thể bị **hạ bởi người khác**
  (cắt đuôi hoặc va đầu), **toàn bộ ô đất** của nạn nhân chuyển về **kẻ đã hạ**. Tự chết
  (tự cắt đuôi) thì đất trả về trung lập.
- **Không được tự đâm vào đuôi của mình** → tự cắt đuôi = chết.

## Totem & vật phẩm (giai đoạn sau MVP)

| Vật phẩm | Hiệu ứng |
|----------|----------|
| Cổng dịch chuyển (Teleport gate) | Dịch chuyển tức thời về sát rìa vùng an toàn khi nguy hiểm |
| Totem làm chậm (Slow totem) | Đặt trong vùng của mình → tạo aura làm chậm đối thủ đi vào |
| Tháp do thám (Spy Radar) | Mở rộng tầm nhìn trên minimap |

## Điều khiển

- **Web (PC):** chuột điều hướng — hướng di chuyển = hướng từ nhân vật tới con trỏ.
- **Mobile:** joystick ảo + nút kỹ năng dùng vật phẩm. Trên màn hình hẹp
  (`max-width: 640px`) các **bảng thông số thu nhỏ về góc** (transform scale) và **ẩn
  dòng hướng dẫn dài** để đỡ che vùng chơi.
- **Bảng xếp hạng:** chỉ hiện **TOP 5**; nếu người chơi đang ở hạng > 5 thì hiện thêm
  **một dòng dưới cùng** (có tô nền) cho đúng hạng thật của mình.

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
