# Báo cáo — Pha 2: Nền tảng multiplayer (server authoritative)

Ngày: 2026-08-09 · Phạm vi do người dùng chốt: **pnpm + NestJS đúng tài liệu**, làm một
**"lát cắt dọc verify được"** (client↔server chạy thật, kiểm chứng headless — preview pane
treo rAF nên không xem gameplay động).

Cách làm: **tái cấu trúc monorepo (tuần tự) do một mình đảm nhiệm** để không ai giẫm chân,
rồi **chia 2 sub-agent song song** trên các gói RỜI NHAU. Mọi kết quả agent đều được
**verify độc lập** (tự chạy lại build/test, không chỉ tin báo cáo) + một **e2e xuyên gói**.

## Tổng quan hạng mục Pha 2 (05-roadmap)

| Hạng mục | Trạng thái | Ghi chú |
|---|---|---|
| Tách `packages/shared` (monorepo pnpm) | ✅ | pnpm workspaces qua corepack; `shared`/`client`/`server` |
| Server NestJS: GameRoom authoritative, tick 20–30 Hz | ✅ | 24 Hz, bước cố định bù trôi |
| Transport `ws` thuần, snapshot broadcast | ✅ | SNAPSHOT nhị phân per-client kèm `ackSeq` |
| Client prediction + interpolation | ✅ | `stepHead` khớp server; interp trễ ~100ms |
| Spatial hashing cho va chạm | ✅ | `SpatialHash` broad-phase va chạm đầu |

## 1) Nền tảng monorepo (tự làm — điểm nối tuần tự)

- Tách `src/game/*` → `packages/shared/src/*` (@hexagon/shared, build `tsc` → `dist` CJS),
  `app` + `src/components` → `packages/client` (@hexagon/client), khung `packages/server`
  (@hexagon/server). Mọi import `@/game/*` của client rewrite sang `@hexagon/shared`.
- Công cụ: **pnpm 11.20.0 qua corepack**. `.npmrc`: `node-linker=hoisted` (tránh peer-dep
  Next/Three/Nest) + `verify-deps-before-run=false`.
- **Hợp đồng cho multiplayer thêm vào `shared`** (do mình viết để 2 agent bám interface ổn định):
  - `protocol.ts` — điều khiển JSON (JOIN/WELCOME/EVENT/PING/PONG) qua text frame; hot-path
    **nhị phân** qua `DataView`: `encodeInput/decodeInput`, `encodeSnapshot/decodeSnapshot`
    (header `tick`+`ackSeq`+`count`, mỗi entity 20B). Server authoritative: client chỉ gửi
    heading; `ackSeq` cho reconciliation.
  - `spatialhash.ts` — `SpatialHash` (bucket theo `cellSize`); `forEachPair(r)` gom cặp
    trong bán kính. Tích hợp vào `GameState.resolveHeadCollisions` (cellSize=`KILL_RADIUS`,
    gom cặp → sort → xử lý) — **giữ nguyên semantics & thứ tự tất định** của bản O(n²) cũ.
  - `GameState`: constructor thêm tham số `humanCount` (ghế người vs bot; mặc định 1 =
    single-player CŨ KHÔNG ĐỔI), `setTargetHeading(id,angle)`, `snapshotEntities()`.

## 2) Chia việc sub-agent (song song, file rời nhau)

### Agent A — `packages/server/**` (NestJS + ws authoritative)
- `game/game-room.ts` (class thuần): giữ `GameState(_, BOT_COUNT, MAX_PLAYERS=8)` → ghế
  0..7 là người, 8..27 là bot; `join()/leave()/applyInput()/stepTick(dt)/buildSnapshotFor()`.
- `net/net-server.ts` (class thuần): `ws.WebSocketServer`, vòng lặp **bước cố định bù trôi**
  (accumulator, trần 5 tick), broadcast snapshot per-client; tách `listen()`/`tickOnce()` để
  test lái tick tất định; `port` đọc cổng thật (hỗ trợ port 0).
- `game.module.ts` + `main.ts`: NestJS **bọc bootstrap** qua `NestFactory.createApplicationContext`
  (KHÔNG HTTP platform), DI qua token chuỗi (`@Inject(GAME_ROOM)` + `useFactory`).
- **Chống gian lận cơ bản:** chỉ nhận heading (không nhận vị trí); bỏ input của ghế không sở
  hữu / seq cũ / heading không hữu hạn; bỏ frame nhị phân khi chưa JOIN.

### Agent B — `packages/client/src/net/**` (net layer + predict/interp)
- `stepHead.ts` (thuần): động học đầu — **sao y `updateEntity` của server** (quay giới hạn
  `TURN_RATE`, đi `SPEED*dt`, `clampInside`, heading theo hướng đi thực). Nguồn chân lý chung.
- `prediction.ts`: `predict/reconcile` + lớp `Predictor` — bỏ input `seq<=ackSeq`, replay
  phần còn lại từ trạng thái server.
- `interpolation.ts`: `InterpolationBuffer` — nội suy x/y + heading theo cung ngắn qua mối
  nối −π/π, trễ `INTERP_DELAY_MS=100`.
- `NetClient.ts` + `useNetClient.ts` + `app/netplay/page.tsx` (canvas 2D hiển thị chấm thực
  thể; single-player R3F giữ nguyên).

## Bẫy toolchain đã xử lý

- **Policy supply-chain của pnpm:** mỗi install yêu cầu quyết định `true/false` cho build
  script, nếu chưa quyết → `ERR_PNPM_IGNORED_BUILDS` + exit 1 (chặn cả `tsc`/`vitest` vì
  pnpm 11 chạy deps-check trước mỗi `run`). Sửa: `allowBuilds: {esbuild:true, sharp:true}`
  trong `pnpm-workspace.yaml`.
- **vitest chạy TS qua esbuild → KHÔNG có `emitDecoratorMetadata`** → DI theo kiểu của
  NestJS hỏng dưới vitest. Giải: mọi logic ở **class thuần** dựng trực tiếp trong test;
  NestJS chỉ dùng ở bootstrap production (nest build có metadata).

## Kết quả verify (tự chạy lại — không chỉ tin agent)

- `pnpm --filter @hexagon/shared build` → `dist` đầy đủ (gồm protocol, spatialhash). ✅
- **verify-logic 93 pass / 0 fail** (spatial-hash + humanCount không phá hành vi). ✅
- **vitest:** shared **41** (28 cũ + 13 mới: protocol khứ hồi, spatial-hash **khớp
  brute-force O(n²)**) · client **15** (stepHead/reconcile/interp) · server **1** (tích hợp:
  2 client ws thật JOIN → WELCOME id khác nhau → INPUT → sau prep vị trí do server tính đổi,
  `ackSeq` đúng, 28 entity). ✅
- **e2e xuyên gói** (script scratch): `Predictor` thật của client ↔ `NetServer` thật qua ws
  thật → (1) vị trí authoritative **di chuyển 22.92 đơn vị** sau prep; (2) dự đoán client
  **hội tụ đúng authority, drift = 0** khi hết input chờ. **4/4 PASS.** ✅
- `pnpm --filter @hexagon/server build` (nest build) ✅ · `pnpm --filter @hexagon/client build`
  (`next build`: `/`, `/play`, `/netplay` prerender) ✅ · mọi `typecheck` sạch. ✅

## File chính (tạo/sửa)

- Gốc: `pnpm-workspace.yaml`, `.npmrc`, `tsconfig.base.json`, `package.json` (workspace scripts).
- `packages/shared`: `package.json`, `tsconfig.json`, `vitest.config.ts`, `src/index.ts`,
  **mới** `src/protocol.ts`, `src/spatialhash.ts`, `src/__tests__/{protocol,spatialhash}.test.ts`;
  **sửa** `src/state.ts` (humanCount, setTargetHeading, snapshotEntities, spatial-hash collisions),
  `scripts/verify-logic.ts` (đường import).
- `packages/client`: `package.json`, `tsconfig.json`, `next.config.mjs`; **mới** `src/net/*`
  (stepHead, prediction, interpolation, NetClient, useNetClient), `app/netplay/page.tsx`,
  `vitest.net.config.mts`, `src/net/__tests__/*`; component cũ đổi import sang `@hexagon/shared`.
- `packages/server`: `package.json`, `tsconfig.json`, `nest-cli.json`; **mới** `src/*`
  (config, game/game-room, game/game.module, net/net-server, app.module, main),
  `test/integration.spec.ts`, `vitest.integration.config.ts`.

## Vòng bổ sung: Giao diện trang chủ + Online CHƠI ĐƯỢC (đồng bộ lãnh thổ)

Theo yêu cầu người dùng: (1) trang chủ là bảng nhập tên + chọn chế độ, chơi THẲNG trên
trang (không đổi route); (2) netplay (trước chỉ là chấm 2D) phải chơi được ĐẦY ĐỦ. Chốt
"online đầy đủ — đồng bộ lãnh thổ".

**Đồng bộ lãnh thổ qua mạng:**
- `protocol.ts`: thêm `TAG.TERRITORY` + `encodeTerritory/decodeTerritory` (FULL keyframe:
  i16 q,r · u8 owner · u8 kind[đất/đuôi]; throttle ~4Hz; delta+AoI để Pha 3).
- `GameState`: `territoryCells()` (server liệt kê), `applyEntity()` + `applyTerritory()` +
  `pctOf(id)` + `respawn(id)` (client dựng view; hồi sinh online). Client tạo `new GameState`
  rồi CHỈ đẩy trạng thái mạng vào → **TÁI DÙNG toàn bộ renderer 3D** (lưới, chiếm đất, biên,
  minimap) y hệt chơi đơn.
- Server: `NetServer.broadcastTerritory()` (4Hz) + gửi ngay khi JOIN; `revive` message →
  `GameRoom.reviveSeat`/`gs.respawn`; JOIN vào ghế chết cũng tự respawn.

**Client UI:**
- `StartPanel.tsx`: bảng nhập tên (nhớ qua localStorage) + 2 thẻ chế độ (Chơi đơn / Nhiều
  người) + ô địa chỉ server (khi online). `app/page.tsx`: chọn xong render THẲNG scene
  (dynamic, ssr:false), nút "← Menu" quay lại — KHÔNG đổi route.
- `NetGameScene.tsx`: scene online đầy đủ (predict self · nội suy others · dựng lưới từ
  keyframe · camera bám · HUD/minimap theo `localId` · popup chết + hồi sinh · thắng).
- `GameScene`/`HUD`/`MiniMap`: thêm `playerName`/`localId` (HUD hết hardcode id 0), nút Menu.
- `/play` (chơi đơn) & `/netplay` (online đầy đủ) vẫn dùng được như route trực tiếp.

**Kiểm chứng:** e2e xuyên gói mở rộng **6/6** — thêm (3) client nhận 21 keyframe TERRITORY
(414 ô); (4) `GameState`-view dựng từ keyframe có lãnh thổ người chơi (`pctOf=0.20%`). Tất
cả test: shared 43 · client 15 · server 1 · verify-logic 93/0 · `next build` (`/`, `/play`,
`/netplay`). **Trực quan (trình duyệt):** trang chủ render đúng; chọn Chơi đơn → mount tại
chỗ (HUD/minimap/prep/Menu), không lỗi console, URL không đổi; chọn Nhiều người → **kết nối
server thật ("● Online · id 0")**, minimap nhận 28 thực thể từ mạng. *Canvas 3D chính hiện
tối trong preview pane do rAF bị bóp (camera chưa kịp lerp tới cụm ô sáng của người chơi) —
giới hạn môi trường đã biết từ Pha 1; mở bằng trình duyệt thật sẽ thấy đầy đủ.*

## Sửa lỗi: vòng đời PHÒNG + prep online

**Triệu chứng:** vào Nhiều người bị popup "đã chết" và không di chuyển được.
**Nguyên nhân:** server chạy MỘT phòng vĩnh viễn từ lúc boot → sau vài phút một bot đạt
KING/thắng ván → `update()` đóng băng + phòng bị khoá → người mới nhận ghế cũ (đã chết),
`respawn` bị chặn (roomLocked) → chết cứng.

**Sửa — vòng đời phòng (`NetServer` viết lại):** không tạo phòng/bot khi trống; phòng
được TẠO khi có người JOIN; ĐÓNG khi (a) hết người, hoặc (b) ván kết thúc (sau grace 8s để
xem kết quả). Người vào khi phòng hiện tại đã kết thúc → tạo phòng MỚI (fresh) → không bao
giờ "vào phòng đã tàn". Hỗ trợ nhiều phòng song song theo nhu cầu. NestJS bootstrap chỉ tạo
`NetServer` (bỏ GAME_ROOM DI).

**Prep online:** SNAPSHOT thêm `selfPrep` (ms chuẩn bị còn lại của client) → HUD online hiện
đếm ngược "3,2,1" (giải thích 3s đầu đứng yên). Khi prep, client `sendAim` (chỉ ngắm, không
dự đoán tiến) để không giật.

**Kiểm chứng:** integration **2/2** (thêm test "phòng tạo khi JOIN, ĐÓNG khi hết người" +
`selfPrep` trong snapshot); e2e 6/6; shared 43 · client 15 · verify-logic 93/0 · next build.
**Trình duyệt:** vào Nhiều người → "● Online · id N", **KHÔNG còn popup chết**, người chơi
sống trong sân (minimap có chấm trắng), console sạch.

## Sửa lỗi vòng 2: mượt/ping, EADDRINUSE, BOT_COUNT

1. **Giật (mượt hoá) + ping:** lỗi ở `InterpolationBuffer` — `sample()` mặc định dùng
   `renderTime = latestTime - delay` (thời điểm snapshot cuối), nên giữa 2 snapshot thời
   gian nội suy đứng yên → thực thể từ xa nhảy theo 24Hz. Sửa: `NetClient.getRenderState`
   lấy mẫu tại `now() - INTERP_DELAY_MS` → nội suy tiến LIÊN TỤC ở 60fps. Thêm **ping (RTT)**:
   client PING mỗi 1s, server PONG; hiện `id · Nms` ở chip (cập nhật qua interval độc lập rAF).
2. **EADDRINUSE :::8910:** do tiến trình server nền còn giữ cổng (từ phiên trước). Không có
   lỗi code; đã dọn tiến trình. (Chạy lại: `pnpm --filter @hexagon/server start:dev`.)
3. **Đổi BOT_COUNT ở shared không nhận:** client/server dùng `@hexagon/shared` từ `dist` →
   phải **rebuild shared** thì mới đổi. Sửa DX: `start:dev`/`dev`/`build` nay **tự build
   shared trước**. Và WELCOME mang `maxPlayers`+`botCount` → `NetGameScene` dựng view đúng
   số thực thể của server (hết hardcode; đổi BOT_COUNT là khớp cả hai bên). *Lưu ý: đổi config
   shared cần KHỞI ĐỘNG LẠI client & server để nạp bản build mới.*

## Sửa lỗi vòng 3: đường đuôi online + phòng chờ (matchmaking người thật)

1. **Online thiếu ĐƯỜNG đuôi (tube):** scene online trước chỉ vẽ đuôi dạng Ô (cellTrail),
   chưa vẽ ống đuôi mượt như chơi đơn vì `TrailLine` cần `entity.trailPoints` (đường liên
   tục) mà online chưa dựng. Sửa trong `shared/state.ts`:
   - `applyTerritory()` dựng lại `trailPoints` từ **tâm các ô đuôi** theo thứ tự server gửi
     (cellTrail theo thời gian) cho MỌI thực thể.
   - `applyEntity()` thêm **chóp đuôi sống** bám đầu (điểm cuối = vị trí đầu hiện tại) → ống
     đuôi nối liền tới cube, mượt giữa các keyframe (keyframe chỉ ~4Hz).
   - `NetGameScene` render thêm `<TrailLine game={game} />`.
2. **Phòng NHIỀU NGƯỜI = matchmaking người thật:**
   - UI: nút online đổi thành **"🔍 Tìm phòng chơi"** (solo giữ "▶ Bắt đầu chơi"); mô tả
     card nêu rõ *tối thiểu 2 người, không bot*.
   - Server: phòng online tạo với **0 bot** (`ONLINE_BOTS`); ghế CHƯA có người được **"đỗ"**
     (`GameState.park(id)` → chết & trả đất/đuôi, không tự hồi sinh, không "bóng ma").
   - **Điều kiện bắt đầu = ≥ `MIN_PLAYERS` (2) người thật.** Chưa đủ → phòng ở trạng thái
     **CHỜ**: không mô phỏng, không snapshot; chỉ phát control `lobby {present, needed,
     started}`. Đủ người → `startGame()` bật vòng lặp, prep đồng loạt.
   - Client: `NetClient` xử lý `lobby` (handler `onLobby` + `getLobby`); `NetGameScene` hiện
     **màn "Đang chờ người chơi… present/needed"** (spinner) tới khi `started`, rồi mới vào
     trận. Vào phòng nếu chưa có → tạo ngay & chờ; hết người → đóng (giữ cơ chế cũ).

**Kiểm chứng:** shared 43 · server typecheck sạch · integration **2/2** (cập nhật: online
0 bot → snapshot đúng `MAX_PLAYERS` ghế) · client typecheck sạch · net 15/15. Script
`verify-lobby.ts` PASS toàn bộ: chờ→đủ 2 người mới `started`, 0 bot, keyframe TERRITORY có
ô đuôi (kind=1) để vẽ đường đuôi, còn 1 người sau khi bắt đầu phòng vẫn chạy, hết người thì
đóng. Trình duyệt: card "Nhiều người" + nút "🔍 Tìm phòng chơi" hiển thị đúng.
*Lưu ý: đã sửa `shared`+`server` → cần khởi động lại server (8910) và refresh client.*

## Sửa lỗi vòng 4: đuôi mượt (theo đầu) + hồi sinh 1 mình → về matching

1. **Đuôi online giật/nhiễu, vẽ về tâm ô:** vòng 3 dựng `trailPoints` từ **tâm ô lục giác**
   → đường zig-zag về tâm ô. Sửa: `applyEntity(id,x,y,heading,alive,hasTrail)` **tích luỹ
   ĐÚNG vị trí đầu** (đã dự đoán/nội suy) khi `hasTrail`, giãn cách theo `TRAIL_POINT_DIST`;
   khép vòng/chết (`hasTrail=false`) → xoá đường. Bỏ dựng-từ-tâm-ô trong `applyTerritory`
   (ô đuôi TÔ MÀU nền vẫn từ keyframe). Kết quả: đường line đi tới đâu theo đầu tới đó,
   giống chơi đơn. `NetGameScene` truyền `hasTrail` cho cả self lẫn others.
2. **Hồi sinh khi còn 1 mình vẫn chơi được:** khi đang chơi mà **tụt dưới `MIN_PLAYERS`**
   (người kia rời) → `NetServer.revertToWaiting()`: dừng mô phỏng, `parkAll()`, phát
   `lobby{started:false}` → người còn lại **quay về màn matching** (chờ đủ người). Đủ người
   trở lại → `startGame()` gọi `GameRoom.startMatch()` spawn tươi ĐỒNG BỘ mọi ghế → ván mới.
   Client reset trạng thái chết/thắng khi CHỜ→VÀO TRẬN (guard `startedRef`).

**Kiểm chứng:** shared 43 · server typecheck sạch · integration 2/2 · client typecheck sạch ·
net 15/15. Unit: đuôi tích luỹ theo đầu (không về tâm ô), throttle, xoá khi hết đuôi.
`verify-revert.ts` PASS: 2 người→chơi; 1 người rời→người còn lại `started=false` (về
matching), phòng vẫn tồn tại; người mới vào→`started=true` ván mới; hết người→đóng. Live
server (nest --watch) đã tự rebuild+restart theo thay đổi.

## Sửa lỗi vòng 5: tên người chơi, thắng khi còn 1, chết ở tường, freeze chết (solo)

1. **Tên người chơi online sai (hiện tên màu):** JOIN đã mang `name` nhưng server không
   phát. Thêm control `roster {players:[{id,name}]}`; `Entity.name` + `GameState.setName/
   nameOf`; `scores()`/king/winner/killer dùng `nameOf` (fallback tên màu). Server lưu tên ở
   `GameRoom.join(name)`, phát roster khi join/leave; client `NetClient.onRoster` → áp vào view.
   Chơi đơn cũng gán tên ghế 0.
2. **Còn 1 người nhưng không báo THẮNG (bị đẩy về matching):** tách 2 trường hợp khi phòng
   tụt xuống 1 người lúc đang chơi (`handleLastPlayer`): người còn lại **CÒN SỐNG → THẮNG**
   (`declareWinner` + event win + markEnded, xem màn thắng); **đã CHẾT → về matching**
   (`revertToWaiting`). (Trước đó luôn về matching.)
3. **Đâm thẳng vào tường/GÓC bị chết oan:** tái hiện được — đầu bị GHIM ở tường/đỉnh, clamp
   làm đầu giật vào ô ĐUÔI vừa vẽ → "tự đâm đuôi" oan. Sửa `updateEntity`: khi **bị tường
   chặn** (`moved < dist`, tức clamp có cắt bước) và ô kế là đuôi của chính mình → **KHÔNG
   bước vào** (trượt/đứng sát tường). Trong sân trống clamp là hằng đẳng (`moved == dist`)
   nên tự-đâm-đuôi vẫn chết bình thường. Đã test 12 hướng đâm tường/đỉnh: đều TRƯỢT, không
   chết; test tự-cắt-đuôi giữa sân vẫn chết.
4. **Chơi đơn: DỪNG màn hình khi chết** để xem lại tình huống — `GameScene` bỏ qua
   `game.update` khi `human.dead && !spectating` (camera đứng yên tại chỗ chết); bấm Hồi
   sinh/Xem chạy lại.

**Kiểm chứng:** shared 43 · server tc + integration 2/2 · client tc + net 15/15. Script:
`verify-names-win` (roster đúng tên; đối thủ rời, mình còn sống → event win, không về
matching), `verify-revert` (mình đang CHẾT + đối thủ rời → về matching), `verify-lobby` —
đều PASS. Sim vật lý: 12 hướng đâm tường/đỉnh đều trượt (không chết). Client build + render
sạch (localhost:3890).

## Ngoài phạm vi / để Pha 3

- **Đồng bộ delta LÃNH THỔ theo ô** + **area-of-interest**: snapshot Pha 2 chỉ mang trạng
  thái thực thể (vị trí/heading/score) — đủ cho predict/interp + va chạm; đồng bộ đất theo
  ô là Pha 3 (delta compression + AoI).
- WebRTC DataChannel (unreliable) — Pha 3.
- Ghép NetClient vào renderer R3F đầy đủ + matchmaking nhiều phòng — pha sau.
- `seed` trong WELCOME hiện gửi 0 (GameState chưa expose seed accessor).
