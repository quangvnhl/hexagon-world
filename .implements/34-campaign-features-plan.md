# 34 — Kế hoạch: King objective, Cứ điểm bot, Minimap sync, Hệ thống BIÊN mới

> **Phạm vi:** tài liệu KẾ HOẠCH cho 4 nhóm tính năng Campaign. Nền: doc 31–33 (trình vẽ, totem,
> collider). Quy ước: mọi field config mới **default = hành vi cũ** (bất biến /play, /netplay).

## Quyết định đã CHỐT
- **D-biên:** biên admin vẽ = **CHỈ tường va chạm** (người/bot không băng qua, trượt dọc). BỎ collider
  theo ô (hex/rect). Flood-fill/chiếm đất **KHÔNG** bị biên chặn (giữ nguyên cơ chế hiện tại).
- **D-cứ điểm:** cứ điểm bot = **thực thể riêng** (`map.strongholds`), không phải totem.

---

## A. Mục tiêu KING (giữ King {3} phút) + tắt King ở mục tiêu khác

**Hiện trạng:** `king_hold` đã có ở `checkWin` (đấu loại + giữ ngôi `winHoldTime`). NHƯNG `roomLocked()`
/`isKing`/`kingHolderId` dựa `territoryPct() >= kingPct` (KING_PCT=20%) và chạy **bất kể** `win.kind`
⇒ ở cấp `territory_pct`, chạm 20% vẫn "khoá phòng" (chặn bot respawn/join). Editor CHƯA có `king_hold`.

**Thiết kế:**
1. **Cờ bật King:** thêm `MatchRules.kingEnabled` (default **true** ⇒ /play, /netplay bất biến). Gate
   `roomLocked()` + King-detection: trả false/`-1` khi `!kingEnabled`. Campaign `buildConfig` đặt
   `kingEnabled = (win.kind === "king_hold")` ⇒ mục tiêu khác KHÔNG có King.
2. **Objective king_hold ở editor:** thêm vào `WIN_KINDS`; field **"Số phút giữ King"** (default 3 →
   `winHoldTime = phút*60 = 180`); (tùy) field `kingPct` (default 20). `buildConfig` set `win.kind`,
   `winHoldTime`, `kingPct` + `rules.kingEnabled=true`.
3. **HUD:** hiện đồng hồ giữ ngôi cho cấp king_hold (kiểm HUD đã hỗ trợ king_hold; bổ sung nếu thiếu).

**Lát:** A1 shared (`kingEnabled` + gate roomLocked/isKing/kingHolder + test) · A2 editor (king_hold +
phút) · A3 client HUD/objectiveProgress cho king_hold.
**Rủi ro:** vừa — gate King phải KHÔNG đổi /play, /netplay (mặc định true). Test bất biến.

---

## B. CỨ ĐIỂM BOT (thực thể riêng) — bot hồi sinh 3s, mất khi bị chiếm

**Hiện trạng:** `BOT.RESPAWN_DELAY = 3` (đã 3s). `spawn(e)` chọn chỗ trống bất kỳ; `updateEntity` hồi
sinh bot khi `!roomLocked() && respawnTimer>0`. Chưa có khái niệm cứ điểm.

**Thiết kế:**
1. **Data:** `MatchMapConfig.strongholds?: Array<{ q: number; r: number }>` (ô cứ điểm). GameState dựng
   danh sách `strongholds` + tập `capturedStrongholds` (rỗng lúc đầu).
2. **Hồi sinh tại cứ điểm:** bot chết → sau 3s hồi sinh **tại một cứ điểm CÒN hoạt động** (chưa bị
   chiếm) gần nhất/round-robin. Nếu **không còn cứ điểm hoạt động** ⇒ bot **KHÔNG** hồi sinh.
   Sửa `spawn()`/`updateEntity`: chỗ spawn bot = ô cứ điểm (thay vì ngẫu nhiên) khi có strongholds.
3. **Chiếm cứ điểm:** khi người chơi **sở hữu** ô cứ điểm (enterHex/applyTerritory owned) ⇒ thêm vào
   `capturedStrongholds`. Cứ điểm bị chiếm ngừng nhận hồi sinh.
4. **Client:** render marker cứ điểm 3D (cờ/tháp; đổi màu khi bị chiếm) + minimap.
5. **Editor:** công cụ đặt cứ điểm (giống đặt totem 1 ô) + round-trip `map.strongholds`.

**Lát:** B1 shared (config + spawn/respawn theo cứ điểm + capture + test) · B2 client render + minimap ·
B3 editor tool.
**Rủi ro:** vừa–cao — đổi luồng spawn bot (ảnh hưởng số bot sống). Chỉ kích hoạt khi có `strongholds`
(cấp không đặt ⇒ bất biến). **Cần chốt:** gán bot↔cứ điểm (mọi bot dùng chung mọi cứ điểm — đề xuất).

---

## C. Minimap ĐỒNG BỘ kích thước theo cấp

**Hiện trạng:** `MiniMap.tsx` dùng hằng `ARENA_R`/`ARENA_INRADIUS` (global CONFIG=130) ⇒ cấp bán kính
nhỏ (vd 20) minimap vẫn vẽ theo 130 → lãnh thổ/obstacle bé xíu, lệch.

**Thiết kế:** GameState expose `get arenaR()` + `get arenaInradius()` (từ `this.arena`). MiniMap dùng
2 getter này thay hằng global (halfW/halfH + đường viền lục giác + toPx). Kích thước canvas minimap giữ,
chỉ đổi hệ scale world→px theo bán kính thật.

**Lát:** C1 shared getter · C2 MiniMap dùng getter.
**Rủi ro:** thấp — thuần hiển thị.

---

## D. HỆ THỐNG BIÊN MỚI (collider = đường biên admin vẽ)

**Hiện trạng:** collider theo Ô (`colliderShape` hex/rect, `slidePolyObstacles`/`slideRectObstacles`).
Công cụ biên hiện tại chỉ TÔ Ô bên trong. Cần thay bằng **đường biên (polyline) làm tường va chạm**.

**Thiết kế (theo D-biên đã chốt):**
1. **Data:** `MatchMapConfig.boundaries?: Array<{ id: string; points: Array<[number, number]> }>` —
   polyline toạ độ WORLD (điểm snap đỉnh hex hoặc tự do). Là tường HỞ (không cần khép kín).
2. **Va chạm (shared):** thay collider-theo-ô bằng **collide-and-slide theo ĐOẠN**: người/bot là điểm
   (bán kính nhỏ), mỗi tick chống lại các đoạn biên gần — nếu bước cắt/đâm vào đoạn thì bỏ thành phần
   pháp tuyến (trượt dọc đoạn), lặp cho góc. Bỏ `colliderShape`, `slideRect/PolyObstacles`,
   `insideObstacleRect`. `map.obstacles` (ô) **không còn** vai trò va chạm.
   *(Flood-fill giữ nguyên — KHÔNG đọc biên. Ô obstacle cũ: giữ cho tô/hiển thị hay bỏ hẳn → xem "cần
   chốt".)*
3. **Hiển thị:** vẽ biên là đường LINE trong game (3D) + minimap; **toggle** qua `map.showColliders`
   (hoặc cờ `showBoundaries` riêng). Đổi `ObstacleCollider` → vẽ từ `boundaries`.
4. **Trình vẽ biên mới (editor):**
   - **Điểm snap = đỉnh hex.** Vẽ **stroke** bình thường; **di chuột vào** point snap ⇒ **fill màu**.
   - **Bấm khi đang hover point** ⇒ chọn đúng đỉnh đó; **bấm ngoài point** ⇒ lấy **vị trí chuột** làm
     điểm (tự do, không snap).
   - **Enter** ⇒ tạo/hoàn tất biên (một polyline). Biên hiện dạng đường line, toggle hiển thị.
   - **Chọn biên đã tạo** ⇒ chọn **nút cuối** ⇒ **vẽ tiếp** (nối thêm điểm).
   - **Backspace** xoá **nút** biên (nút cuối / nút đang chọn); nút **Delete** xoá **cả đường biên**.
   - Round-trip `map.boundaries`.

**Lát:** D1 shared data `boundaries` + resolve · D2 shared va chạm collide-and-slide theo đoạn (bỏ
collider-ô) + test · D3 client render biên (3D + minimap) + toggle · D4 editor: trình vẽ biên mới
(snap fill/hover, chọn/nối/xoá nút, Delete biên, Enter) · D5 gỡ `colliderShape` + công cụ ô cũ (theo
quyết định).
**Rủi ro:** CAO — đổi mô hình va chạm + UI editor lớn. Làm sau A/B/C. Test va chạm biên (trượt, không
xuyên) kỹ.

## Thứ tự đề xuất
```
C (minimap, nhỏ) → A (King) → B (cứ điểm) → D (biên, lớn nhất)
```
Mỗi nhóm commit riêng; D chia D1→D5.

## Cần chốt thêm (trước khi làm nhóm tương ứng)
- **B:** gán bot↔cứ điểm — đề xuất "mọi bot dùng chung mọi cứ điểm còn hoạt động".
- **D:** `map.obstacles` (ô) cũ — **bỏ hẳn** công cụ tô ô (chỉ còn biên) hay **giữ** làm lớp hiển thị/
  flood-fill? (Đề xuất: bỏ vai trò va chạm; giữ tô ô như trước là tuỳ chọn hiển thị, hoặc gỡ hẳn để
  "chỉ còn 1 loại".)
- **A:** có cho chỉnh `kingPct` (ngưỡng %) ở editor không, hay khoá mặc định 20%.

## Tiêu chí đóng (mỗi nhóm)
- **A:** cấp king_hold: giữ King đủ phút ⇒ thắng; cấp khác KHÔNG có King (bot respawn/join không bị khoá).
- **B:** bot hồi sinh ở cứ điểm sau 3s; chiếm hết cứ điểm ⇒ bot ngừng hồi sinh; render + minimap.
- **C:** minimap khớp bán kính cấp (obstacle/lãnh thổ đúng tỉ lệ).
- **D:** collider chỉ còn biên admin vẽ; va chạm trượt dọc biên không xuyên; toggle hiển thị; editor
  chọn/nối/xoá nút + xoá biên + snap fill-on-hover.
- Build 4 gói + test thuần TS xanh; cấp không dùng field mới ⇒ bất biến.

---
Xem thêm: [33](33-obstacle-collider-plan.md) · [32](32-custom-totem-authoring-plan.md) · `state.ts` (King/spawn) · `MiniMap.tsx`.
