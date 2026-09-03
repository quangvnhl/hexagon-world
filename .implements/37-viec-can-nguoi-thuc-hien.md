# 37 — Việc CẦN NGƯỜI làm (hướng dẫn từng bước)

> Agent chạy tự động theo `.implements/BACKLOG.yaml`. File này là danh sách **những việc agent
> KHÔNG tự làm được** — hạ tầng bên ngoài, quyền, pháp lý, giá cả, cảm giác chơi — kèm hướng dẫn
> bấm/chạy cụ thể.
>
> **Nguyên tắc an toàn xuyên suốt:** không bao giờ dán secret vào khung chat. Mọi secret ghi vào
> file env cục bộ (đã được `.gitignore` bỏ qua). Script đọc file đó; agent không đọc, không in ra.

## Cách phối hợp

| Bên | Làm gì |
|---|---|
| **Agent** | Thực hiện từng lát trong BACKLOG theo thứ tự phụ thuộc; chạy CI; tự gộp lát **không phải** `risk: high`; tự chuyển pha khi gate đóng pha đạt |
| **Anh** | Làm các việc trong file này; duyệt PR của lát `risk: high` |

Agent **dừng và báo** khi: (a) gặp lát `requires_human: true` mà điều kiện chưa sẵn sàng,
(b) mở PR cho lát `risk: high`, (c) gate chuyển pha cần anh xác nhận.

Tra trạng thái bất cứ lúc nào:

```bash
grep -E "^  - id:|^    status:" .implements/BACKLOG.yaml
```

---

## Việc 1 — Bật GitHub Actions ✅ XONG (2026-09-03)

Không có Actions thì không có cổng "xong", agent không được phép gộp gì.

1. Mở https://github.com/quangvnhl/hexagon-world/settings/actions
2. Mục **Actions permissions** → chọn **Allow all actions and reusable workflows** → **Save**.
3. Mở tab **Actions** của repo. Nếu có banner đề nghị bật workflow, bấm **I understand my workflows, go ahead and enable them**.

Kiểm tra đạt:

```bash
gh workflow list
```

Phải in ra dòng có tên `CI`. Đã kiểm: `CI  active  349121877`.

---

## Việc 2 — Branch protection cho `main` ⏸️ BỎ QUA (chốt 2026-09-03: phương án A)

GitHub **không cho** đặt branch protection trên repo *private* ở gói Free (API trả 403
"Upgrade to GitHub Pro or make this repository public"). Anh đã chọn **A: không bảo vệ nhánh,
dựa vào CI + kỷ luật** — agent vẫn luôn đi qua PR và chỉ gộp khi CI xanh, chỉ là GitHub không
cưỡng chế hộ. Khi nào lên Pro hoặc mở public thì làm theo các bước dưới.

1. Mở https://github.com/quangvnhl/hexagon-world/settings/branches
2. **Add branch protection rule** → Branch name pattern: `main`
3. Tick **Require a pull request before merging**
4. Tick **Require status checks to pass before merging** → ô tìm kiếm gõ `verify` → chọn check **verify**
5. **Create** / **Save changes**

Từ đây mọi thay đổi vào `main` đều phải qua PR có CI xanh — kể cả của agent.

---

## Việc 3 — Database Supabase ✅ XONG (2026-09-03) — còn 1 việc nhỏ

Chốt 2026-09-03: **mọi thứ đang là dev**, kể cả Supabase đã deploy. Nên KHÔNG tạo project staging
riêng, KHÔNG cần `deploy/staging.env` — dùng thẳng `SUPABASE_URL` / `SUPABASE_SECRET_KEY` /
`SUPABASE_DB_URL` đã có trong `.env` ở gốc repo.

### 3.1 Đã làm xong

- `scripts/db-migrate.mjs` chạy được trên database dev (project `elxlvtftobmqkmrczqrx`).
- Database đó đã được dựng tay từ trước (28 bảng, 20 hàm, 5 người chơi) nhưng chưa có sổ
  migration. Đã chạy **baseline** — đánh dấu cả 9 migration là *đã áp* mà **không chạy lại SQL**
  (migration dùng `create table` nên chạy lại chắc chắn vỡ):

  ```bash
  node scripts/db-migrate.mjs --baseline 202608180006_campaign_totems_authored --yes
  ```

- Đã đối chiếu bằng chứng thật trước khi baseline, không tin cảm tính: migration cuối (doc 32) chỉ
  sửa dữ liệu — kiểm tra thấy `c3` có đúng 4 totem và mọi cấp đều `totemsEnabled=false`.
- Từ giờ `node scripts/db-migrate.mjs --dry-run` in ra `Đã áp: 9/9`.

### 3.2 Việc còn lại của anh (1 phút) — sửa `SUPABASE_DB_URL` trong `.env`

Chuỗi hiện tại trong `.env` dùng host **Direct connection** `db.<ref>.supabase.co`. Host này chỉ có
bản ghi **IPv6**. Mạng nhà mạng IPv4 gọi REST API vẫn được (nên app chạy bình thường) nhưng nối
Postgres thì `ENOTFOUND` — agent phải tự ghép lại chuỗi pooler mỗi lần chạy, rất dễ sai.

Sửa một lần cho xong: mở Dashboard → **Connect** → tab **Session pooler** → copy chuỗi, thay
`[YOUR-PASSWORD]` bằng mật khẩu database, rồi thay giá trị `SUPABASE_DB_URL` trong `.env`. Dạng đúng:

```
postgresql://postgres.elxlvtftobmqkmrczqrx:<mật khẩu>@aws-0-ap-northeast-1.pooler.supabase.com:5432/postgres
```

> Chọn **Session pooler** (cổng `5432`) — KHÔNG chọn *Transaction pooler* (cổng `6543`): pooler giao
> dịch không chạy được DDL, migration sẽ vỡ.

Kiểm tra đạt (không in mật khẩu — script tự che):

```bash
node scripts/db-migrate.mjs --dry-run
```

Phải thấy `Đã áp      : 9/9` và `Không có migration nào cần áp.`

> ⚠️ Khi nào có database **production** thật: tuyệt đối không đặt chuỗi của nó vào `.env` này.
> `db-migrate` mặc định từ chối `--target production` (cần biến `ALLOW_PRODUCTION_MIGRATE=yes-i-know`
> mà agent không bao giờ có), nhưng lớp bảo vệ tốt nhất vẫn là không để key production ở đây.

---

## Việc 4 — Bot Telegram TEST (chưa gấp — cần ở Pha 7)

Chặn: `b1-*` (rewarded ads), `b5-*` (gói ưu đãi), và phần Stars của `r2.2-e2e-money`.

1. Mở Telegram, chat với **@BotFather** → `/newbot`
2. Đặt tên hiển thị (vd `Hexagon World Staging`) và username kết thúc bằng `_bot`
3. BotFather trả về **token** → thêm vào `deploy/staging.env`:

```bash
printf 'TELEGRAM_BOT_TOKEN=%s\n' 'DÁN_TOKEN' >> deploy/staging.env
```

4. Webhook cần một domain HTTPS công khai — làm sau, khi có bản staging deploy. Chưa cần bây giờ.

> Dùng **bot riêng cho staging**, không dùng chung bot production: webhook chỉ trỏ được về một nơi.

---

## Việc 5 — AdsGram TEST (chưa gấp — cần ở Pha 7)

1. Đăng ký publisher tại AdsGram Partner, khai báo Mini App.
2. Tạo **Block ID** riêng cho Rewarded và Interstitial ở môi trường test.
3. Cấu hình **Reward URL** trỏ về `POST /v1/webhooks/adsgram` của staging (agent sẽ dựng endpoint ở lát `b1`).
4. Thêm vào `deploy/staging.env`: `NEXT_PUBLIC_ADSGRAM_REWARDED_LOBBY_RANDOM_BLOCK_ID`,
   `NEXT_PUBLIC_ADSGRAM_INTERSTITIAL_END_GAME_BLOCK_ID`, `ADSGRAM_REWARD_SECRET`.

---

## Việc 6 — Nội dung pháp lý (chặn `c4.1-legal-pages`)

Agent dựng **khung** 3 trang `/terms`, `/privacy`, `/paysupport`; **nội dung phải do anh duyệt** vì
đây là cam kết pháp lý và là điều kiện của Telegram Stars.

Cần anh cung cấp 6 mục:

1. Tên pháp nhân hoặc cá nhân vận hành game (hiện trên điều khoản).
2. Email hỗ trợ người chơi (dùng cho `/paysupport`).
3. **Chính sách hoàn Stars**: hoàn trong bao lâu, trường hợp nào từ chối.
4. Tuổi tối thiểu được chơi.
5. Dữ liệu thu thập và thời hạn lưu (agent sẽ liệt kê đúng những gì code thật sự thu thập; anh xác nhận).
6. Quốc gia/luật áp dụng.

Trả lời 6 mục này trong chat là đủ (không có gì bí mật), agent sẽ soạn thành trang.

---

## Việc 7 — Duyệt PR của lát `risk: high`

Agent **không tự gộp** 9 lát này. Khi agent mở PR, anh xem rồi gộp:

```bash
gh pr list
gh pr diff <số PR>
gh pr merge <số PR> --squash
```

Danh sách lát cần anh duyệt: `r3.1-db-migrate` · `r2.2-e2e-money` · `t1-seeded-rng` ·
`a3.1-server-scores-campaign` · `a3.2-campaign-sanity` · `a3.3-replay-verify` · `c2.1-ops-api-keys` ·
`c2.2-openapi-dryrun` · `c4.2-self-serve-privacy`.

Lý do chúng là `high`: chạm tiền, tài khoản người chơi, schema database, hoặc quyền của Ops API.

---

## Việc 8 — Các quyết định sẽ hỏi đúng lúc (chưa cần bây giờ)

| Khi nào | Quyết định |
|---|---|
| Lát `d1.1-ftue` | Nội dung 3 bước hướng dẫn + ngưỡng "đạt" mỗi bước (cảm giác chơi — máy không chấm được) |
| Lát `a4.2` | Chọn Sentry hay GlitchTip self-host, cấp DSN |
| Đầu Pha 7 | Thưởng cụ thể 7 ngày điểm danh, thưởng theo mốc level |
| Trước khi bật quyền GHI của Ops API cho agent | Hạn mức ngày mỗi key (vd trần coin/ngày) — sau 2 tuần chạy read-only |
| Pha 8 | Giá và nội dung Battle Pass mùa 1 |

---

## Thứ tự khuyến nghị

```
Việc 1 (Actions) ✅  →  Việc 2 (branch protection) ⏸️ bỏ qua  →  Việc 3 (database) ✅
                                                                      ↓
                                     Việc 7 (duyệt PR #2)  ← ĐANG CHẶN lát a3.2, a3.3
                                                                      ↓
                                Việc 6 (nội dung pháp lý)  →  Việc 4, 5 khi tới Pha 7
```

**Đang chặn ngay lúc này: Việc 7** — PR #2 (`risk: high`, sửa lỗ hổng kinh tế ở `campaign/complete`)
và PR của lát `r3.1` đang chờ anh duyệt. Ngoài ra chỉ còn 1 phút sửa `SUPABASE_DB_URL` ở §3.2 để
agent khỏi phải ghép chuỗi pooler thủ công mỗi lần.

---

## Gate chuyển pha (agent tự chuyển khi đạt, và báo cho anh)

| Pha | Điều kiện đóng |
|---|---|
| **5.5** | Một lát chạy trọn vòng không người can thiệp: đọc BACKLOG → sửa đúng `files` → `dod` xanh → CI xanh → gộp. Lát mẫu: `a3.1`. |
| **6** | Truy vấn được D1/D7 + funnel FTUE; request campaign giả bị từ chối; CI xanh trên mọi PR; đổi 1 tham số kinh tế không cần deploy; `x-admin-key` dùng chung đã bị gỡ và mọi thao tác admin có vết kiểm toán |
| **7** | D1/D7 cải thiện đo được so với mốc Pha 6; ARPDAU > 0 tách được theo nguồn; mọi alert có playbook; agent hoàn thành 5 kịch bản vận hành ở doc 35 §C2 |

Agent **không tự chuyển pha** khi gate còn hạng mục `requires_human` chưa xong — sẽ dừng và báo.

---

Liên quan: [36-phase-5-5-automation-rails.md](36-phase-5-5-automation-rails.md) ·
[35-product-depth-plan.md](35-product-depth-plan.md) · [BACKLOG.yaml](BACKLOG.yaml) · `AGENTS.md`
