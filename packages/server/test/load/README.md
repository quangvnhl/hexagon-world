# Load / Soak harness — Pha 5 · B3

Công cụ đo tải WebSocket cho game server, để **chốt lại SLO bằng số thật** trước khi quyết
định có cần **B2 (scale ngang Redis)** hay không. Nguồn kế hoạch: [`.implements/26-phase-5-plan.md`](../../../../.implements/26-phase-5-plan.md) §2 (SLO) và §4 (B3).

## Công cụ đã chọn: **Node + `ws`** (không phải k6)

k6 **không có sẵn** trong môi trường này và cài đặt cần quyền hệ thống. `ws` đã là dependency
của `packages/server`, nên harness chạy ngay bằng `node` thuần — không cần build TS, không cần
cài thêm. Nếu sau này muốn dùng k6 (phân tán tải qua nhiều máy), protocol nhị phân đã tách sẵn
ở `protocol.mjs` để port sang script k6.

## Thành phần

| File | Vai trò |
|------|---------|
| `protocol.mjs` | Bản sao tự chứa wire-protocol **v5** (INPUT encode + peek SNAPSHOT/tag). Đồng bộ với `packages/shared/src/protocol.ts`. |
| `virtual-client.mjs` | Một client người-thật ảo: join → ready → phát input ~24/s (heading random-walk) → đọc snapshot xác nhận sống + đo ack-latency. Hỗ trợ drop/resume (reconnect) và rejoin. |
| `metrics.mjs` | Scrape `/health/network` (JSON, đã có) + `/metrics` (Prometheus, do nhánh B1+B3 thêm) → dựng bảng SLO §2. |
| `orchestrator.mjs` | Dựng N phòng × 8 người, ready hàng loạt, scrape định kỳ, churn tùy chọn, in báo cáo SLO. |

## Chạy

Từ thư mục `packages/server` (để `node` phân giải được package `ws`):

```bash
# 1) Khởi động game server ở terminal khác (ví dụ)
GAME_ROLE=all pnpm --filter @hexagon/server start   # hoặc script dev tương ứng

# 2) Smoke — 1 phòng, 8 người, 20 giây
node test/load/orchestrator.mjs

# 3) Ramp — 4 phòng × 8 người, 2 phút, kết nối rải 10s
ROOMS=4 DURATION=120 RAMP=10 node test/load/orchestrator.mjs

# 4) Soak — 8 phòng (trần 1 node theo §2.2), 30 phút, có churn + interest
ROOMS=8 DURATION=1800 CHURN=1 INTEREST=1 node test/load/orchestrator.mjs
```

### Biến môi trường

| Biến | Mặc định | Ý nghĩa |
|------|:--------:|---------|
| `WS_URL` | `ws://localhost:8910/game` | endpoint WebSocket |
| `BASE_URL` | `http://localhost:8910` | gốc HTTP để scrape metrics |
| `ROOMS` | `1` | số phòng mục tiêu (mỗi phòng 8 người thật + 12–16 bot do server sinh) |
| `HUMANS` | `8` | người thật/phòng (cap server = 8) |
| `DURATION` | `20` | thời lượng (giây); ≥1800 ⇒ soak |
| `INPUT_RATE` | `24` | khung input/giây/người |
| `RAMP` | `0` | giây rải đều lúc kết nối (tránh burst mở phiên đụng B1 IP-cap) |
| `CHURN` / `CHURN_EVERY` / `CHURN_FRAC` | `0` / `5` / `0.1` | reconnect churn: bật, chu kỳ (s), tỉ lệ drop mỗi đợt |
| `INTEREST` | `0` | 1 = gửi territory/entity interest (biến thể AoI + kích Radar) |
| `SCRAPE_EVERY` | `5` | chu kỳ scrape metrics (giây) |

## Bảng ánh xạ SLO (báo cáo cuối)

| Dòng báo cáo | SLO §2 doc 26 | Nguồn số |
|--------------|---------------|----------|
| `stepRoom p95 / room` | < 5 ms | histogram `hexworld_tick_step_ms` (**cần /metrics**) |
| `event-loop lag p95` | < 10 ms | histogram `hexworld_eventloop_lag_ms` (**cần /metrics**) |
| `input→snapshot p95` | < 60 ms | ack-latency phía client (proxy; localhost RTT≈0) |
| `downstream / client` | < 60 KB/s | `bytesPerSecond.snapshot+territory` từ `/health/network` ÷ số client |
| `snapshot drop rate` | < 1 % | `totals.snapshot.dropped/frames` từ `/health/network` |
| `rooms active` | ≥ 8 (trần 1 node) | `hexworld_rooms_active` (**cần /metrics**) |
| `ws input dropped total` | quan sát (B1) | `hexworld_ws_input_dropped_total` (**cần /metrics**) |

## Cần validate lại sau khi merge nhánh B1+B3

- Harness đã tự validate được các dòng dựa trên **`/health/network`** (downstream, drop rate)
  và **ack-latency phía client** ngay với server hiện tại.
- Các dòng **tick p95 / event-loop lag / tick behind / rooms active / input dropped** cần
  endpoint **`/metrics`** của nhánh backend (B1+B3). `metrics.mjs` **đã khớp** hợp đồng thực
  tế: tick/lag là **summary** (`{quantile="0.95"}`) nên đọc bằng `summaryQuantile`, tick behind
  = `hexworld_tick_behind_total / hexworld_tick_total`. Khi hai nhánh cùng một cây, chỉ cần
  chạy lại harness — bảng SLO sẽ đầy đủ, không phải sửa gì thêm.

## Bảo trì

`protocol.mjs` là **bản sao** của wire-protocol. Nếu `packages/shared/src/protocol.ts` đổi
layout (đặc biệt `TAG`, `INPUT_BYTES`, `SNAPSHOT_HEADER`) hoặc bump version, **phải cập nhật**
`protocol.mjs` + `GAME_PROTOCOL_VERSION` tương ứng, nếu không client ảo sẽ bị từ chối
(`protocol mismatch`, close code 4002).
