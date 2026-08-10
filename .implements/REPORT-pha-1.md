# Báo cáo — Pha 1: Gameplay hoàn thiện (local)

Ngày: 2026-08-08 · Phạm vi: MVP local, single-player + bots (không server/mạng).
Cách làm: chia việc cho **sub-agent** theo từng ĐỢT để không giẫm chân nhau trên các file
chung (`state.ts`, `config.ts`, `GameScene.tsx`, `HUD.tsx`). Mọi kết quả đều được
**verify độc lập** (không chỉ tin báo cáo của agent).

## Tổng quan hạng mục Pha 1

| Hạng mục (05-roadmap) | Trạng thái | Ghi chú |
|---|---|---|
| Bot AI đối kháng | ✅ (phiên trước) | đa thực thể, cắt đuôi hạ nhau |
| Cơ chế thắng: giữ King 3 phút + đồng hồ + màn hình thắng | ✅ Đợt 1 | |
| Camera zoom theo diện tích + minimap | ✅ (minimap phiên trước) + Đợt 2 | |
| Hiệu ứng: particle khi chết + lóe khi chiếm | ✅ Đợt 2 | fill-animation từng-ô để pha sau |
| Mobile: joystick ảo | ✅ Đợt 3 | nút kỹ năng chỉ là placeholder khoá |
| Unit test hex math & flood fill (Vitest) | ✅ Đợt 1 (28 test) | `npm test` bị chặn quyền — xem mục ⚠️ |

## Chia việc theo đợt (sub-agents)

### Đợt 1 — song song (file rời nhau)
**① Cơ chế thắng.** Giữ ngôi King (≥ `KING_PCT` = 20%) liên tục `WIN_HOLD_TIME` = 180s → thắng.
- `config.ts`: thêm `WIN_HOLD_TIME: 180`.
- `state.ts`: thêm `GameState.kingHoldRemaining`, `won`; đếm giờ ở cuối `update(dt)`
  (chạy khi người chơi còn sống & đang là King, tụt < 20% thì reset đồng hồ);
  `update()` early-return khi `won`; thêm `restart()` (dọn sạch lưới, respawn mọi thực thể,
  `deaths=0`, về pha chuẩn bị).
- `HUD.tsx`: đồng hồ đếm ngược "Giữ ngôi: m:ss" dưới banner 👑; màn hình 🏆 **CHIẾN THẮNG!**
  + nút **▶ CHƠI LẠI** (`onRestart`).
- `GameScene.tsx`: đẩy `won`/`kingHold` vào stats; `onRestart → game.restart()`.

**② Vitest.** Dựng framework test + 28 unit test (3 file) cho logic thuần.
- `vitest.config.ts` (node env, globals), `src/game/__tests__/{hex,floodfill,state}.test.ts`.
- `package.json`: devDep `vitest@^4.1.10` + script `test`/`test:watch`.
- Bao phủ: công thức số ô `mapCells`, `hexLinedraw`, round-trip `axialToPixel↔pixelToAxial`,
  `captureEnclosed`, và hành vi `GameState` (khép vòng→7 ô, tự cắt đuôi→chết→hồi sinh,
  trượt tường lục giác, đứng yên khi chuẩn bị, khởi tạo & hoạt động bot).

### Đợt 2 — camera zoom + juice (một agent, tuần tự sau Đợt 1)
- `config.ts`: `CAMERA.ZOOM = { MIN: 1, MAX: 1.7 }`, `EFFECTS = { PARTICLES: 14, LIFE: 0.8 }`.
- `GameScene.tsx`: camera **zoom mượt theo diện tích** — `t = clamp(pct/KING_PCT,0,1)`,
  hệ số `MIN + t·(MAX−MIN)` nhân vào `oy`/`oz` rồi mới lerp; giữ nguyên rotation khoá & pan.
- `Effects.tsx` (mới): **một** hệ hạt gộp `THREE.Points` (trần 300 hạt, không cấp phát mỗi
  frame). Nổ hạt màu glow khi thực thể **chết** (`deaths` tăng); lóe hạt màu owned khi
  **chiếm đất** (`owned.size` tăng — bản MVP thay cho animation tô từng ô).

### Đợt 3 — mobile joystick (một agent)
- `config.ts`: `JOYSTICK = { SIZE: 132, KNOB: 56, DEADZONE: 0.18 }`.
- `Joystick.tsx` (mới): overlay cảm ứng góc dưới-trái (pointer events + `setPointerCapture`),
  chỉ hiện khi `matchMedia('(pointer: coarse)')` → **không ảnh hưởng chuột desktop** (render `null`).
  Ánh xạ hướng `angle = atan2(-oy, ox)` (lật trục y của DOM để kéo lên = tiến về world +y).
  Kèm nút 🔒 placeholder (vật phẩm/kỹ năng ở Pha 4, chưa nối hành vi).
- `GameScene.tsx`: joystick **ưu tiên hơn chuột** — khi đang giữ thì set heading từ joystick
  và bỏ qua nhánh raycast chuột trong frame đó.

## Kết quả verify (tự chạy lại, không chỉ tin agent)

- `npx tsc --noEmit` → **chỉ 4 lỗi** `TS2307 Cannot find module 'vitest'` (do chặn cài, xem ⚠️),
  **không lỗi nào** trong file game/UI.
- `npx tsx scripts/verify-logic.ts` → **36 pass, 0 fail** (sau mỗi đợt).
- Vitest → **28 passed (3 files)** (chạy qua bản cài ở thư mục user do node_modules bị chặn).
- Kiểm tra riêng cơ chế thắng (script tạm): thắng đúng mốc 180s; đồng hồ reset khi tụt < 20%;
  `restart()` về 7 ô + pha chuẩn bị + deaths=0.

### Sửa phát sinh
`scripts/verify-logic.ts` hàm `go()` hardcode `axialToPixel(..., 1)` trong khi
`CONFIG.HEX_SIZE=0.75` (drift từ phiên trước) → test `[4] owned=7` sai. Đã đổi sang dùng
`CONFIG.HEX_SIZE` → trở lại 36/0.

## ⚠️ Chặn môi trường (KHÔNG phải lỗi code) — cần bạn xử lý

`node_modules` thuộc sở hữu **`root`**, user hiện tại là `quangnguyen` → `npm install`
(kể cả cài `vitest`) báo `EACCES`. Vì vậy `npm test` **chưa chạy tại chỗ** và `tsc` còn 4 lỗi
thiếu module `vitest`. Sửa quyền (cần mật khẩu nên agent không tự chạy):

```bash
sudo chown -R "$(whoami)" node_modules && npm install
```

Sau đó `npm test` sẽ xanh (28 test) và 4 lỗi `tsc` biến mất.

## File thay đổi/ tạo mới

- Mới: `src/components/Effects.tsx`, `src/components/Joystick.tsx`,
  `src/game/__tests__/{hex,floodfill,state}.test.ts`, `vitest.config.ts`, và tài liệu này.
- Sửa: `src/game/state.ts`, `src/game/config.ts`, `src/components/GameScene.tsx`,
  `src/components/HUD.tsx`, `package.json`, `package-lock.json`, `scripts/verify-logic.ts`,
  `.implements/{README,05-roadmap}.md`.

## Cập nhật đối kháng (sau Pha 1, theo yêu cầu người chơi)

1. **Cắt đuôi ở mọi ô** — sửa thứ tự trong `enterHex`: xét ô-đuôi **trước** ô-đất-của-mình
   → đâm đuôi đối thủ ở **bất kỳ ô nào** (kể cả khi đoạn đuôi nằm trong đất mình) đều hạ
   đối thủ. (Test [13])
2. **Va chạm ĐẦU trên sân nhà** — `GameState.resolveHeadCollisions()` gọi mỗi frame: đầu
   kẻ xâm nhập đứng trên **đất của mình** và sát đầu mình (≤ `CONFIG.KILL_RADIUS`) → kẻ xâm
   nhập chết; chủ đất bất khả xâm phạm. (Test [14])
3. **Spawn tránh xa đất đã chiếm** — `CONFIG.SPAWN_CLEARANCE`. (Test [10])
4. **Khoá phòng khi có KING** — `kingId()`/`roomLocked()`; chặn bot tự hồi sinh & nút Hồi
   sinh của người chơi khi đã có King; mở lại khi mất ngôi. HUD hiện trạng thái khoá.
   (Test [11], [12])
5. **Bot AI nâng cao** — FSM `EXPAND/RETURN/HUNT/FLEE` trong `botThink()`, né đuôi mình +
   né tường (`steerAvoiding`/`aheadBlocked`), săn cắt đuôi (`nearestEntity`/
   `nearestTrailPoint`), và **độ khó tham số hoá** `CONFIG.BOT_DIFFICULTY` (Dễ/Thường/Khó,
   gán luân phiên).

Kiểm chứng: **verify-logic 51 pass / 0 fail**, **vitest 28/28**, `tsc` chỉ còn 4 lỗi thiếu
module `vitest` (chặn quyền `node_modules`).

## Vòng chỉnh sửa 2 (đối kháng + quy mô)

1. **Thắng do đấu loại** — `checkWin()`: phòng có KING + chỉ còn 1 thực thể sống → thắng
   ngay; `winnerId` cho biết ai. Win "giữ ngôi" tổng quát cho **mọi** KING (không chỉ
   người chơi). HUD hiện màn 🏆 CHIẾN THẮNG (winnerId=0) hoặc ☠️ THUA CUỘC. (Test [16])
2. **Hạ đối thủ → chiếm sạch đất** — `kill(e, killer)` chuyển toàn bộ đất nạn nhân cho
   kẻ hạ (cắt đuôi & va đầu); tự chết → đất trung lập. (Test [15])
3. **Đường viền ô** (#3) — chuyển render sang **chỉ instance ô đã tô** (đất+đuôi) trên
   một **nền lục giác** (`Ground`); ô ở scale 0.86 để nền lộ ra thành viền, tách cả ô
   cùng màu.
4. **Bản đồ siêu lớn** (#4) — instancing: **có**. Ở `ARENA_RADIUS=600` có **644k ô** →
   các điểm nóng đã sửa: `spawn` claim cụm O(R²) thay vì O(map); `pickSpawnHex` lấy mẫu
   điểm ngẫu nhiên + kiểm tra clearance chỉ trên ô đã chiếm (O(owned)); render chỉ ô đã
   tô; MiniMap duyệt `forEachOwned`. Dựng 20 bot: ~850ms (một lần); update 60 frame: ~3ms.
   *Khuyến nghị:* nền/biên đã tách khỏi số ô nên chịu map lớn; chi phí còn lại ~ số ô
   **đã chiếm** (thực chơi), không phải tổng ô.
5. **Biên ảo + extrude** (#5) — bỏ `Walls`; các ô NGOÀI vùng chơi (`map \ playable`) được
   extrude thành lăng trụ (`BorderRim`) làm vành ranh giới; va chạm vẫn do `insideArena`.

Kiểm chứng: **verify-logic 57/0**, `tsc` chỉ 4 lỗi `vitest`, `/play` mount không lỗi console.

## Vòng chỉnh sửa 3 (hiển thị lãnh thổ)

1. **Khôi phục lưới hex cho ô trung lập** — hoàn tác cách "chỉ instance ô đã tô + nền
   phẳng" của vòng 2 (làm ô trung lập mất dạng lục giác). `HexGridView` trở lại instance
   **mọi ô playable** (hợp map vừa/nhỏ; `ARENA_RADIUS=30` hiện tại). Đã bỏ `Ground`.
2. **Vạch vàng phân tách người trùng màu** (`TerritoryBorders`) — `LineSegments` vàng ở
   **cạnh chung giữa hai ô cùng màu (id%6 trùng) nhưng khác chủ**. Dựng lại theo
   `gridRevision`, chỉ xét 3 hướng/ô để mỗi cạnh vẽ 1 lần.

> Lưu ý quy mô: khôi phục instance-toàn-ô hợp map vừa/nhỏ. Nếu lại đẩy map cực lớn
> (hàng trăm nghìn ô) thì cần quay lại hướng "nền + chỉ instance ô đã tô + lưới bằng
> shader/texture".

## Vòng chỉnh sửa 4 (va chạm trung lập, vạch vàng, spawn strict)

1. **Va đầu ở ô trung lập → cả hai chết** — `resolveHeadCollisions` viết lại theo cặp
   (i<j): kẻ xâm nhập trên sân nhà đối phương chết (đất về chủ nhà); **cả hai đều ở ngoài
   sân nhà mà đâm đầu → cùng chết, mất sạch đất**. (Test [17])
2. **Vạch vàng dày + phát sáng** — `TerritoryBorders` chuyển từ line 1px sang **mesh quad**
   dày (`CONFIG.BORDER.WIDTH`) màu vàng **additive** (`CONFIG.BORDER.GLOW`).
3. **Hồi sinh strict** — `pickSpawnHex` tuân thủ **tuyệt đối** `SPAWN_CLEARANCE` (bỏ nới
   lỏng), quét xác định để khẳng định còn/​hết chỗ, trả `null` nếu bản đồ đầy. `spawn()`
   trả boolean; `revive()`/bot-respawn không spawn khi hết chỗ; thêm `canRevive()`; HUD
   báo "bản đồ đã đủ ô đất · chưa có chỗ" và khoá nút cho tới khi có ô trống hợp lệ.
   (Test [18])

Kiểm chứng: **verify-logic 66/0**, `tsc` chỉ 4 lỗi `vitest`, `/play` mount không lỗi console.

## Vòng chỉnh sửa 5 (chế độ khán giả)

- **Xem (khán giả) khi chết** — popup chết có thêm nút **👁 XEM**. `GameState.spectating`;
  `spectate()` bật khi human dead; `revive()`/`canRevive()` trả false khi đang xem →
  không hồi sinh nữa, phải `restart()` (hết ván) mới chơi lại. Camera bám `leaderId()`
  (thực thể còn sống nhiều đất nhất) khi đang xem; HUD hiện banner "👁 Đang xem · chờ hết
  ván" thay cho popup. (Test [19])

Kiểm chứng: **verify-logic 74/0**, `tsc` chỉ 4 lỗi `vitest`, `/play` mount không lỗi.

## Ngoài phạm vi / để pha sau
- Fill-animation tô từng ô khi chiếm (hiện dùng lóe hạt thay thế).
- Nút kỹ năng dùng vật phẩm (totem ở Pha 4).
- Xác minh gameplay động bằng mắt trong preview — bị chặn do khung Browser pane ẩn
  (rAF tạm dừng); đã bù bằng unit test + verify-logic + kiểm tra win riêng.
