# 05 — Roadmap

Phân pha rõ ràng; mỗi pha có thể giao cho một nhóm sub-agent.

## Pha 0 — MVP local (ĐANG LÀM)
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

## Pha 3 — Tối ưu mạng
- [ ] Binary protocol (DataView → FlatBuffers)
- [ ] Delta compression + area-of-interest (chỉ gửi thứ trong tầm nhìn)
- [ ] (Tùy chọn) WebRTC DataChannel unreliable cho vị trí

## Pha 4 — Meta & vật phẩm
- [ ] Totem: teleport gate, slow totem, spy radar
- [ ] Redis: matchmaking + leaderboard realtime
- [ ] PostgreSQL + Prisma: account, XP, skin, tiến trình
- [ ] Lobby/Store (React), Auth

## Pha 5 — Vận hành
- [ ] Chống gian lận (server authoritative + sanity check)
- [ ] Horizontal scale GameRoom (nhiều instance + Redis pub/sub)
- [ ] Telemetry, metrics, load test (k6/artillery cho ws)

## Tiêu chí lên pha sau
Chỉ chuyển pha khi pha trước có: build xanh, demo chạy, và (từ Pha 2) test tự động
cho phần logic chia sẻ.
