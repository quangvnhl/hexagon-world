# 05 — Roadmap

Phân pha rõ ràng; mỗi pha có thể giao cho một nhóm sub-agent.

## Pha 0 — MVP local — ĐÃ XONG
- [x] Tài liệu kế hoạch `.implements`
- [x] Next.js + R3F scaffold, lưới hex top-down
- [x] Di chuyển theo chuột, đuôi + biên
- [x] Flood fill chiếm đất, HUD %, King ≥ 20%
- [x] Tự cắt đuôi → chết/reset

## Pha 1 — Gameplay hoàn thiện (vẫn local) — ĐÃ XONG
Xem báo cáo: [REPORT-pha-1.md](REPORT-pha-1.md).
- [x] Bot AI đơn giản (đi tuần, mở rộng) để test cắt đuôi & bị tiêu diệt
- [x] Cơ chế thắng: giữ King 3 phút + đồng hồ + màn hình thắng (`CONFIG.WIN_HOLD_TIME`, `GameState.won/kingHoldRemaining/restart()`)
- [x] Camera zoom theo diện tích, minimap (`CONFIG.CAMERA.ZOOM`)
- [x] Hiệu ứng: particle khi chết + lóe khi chiếm (`Effects.tsx`); *fill animation từng-ô để lại pha sau*
- [x] Mobile: joystick ảo (`Joystick.tsx`); *nút kỹ năng chỉ là placeholder khoá — vật phẩm ở Pha 4*
- [x] Unit test cho hex math & flood fill (Vitest — 28 test) ⚠️ `npm test` cần sửa quyền `node_modules` (xem báo cáo)

## Pha 2 — Multiplayer nền tảng — ĐÃ XONG
Xem báo cáo: [REPORT-pha-2.md](REPORT-pha-2.md).
- [x] Tách `packages/shared` (monorepo **pnpm workspaces** qua corepack; `shared`/`client`/`server`)
- [x] Server NestJS: GameRoom authoritative, tick **24 Hz** (bước cố định bù trôi); NestJS bọc bootstrap, logic ở class thuần
- [x] Transport `ws` thuần; SNAPSHOT nhị phân (DataView) broadcast per-client kèm `ackSeq`
- [x] Client prediction + reconciliation (`stepHead` khớp server) + interpolation (trễ ~100ms)
- [x] Spatial hashing cho va chạm đầu (`SpatialHash`, tích hợp `resolveHeadCollisions`; khớp brute-force)

> Kiểm chứng độc lập: verify-logic 93/0 · vitest shared 41 / client 15 / server 1 (tích hợp
> ws thật) · **e2e xuyên gói 4/4** (client predict ↔ server thật, dự đoán hội tụ drift=0) ·
> `next build` xanh (client). Đồng bộ delta LÃNH THỔ + AoI để **Pha 3**.

## Pha 3 — Tối ưu mạng — ĐÃ XONG
- [x] Binary protocol bằng `DataView` cho snapshot và lãnh thổ
- [x] Delta compression lãnh thổ: full keyframe khi join/resync, delta theo revision cho từng connection
- [x] Entity area-of-interest phía server: snapshot lọc theo bán kính cấu hình, luôn giữ self/KING
- [x] Territory area-of-interest theo camera, hysteresis và keyframe toàn bản đồ riêng cho minimap (~200 ms)
- [x] Spectator interest target; snapshot absence là despawn authoritative, client xóa interpolation/effect state khi rời AoI
- [x] Backpressure (`bufferedAmount`), protocol version và metric bytes/giây/frame drop theo message type
- [x] **Quyết định hoãn:** chỉ chuyển `DataView` sang FlatBuffers nếu số đo CPU/băng thông chứng minh cần thiết
- [x] **Quyết định bỏ qua hiện tại:** WebRTC DataChannel; chỉ xem lại khi WebSocket có HOL/độ trễ đã đo được

Xem báo cáo đóng pha: [17-phase-3-completion-report.md](17-phase-3-completion-report.md).

## Pha 4 — Meta & vật phẩm — ĐÃ XONG
- [x] Totem Speed/Slow/Radar authoritative, Radar kiểm soát quyền xem minimap
- [x] Room lifecycle: 12..16 bot cố định theo cấu hình; KING sống cuối cùng thắng ngay
- [ ] **Hoãn khỏi gate beta:** Totem teleport gate
- [ ] **Hoãn tới khi chạy nhiều node:** Redis matchmaking + leaderboard realtime → chuyển sang **Pha 5 (B2 scale ngang)**
- [x] Supabase PostgreSQL: account đa nguồn, session, match history, catalog, wallet, inventory, loadout
- [x] XP/progression: rule cấu hình trong DB, level curve, ledger idempotent và API `/v1/me`
- [x] Skin/tài sản: màu, model, trail pattern, shop coin và Telegram Stars
- [x] Auth: Google OAuth cho web, Telegram initData, guest hạn chế backend
- [x] Lobby/Store React cơ bản
- [x] **Gate:** Lobby ready/cancel/reconnect có reconnect grace; private room/party hoãn sau beta
- [x] **Gate:** Áp migration + seed trên Supabase staging/production (xác minh 2026-08-16)
- [x] **Gate:** Google OAuth, Telegram auth/Stars webhook và match-result E2E trên HTTPS production (xác minh 2026-08-16)

## Pha 5 — Vận hành — ĐANG THỰC HIỆN (wave 1: B1+B3 · wave 2: doc 25 P0 — đã commit; wave 3: load-test sơ bộ)
- [x] **doc 25 P0 — nền `MatchConfig`** (refactor thuần, không đổi trải nghiệm): `MatchConfig`/`WinCondition`/`ArenaGeometry` per-instance; `GameState` nhận 1 object config. *typecheck+build xanh, 171/171 test. Đã commit ("Pha5"). Chi tiết: "Trạng thái Pha 5 — wave 2" dưới.*
- [x] **B1 Chống gian lận** (code + test): rate-limit ws input (token-bucket 48/s), text (5/5s, strike→close 4009), trần kết nối/IP (20, close 4008), chuẩn hóa `heading`→`[-π,π]`. Ngưỡng env-driven. *Server build xanh, 49 test (12 mới).*
- [x] **B3 Telemetry** (code + harness): đo `stepRoom` p50/p95, event-loop lag, tick behind, rooms active, counters B1 → endpoint `GET /metrics` (Prometheus). Harness load/soak Node+ws (`packages/server/test/load/`) ánh xạ SLO §2. *Đã kiểm chứng offline khớp `/metrics`.*
- [~] **B3 chạy load-test — ĐO SƠ BỘ trên 1 máy dev** (2026-08-17, xem "wave 3" dưới). `stepRoom` p95 & bandwidth & drop rate **PASS**; latency/event-loop metrics **chưa chốt được** (nhiễu co-located). **Chốt SLO chính thức vẫn cần load-gen tách máy + mạng thật.**
- [ ] **B2** Horizontal scale GameRoom (nhiều instance + Redis pub/sub) — CHỈ khi load-test cho thấy 1 node chạm trần SLO §2.2 (~64 người/8 room).
- [ ] **doc 25 P1 — Practice / Tournament / obstacle** (KHÔNG bị load-test chặn; nền P0 đã xong). Kế hoạch triển khai chia lát: [27-phase1-modes-impl.md](27-phase1-modes-impl.md).

> **Kế hoạch chi tiết + SLO đề xuất + thứ tự: [26-phase-5-plan.md](26-phase-5-plan.md).**
>
> **Nhóm việc & thứ tự đề xuất:** **B1** chống gian lận (rate-limit khung vào + sanity control frame — code thuần, làm ngay) + **B3** mở rộng telemetry/metrics (tick/CPU mỗi phòng, event-loop lag, `/metrics` Prometheus) và harness load/soak (8 người thật + 16 bot, Radar bật/tắt, reconnect churn) → **đo tải, chốt lại SLO** → **doc 25 P0 `MatchConfig`** (nền cho mode + cho B2) + Practice/Tournament/Campaign → **B2** scale ngang (Redis pub/sub + matchmaking + leaderboard, **chỉ khi SLO chạm trần**).
>
> **SLO khởi điểm (doc 26):** `stepRoom` p95 < 5 ms/room · event-loop lag p95 < 10 ms · p95 input→snapshot < 60 ms · downstream < 60 KB/s/client · drop < 1 % · trần 1 node ≈ 64 người / 8 room (= ngưỡng kích hoạt B2).
>
> **Đã đề xuất (chờ chốt):** đặt `MatchConfig` (doc 25 P0) **trước B2**; hoãn B2 tới khi đo tải chạm trần; nhánh client "đổi material hex" (doc 24) chạy **song song, độc lập**. Totem teleport gate: đưa vào Pha 5 hay để sau — chưa chốt.

## Tiêu chí lên pha sau
Chỉ chuyển pha khi pha trước có: build xanh, demo chạy, và (từ Pha 2) test tự động
cho phần logic chia sẻ.

### Trạng thái gate ngày 2026-08-14

- Build production toàn monorepo: đạt.
- Runtime smoke test server: đạt (`/health/live`, `/health/network`, role `all`, region `sea`).
- Vitest: đạt 61 shared + 58 client + 37 server; release gate 5/5.
- `verify:logic`: đạt 93/0.
- Pha 3: **đã đóng, đủ điều kiện tiếp tục Pha 4**.
- Pha 4 còn migration/seed thật và E2E HTTPS production; chưa đủ điều kiện chuyển sang Pha 5.
- Gate cấu hình offline đã có (`pnpm release:check`), nhưng không thay thế kiểm chứng hạ tầng thật.

Chi tiết mới nhất: [23-phase-4-readiness-report.md](23-phase-4-readiness-report.md).

### Trạng thái gate ngày 2026-08-16

- **Pha 4 ĐÃ ĐÓNG.** Cả hai gate hạ tầng đã xác minh trên môi trường thật:
  - **Supabase migration + seed:** `/health/ready` trả `database:true`; RPC `fulfill_telegram_stars_coin_order`/`fulfill_telegram_stars_order` tồn tại; gói coin (`coin_packages`) + `player_identities` provider=telegram khớp tài khoản test.
  - **E2E HTTPS production:** Google OAuth (cookie `hex_session` HttpOnly+Secure, đúng tên); Telegram initData đúng tên/nền tảng + webhook đã đăng ký (`setWebhook` với `allowed_updates=[pre_checkout_query,message]`); **mua coin Stars thành công**; **Stars idempotency đạt** (gửi lặp `successful_payment` KHÔNG cộng coin lần hai); **match-result spool + gửi-lại-đúng-một-lần** (test `CONTROL_PLANE_URL` sai→đúng: cả hai ván ghi đủ vào `matches`/`match_players`); **CORS** chặn origin lạ (localhost gọi production bị chặn); `/v1/regions` khớp deployment; **WSS `/game` bắt tay protocol v5**.
- **Bug đã sửa trong đợt kiểm chứng:** mua coin Stars thất bại ("Bạn đã đóng hóa đơn") do webhook chưa đăng ký (`getWebhookInfo` url rỗng) → đăng ký lại `setWebhook`. (`provider_token` không truyền là đúng chuẩn Stars.)
- **Hành vi vận hành đã chốt (giữ nguyên):** thoát phòng giữa chừng → không cộng điểm lãnh thổ (XP ~0, ghế bị park); reconnect trong grace 30s giữ ghế/phòng nhưng rắn vẫn đi theo heading cuối lúc mất mạng nên thường chết → chờ hồi sinh.
- **Kết luận:** đủ điều kiện chuyển sang **Pha 5**. Các điểm cần thống nhất trước khi khởi động: xem ghi chú dưới mục "Pha 5 — Vận hành" ở trên.

`GAME_RESULT_SPOOL_DIR` mặc định `./data/match-results` (resolve theo cwd game node); mỗi kết quả chờ gửi là file `<eventId>.json`, tự xóa khi gửi thành công.

### Trạng thái Pha 5 — wave 1 (2026-08-16)

Thực thi theo kế hoạch [26-phase-5-plan.md](26-phase-5-plan.md) §6.3, chia 3 nhánh song song (chưa commit; chờ review + hợp nhất):

- **B1 + B3 (backend `packages/server`):**
  - Mới: `src/net/rate-limit.ts` (TokenBucket, SlidingWindowCounter), `src/net/telemetry.ts` (reservoir p50/p95 + counters), `src/net/prometheus.ts`, `src/metrics.controller.ts` (`GET /metrics`).
  - Sửa: `config.ts` (6 ngưỡng env B1), `game/game-room.ts` (`applyInput` chuẩn hóa heading), `net/net-server.ts` (rate-limit input/text + trần IP + đo tick/lag/behind/rooms), `app.module.ts`.
  - Kết quả: `pnpm build` xanh; `pnpm test` **49/49** (12 test mới). `/health/network` giữ nguyên.
  - Ngưỡng: `WS_INPUT_RATE_PER_SEC=48`, `WS_INPUT_BURST=48`, `WS_TEXT_RATE_MAX=5`, `WS_TEXT_RATE_WINDOW_MS=5000`, `WS_TEXT_FLOOD_STRIKES=3`, `WS_MAX_CONN_PER_IP=20`. Vi phạm: input=drop im lặng; text=strike→close 4009; IP=close 4008.
- **Harness load/soak** (`packages/server/test/load/`): Node+`ws` (k6 không có sẵn). `protocol.mjs`/`virtual-client.mjs`/`metrics.mjs`/`orchestrator.mjs`+`README.md`. Ánh xạ đầy đủ SLO §2; kiểm chứng offline khớp `/metrics` của B1+B3. **Chạy tải thật cần server chạy (secrets) → chưa thực thi.**
- **Doc 24 render** (`packages/client`): `HexGridView.tsx` đổi `meshStandardMaterial`→`meshLambertMaterial` (giảm nóng máy mobile #1, giữ khối 3D/instanceColor). `next build` xanh; vitest 58/58; xác minh thị giác dev server.

**GIỮ LẠI theo đúng thứ tự:** **B2 (Redis)** chỉ khi SLO §2.2 chạm trần. (MatchConfig P0 đã tách khỏi bước đo tải — xem wave 2 dưới.)

**Việc kế tiếp:** (1) review + commit các nhánh; (2) chạy server + harness để **đo và chốt lại SLO thật**.

### Trạng thái Pha 5 — wave 2: doc 25 P0 nền `MatchConfig` (2026-08-16)

Quyết định: P0 là **refactor thuần, KHÔNG đổi trải nghiệm** → không bị đo-tải chặn (chỉ B2 chờ số đo), nên khởi động ngay. Phạm vi đợt này = **CHỈ P0**, xong **dừng để review** (chạm code nóng mỗi-tick). Chưa commit.

- **Mới `packages/shared/src/match-config.ts`:** `MatchConfig` (map/bots/rules/win/seed) + `WinCondition` (kind: `king_hold`/`territory_pct`/`survive`/`capture_totems`/`none`) + `resolveMatchConfig()` — mọi default = giá trị `CONFIG` hiện tại ⇒ không truyền gì = hành vi cũ y hệt.
- **`arena.ts` → `ArenaGeometry` per-instance:** hình học + va chạm (`insideArena`/`clampInside`/`slideMove`/`mapArena`) theo bán kính/biên của từng ván. Export module-level cũ (`ARENA_R`, `WALL_LIMIT`, …) giữ nguyên làm **shim trỏ `DEFAULT_ARENA`** ⇒ 7 component render/debug + net-server không đổi.
- **`state.ts` `GameState`:** constructor gộp params rời → **1 object `GameStateOptions`** (`{humanCount, spawnAt, config}`); đọc luật từ `this.config` + hình học từ `this.arena` (bỏ đọc thẳng `CONFIG`/hằng arena cho phần per-match). `checkWin` rẽ theo `config.win.kind` (`none`=Luyện tập endless; `king_hold`=mặc định như cũ).
- **Chủ ý HOÃN sang P1:** cấu hình TOTEM + profile TỐC ĐỘ/AI bot vẫn đọc `CONFIG` (còn chia sẻ với `totems.ts`); evaluator `territory_pct`/`survive`/`capture_totems`; hợp nhất luật thắng trùng lặp giữa `GameState.checkWin` và `GameRoom.stepTick` (server vẫn tự chạy king-countdown riêng — chưa đụng).
- **Kết quả:** typecheck xanh (shared/server/client); test **shared 64 · server 49 · client 58 = 171/171**; `nest build` xanh; `next build` xanh. Hành vi không đổi (mọi default = CONFIG).
- **Call-site đã đổi:** `game-room.ts`, `NetGameScene.tsx` (dùng object mới); `GameScene.tsx` `new GameState()` giữ nguyên; ~16 call-site test viết lại.

### Trạng thái Pha 5 — wave 3: load-test SƠ BỘ (2026-08-17)

Chạy harness `packages/server/test/load/orchestrator.mjs` với **game node cục bộ** (`SERVER_ROLE=all`,
dummy secrets — không cần Supabase/OAuth thật) ở 3 mức: 1 phòng, 4 phòng, và **8 phòng × 8 = 64 người**
(trần 1 node theo doc 26 §2.2). **Đây là đo SƠ BỘ, chưa phải chốt SLO chính thức.**

**Kết quả ĐÁNG TIN (đo phía server, hợp lệ) ở 64 người / 8 phòng:**

| Chỉ số | SLO §2 | Đo | KL |
|---|---|---|---|
| `stepRoom` p95 / phòng | < 5 ms | **1.62 ms** (phẳng theo tải: 0.43→1.78→1.62) | ✅ |
| downstream / client | < 60 KB/s | **0.3 KB/s** | ✅ |
| snapshot drop rate | < 1 % | **0 %** (0/75.456 khung) | ✅ |
| rooms active | ≥ 8 | **8** | ✅ |

⇒ **Compute lõi mô phỏng mỗi tick KHÔNG phải nút thắt** ngay cả ở trần 64/8-phòng; băng thông & mất gói tốt.

**Số CHƯA chốt được (nhiễu môi trường 1-máy):** `event-loop lag` p95 (5.5→15→205 ms), `tick-behind`
(11→17→26 %), `input→snapshot` p95 (49 ms→3,25 s) — đều **phình theo số client harness** trong khi
`stepRoom` đứng yên ⇒ chủ yếu do **load-generator chạy CHUNG máy với server** + **localhost RTT≈0**
(dòng input→snapshot chỉ là proxy). Ngoài ra ban đầu vướng **artifact IP-cap B1** (`WS_MAX_CONN_PER_IP=20`
chặn ở 20 client vì mọi client ảo cùng IP localhost → phải nâng cap cho lần đo trần). *Lưu ý mở:* phần
event-loop lag có thể lẫn chi phí THẬT của đường broadcast/encode gửi 64 socket mỗi tick + GC (ngoài
`stepRoom`) — cần đo tách máy để quy trách dứt khoát.

**Để CHỐT SLO chính thức (chưa làm):** load-gen trên 1–2 máy TÁCH RỜI (nhiều IP, không giành CPU với
server) + server trên phần cứng gần production + soak 30 phút kèm churn/interest như doc 26 §2. **B2 (Redis)
vẫn GIỮ nguyên điều kiện kích hoạt:** chỉ khi đo chính thức cho thấy 1 node chạm trần §2.2.
