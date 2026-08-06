# 05 — Roadmap

Phân pha rõ ràng; mỗi pha có thể giao cho một nhóm sub-agent.

## Pha 0 — MVP local (ĐANG LÀM)
- [x] Tài liệu kế hoạch `.implements`
- [x] Next.js + R3F scaffold, lưới hex top-down
- [x] Di chuyển theo chuột, đuôi + biên
- [x] Flood fill chiếm đất, HUD %, King ≥ 20%
- [x] Tự cắt đuôi → chết/reset

## Pha 1 — Gameplay hoàn thiện (vẫn local)
- [ ] Bot AI đơn giản (đi tuần, mở rộng) để test cắt đuôi & bị tiêu diệt
- [ ] Cơ chế thắng: giữ King 3 phút + đồng hồ + màn hình thắng
- [ ] Camera zoom theo diện tích, minimap
- [ ] Hiệu ứng: fill animation, particle khi chết
- [ ] Mobile: joystick ảo + nút kỹ năng
- [ ] Unit test cho hex math & flood fill (Vitest)

## Pha 2 — Multiplayer nền tảng
- [ ] Tách `packages/shared` (monorepo pnpm)
- [ ] Server NestJS: GameRoom authoritative, tick 20–30 Hz
- [ ] Transport `ws` thuần, snapshot broadcast
- [ ] Client prediction + interpolation
- [ ] Spatial hashing cho va chạm (xem 06)

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
