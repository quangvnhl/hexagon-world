# .implements — Kế hoạch xây dựng "Hexagon World"

Đây là bộ tài liệu nguồn (source of truth) mô tả thiết kế, kiến trúc và kế hoạch
triển khai game chiếm đất hexagon (tương tự hexanaut.io). **Mọi agent / sub-agent
phải đọc và tuân thủ các tài liệu này trước khi code.**

## Thứ tự đọc

| File | Nội dung | Dành cho |
|------|----------|----------|
| [00-game-design.md](00-game-design.md) | Luật chơi, mục tiêu, cơ chế thắng/thua | Tất cả |
| [01-tech-stack.md](01-tech-stack.md) | Công nghệ đã chọn + lý do | Tất cả |
| [02-architecture.md](02-architecture.md) | Kiến trúc hệ thống (client / server / shared) | Backend + Frontend |
| [03-hex-math.md](03-hex-math.md) | Hệ toạ độ lục giác & công thức | Người làm gameplay |
| [04-mvp-tasks.md](04-mvp-tasks.md) | **Chia việc MVP local (single-player)** | Sub-agents |
| [05-roadmap.md](05-roadmap.md) | Lộ trình sau MVP (multiplayer, totem, DB) | PM + Tech lead |
| [06-multiplayer-netcode.md](06-multiplayer-netcode.md) | Thiết kế netcode, tick, binary protocol | Backend |

## Nguyên tắc làm việc cho agents

1. **Không phá hợp đồng (contract):** Toán hex và protocol nằm trong package
   `shared` — mọi thay đổi phải cập nhật tài liệu tương ứng ở đây.
2. **MVP trước, multiplayer sau.** Không thêm socket/server vào MVP. Xem
   [04-mvp-tasks.md](04-mvp-tasks.md).
3. **Deterministic logic:** Toàn bộ logic gameplay (di chuyển, flood fill, va chạm)
   phải tách khỏi tầng render để sau này chạy được trên server (authoritative).
4. **Đơn vị công việc nhỏ:** Mỗi task trong `04-mvp-tasks.md` được thiết kế để một
   sub-agent hoàn thành độc lập; có mục "Định nghĩa hoàn thành" (DoD).

## Trạng thái hiện tại

- [x] Bộ tài liệu kế hoạch
- [x] MVP scaffold (Next.js + React Three Fiber, single-player)
- [ ] Bot/AI thử nghiệm cắt đuôi
- [ ] Server authoritative + WebSocket
- [ ] Binary protocol, matchmaking, totem, DB
