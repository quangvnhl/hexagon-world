# .implements_unity — Port "Hexagon World" sang Unity

Bộ tài liệu ghi lại **kết quả đã đạt được** khi port game sang Unity, song song với
bản web trong repo này. Bản web (`packages/shared`, `packages/client`) vẫn là nguồn
luật chơi gốc; tài liệu ở đây mô tả bản Unity đã port tới đâu, làm theo cách nào và
những ràng buộc kỹ thuật đã phải trả giá mới biết.

- **Project Unity:** `D:\UnityProjects\BeeKing` (nằm NGOÀI repo này)
- **Scene:** `Assets/Scenes/Practice.unity`
- **Chế độ đang làm:** Luyện tập (Practice) — một người chơi + 8 bot, chạy offline

> Tài liệu trong `.implements/` mô tả bản web. Khi luật chơi lệch nhau, bản web là
> chuẩn; mọi chỗ bản Unity cố tình làm khác đều được ghi rõ lý do.

## Thứ tự đọc

| File | Nội dung | Dành cho |
|------|----------|----------|
| [00-kien-truc-unity.md](00-kien-truc-unity.md) | Kiến trúc, quy ước code, và **14 cái bẫy kỹ thuật** đã dính (winding, color space, blendshape + instancing, giá trị scene đè code…) | Bắt buộc đọc trước khi sửa |
| [01-ket-qua-giai-doan-1-5.md](01-ket-qua-giai-doan-1-5.md) | Giai đoạn 1→5 đã làm được gì, kèm số đo thật | PM + Gameplay |
| [02-hieu-ung-noi-o-hat-rung.md](02-hieu-ung-noi-o-hat-rung.md) | Sửa lỗi ô nổi không đều, hạt khi chiếm ô, rung camera khi chết | Frontend + Gameplay |

## Trạng thái hiện tại

- [x] Lưới hex render bằng GPU instancing, dùng model `Hexagon.fbx` của dự án
- [x] Shader riêng `HexagonWorld/HexTile` — màu từng ô + blendshape Rise chạy được cùng instancing
- [x] Mô phỏng đa thực thể: tranh chấp ô chung, cắt đuôi, va chạm đầu, cướp đất khi hạ đối thủ
- [x] **Giai đoạn 1** — HUD, màn hình chết/thắng, collider thân nhân vật + collider biên sân
- [x] **Giai đoạn 2** — 8 bot với FSM EXPAND/RETURN/HUNT/FLEE, 3 hồ sơ độ khó, model bee/fly
- [x] **Giai đoạn 3** — joystick ảo cảm ứng, camera zoom theo lãnh thổ, kẹp tâm nhìn trong sân
- [x] **Giai đoạn 4** — cắt ô ngoài tầm nhìn: 16.651 → ~650 instance, draw call 17 → 1
- [x] **Giai đoạn 5** — 74 totem (Speed/Slow/Radar), chủ totem suy ra từ chủ ô
- [x] Hiệu ứng: ô nổi lên khi chiếm (blendshape), hạt bắn khi đổi chủ, rung camera khi chết
- [ ] **Vật cản và thành trì** — *cố ý chưa làm*, xem lý do ở [01](01-ket-qua-giai-doan-1-5.md#phần-cố-ý-chưa-làm)
- [ ] Minimap / Radar Totem mới chỉ là cột mốc trên bản đồ, chưa lộ vị trí địch
- [ ] Chưa có multiplayer, chưa nối backend, chưa có test tự động

## Nguyên tắc làm việc

1. **Logic tách khỏi render.** `GameState` là C# thuần, không phải MonoBehaviour —
   giữ đúng nguyên tắc của bản web để sau này chạy được trên server.
2. **Không xoay riêng từng ô hex.** Hệ toạ độ là đỉnh-nhọn; muốn đổi hướng cả bàn
   chơi thì xoay `yaw` của camera. Xoay từng ô sẽ làm lưới hở/chồng.
3. **Đọc [00-kien-truc-unity.md](00-kien-truc-unity.md) trước khi đụng vào render.**
   Phần lớn lỗi ở đây là lỗi *im lặng* — không ném exception, chỉ ra sai hình.
4. **Sửa hằng số thì sửa ở [GameConfig.cs](00-kien-truc-unity.md#gameconfig),
   nhưng nhớ giá trị trong scene đè giá trị mặc định trong code** (bẫy số 6).
