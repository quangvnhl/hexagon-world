# 31 — Kế hoạch nâng cấp TRÌNH VẼ ADMIN (bản đồ Canvas + sửa cấp + UI toàn màn hình)

> **Phạm vi:** tài liệu **thực thi** (chia lát code). Nâng cấp app admin `packages/admin`
> (đã tách ở [doc 30](30-phase3-L6-admin-app-plan.md)) để: (1) sửa cấp độ đúng nghĩa,
> (2) vẽ ĐÚNG toàn sân lục giác (không chỉ quanh tâm), (3) thiết kế lại giao diện toàn màn hình,
> pan được, panel key thu gọn, panel thông tin cấp cố định phải.

## 0. Hiện trạng & vấn đề (đã điều tra)

- **Sân thật:** lục giác tâm (0,0), `ARENA_RADIUS=130`, `HEX_SIZE=1` → `mapArena(0.6)` cho
  **16 651 ô** (q,r ≈ −74..74). Sim (`state.ts`) dựng `ArenaGeometry(config.map.radius)` và
  chỉ nhận obstacle là **ô hợp lệ trong sân** (ngoài sân bị bỏ âm thầm — dùng cho va chạm +
  flood fill).
- **Trình vẽ hiện tại:** lưới SVG `EDIT_CELLS` chỉ phủ `R_EDIT=6` cube-distance = **127 ô** quanh
  tâm (0,76% sân). ⇒ **VĐ #2**: sai số lượng ô, chỉ quanh trung tâm; obstacle ngoài ±6 KHÔNG
  vẽ/hiển thị được và **mất khi lưu lại** (round-trip hỏng).
- **Sửa cấp (VĐ #1):** server đã đủ (`POST levels` = upsert tạo/sửa, `DELETE` = gỡ publish,
  `PUT publish`). Client `editRow` có nạp form nhưng **affordance mờ** (bấm chip = sửa, không
  rõ), và obstacle ngoài ±6 mất ⇒ sửa cấp không đáng tin.
- **Giao diện (VĐ #3):** layout 2 cột tĩnh trong khung `maxWidth 980`; bản đồ nhỏ; không pan/zoom.

## 1. Quyết định (đã CHỐT)

1. **Mô hình sân:** **CẢ HAI** — render đúng sân theo `map.radius` của cấp + pan/zoom cho sân lớn;
   **ĐỒNG THỜI** thêm ô nhập **bán kính sân** để tác giả thu nhỏ sân (vd 20 ô) dựng cấp gọn,
   hiện đủ màn hình. (Sim đã honor `map.radius` sẵn.)
2. **Kỹ thuật render:** **Canvas 2D** (`<canvas>`), hit-test bằng `pixelToAxial`. Bỏ SVG per-ô
   (16.6k node DOM + React diff mỗi lần tô = giật). Pan (kéo nền) + zoom (cuộn) + kéo-tô nhiều ô.
3. **Obstacle hợp lệ:** chỉ cho tô ô **nằm trong sân** (theo `ArenaGeometry(radius)`); đổi bán kính
   nhỏ hơn ⇒ **cắt** obstacle rơi ngoài sân (cảnh báo số ô bị bỏ). Khớp đúng hành vi sim.
4. **Xóa cấp:** giữ **gỡ publish** (an toàn với progress) — không hard-delete (ngoài phạm vi).

## 2. Các lát công việc

| Lát | Tên | Effort | Sau |
|-----|-----|:------:|-----|
| **M1** | `HexCanvas`: renderer Canvas 2D toàn sân (từ `ArenaGeometry(radius).mapArena`) + pan + zoom + hit-test | L | — |
| **M2** | Tô obstacle trên canvas: click + kéo-tô, cỡ cọ (brush), chặn ngoài sân; model `Set<HexKey>` | V | M1 |
| **M3** | Ô nhập **bán kính sân** (`map.radius`) trong form + `buildConfig`; đổi bán kính ⇒ dựng lại sân + cắt obstacle ngoài | Đ | M1 |
| **M4** | Thiết kế lại UI: canvas TOÀN MÀN HÌNH; panel Admin Key + danh sách cấp **thu gọn** trên trái; panel thông tin cấp **cố định phải**; thanh công cụ (zoom/fit/brush/đếm ô) | L | M1,M2 |
| **M5** | "Sửa cấp" đúng nghĩa: chọn/sửa/mới/gỡ publish rõ ràng; trạng thái đang-chọn; round-trip obstacle **không mất** (bất kể vị trí) | V | M2,M4 |
| **M6** | Preview 2D dùng lại `HexCanvas` (đọc-thôi) + cập nhật README/doc | Đ | M4 |

### M1 — Renderer Canvas 2D toàn sân
- **Đụng:** `packages/admin/src/HexCanvas.tsx` (mới). Props: `radius`, `obstacles:Set<HexKey>`,
  `onPaint?(q,r,erase)`, `readOnly?`. Nội bộ: `ArenaGeometry(radius)` → `mapArena(margin)` ra tập
  ô hợp lệ (cache theo radius). Vẽ mỗi ô = polygon 6 đỉnh (dùng `axialToPixel` + góc `60·i−30`).
  **View transform:** `scale` (zoom) + `offset` (pan) world→screen. Vẽ trong `requestAnimationFrame`
  khi đổi obstacles/view. Pan = kéo chuột nền; zoom = wheel quanh con trỏ. Hit-test:
  screen→world→`pixelToAxial(size)`; chỉ nhận nếu ô ∈ tập hợp lệ.
- **Xong khi:** mở app thấy TOÀN sân 130 (16.6k ô) mượt; pan/zoom quanh; con trỏ highlight ô dưới nó.
- **Rủi ro:** vừa — vẽ 16.6k ô mỗi frame khi pan có thể chậm. Giảm tải: chỉ vẽ ô trong viewport
  (cull theo bbox màn hình), hoặc vẽ nền 1 lần vào offscreen canvas rồi blit; obstacle vẽ đè.

### M2 — Tô obstacle trên canvas
- **Đụng:** trong `HexCanvas`: `mousedown` bắt đầu tô (bật/tắt theo ô đầu), `mousemove` khi giữ =
  tô tiếp (dùng `hexLinedraw` vá ô nhảy cóc), `mouseup` kết thúc; phím/nút chọn **cọ** (bán kính 0/1/2
  → dùng `cubeDistance`). Chỉ tô ô ∈ sân. Phân biệt **tô** (trái) và **xóa** (giữ Alt/phải).
- **Xong khi:** kéo chuột tô/xóa dải obstacle; cọ to tô nhanh; ô ngoài sân không nhận.
- **Rủi ro:** thấp.

### M3 — Bán kính sân theo cấp
- **Đụng:** `FormState.radius` (mặc định 130); `buildConfig` set `config.map.radius` khi ≠ 130 (giữ
  bất biến cấp cũ nếu để 130 — nhưng nên luôn ghi để rõ ràng). `rowToForm` đọc `cfg.map?.radius`.
  Khi radius đổi → `HexCanvas` dựng lại sân; obstacle rơi ngoài sân mới bị **lọc** (helper
  `pruneObstacles(obstacles, radius)`), hiện cảnh báo "đã bỏ N ô ngoài sân".
- **Xong khi:** đặt bán kính 20 → sân nhỏ gọn vừa màn; obstacle luôn nằm trong sân.
- **Rủi ro:** thấp — chú ý `validateLevelDraft` vẫn xanh (radius là số > 0).

### M4 — Giao diện toàn màn hình
- **Đụng:** `LevelEditor.tsx` bố cục lại: `HexCanvas` phủ `position:fixed inset:0`. Overlay:
  - **Trên-trái (thu gọn):** hộp Admin Key + nút Tải + **danh sách cấp** (chip chọn để sửa). Nút
    ▸/▾ collapse (chỉ còn icon khi thu). Nhớ trạng thái collapse (localStorage).
  - **Phải (cố định):** form thông tin cấp (id/tên/mục tiêu/bot/mạng/power-up/unlock/thưởng/publish/
    bán kính) + nút Lưu/Xem thử/Mới/Gỡ publish + danh sách lỗi validate.
  - **Dưới hoặc góc:** thanh công cụ nhỏ: zoom +/−, **Fit** (canh vừa sân), cỡ cọ, "N ô chướng ngại".
- **Xong khi:** bản đồ toàn màn; 2 panel overlay; thu gọn panel trái được; form phải luôn thấy.
- **Rủi ro:** vừa — z-index/scroll panel phải khi màn thấp; canvas nhận sự kiện nền còn panel chặn.

### M5 — Sửa cấp đúng nghĩa
- **Đụng:** danh sách cấp: mỗi hàng có trạng thái publish + nút **Sửa** (nạp form+obstacle) và **Gỡ
  publish**. Ô đang sửa nổi bật; nút **+ Cấp mới** rõ. Round-trip: obstacle nạp từ `cfg.map.obstacles`
  hiển thị đúng vị trí thật (canvas toàn sân) và lưu lại **không mất** ô nào.
- **Xong khi:** chọn c4/c5 (có obstacle) → thấy đúng ô → sửa → lưu → tải lại khớp; tạo cấp mới maze
  bằng bán kính nhỏ + tô obstacle → publish → chơi ở `/campaign`.
- **Rủi ro:** thấp.

### M6 — Preview 2D + tài liệu
- **Đụng:** `Preview2D` dùng `HexCanvas readOnly` (thay lưới SVG cũ). Cập nhật `README.md` (thao tác
  pan/zoom/tô, bán kính sân) + doc 30 §6 trỏ sang doc 31.
- **Xong khi:** Xem thử hiển thị sân + obstacle bằng canvas; tài liệu khớp.
- **Rủi ro:** thấp.

## 3. Thứ tự & phụ thuộc
```
M1 (canvas) ─► M2 (tô) ─► M5 (sửa cấp)
M1 ─► M3 (bán kính)        M2,M4 ─► M5
M1,M2 ─► M4 (UI) ─► M6 (preview+doc)
```
**Khuyến nghị:** M1 → M2 → M3 → M4 → M5 → M6. (M1 là nền; UI M4 làm sau khi vẽ+tô chạy.)

## 4. Ngoài phạm vi (hoãn)
- Sân `shape:"custom"` / `cells` tùy ý (lõm, không lục giác đều).
- Hard-delete cấp + audit log; undo/redo khi tô; import/export JSON cấp.
- 3D preview; StarCriteria theo dữ liệu; snap/mirror/đối xứng khi vẽ.

## 5. Tiêu chí ĐÓNG
- Trình vẽ hiển thị **đúng toàn sân** theo bán kính cấp; pan/zoom mượt; tô/xóa obstacle bất kỳ đâu
  trong sân.
- **Sửa cấp** round-trip không mất obstacle; tạo/sửa/gỡ publish rõ ràng.
- UI: canvas toàn màn hình; panel key thu gọn trên-trái; form cố định phải.
- Cấp người chơi ở `/campaign` đọc từ DB **bất biến** so với trước (chỉ thêm khả năng đặt bán kính).
- `tsc --noEmit` + `vite build` admin xanh; client/server/shared không đổi hành vi.

---
Xem thêm: [30-phase3-L6-admin-app-plan.md](30-phase3-L6-admin-app-plan.md) · [29-phase3-level-authoring-plan.md](29-phase3-level-authoring-plan.md) · [25-game-modes-plan.md](25-game-modes-plan.md).
