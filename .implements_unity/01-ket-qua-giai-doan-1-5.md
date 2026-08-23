# 01 — Kết quả Giai đoạn 1 → 5 (chế độ Luyện tập)

Kế hoạch 5 giai đoạn được chốt sau khi lưới hex, nhân vật và vệt đuôi đã chạy được.
Tài liệu này ghi lại **đã làm được gì**, kèm số đo thật lấy từ ván chạy trong editor.

---

## Nền tảng có trước Giai đoạn 1

| Hạng mục | Kết quả |
|---|---|
| Lưới hex | `Graphics.DrawMeshInstanced`, lô 1023 ô, mesh lấy từ `Hexagon.fbx` và chuẩn hoá một lần lúc `Awake` |
| Màu từng ô | Shader riêng `HexagonWorld/HexTile` qua `MaterialPropertyBlock._InstanceColor` |
| Ô nổi khi chiếm | Blendshape "Rise" của model, nướng vào UV1 để chạy chung với instancing |
| Nhân vật | Model ladybug, `modelSize` 2.2 |
| Vệt đuôi | Dải cong Catmull-Rom, port `trailRibbonGeometry.ts` |
| Sân | Lục giác đều, 6 tường, trượt dọc biên khi va |

---

## Giai đoạn 1 — Vòng lặp trận đấu + collider

**HUD** — [`UI/PracticeHud.cs`]. Dựng toàn bộ cây uGUI **bằng code** lúc `Awake` nên
không phải nối tay hàng chục tham chiếu trong scene (đổi cấu trúc là hỏng). Dùng
`Text` cổ điển + `LegacyRuntime.ttf` thay TextMeshPro để không phụ thuộc bước "Import
TMP Essentials". Hiển thị:

- `Lãnh thổ x.x%` + thanh tiến độ tới ngưỡng Vua (20%)
- Đồng hồ giữ Vua (thắng khi giữ đủ 180 giây)
- Hạng `n/N`, số bot còn sống, số Totem tốc độ, số lần chết
- Đếm ngược chuẩn bị 3 giây

**Màn hình chết / thắng.** Bảng chết phân biệt *tự cắt đuôi* với *bị giết*, có nút
`HỒI SINH (R)`. Bảng thắng có nút `CHƠI LẠI`. `EventSystem` dùng
`InputSystemUIInputModule` — module cũ sẽ ném lỗi với project này.

**Collider nhân vật.** `GameConfig.BodyRadius = 1.0` (thay 0.6 của cube bản web, tính
theo cỡ model ladybug) được truyền vào `ArenaGeometry.SlideMove` ⇒ **mép thân** dừng ở
tường, tâm không lún vào. Chỗ sinh cũng bị đẩy vào trong ít nhất một bán kính thân,
vì ô sát tường có tâm cách tường < bán kính thân.

**Collider đường biên.** [`Rendering/ArenaBorder.cs`] vẽ hai đường:

- viền đỏ `#d91e48` = tường va chạm thật, tại `ArenaRadius × WallScale`
- đường xanh `#2ec4b6` mảnh phía trong tại `wall − BodyRadius / cos(π/6)` = quỹ đạo
  **tâm** khi thân áp tường

Nhìn hai đường là kiểm được bằng mắt collider có khớp hình vẽ không.

**Rung camera khi chết** — chi tiết ở [02](02-hieu-ung-noi-o-hat-rung.md#3-rung-camera-khi-chết).

---

## Giai đoạn 2 — Bot

Đây là giai đoạn nặng nhất: `GameState` chuyển từ một người chơi sang **nhiều thực
thể tranh chấp chung bản đồ**.

**Mô hình sở hữu.** `cellOwner` / `cellTrail` là nguồn sự thật; `Entity.Owned` chỉ là
chỉ mục ngược. Kéo theo:

- Khép vòng ⇒ `FloodFill.CaptureEnclosed` ⇒ `ClaimCell` cho từng ô, **cướp luôn** ô
  đang thuộc đối thủ nằm trong vòng.
- Đâm vào đuôi đối thủ ở **bất kỳ ô nào** (kể cả trong lãnh thổ của mình) đều khiến
  đối thủ chết và mất sạch đất về tay kẻ cắt.
- Tự cắt đuôi mình vẫn chết, nhưng **miễn cho 2 ô đuôi mới nhất** (`SelfTrailGrace`)
  để không chết oan khi làm tròn hex dao động lúc đi men theo tường.

**Va chạm đầu.** Hai đầu cùng nằm trên một ô **trung lập** được phân xử **trước** va
chạm với đuôi (`ResolveNeutralSameHex`). Không làm vậy thì thực thể được update sau
có thể cắt đuôi thực thể kia trước, biến va chạm hoà thành một sống một chết **tuỳ
thứ tự update**. Ngoài trường hợp đó: đứng trên đất của mình thì an toàn, kẻ xâm nhập
chết; cả hai ở đất lạ thì cùng chết.

**AI.** 8 bot, FSM **EXPAND / RETURN / HUNT / FLEE**:

- FLEE tức thời khi đang ở ngoài (có đuôi, dễ tổn thương) mà có đối thủ vào trong
  55% tầm nhìn.
- HUNT nhắm **điểm gần nhất trên đuôi con mồi**, không nhắm vào đầu; đi quá xa nhà
  thì tự chuyển RETURN.
- `SteerAvoiding` quét các hướng lệch dần quanh hướng mong muốn để né đuôi mình và
  tường; bot kỹ năng cao quét nhiều hướng hơn, có kẹp trần để đông bot không ngốn CPU.
- AI giới hạn tối đa **20 Hz** (`BotThinkIntervalMin`), nhưng chuyển động và va chạm
  vẫn chạy ở nhịp render.

Ba hồ sơ độ khó gán luân phiên:

| Hồ sơ | Hung hăng | Tầm nhìn | Kỹ năng né | Nhịp quyết định |
|---|---|---|---|---|
| Dễ | 0.1 | 12 | 0.3 | 0.30s |
| Thường | 0.4 | 16 | 0.5 | 0.20s |
| Khó | 0.8 | 20 | 1.0 | 0.10s |

**Model bot.** Bee và fly, mỗi model quay đầu theo một trục khác nhau nên có
`botModelYawOffsets` riêng (bee 90°, fly 0°) — xem bẫy số 9.

---

## Giai đoạn 3 — Điều khiển và camera

**Joystick ảo** — [`UI/TouchJoystick.cs`]. Mọc tại chỗ chạm, vùng chết 0.18 bán kính.
Đọc thẳng `Touchscreen.current.touches` chứ không qua `EventSystem`, để HUD không
nuốt mất ngón. Canvas riêng ở `sortingOrder = 10`. Chuột PC giữ nguyên không đổi.

**Đổi hướng màn hình sang hướng thế giới.** Camera đang `yaw = 90°` nên "kéo lên"
trên joystick **không** phải `+Z` của thế giới. `ScreenDirToHeading` chiếu trục
`right`/`up` của camera xuống mặt sân rồi mới ghép.

**Camera** — [`CameraControl/TopDownCamera.cs`]: orthographic, `pitch = 73`,
`yaw = 90`, `orthoSize = 8`.

- **Zoom theo lãnh thổ:** hệ số nội suy `zoomMin 1 → zoomMax 1.4` theo `pct / KingPct`
  — đất càng rộng càng cần thấy xa để tính đường.
- **Kẹp tâm nhìn** (`ClampFocus`): kẹp theo 6 pháp tuyến tường để mép màn hình không
  lòi ra vùng trắng ngoài biên khi người chơi men theo tường. Chiều dọc màn hình bị
  nghiêng `pitch` nên trải trên mặt sân dài hơn, phải chia cho `sin(pitch)`.

> Người dùng đã sửa `pitch = 73` / `orthoSize = 8` trong file `.cs` nhưng scene lưu
> sẵn 62/13 nên không có tác dụng — đã ghi 73/8 thẳng vào scene. Xem bẫy số 6.

---

## Giai đoạn 4 — Tối ưu

Chỉ vẽ ô nằm trong tầm camera, dựng lại danh sách khi camera đã lia ≥ 0.8 đơn vị hoặc
đổi bán kính nhìn ≥ 0.5 — cùng cách làm với `visibleCells` của `HexGridView.tsx` bản
web. Quét toàn map mỗi lần dựng lại, nhưng chỉ vài lần/giây thay vì gửi cả 17.000
instance xuống GPU **mỗi frame**.

Bán kính vùng nhìn tính từ hình chiếu vùng nhìn xuống mặt sân, có bù `pitch`:

```
halfDepth = orthoSize / sin(pitch)
radius    = √(halfWidth² + halfDepth²) + cullPadding
```

**Số đo thật:**

| | Trước | Sau |
|---|---|---|
| Instance gửi xuống GPU | 16.651 | **643 – 749** |
| Draw call của lưới | 17 | **1** |

---

## Giai đoạn 5 — Totem

74 totem: **32 Speed / 12 Slow / 30 Radar**. Rải bằng cách lọc ô ứng viên (cách tường
và cách chỗ sinh ≥ 12), xáo trộn, rồi lấy dần với giãn cách giữa hai totem ≥ 18.

**Chủ totem KHÔNG lưu riêng mà suy ra từ chủ của ô nó đứng** — chiếm được ô là chiếm
được totem, mất ô là mất luôn. Đồng bộ lại chỉ khi `GridRevision` thực sự đổi.

**Tác dụng** (`EffectiveSpeed`, port `effectiveSpeedWithTotems()`):

- Speed Totem: `+0.5` tốc độ mỗi cái đang sở hữu.
- Slow Totem: đứng trong bán kính 8 của totem **địch** thì bị **ép** về tốc độ 3,
  ghi đè mọi cộng dồn khác. Totem vô chủ không tính.
- Radar Totem: hiện mới chỉ là cột mốc trên bản đồ, **chưa** lộ vị trí địch như bản web.

**Render** — [`Rendering/TotemRenderer.cs`]: mỗi totem một GameObject (Cylinder cho
Speed/Radar, Cube cho Slow). Vài chục cái nên dùng GameObject thường cho gọn, không
cần instancing như lưới hex. Đổi sang màu chủ khi bị chiếm; Slow Totem có chủ thì
hiện vòng `LineRenderer` bán kính vùng làm chậm.

> **Lưu ý lệch bản gốc:** bản web **TẮT** totem ở chế độ Luyện tập. Ở đây bật để có
> nội dung chơi; đổi `GameConfig.TotemsEnabled = false` là về đúng bản gốc.

---

<a id="phần-cố-ý-chưa-làm"></a>
## Phần cố ý chưa làm

**Vật cản và thành trì.** Trong bản web đây là **nội dung do admin vẽ trong map
editor** (`config.map.obstacles` / `strongholds`), không phải sinh ngẫu nhiên. Không
có dữ liệu map đó thì chỉ có thể rải bừa, ra một thứ khác hẳn bản gốc — nên đã dừng
lại thay vì tự bịa. Hai hướng nếu muốn đi tiếp:

1. Rải vật cản theo cụm ngẫu nhiên **có seed**, coi như chướng ngại chặn đường.
2. Port luôn định dạng map của admin editor rồi nạp file map xuất từ bản web.

**Radar Totem** chưa lộ vị trí địch (chưa có minimap trong bản Unity).

---

## Ván chạy kiểm chứng cuối

```
pct=0.00  bot sống=8  totem=74  vẽ=649 ô   |  0 lỗi console
totem: tổng=74 speed=32 slow=12 radar=30
```
