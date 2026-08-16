# 26 — Kế hoạch Pha 5: Vận hành (chống gian lận · telemetry · scale ngang) + SLO

> **Phạm vi:** tài liệu **kế hoạch** (chỉ thiết kế + đề xuất số, **CHƯA sửa code**).
> Chốt phạm vi **B1 / B3 / B2**, đề xuất **SLO**, và xếp thứ tự Pha 5 so với hai tài liệu
> song song: [24-render-perf-research.md](24-render-perf-research.md) (render/mobile) và
> [25-game-modes-plan.md](25-game-modes-plan.md) (chế độ chơi + `MatchConfig`).
> Dành cho: PM + Backend + DevOps + Gameplay.

## 0. Điều kiện khởi động

Pha 4 **đã đóng** (2026-08-16 — E2E HTTPS production đủ, xem [05-roadmap.md](05-roadmap.md)).
Backend = `packages/server` (NestJS :8910, REST + ws + Supabase, **1 process**, event-loop
đơn luồng). Tick **24 Hz** (`DT = 1/24 ≈ 41,67 ms`). Cap mỗi room: **8 người thật + 12–16
bot** (`MAX_HUMAN_PLAYERS`, `onlineBotCapacityForRoom`). Nhiều room multiplex trên **cùng một
event loop** qua `setTimeout` tự lịch (`net-server.ts:loop`).

## 1. Ảnh chụp hiện trạng (căn cứ mã nguồn)

| Khu vực | Đã có | Khoảng trống cho Pha 5 |
|---------|-------|------------------------|
| **Chống gian lận đầu vào** | `applyInput` (`game-room.ts:211`) đã sanity một phần: chặn `entityId` ngoài phạm vi, ghế trống, `heading` không hữu hạn, seq lùi/trùng. Mô phỏng server-authoritative (turn-rate/tốc độ do physics chặn, client chỉ gửi *heading mong muốn*). | **KHÔNG có rate-limit** trên `onBinary`→`decodeInput`→`applyInput` (net-server.ts:570) **cũng như** `onText` join/resume (net-server.ts:686). Không có `@nestjs/throttler` ở bất kỳ đâu. ⇒ **flood khung input / flood mở kết nối** là bề mặt tấn công chính. |
| **Telemetry** | `gameNetworkMetrics` (`network-transport.ts`): frames/bytes/dropped + `bytesPerSecond` theo từng loại khung; phơi ở `GET /health/network`. Backpressure `bufferedAmount ≥ WS_BACKPRESSURE_BYTES` (262 KB) → drop khung `droppable`. | **KHÔNG đo thời lượng tick / CPU mỗi room / số room / event-loop lag.** Không có endpoint `/metrics` chuẩn Prometheus. Loop có guard "spiral of death" (`elapsed > dt*5` bị kẹp) nhưng **không đếm** số lần trễ. |
| **Scale ngang** | Toàn bộ trong 1 process; room state in-memory; resume session in-memory. | Chưa có Redis pub/sub, chưa matchmaking đa node, chưa leaderboard realtime (đã hoãn từ Pha 4 → gộp vào **B2**). |

## 2. Đề xuất SLO (số khởi điểm — sẽ hiệu chỉnh bằng load test)

> Nguyên tắc: đây là **mục tiêu khởi điểm** để B3 đo và **chốt lại bằng số thật**. Ngân sách
> mỗi tick là **41,67 ms** cho *toàn bộ* công việc của mọi room trên một event loop.

### 2.1 SLO tài nguyên & độ trễ (mỗi node, trước B2)

| Chỉ số | SLO đề xuất | Vì sao / đo ở đâu |
|--------|-------------|-------------------|
| **`stepRoom` p95 / room** | **< 5 ms** | `stepTick + reconcileBots + emitEvents`. ~20–24 thực thể/room. Đo bằng `performance.now()` quanh `stepRoom` (B3). |
| **Event-loop lag p95** | **< 10 ms** | Khoảng lệch giữa lịch `setTimeout` và lúc chạy thật. > tick budget 41 ms = bắt đầu rớt tick. |
| **Số tick trễ (behind)** | **< 0,5 %** tick | Số lần `accumulator` buộc chạy ≥ 2 bước, hoặc bị kẹp `dt*5`. Chỉ báo bão hòa sớm. |
| **p95 input→snapshot (server-side)** | **< 60 ms** | Input áp ở tick kế + broadcast ≈ 1–1,5 tick. KHÔNG tính RTT mạng. |
| **Downstream p95 / client** | **< 60 KB/s** | Từ `bytesPerSecond` (đã có). Snapshot 24 Hz đã lọc AoI + territory ~4–5 Hz. |
| **Tỷ lệ khung drop (backpressure)** | **< 1 %** khung `snapshot` | `dropped/frames` trong `gameNetworkMetrics`. > 1 % = client/nhánh mạng không theo kịp. |

### 2.2 SLO dung lượng (mục tiêu 1 node trước khi cần B2)

| Chỉ số | SLO đề xuất | Ghi chú |
|--------|-------------|---------|
| **Người thật đồng thời / node** | **≥ 64** | = 8 room × 8 ghế người (mỗi room thêm 12–16 bot). Là **ngưỡng kích hoạt B2**: chạm trần này ở SLO §2.1 mới shard. |
| **Room đồng thời / node** | **≥ 8** | Ràng buộc thực tế = tổng `stepRoom` mọi room vừa ngân sách 41 ms + lag < 10 ms. |
| **Uptime game node** | **≥ 99,5 %** | Ngoài cửa sổ deploy. |

### 2.3 SLO tính đúng đắn / kinh tế (đã đạt ở Pha 4, giữ làm bất biến)

- **Stars idempotency:** gửi lặp `successful_payment` **không** cộng coin lần hai (đã xác minh).
- **Match-result:** không mất, không double-count (spool + gửi-lại-đúng-một-lần).

## 3. B1 — Chống gian lận (làm TRƯỚC · code thuần · không phụ thuộc hạ tầng)

Mục tiêu: bịt bề mặt flood + siết sanity, **không đổi hành vi người chơi hợp lệ**.

1. **Rate-limit khung input (ws binary)** — token-bucket **theo kết nối**. Trần ≈ **2× tick
   rate** (đề xuất **48 msg/s**, cho phép burst ngắn); vượt → **drop im lặng** khung thừa
   (không ngắt kết nối vì input là idempotent — chỉ giữ heading mới nhất). Đếm vi phạm vào
   metric (B3).
2. **Rate-limit khung text (join/resume/…)** — trần thấp (đề xuất **5 msg / 5 s / kết nối**);
   vượt nhiều lần → đóng socket. Chặn flood mở phiên.
3. **Siết sanity `applyInput`** — chuẩn hóa `heading` về `[-π, π]` (hiện chỉ chặn không hữu
   hạn); giữ nguyên tin cậy physics cho turn-rate/tốc độ. Từ chối seq nhảy bất thường (đã có
   monotonic; thêm trần bước nhảy nếu cần).
4. **Trần kết nối / IP** (nhẹ) — giới hạn số socket đồng thời mỗi IP để chặn cạn ghế.

> **Hành động khi vi phạm (cần chốt số):** input thừa = **drop**; text flood = **cảnh báo →
> đóng**; lặp lại = **tạm chặn IP ngắn**. Ngưỡng ở trên là **đề xuất**, hiệu chỉnh bằng B3.

## 4. B3 — Telemetry & Load test (làm CÙNG B1 · điều kiện để chốt SLO)

1. **Đo tick/room:** bọc `performance.now()` quanh `stepRoom`; xuất p50/p95 mỗi room, số room
   sống, event-loop lag, số tick "behind". Mở rộng `gameNetworkMetrics` sẵn có.
2. **Đếm sự kiện B1:** input dropped, text flood, IP bị chặn.
3. **Endpoint `/metrics` (Prometheus text)** — gom network + tick + B1 + `process` (rss/cpu).
   Giữ `/health/network` cho tương thích.
4. **Harness load/soak** (k6/artillery cho ws): kịch bản **8 người thật + 16 bot/room**,
   nhân số room lên, Radar bật/tắt, **reconnect churn** (bám hành vi grace 30 s), phiên soak
   ≥ 30 phút. **Xuất số thật → chốt lại SLO §2.**

## 5. B2 — Scale ngang (làm SAU · chỉ khi số đo yêu cầu)

Chỉ khởi động khi load test cho thấy 1 node chạm trần SLO §2.2 (≈ 64 người / 8 room).

- **Redis pub/sub** điều phối nhiều instance GameRoom; **resume session** chuyển từ in-memory
  sang store chia sẻ (Redis) để reconnect qua node.
- **Matchmaking đa node** + **leaderboard realtime** (gộp từ mục hoãn Pha 4).
- **Sticky routing** người↔room theo node (room vẫn là đơn vị đặt trên 1 node; Redis lo khám
  phá + xếp phòng, **không** chia mô phỏng 1 room qua nhiều node).

> **Phụ thuộc thứ tự với `MatchConfig` (§6):** B2 shard *GameRoom*. Nếu `MatchConfig`
> (doc 25 P0) làm **trước** B2, ta shard đúng hình dạng room cuối cùng — tránh "shard rồi
> refactor lại".

## 6. Xếp thứ tự Pha 5 ↔ doc 24 (render) ↔ doc 25 (chế độ chơi)

### 6.1 Doc 24 — render/mobile: CÓ việc cần làm, nhưng ĐỘC LẬP với Pha 5

Doc 24 có **1 việc code chưa làm, ưu tiên cao**: **đổi material lưới hex** (`meshStandardMaterial`
PBR → `meshBasic`/`Lambert`, `HexGridView.tsx:188`) — đòn bẩy **giảm nóng máy mobile #1**.
Đây là **client render**, **không đụng** backend/ops của Pha 5 ⇒ **chạy song song** một nhánh
riêng (frontend), **không chặn** và **không bị chặn** bởi Pha 5. Hai mục còn mở (atlas+UV skin
premium; tối ưu tăng dần flood-fill) **ưu tiên thấp**, để sau.

**Khuyến nghị:** tách "24 — client perf" thành nhánh song song; ưu tiên đổi material sớm vì rẻ
+ tác động lớn tới trải nghiệm mobile, độc lập hoàn toàn với B1/B2/B3.

### 6.2 Doc 25 — chế độ chơi: nên làm `MatchConfig` P0 SỚM, XEN giữa B1+B3 và B2

Ba lý do đặt **doc 25 P0 (`MatchConfig` + `WinCondition`)** *trước* B2 (không phải sau cả Pha 5):

1. **Kỹ thuật:** B2 shard GameRoom; refactor `MatchConfig` đổi *hình dạng* GameRoom. Làm
   trước ⇒ shard bản cuối, tránh làm lại (đã nêu §5).
2. **Giá trị người chơi:** B2 (Redis) là **vô hình** với người chơi và **chưa cần** khi
   concurrency beta còn thấp. Practice/Tournament/Campaign + năng lượng (doc 25) tạo **giữ
   chân + doanh thu** — đáng ưu tiên hơn scale sớm.
3. **Rủi ro thấp khi hoãn B2:** SLO chưa đo xong thì B2 là **tối ưu hóa non**. Đo trước (B3),
   scale sau — đúng thứ tự "đo rồi mới scale".

**Không nên** làm toàn bộ doc 25 *trước* B1: B1 (rate-limit) nhỏ, bảo vệ sản phẩm đang chạy
thật → làm ngay là an toàn nhất.

### 6.3 Thứ tự tổng hợp đề xuất

```
(song song, nhánh client)  24: đổi material hex  ─────────────────────────►

nhánh backend/gameplay:
  1) B1 chống gian lận (rate-limit + sanity)        ← nhỏ, bảo vệ live, làm ngay
  2) B3 telemetry + /metrics + harness load          ← cùng B1; để có SỐ
        └─(đo tải)──► CHỐT LẠI SLO §2 bằng số thật
  3) doc 25 P0: MatchConfig + WinCondition            ← nền cho mode & cho B2
     doc 25 P1/P2: Practice/Tournament/Campaign + năng lượng   ← giá trị người chơi
  4) B2 scale ngang (Redis + matchmaking + leaderboard)  ← CHỈ khi SLO §2.2 chạm trần
```

## 7. Cần NGƯỜI DÙNG chốt trước khi chuyển sang code

1. **SLO §2** — đồng ý bộ số khởi điểm? (Sẽ hiệu chỉnh sau B3.)
2. **Ngưỡng B1** — 48 msg/s input · 5 msg/5s text · hành động drop→cảnh báo→chặn IP: giữ hay đổi?
3. **Thứ tự §6.3** — B1+B3 → (đo) → doc 25 P0/P1/P2 → B2. Đồng ý đặt **doc 25 trước B2**
   và **hoãn B2 tới khi SLO chạm trần**?
4. **Doc 24** — chạy nhánh client "đổi material" song song ngay, hay gộp lịch với backend?
5. **Totem teleport gate** (hoãn từ Pha 4) — đưa vào Pha 5 hay để sau doc 25?

---

Liên quan: [05-roadmap.md](05-roadmap.md) · [24-render-perf-research.md](24-render-perf-research.md) · [25-game-modes-plan.md](25-game-modes-plan.md)
