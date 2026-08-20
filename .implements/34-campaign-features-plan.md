# 34 — Kế hoạch: King objective, Cứ điểm bot, Minimap sync, Hệ thống BIÊN mới

> **Phạm vi:** tài liệu KẾ HOẠCH cho 4 nhóm tính năng Campaign. Nền: doc 31–33 (trình vẽ, totem,
> collider). Quy ước: mọi field config mới **default = hành vi cũ** (bất biến /play, /netplay).

## Quyết định đã CHỐT (đã cập nhật theo phản hồi)
- **Hai công cụ SONG SONG (không thay thế):**
  - **Chướng ngại (ô):** GIỮ — là chức năng CHÍNH tạo ô lục giác chướng ngại; collider theo Ô như hiện
    tại (doc 33, biên hex đa giác). Flood-fill vẫn chặn theo ô như cũ.
  - **Biên (line):** CHỈ để vẽ **đường biên** (polyline) làm **tường va chạm bổ sung**; KHÔNG tô ô.
    Biên = collision-only, không chặn flood-fill. (Bỏ ý "chỉ còn 1 loại collider".)
- **Cứ điểm bot:** **thực thể riêng** (`map.strongholds`), MỖI cứ điểm có **số bot** riêng
  (`botCount`). Bot của cứ điểm hồi sinh tại đó sau 3s; chiếm cứ điểm ⇒ số bot đó ngừng hồi sinh.
- **Bot Campaign là ĐỒNG MINH:** mọi bot **cùng màu**, **đâm nhau KHÔNG chết** (chỉ đối đầu người chơi).
- **King:** cho **chỉnh ngưỡng % (kingPct)** ở editor; King TẮT ở mục tiêu khác king_hold.

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
   `winHoldTime = phút*60 = 180`) + field **"Ngưỡng % King" (kingPct, default 20)**. `buildConfig` set
   `win.kind`, `winHoldTime`, `kingPct` + `rules.kingEnabled=true`.
3. **HUD:** hiện đồng hồ giữ ngôi cho cấp king_hold (kiểm HUD đã hỗ trợ king_hold; bổ sung nếu thiếu).

**Lát:** A1 shared (`kingEnabled` + gate roomLocked/isKing/kingHolder + test) · A2 editor (king_hold +
phút) · A3 client HUD/objectiveProgress cho king_hold.
**Rủi ro:** vừa — gate King phải KHÔNG đổi /play, /netplay (mặc định true). Test bất biến.

---

## B. CỨ ĐIỂM BOT (thực thể riêng) — bot hồi sinh 3s, mất khi bị chiếm

**Hiện trạng:** `BOT.RESPAWN_DELAY = 3` (đã 3s). `spawn(e)` chọn chỗ trống bất kỳ; `updateEntity` hồi
sinh bot khi `!roomLocked() && respawnTimer>0`. Chưa có khái niệm cứ điểm.

**Thiết kế:**
1. **Data:** `MatchMapConfig.strongholds?: Array<{ q: number; r: number; botCount: number }>`. GameState
   dựng danh sách + tập `capturedStrongholds`. **Tổng bot** = Σ `botCount` các cứ điểm (khi có
   strongholds thì `bots.count` bị bỏ qua ở cấp; nếu KHÔNG có strongholds ⇒ giữ `bots.count` như cũ).
2. **Gán bot↔cứ điểm:** mỗi bot thuộc **một cứ điểm** (theo botCount). Bot hồi sinh **tại cứ điểm của
   mình** sau 3s. Cứ điểm bị chiếm ⇒ bot của nó **KHÔNG** hồi sinh nữa (bot đang sống vẫn chơi tới khi
   chết). Sửa `spawn()`/`updateEntity`: chỗ spawn bot = ô cứ điểm chủ; gate respawn theo
   `!captured(stronghold)`.
3. **Chiếm cứ điểm:** người chơi **sở hữu** ô cứ điểm ⇒ thêm vào `capturedStrongholds` (như capture totem).
4. **Bot ĐỒNG MINH (campaign):** thêm `rules.botsAllied` (default **false** ⇒ /play, /netplay bất biến).
   Khi true: mọi bot cùng **teamId** (vd 1) + **cùng màu**; va chạm đầu-đầu / đâm đuôi GIỮA bot với bot
   ⇒ KHÔNG chết. Chỉ người chơi (team 0) vs bot mới sát thương. Campaign `buildConfig` đặt `botsAllied=true`.
5. **Client:** render marker cứ điểm 3D (cờ/tháp; đổi màu khi bị chiếm) + minimap; bot cùng màu.
6. **Editor:** công cụ đặt cứ điểm (đặt ô + nhập `botCount`) + round-trip `map.strongholds`.

**Lát:** B1 shared (config strongholds + spawn/respawn theo cứ điểm + capture + `botsAllied` gate kill +
test) · B2 client render + minimap + màu bot · B3 editor tool (đặt + số bot).
**Rủi ro:** cao — đổi luồng spawn bot + luật sát thương (đồng minh). Chỉ kích hoạt khi có strongholds /
`botsAllied` (cấp không đặt ⇒ bất biến). Test kỹ luật kill bot-vs-bot.

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

## D. Công cụ BIÊN (đường line) — tường va chạm BỔ SUNG (GIỮ công cụ Chướng ngại)

**Hiện trạng:** collider theo Ô (doc 33, biên hex đa giác) — **GIỮ** làm chính. Công cụ "Biên" hiện tô
ô bên trong; cần **đổi thành vẽ ĐƯỜNG BIÊN** (polyline) làm tường va chạm bổ sung, KHÔNG tô ô.

**Thiết kế (biên = collision-only, THÊM vào cạnh collider ô):**
1. **Data:** `MatchMapConfig.boundaries?: Array<{ id: string; points: Array<[number, number]> }>` —
   polyline toạ độ WORLD (điểm snap đỉnh hex hoặc tự do). Tường HỞ (không cần khép kín).
2. **Va chạm (shared):** GIỮ collider-ô hiện tại; THÊM **collide-and-slide theo ĐOẠN** cho `boundaries`:
   sau bước (đã giải obstacle-ô), chống tiếp các đoạn biên gần — đâm vào đoạn thì bỏ thành phần pháp
   tuyến (trượt dọc), lặp cho góc. Áp cho cả người & bot. Flood-fill KHÔNG đọc biên.
3. **Hiển thị:** vẽ biên là đường LINE trong game (3D) + minimap; **toggle** (dùng `map.showColliders`
   sẵn có, hoặc thêm `showBoundaries`). `ObstacleCollider` bổ sung vẽ `boundaries`.
4. **Trình vẽ biên mới (editor, công cụ Biên — CHỈ vẽ line):**
   - **Điểm snap = đỉnh hex.** Vẽ **stroke** bình thường; **di chuột vào** point snap ⇒ **fill màu**.
   - **Bấm khi đang hover point** ⇒ chọn đúng đỉnh đó; **bấm ngoài point** ⇒ lấy **vị trí chuột** làm
     điểm (tự do, không snap).
   - **Enter** ⇒ tạo/hoàn tất biên (một polyline). Biên hiện dạng đường line, toggle hiển thị.
   - **Chọn biên đã tạo** ⇒ chọn **nút cuối** ⇒ **vẽ tiếp** (nối thêm điểm).
   - **Backspace** xoá **nút** biên (nút cuối / nút đang chọn); nút **Delete** xoá **cả đường biên**.
   - Round-trip `map.boundaries`. (Công cụ Chướng ngại giữ nguyên tô ô.)

**Lát:** D1 shared data `boundaries` + resolve · D2 shared va chạm collide-and-slide theo đoạn (THÊM,
giữ collider ô) + test · D3 client render biên (3D + minimap) + toggle · D4 editor: đổi công cụ Biên
sang vẽ line (snap fill/hover, chọn/nối/xoá nút, Delete biên, Enter) + round-trip.
**Rủi ro:** CAO — thêm mô hình va chạm đoạn + UI editor lớn. Làm sau A/B/C. Test va chạm biên kỹ.

## Thứ tự đề xuất
```
C (minimap, nhỏ) → A (King) → B (cứ điểm) → D (biên, lớn nhất)
```
Mỗi nhóm commit riêng; D chia D1→D5.

## Trạng thái thực thi (đã code)
- **C ✅** GameState.arenaR/arenaInradius; MiniMap theo bán kính cấp.
- **A ✅** rules.kingEnabled gate King; editor objective king_hold (phút + kingPct); HUD hiển thị.
- **B ✅** map.strongholds (ô+botCount) spawn/respawn/capture; rules.botsAllied (bot cùng màu, không sát
  thương nhau); StrongholdInstances 3D + minimap; công cụ 🚩 Cứ điểm.
- **D ✅** map.boundaries (polyline) va chạm collide-and-slide theo đoạn (thêm, giữ collider ô);
  ObstacleCollider + minimap vẽ biên (toggle qua showColliders); công cụ ✏️ Biên vẽ LINE: snap
  fill-on-hover / click tự do, Enter tạo, Backspace xoá nút, Esc huỷ, bấm điểm cuối để vẽ tiếp, Xoá biên.

**Build/test:** shared 139 + client 58 + server 56 xanh; typecheck 4 gói + builds xanh. Verify live:
King fields, đặt cứ điểm "1 cứ điểm (3 bot)", tạo biên "1 BIÊN". Cảm giác lái/3D/minimap cần hiện pane.

## Cần chốt thêm
- (Đã chốt hết các điểm chính.) Chi tiết nhỏ giải quyết khi làm: hình marker cứ điểm 3D, màu bot đồng
  minh cụ thể, cổng zoom hiển thị biên trên minimap.

## Tiêu chí đóng (mỗi nhóm)
- **A:** cấp king_hold: giữ King đủ phút ⇒ thắng; cấp khác KHÔNG có King (bot respawn/join không bị khoá).
- **B:** bot hồi sinh ở cứ điểm sau 3s; chiếm hết cứ điểm ⇒ bot ngừng hồi sinh; render + minimap.
- **C:** minimap khớp bán kính cấp (obstacle/lãnh thổ đúng tỉ lệ).
- **D:** collider chỉ còn biên admin vẽ; va chạm trượt dọc biên không xuyên; toggle hiển thị; editor
  chọn/nối/xoá nút + xoá biên + snap fill-on-hover.
- Build 4 gói + test thuần TS xanh; cấp không dùng field mới ⇒ bất biến.

---
Xem thêm: [33](33-obstacle-collider-plan.md) · [32](32-custom-totem-authoring-plan.md) · `state.ts` (King/spawn) · `MiniMap.tsx`.
