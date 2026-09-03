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
| [07-them-model-glb.md](07-them-model-glb.md) | Hướng dẫn chuẩn bị, đăng ký và kiểm thử model GLB mới | Frontend |
| [10-player-backend-supabase.md](10-player-backend-supabase.md) | Kế hoạch backend người chơi, đa nguồn, shop và tài sản trên Supabase | Backend + Product |
| [11-player-backend-runbook.md](11-player-backend-runbook.md) | Runbook migration, OAuth, Telegram Stars, admin và multi-region | Backend + DevOps |
| [12-player-backend-implementation-report.md](12-player-backend-implementation-report.md) | Phạm vi đã triển khai, kiểm thử và blocker hạ tầng | Backend + Product |
| [15-telegram-platform-gating-and-adsgram.md](15-telegram-platform-gating-and-adsgram.md) | Quy tắc bắt buộc cô lập Telegram và placement AdsGram | Tất cả agent sửa code platform |
| [16-work-session-roadmap-audit.md](16-work-session-roadmap-audit.md) | Tổng kết cửa sổ làm việc, tồn đọng Pha 3–4 và gate chuyển Pha 5 | PM + Tech lead |
| [17-phase-3-completion-report.md](17-phase-3-completion-report.md) | Báo cáo đóng Pha 3: AoI, lifecycle, backpressure, protocol metrics | Backend + Frontend + DevOps |
| [18-telegram-stars-coin-packages.md](18-telegram-stars-coin-packages.md) | Contract mua ba gói coin bằng Telegram Stars | Backend + Frontend + DevOps |
| [19-speed-totem-room-king-timer-plan.md](19-speed-totem-room-king-timer-plan.md) | Kế hoạch tốc độ theo King, Totem, Radar/minimap, bot quota, multi-room và deadline King | Gameplay + Backend + Frontend |
| [21-speed-totem-room-king-implementation-report.md](21-speed-totem-room-king-implementation-report.md) | Báo cáo triển khai tốc độ, Totem, Radar privacy, bot quota, multi-room và King countdown | Gameplay + Backend + Frontend |
| [21-backend-release-gate.md](21-backend-release-gate.md) | Gate offline kiểm tra cấu hình staging/production trước deploy | Backend + DevOps |
| [22-trail-vector-designs.md](22-trail-vector-designs.md) | Hướng dẫn thay thế và bổ sung thiết kế vệt đuôi bằng SVG 2D | Frontend + Design |
| [23-phase-4-readiness-report.md](23-phase-4-readiness-report.md) | Trạng thái sẵn sàng đóng Pha 4 và các gate hạ tầng còn lại | PM + Backend + DevOps |
| [24-render-perf-research.md](24-render-perf-research.md) | Tổng hợp nghiên cứu hiệu năng render: đổi material hex, UI HTML/CSS, đuôi 2D, flood fill, overdraw, sơ đồ kiến trúc lai | Frontend + Gameplay + Design |
| [25-game-modes-plan.md](25-game-modes-plan.md) | Quy hoạch Luyện tập/Tournament/Cấp độ + hệ năng lượng + admin level editor; nút thắt `CONFIG`→`MatchConfig` | Gameplay + Backend + Frontend + Product |
| [26-phase-5-plan.md](26-phase-5-plan.md) | Kế hoạch Pha 5 (B1 chống gian lận · B3 telemetry/load · B2 scale Redis) + SLO đề xuất + thứ tự với doc 24/25 | PM + Backend + DevOps + Gameplay |
| [27-phase1-modes-impl.md](27-phase1-modes-impl.md) | Thực thi doc 25 P1: Practice/Tournament, MatchRules, WinCondition, obstacle | Gameplay + Backend + Frontend |
| [28-phase2-energy-campaign-impl.md](28-phase2-energy-campaign-impl.md) | Thực thi doc 25 P2: năng lượng server-authoritative, Campaign, power-up, mạng phụ | Gameplay + Backend + Frontend |
| [29-phase3-level-authoring-plan.md](29-phase3-level-authoring-plan.md) | Schema `campaign_levels` trên Supabase + Admin API + trình vẽ hex | Backend + Frontend + Product |
| [30-phase3-L6-admin-app-plan.md](30-phase3-L6-admin-app-plan.md) | Tách app admin riêng (`packages/admin`, Vite) | Frontend + DevOps |
| [31-admin-editor-upgrade-plan.md](31-admin-editor-upgrade-plan.md) | Nâng cấp trình vẽ cấp độ (công cụ, xem thử, publish) | Frontend + Product |
| [32-custom-totem-authoring-plan.md](32-custom-totem-authoring-plan.md) | Totem tự đặt theo cấp (authoring + runtime) | Gameplay + Frontend |
| [33-obstacle-collider-plan.md](33-obstacle-collider-plan.md) | Chướng ngại: trượt dọc viền + hiển thị đường collider theo cấp | Gameplay + Frontend |
| [34-campaign-features-plan.md](34-campaign-features-plan.md) | King objective, cứ điểm bot, minimap theo bán kính cấp, công cụ vẽ BIÊN | Gameplay + Frontend |
| [35-product-depth-plan.md](35-product-depth-plan.md) | **Kế hoạch chuyên sâu Pha 6–8:** analytics, remote config, liêm chính kết quả, CI, kinh tế/ads/mùa, vận hành, vòng đời sản phẩm | PM + Backend + Frontend + Product + DevOps |
| [36-phase-5-5-automation-rails.md](36-phase-5-5-automation-rails.md) | **Pha 5.5 — đường ray tự động hoá:** CI, nghiệm thu bằng số thay mắt người, `db:migrate`/seed, `BACKLOG.yaml`, kỷ luật git đa agent, guardrail `AGENTS.md` | Tech lead + DevOps + mọi agent |

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
- [x] Sân LỤC GIÁC + tường trượt, spawn 7 ô ngẫu nhiên, 3s chuẩn bị, popup hồi sinh
- [x] Bot/AI đối kháng (đa thực thể: bành trướng, cắt đuôi để hạ nhau)
- [x] **Pha 1 hoàn thiện gameplay:** cơ chế thắng (giữ King 3 phút), camera zoom theo diện tích, hiệu ứng hạt, joystick mobile, unit test Vitest — xem [05-roadmap.md](05-roadmap.md) & [REPORT-pha-1.md](REPORT-pha-1.md)
- [x] **Pha 2 nền tảng multiplayer:** monorepo pnpm (`shared`/`client`/`server`), server NestJS authoritative + `ws` (tick 24Hz), protocol nhị phân + snapshot, client prediction/interpolation, spatial hashing — xem [REPORT-pha-2.md](REPORT-pha-2.md)
- [x] Pha 3: delta/AoI lãnh thổ, entity/spectator lifecycle, backpressure và protocol metrics
- [x] Pha 4: **đã đóng** (2026-08-16) — migration/seed + E2E HTTPS production đã xác minh (OAuth, Telegram/Stars idempotency, match-result spool, CORS, regions, WSS v5)
- [~] Pha 5 — Vận hành: **đang thực hiện** — B1 chống gian lận + B3 telemetry/`/metrics` + harness load đã xong; doc 25 P0/P1/P2 (MatchConfig, Practice/Tournament, năng lượng/Campaign) đã xong; doc 29–34 (level authoring, totem/obstacle/cứ điểm/biên) đã code. Còn: chốt SLO bằng load-test tách máy; **B2 Redis chỉ khi chạm trần**. Xem [05-roadmap.md](05-roadmap.md).
- [ ] Pha 5.5 — Đường ray tự động hoá: kế hoạch đã dựng ([36-phase-5-5-automation-rails.md](36-phase-5-5-automation-rails.md)) — CI + nghiệm thu tự động + `db:migrate` + `BACKLOG.yaml`; làm **trước** Pha 6
- [ ] Pha 6–8 — Chiều sâu sản phẩm: kế hoạch đã dựng ([35-product-depth-plan.md](35-product-depth-plan.md)) — analytics + remote config + liêm chính kết quả Campaign + CI (P0), rồi giữ chân/doanh thu, rồi mùa & mở rộng. **Chờ chốt 8 câu hỏi ở §10 trước khi code.**
