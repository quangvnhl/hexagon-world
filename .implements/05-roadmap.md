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

## Pha 4 — Meta & vật phẩm — ĐANG THỰC HIỆN
- [x] Totem Speed/Slow/Radar authoritative, Radar kiểm soát quyền xem minimap
- [x] Room lifecycle: 12..16 bot cố định theo cấu hình; KING sống cuối cùng thắng ngay
- [ ] **Hoãn khỏi gate beta:** Totem teleport gate
- [ ] **Hoãn tới khi chạy nhiều node:** Redis matchmaking + leaderboard realtime
- [x] Supabase PostgreSQL: account đa nguồn, session, match history, catalog, wallet, inventory, loadout
- [x] XP/progression: rule cấu hình trong DB, level curve, ledger idempotent và API `/v1/me`
- [x] Skin/tài sản: màu, model, trail pattern, shop coin và Telegram Stars
- [x] Auth: Google OAuth cho web, Telegram initData, guest hạn chế backend
- [x] Lobby/Store React cơ bản
- [x] **Gate:** Lobby ready/cancel/reconnect có reconnect grace; private room/party hoãn sau beta
- [ ] **Gate:** Áp migration + seed trên Supabase staging/production
- [ ] **Gate:** Google OAuth, Telegram auth/Stars webhook và match-result E2E trên HTTPS production

## Pha 5 — Vận hành
- [ ] Chống gian lận (server authoritative + sanity check)
- [ ] Horizontal scale GameRoom (nhiều instance + Redis pub/sub)
- [ ] Telemetry, metrics, load test (k6/artillery cho ws)

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
