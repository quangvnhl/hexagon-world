# 38 — Lộ trình dài hạn: đo hiện trạng và đường đi tới hết kế hoạch

> **Loại tài liệu:** LỘ TRÌNH. Không thay thế [35](35-product-depth-plan.md) (thiết kế) hay
> [BACKLOG.yaml](BACKLOG.yaml) (việc) — nó trả lời câu *"đang ở đâu, và đi tiếp theo thứ tự nào"*.
>
> Lập ngày **2026-09-07**, căn cứ trạng thái thật của repo và database dev, không căn cứ trí nhớ.

---

## 1. Đã làm được bao nhiêu

Đo bằng đơn vị **lát** của `BACKLOG.yaml` — cùng đơn vị mà agent thi công, nên không tự khen.

| Tài liệu | Xong | Tổng | % | Ghi chú |
|---|---:|---:|---:|---|
| **36 — đường ray Pha 5.5** | 13 | 16 | **81%** | **Cổng đóng pha ĐÃ ĐẠT** |
| **35 — Pha 6** | 13 | 20 | **65%** | 2/13 đang nằm trong PR chờ gộp |
| **35 — Pha 7** | 0 | ~28 | **0%** | chưa chẻ lát |
| **35 — Pha 8** | 0 | ~25 | **0%** | chưa chẻ lát |
| **35 — toàn bộ** | 13 | ~90 | **~15%** | xem cảnh báo bên dưới |

⚠️ **Con số 15% dễ gây hiểu nhầm theo hướng bi quan.** Phần đã làm là phần *khó bỏ qua nhất*: nền
phân tích, remote config, liêm chính kinh tế lớp 1, FTUE, và toàn bộ đường ray tự động hoá. Pha 7 và
Pha 8 tuy nhiều lát nhưng phần lớn là **tính năng dựng trên nền đã có** (bảng + RPC + UI), không phải
hạ tầng mới. Mẫu số ~90 cũng là **ước lượng** vì Pha 7/8 chưa được chẻ lát thật.

### Doc 36 — coi như xong

Tiêu chí đóng pha của chính nó (§1): *"một lát chạy trọn vòng không người can thiệp"* — đã đạt với lát
mẫu `a3.1`, và lặp lại được ở `a1.4`, `d1.1`, `a1.5`, `c4.1`.

| Hạng mục | Trạng thái |
|---|---|
| R1 CI | ✅ |
| R2 tầng 1 — smoke UI Playwright | ❌ `r2.1-smoke-ui` |
| R2 tầng 2 — E2E luồng tiền | ❌ `r2.2-e2e-money` |
| R2 tầng 3 — đo thay vì nhìn | ✅ |
| R3 db-migrate · đồng bộ `.env.example` | ✅ |
| R3 db-seed | ❌ `r3.2-db-seed` |
| R4 BACKLOG · R5 kỷ luật git · R6 AGENTS.md · R7 review 3 tầng | ✅ |

Ba lát còn lại đều là **lưới an toàn**, không chặn tính năng nào.

### Doc 35 Pha 6 — còn 3 mảnh của cổng

| Điều kiện đóng pha (§7) | Trạng thái |
|---|---|
| CI xanh trên PR | ✅ |
| Đổi 1 tham số kinh tế không cần deploy | ✅ |
| Truy vấn D1/D7 + funnel FTUE | 🟡 xong ở PR #24, **chờ gộp** → rồi `d1.2` |
| Request campaign giả bị từ chối | 🟡 lớp 1 xong; còn `a3.2` (chặn phi lý) |
| Gỡ `x-admin-key` + vết kiểm toán | ❌ `c2.1` + `c2.2` — chưa động |

---

## 2. Phát hiện lớn nhất: **kế hoạch không có bước phát hành**

Đây là lỗ hổng nghiêm trọng nhất của doc 35, và nó không tự lộ ra vì mọi lát vẫn xanh.

**Bằng chứng trong repo:**

- `.github/workflows/` có 3 workflow: `ci`, `review`, `claude-review`. **Không có workflow deploy nào.**
- Không có `fly.toml`, `vercel.json`, `render.yaml`, `docker-compose.yml`. Có `Dockerfile` (từ pha
  trước) nhưng không có gì gọi nó.
- `NEXT_PUBLIC_SERVER_URL` mặc định `ws://localhost:8910`.
- Database dev có **5 người chơi và 53 sự kiện** — toàn bộ từ chính đợt kiểm thử của agent.

**Vì sao đây là vấn đề, không phải chi tiết:**

> Cổng đóng **Pha 7** của doc 35 là *"D1/D7 cải thiện đo được **so với mốc Pha 6**; ARPDAU > 0"*.

Cả hai đều là chỉ số của **người chơi thật**. Không có người chơi thật thì:

- Không có "mốc Pha 6" để so — mà mốc đó phải được đo **trong** Pha 6, tức là **trước** khi Pha 7 bắt đầu.
- ARPDAU không thể > 0 vì chưa ai trả một Star nào.
- Toàn bộ §8 (8 chỉ số mục tiêu) không đo được.
- Và nghiêm trọng hơn: `a1.5` vừa dựng xong bộ truy vấn retention/funnel/ARPDAU — **chúng đang chạy
  trên số liệu của chính agent**. Một bộ đo không có gì để đo là một bộ đo chưa được kiểm chứng.

Doc 35 có nhắc `C5` (*"CD staging → production"*) nhưng §7 **không xếp C5 vào pha nào**. Nó rơi giữa
các khe.

**Kết luận:** phải chèn một chặng **PHÁT HÀNH** giữa Pha 6 và Pha 7. Đây là thay đổi lộ trình thật,
không phải thêm việc vặt.

### Ba mục P1 khác cũng bị doc 35 §7 để rơi

| Mục | Nội dung | Vì sao không bỏ qua được |
|---|---|---|
| **C3** An toàn cộng đồng | Lọc tên hiển thị, `player_bans` | Tên hiển thị lấy từ Telegram và hiện cho người khác thấy — bề mặt lạm dụng có sẵn từ ngày phát hành |
| **C5** Phát hành & tương thích | CD, gate migration, cửa sổ protocol, rollback | Chính là chặng phát hành ở trên |
| **C6** Sao lưu & khôi phục | PITR + **diễn tập khôi phục** | Chưa từng thử khôi phục = coi như chưa có backup. Đây là thứ duy nhất đứng giữa một sai lầm và mất sạch dữ liệu người chơi |

---

## 3. Lộ trình

```
Chặng 0  Đóng Pha 6            ~7 lát    ← đang ở đây
Chặng 1  PHÁT HÀNH (mới)       ~10 lát   ← doc 35 thiếu hẳn chặng này
Chặng 2  Thu số nền            0 lát, 2–4 tuần chờ
Chặng 3  Pha 7 giữ chân+tiền   ~28 lát
Chặng 4  Pha 8 mùa & mở rộng   ~25 lát
```

### Chặng 0 — Đóng Pha 6 *(đang làm)*

Thứ tự đã tính theo phụ thuộc và theo việc gì mở khoá việc gì:

| # | Lát | Vì sao ở vị trí này |
|---|---|---|
| 1 | *(bạn)* Gộp **#24**, **#25** | Chặn `d1.2`; hai PR xanh đã 3 ngày |
| 2 | `c2.1-ops-api-keys` | Mảnh nặng nhất của cổng. `risk: high` |
| 3 | `c2.2-openapi-dryrun` | Cùng trục, phụ thuộc c2.1 |
| 4 | `a3.2-campaign-sanity` | Đóng nốt mục "request giả bị từ chối" |
| 5 | `d1.2-ftue-funnel` | Đóng mục "funnel FTUE" |
| 6 | `c4.2-self-serve-privacy` | Điều kiện của Telegram Stars, đi cùng c4.1 |
| 7 | `a4.2-error-reporting` | Không có nó thì phát hành xong sẽ mù lỗi |

Xen kẽ khi cần lát nhẹ: `r2.1-smoke-ui`, `a2.3-admin-config-ui`.

**Cổng đóng chặng:** đúng 5 điều kiện ở doc 35 §7.

### Chặng 1 — PHÁT HÀNH *(chặng mới, doc 35 thiếu)*

> **Cập nhật 2026-09-09 — phần CODE của chặng này đã xong.** Còn lại là những việc cần tài khoản
> của chủ dự án. Chi tiết ở bảng dưới; các lát tương ứng nằm trong `BACKLOG.yaml`.
>
> | Nhóm | Trạng thái |
> |---|---|
> | An toàn cộng đồng — **C3** | ✅ `c3-an-toan-cong-dong` (#45) |
> | Lưới an toàn — E2E tiền + seed | ✅ `r2.2` (#41) · `r3.2` (#40) |
> | Lưới an toàn — **C1** alert tối thiểu | ✅ `c1-alert-toi-thieu` (#47) — cần Prometheus đang chạy để nạp `deploy/alerts.yml` |
> | Đường phát hành — **C5** cổng migration | ✅ `db-migrate --check` |
> | Đường phát hành — **C5** cửa sổ protocol | ✅ `MIN_SUPPORTED_GAME_PROTOCOL` |
> | Đường phát hành — **C5** sổ tay rollback | ✅ [doc 39](39-runbook-phat-hanh-rollback.md) |
> | Đường phát hành — dựng image | ✅ `t5-ci-dung-image` (#50) — trước đó `Dockerfile` chưa từng được dựng ở đâu |
> | Đường phát hành — **C5** workflow deploy | ✅ `c5.2-deploy-vps` (#51) — VPS + Compose; **chưa từng chạy**, chưa có máy chủ |
> | Hạ tầng (VPS, domain, Supabase production) | ⏸️ **chỉ chủ dự án** — nhà cung cấp đã chốt, máy chủ thì chưa có |
> | Telegram thật (bot production, Mini App URL, webhook Stars) | ⏸️ **chỉ chủ dự án** |
> | **C6** PITR + diễn tập khôi phục | ⏸️ **chỉ chủ dự án** — quyết định khôi phục phải do người bấm |
>
> Một lỗi phát hiện khi soát: `Dockerfile` thiếu manifest `packages/admin` ⇒ `pnpm install
> --frozen-lockfile` chết ngay ở bước cài đặt. Không cổng nào bắt được vì typecheck/test/build đều
> chạy trên máy, không qua Docker. Đã sửa (#48) và khoá bằng `scripts/dockerfile.test.mjs`.

Không có chặng này thì Pha 7 không có cổng để đóng.

| Nhóm | Nội dung |
|---|---|
| **Hạ tầng** | Chọn nơi chạy server game + control plane (`Dockerfile` đã có); host client Next.js; domain + HTTPS; Supabase **production riêng** — không dùng lại project dev |
| **Đường phát hành** | Workflow deploy; **gate migration chạy trước khi đổi code đọc schema mới**; kế hoạch rollback từng phần (client / server / migration) — đây chính là **C5** |
| **Telegram thật** | Bot production, Mini App URL, webhook Stars trỏ về domain thật, bật thanh toán Stars |
| **Lưới an toàn** | `r2.2-e2e-money` + `r3.2-db-seed` (luồng tiền xuyên HTTP thật) · **C6** bật PITR + **diễn tập khôi phục một lần** · `c1` alert tối thiểu: webhook Stars lỗi, spool tồn đọng |
| **An toàn cộng đồng** | **C3** lọc tên hiển thị + `player_bans` — phải có **trước** người lạ đầu tiên |

**Cổng đóng chặng:** một người lạ mở link Telegram, chơi hết FTUE, mua một gói Stars **bằng tiền
thật**, và giao dịch đó hiện đúng trong `analytics_daily_kpi.revenue_stars`.

> ⚠️ Đây là chặng có nhiều **việc của bạn** nhất — mua domain, tạo project production, đăng ký thanh
> toán. Agent viết được toàn bộ code và workflow, nhưng không bấm được nút nào ở các bước đó.

### Chặng 2 — Thu số nền *(2–4 tuần, không code)*

Chặng này **không có lát nào** và đó là chủ ý. Cần đủ thời gian để có cohort D7 thật.

Việc trong chặng: xem funnel FTUE mỗi tuần, sửa chỗ rơi cao nhất, và **ghi lại mốc** — chính là con
số mà cổng Pha 7 sẽ so với. Bật `pg_cron` (doc 37 Việc 3c) trở thành bắt buộc ở đây, không còn là
tuỳ chọn.

Nếu FTUE < 70% (mục tiêu §8) thì sửa FTUE trước, **không** mở Pha 7. Đổ tính năng giữ chân lên một
cái phễu thủng là cách chắc chắn nhất để không biết cái gì hỏng.

### Chặng 3 — Pha 7: giữ chân & doanh thu

Thứ tự **không** theo doc 35 §7 liệt kê, mà theo ràng buộc rủi ro #4 của chính doc 35:

1. **B9 bảng kinh tế trước tiên.** Doc 35 ghi rõ *"dựng TRƯỚC B1–B4"*. Thêm 4 nguồn phát coin cùng
   lúc mà không có bảng lạm phát là bay mù.
2. **B1 rewarded ads cấp thưởng thật** — quảng cáo đang chạy mà không thưởng, tức là đang tốn chỗ
   hiển thị mà không thu được gì.
3. **B2 điểm danh → B3 nhiệm vụ → B4 thưởng theo cấp** — theo thứ tự tăng dần độ phức tạp.
4. **A5 leaderboard** + **B7 giới thiệu bạn** — hai đòn bẩy lan truyền.
5. **C2.3–C2.6** bề mặt Ops API đầy đủ + playbook + UI admin.
6. **C1 alerting** đầy đủ · **D3** thông báo quay lại · **D4** nhịp nội dung 2–4 cấp/tuần.

**Cổng đóng chặng:** doc 35 §7 Pha 7 — giờ mới đo được, nhờ chặng 1 và 2.

> Doc 35 §10 đã ghi: bật quyền **ghi** của Ops API cho agent cần **xin xác nhận riêng**, sau 2 tuần
> chạy read-only. Đừng bỏ qua ở C2.4.

### Chặng 4 — Pha 8: mùa & mở rộng

Giữ nguyên doc 35 §7: B6 battle pass · B5 gói ưu đãi · A6 MMR · A7 hiệu năng máy yếu · A8 cửa sổ
tương thích client · A3 lớp 3 (chạy lại `inputTrace` — cần `t1-seeded-rng` trước) · D5 party ·
C7 chi phí · B2-Redis **chỉ khi** số đo chạm trần 64 người/8 phòng.

---

## 4. Việc cần bạn, xếp theo thời điểm

| Khi nào | Việc | Vì sao agent không làm được |
|---|---|---|
| **Ngay** | Gộp PR #24, #25 | Lệnh gộp bị chặn ở phiên agent |
| **Ngay** | Bật `pg_cron` (doc 37 Việc 3c) | Bật extension là thay đổi hạ tầng |
| **Ngay** | Điền `operator` + `contactEmail` (Việc 6) | Bịa pháp nhân = tạo tổ chức không tồn tại |
| Chặng 0 | Review comment cho `c2.1`, `c2.2`, `a3.2` | Luật `risk: high` ở AGENTS.md §4 |
| Chặng 1 | Domain, hosting, Supabase production, bot Telegram production | Cần tài khoản và thẻ của bạn |
| Chặng 1 | **Diễn tập khôi phục** một lần | Phải có người quyết định khi khôi phục thật |
| Chặng 3 | Duyệt bật quyền ghi Ops API + hạn mức ngày | Doc 35 §10 — chạm tiền thật |
| Chặng 4 | Giá và nội dung Battle Pass mùa 1 | Quyết định kinh doanh |

---

## 5. Rủi ro của chính lộ trình này

| # | Rủi ro | Giảm thiểu |
|---|---|---|
| 1 | **Trì hoãn phát hành vô hạn** — luôn có thêm một lát nữa để làm trước khi dám mở cho người lạ | Chặng 1 có cổng đóng bằng **một giao dịch thật**, không bằng danh sách việc. Bộ đo `a1.5` đang chạy trên số liệu của chính agent, và mỗi tuần không phát hành là một tuần nó chưa được kiểm chứng |
| 2 | **Số đo Pha 6 vô nghĩa vì quá ít người** | Chặng 2 định thời gian, không định số lát. Nếu sau 4 tuần vẫn quá ít dữ liệu thì vấn đề là phân phối, không phải sản phẩm — và đó là câu hỏi khác hẳn |
| 3 | Hai PR nằm chờ nhiều ngày làm mọi lát sau dồn ứ | Đã thấy: #24/#25 chờ 3 ngày và chặn `d1.2`. Gộp sớm rẻ hơn nhiều so với gỡ xung đột sau |
| 4 | Ước lượng ~90 lát sai vì Pha 7/8 chưa chẻ | Chẻ Pha 7 thành lát **ngay khi chặng 0 đóng**, đừng đợi tới lúc bắt đầu — chẻ lát là lúc phát hiện việc ẩn |

---

Liên quan: [35-product-depth-plan.md](35-product-depth-plan.md) · [36-phase-5-5-automation-rails.md](36-phase-5-5-automation-rails.md) ·
[37-viec-can-nguoi-thuc-hien.md](37-viec-can-nguoi-thuc-hien.md) · [BACKLOG.yaml](BACKLOG.yaml) · `AGENTS.md`
