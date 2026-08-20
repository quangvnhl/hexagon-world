# 33 — Chướng ngại: TRƯỢT dọc viền + hiển thị đường COLLIDER (Campaign)

> **Phạm vi:** tài liệu thực thi. (1) Sửa va chạm obstacle để 3D object **trượt** dọc viền
> thay vì **kẹt**; (2) vẽ **đường collider** của obstacle + biên sân, bật/tắt qua **config
> theo cấp** (Campaign). Nền: obstacle đã đặt được (doc 31/32).

## 0. Hiện trạng
- **Va chạm biên sân:** `ArenaGeometry.slideMove` — trượt dọc 6 tường ở tốc độ đầy đủ. Tốt.
- **Va chạm obstacle:** `state.ts updateEntity` — nếu ô đích là obstacle ⇒ `return` (KHÔNG
  bước) ⇒ **kẹt cứng**, người/bot phải tự đổi hướng.
- **Viz:** `ArenaCollider.tsx` vẽ viền collider + pháp tuyến biên, gate bởi **global**
  `CONFIG.DEBUG.COLLISION_VECTORS`. KHÔNG có viz cho obstacle. Không cấu hình theo cấp.
- `game.config` (MatchConfig) + `game.obstacles` (Set<HexKey>) đều PUBLIC ⇒ client đọc được.

## 1. Quyết định
1. **Trượt obstacle:** cùng ý tưởng `slideMove` — bỏ thành phần pháp tuyến (hướng ĐI VÀO obstacle),
   giữ tiếp tuyến ⇒ trượt dọc mặt hex. Pháp tuyến ≈ `pos − tâm(ô obstacle đích)` (ô kề ⇒ đúng mặt).
   Lặp tối đa 2 lần (góc lõm 2 ô); vẫn kẹt ⇒ đứng (đâm thẳng góc). Clamp về trong sân sau cùng.
2. **Config theo cấp:** thêm `MatchMapConfig.showColliders?: boolean` (default false ⇒ bất biến).
   Trình vẽ có ô chọn; GameScene vẽ collider khi `CONFIG.DEBUG.COLLISION_VECTORS || map.showColliders`.
3. **Viz obstacle:** component client vẽ CẠNH collider = cạnh hex của ô obstacle GIÁP ô KHÔNG-obstacle
   (mặt va chạm thật) + (tùy) pháp tuyến. Đọc `game.obstacles` + toán hex.

## 2. Lát
| Lát | Tên | Sau |
|-----|-----|-----|
| **S1** | shared: `slideAlongObstacles` trong `updateEntity` (trượt thay kẹt) + test | — |
| **S2** | shared: `MatchMapConfig.showColliders` + resolve default false | — |
| **S3** | client: `ObstacleCollider.tsx` (cạnh giáp playable) + gate ArenaCollider/CollisionDebug theo `map.showColliders` | S2 |
| **S4** | admin: ô "Hiện đường collider" trong form → `map.showColliders`; round-trip | S2 |

## 3. Ngoài phạm vi
- Va chạm obstacle "chuẩn hình học" từng cạnh (segment) cho bước nhảy nhiều ô (giữ giả định bước < 1 ô).
- Collider cho totem; chỉnh màu/độ dày line theo cấp.

## 4. Tiêu chí đóng
- 3D object trượt dọc viền obstacle (không kẹt); không lọt vào ô obstacle.
- Bật `showColliders` ở cấp ⇒ in-game thấy đường collider obstacle + biên; tắt ⇒ không.
- shared/client build + test xanh; cấp không bật cờ ⇒ bất biến.

## 4b. Bổ sung — collider CHỮ NHẬT (AABB), sửa "vẫn kẹt"

Bản hex slide vẫn kẹt (chuẩn hex kém tin cậy khi đâm cụm/mặt). Chuyển sang **AABB**:
- `MatchMapConfig.colliderShape: "hex" | "rect"` (default **"rect"**). Cấu hình được ở trình vẽ.
- **RECT:** mỗi ô obstacle = hộp chữ nhật (nửa rộng √3/2·size, nửa cao size) BAO TRỌN ô lục. Va chạm
  giải **theo từng trục** (x rồi y) ⇒ trượt dọc cạnh hộp đáng tin, không kẹt (trừ góc). `insideObstacleRect`
  chỉ xét ô + 6 ô kề (O(1)).
- Viz `ObstacleCollider` vẽ **4 cạnh hộp/ô** khi rect (hoặc cạnh hex khi hex).
- Test: đâm thẳng → dừng ĐÚNG cạnh trái hộp (không xuyên); đâm chéo → trượt.

## 4c. Sửa "vẫn kẹt góc vuông" — biên ĐA GIÁC hex (mặc định) + fix targetPct

- **Collider mặc định → `"hex"`** (đa giác theo mặt lục, góc lồi **120° > 90°** nên không bẫy như
  hộp chữ nhật 90°). `state.ts.slidePolyObstacles`: bỏ pháp tuyến mặt BIÊN gần đích nhất (giữ tiếp
  tuyến, tốc độ đầy đủ), lặp ≤3 cho góc; còn dính thì đẩy vuông góc ra ngoài mặt gần nhất. Giữ
  `"rect"` (AABB) làm tuỳ chọn. Test: trượt dọc TƯỜNG 5 ô (đi xa theo cạnh), không xuyên.
- **Bug hệ số `targetPct`:** `targetPct` là PHÂN SỐ 0–1 (trình vẽ/catalog) nhưng win-check so trực
  tiếp với `pctOf` (0–100) ⇒ 0.3 thắng ở 0.3%. Sửa: `targetPct*100` trước khi so (`kingPct` vẫn
  0–100). `GameScene.objectiveProgress` chỉnh cho khớp. Cập nhật `win-condition.test` sang phân số.

## 5. Trạng thái thực thi (đã code)

| Lát | Trạng thái | Ghi chú |
|-----|:----------:|---------|
| **S1** | ✅ | `state.ts.slideAlongObstacles`: bỏ pháp tuyến, giữ tiếp tuyến (lặp ≤2, clamp sân). Thay `return` kẹt. Test: đâm chéo → trượt (di chuyển sau chạm + đổi y), không xuyên. |
| **S2** | ✅ | `MatchMapConfig.showColliders?` + resolve default false. |
| **S3** | ✅ | `ObstacleCollider.tsx` (cạnh hex giáp ô mở = mặt va chạm, gom LineSegments) + `CONFIG.DEBUG.OBSTACLE_LINE`. GameScene gate `CONFIG.DEBUG.COLLISION_VECTORS \|\| game.config.map.showColliders`. |
| **S4** | ✅ | Trình vẽ: ô "Hiện đường collider" → `map.showColliders`; round-trip. |

**Build/test:** shared 131 + client 58 + server 56 xanh; typecheck 4 gói + client/admin build xanh.
Va chạm + viz 3D cần **hiện pane** để mắt-thường xác nhận (headless không chụp 3D).

### Verify tay
- [ ] Cấp có obstacle + bật "Hiện đường collider" → Publish → chơi `/campaign`: thấy đường vàng viền
  obstacle + đường đỏ biên; lái đâm chéo vào obstacle → **trượt** dọc viền (không kẹt).

---
Xem thêm: `packages/shared/src/arena.ts` (slideMove) · `ArenaCollider.tsx` · `ObstacleCollider.tsx` · [32](32-custom-totem-authoring-plan.md).
