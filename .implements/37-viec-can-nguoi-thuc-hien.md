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

## Việc 3b — Bật Claude review tự động (5 phút, khuyến nghị làm sớm)

Repo đã có **hai** tầng review chạy sẵn, không cần anh làm gì:

- `CI` → job `verify`: code có chạy không.
- `Review` → job `guard`: có phạm luật trong `AGENTS.md` không (bí mật lọt vào commit, sửa
  migration đã áp, tắt test, log trong đường nóng, server tin giá trị client tự khai…).

Tầng thứ ba — Claude đọc diff và nhận xét phần **cần suy xét** — cần một API key. Chưa có key thì
job vẫn **xanh** và chỉ ghi một dòng nhắc, không làm phiền ai.

1. Lấy API key: https://console.anthropic.com/settings/keys → **Create Key** → copy (chỉ hiện một lần).
2. Mở https://github.com/quangvnhl/hexagon-world/settings/secrets/actions
3. **New repository secret** → Name: `ANTHROPIC_API_KEY` → Secret: dán key → **Add secret**.

Kiểm tra đạt: mở một PR bất kỳ, tab **Checks** phải có job `claude` chạy và để lại nhận xét trong
tab **Conversation**. Nếu chưa bật, job đó vẫn xanh kèm dòng "Chưa bật Claude review".

> Chi phí: mỗi PR tốn một lượt gọi API theo kích thước diff. Muốn tắt tạm thì xoá secret — không
> cần sửa code.

---

## Việc 3c — Bật `pg_cron` cho rollup phân tích (2 phút — làm khi muốn số liệu tự tươi)

Lát `a1.5` đã tạo 3 bảng tổng hợp + hàm `refresh_analytics_rollups(p_days)`. Hàm chạy đúng và
idempotent, nhưng **chưa có lịch tự chạy**, nên `analytics_daily_kpi` (ARPDAU/DAU) chỉ mới bằng lần
refresh gần nhất. Truy vấn retention và funnel FTUE đọc sự kiện thô nên luôn tươi — chỉ ARPDAU bị cũ.

Agent **cố ý không tự bật** trong migration: `pg_cron` dựng một background worker và job của nó nằm
ngoài repo — đọc code sẽ không thấy nó tồn tại. Đây là loại thay đổi hạ tầng phải do người bấm.

1. Mở Supabase Dashboard → **Database** → **Extensions** → tìm `pg_cron` → bật.
2. Vào **SQL Editor**, chạy:

```sql
select cron.schedule('analytics-rollup', '20 0 * * *',
                     $$select public.refresh_analytics_rollups(3)$$);
```

Kiểm tra đạt — `select * from cron.job;` phải thấy dòng `analytics-rollup`.

Chưa bật cũng không sao: chạy tay `select public.refresh_analytics_rollups(3);` trước khi đọc
ARPDAU. Câu Q3 và Q4 trong [analytics-queries.md](analytics-queries.md) được viết để chỗ số liệu
cũ **lộ ra** thay vì im lặng.

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

## Việc 3d — Lên lịch xoá tài khoản quá hạn (1 phút — **làm cùng lúc với Việc 3c**)

Đây **không** cùng loại với 3c. 3c chỉ làm số liệu tươi hơn; việc này là **giữ đúng một lời hứa đã
in ra cho người dùng đọc**.

Trang `/privacy` (lát c4.1) viết nguyên văn:

> *"Khi bạn yêu cầu xoá, tài khoản bị vô hiệu ngay và dữ liệu chơi bị xoá hẳn sau 30 ngày"*

Lát `c4.2` đã làm vế đầu (`DELETE /v1/me` vô hiệu ngay) và đã viết sẵn vế sau —
`purge_deleted_players(p_grace_days integer default 30)` trong migration `202609080002`. Hàm chạy
đúng và idempotent (đã kiểm trên DB dev bằng một giao dịch rollback: xoá sạch định danh + dữ liệu
chơi, giữ chứng từ, chạy lần hai trả 0). **Nhưng chưa có lịch chạy.**

Chừng nào chưa có lịch, câu trên trang `/privacy` là một câu **sai**. Không ai bấm thì không có
tài khoản nào bị xoá hẳn cả.

Sau khi đã bật `pg_cron` ở Việc 3c, chạy thêm:

```sql
select cron.schedule('purge-deleted-players', '40 0 * * *',
                     $$select public.purge_deleted_players(30)$$);
```

Kiểm nó có việc để làm hay không (an toàn, chỉ đọc):

```sql
select count(*) as cho_xoa
from public.players
where status = 'deleted' and purged_at is null
  and deleted_at < now() - interval '30 days';
```

Con số `30` ở lệnh `cron.schedule` **phải** khớp `LEGAL.deletionGraceDays` trong
`packages/client/src/lib/legal.ts`. Có test khoá hằng số controller với cả `legal.ts` lẫn mặc định
trong migration, nhưng test **không** nhìn thấy được tham số bạn gõ vào `cron.schedule` — nên chỗ
này là chỗ duy nhất phải tự để ý.

## Việc 6 — Điền 2 ô còn trống của trang pháp lý (5 phút)

**Nội dung 3 trang đã soạn xong** (lát `c4.1`, 2026-09-04 — anh yêu cầu agent tự viết).
`/terms`, `/privacy`, `/paysupport` đã chạy, cuộn được, vừa màn hình điện thoại, và có link từ menu
chính. Sáu mục hỏi trong bản trước đã được chốt như sau:

| Mục | Đã chốt | Ai quyết |
|---|---|---|
| Chính sách hoàn Stars | Hoàn trong **14 ngày**; từ chối khi đã tiêu hết coin/năng lượng, đổi ý, hoặc tài khoản bị khoá vì gian lận | agent soạn |
| Tuổi tối thiểu | **13** (khớp điều kiện của chính Telegram) | agent soạn |
| Dữ liệu thu thập | Liệt kê theo **schema database thật**, không theo trí nhớ — có test khoá hạn 90 ngày cho khớp `purge_old_analytics_events` | agent soạn |
| Luật áp dụng | **Việt Nam** | agent soạn |
| **Tên đơn vị vận hành** | ⛔ **CÒN TRỐNG** | **chỉ anh** |
| **Email hỗ trợ** | ⛔ **CÒN TRỐNG** | **chỉ anh** |

Hai ô cuối agent **cố ý không bịa**: đó là lời khẳng định về việc *ai chịu trách nhiệm pháp lý*, và
đặt một cái tên nghe hợp lý vào đó là tạo ra một pháp nhân không tồn tại.

### Cách điền

Mở `packages/client/src/lib/legal.ts`, sửa đúng hai dòng đầu:

```ts
operator: "Tên công ty hoặc tên anh",
contactEmail: "email-ho-tro@ten-mien.vn",
```

Tuỳ chọn: `contactTelegram: "@ten_bot_ho_tro"` nếu muốn hiện thêm kênh Telegram.

Kiểm tra đạt: mở `/terms` — băng đỏ **"BẢN NHÁP — CHƯA PHÁT HÀNH ĐƯỢC"** phải **biến mất**. Chừng
nào băng đó còn, cả ba trang tự khai mình là bản nháp, nên không thể vô tình nộp cho Telegram.

Sau khi điền, đọc lại một lượt và sửa chỗ nào không đúng ý anh — đây là cam kết pháp lý mang tên
anh, agent chỉ soạn bản đầu.

⚠️ Nội dung này do agent soạn, **không phải luật sư rà**. Nếu game bắt đầu có doanh thu đáng kể hoặc
người chơi ngoài Việt Nam, nên đưa một luật sư đọc lại — nhất là mục giới hạn trách nhiệm và mục
hoàn tiền.

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

## Việc 9 — QUYẾT ĐỊNH: mua năng lượng khi đầy bình vẫn bị trừ coin 🔴

**Lát `r2.2` phát hiện. Đây là lỗi tiền, chưa sửa — vì cách sửa là một quyết định sản phẩm.**

Đo trong một giao dịch rollback trên database dev (không commit gì):

| tình huống | coin | năng lượng | sổ cái |
|---|---|---|---|
| **đầy bình 50/50** | **−100** | **+0** | ghi khoản trừ |
| còn chỗ 10/50 | −100 | +20 | ghi khoản trừ |

Ở bình đầy, người chơi **trả 100 coin và không nhận được gì**.

**Nguyên nhân** (`supabase/migrations/202608180003_energy_purchase.sql`): `purchase_energy_with_coin`
trừ coin **vô điều kiện** rồi mới gọi `grant_energy`, mà `grant_energy` chặn trần ở `energy_max`.

Client hiện có thể đang ẩn nút mua khi đầy bình. Đó **không phải** lớp bảo vệ: cả doc 35 §A3 dựng
lên vì server không được tin client.

**Ba cách sửa, anh chọn một:**

| cách | nghĩa là gì | đánh đổi |
|---|---|---|
| **A. Từ chối** khi không nhận được trọn gói | `raise exception 'energy_full'`, không trừ đồng nào | Rõ ràng nhất. Người chơi ở 45/50 không mua được dù còn thiếu 5 — phải chờ hồi |
| **B. Cho tràn** trên trần | cộng đủ 20 điểm, vượt `energy_max` | Người chơi được đúng thứ đã trả tiền. Nhưng trần năng lượng là một cần điều tiết nhịp chơi — phá nó là đổi thiết kế kinh tế |
| **C. Tính tiền theo phần nhận được** | ở 45/50 chỉ trừ 5/20 giá | Công bằng nhất, phức tạp nhất; sinh số lẻ trong sổ cái |

Tôi nghiêng về **A**: nó không đổi thiết kế kinh tế nào, và "không bán thứ không giao được" là quy
tắc dễ giải thích cho người chơi nhất. Nhưng đây là tiền của anh, không phải quyết định kỹ thuật.

Sửa xong cần **migration mới** (không được sửa file đã áp — AGENTS.md §1) và một bài test cho
đường vừa chọn.

---

## Việc 8 — Các quyết định sẽ hỏi đúng lúc (chưa cần bây giờ)

| Khi nào | Quyết định |
|---|---|
| Lát `d1.1-ftue` | Nội dung 3 bước hướng dẫn + ngưỡng "đạt" mỗi bước (cảm giác chơi — máy không chấm được) |
| ~~Lát `a4.2`~~ ✅ | Đã dựng TRUNG TÍNH — cùng SDK chạy được cả Sentry lẫn GlitchTip. Chỉ còn dán DSN vào `ERROR_DSN` + `NEXT_PUBLIC_ERROR_DSN`; để rỗng = tắt hẳn |
| Đầu Pha 7 | Thưởng cụ thể 7 ngày điểm danh, thưởng theo mốc level |
| Trước khi bật quyền GHI của Ops API cho agent | Hạn mức ngày mỗi key (vd trần coin/ngày) — sau 2 tuần chạy read-only |
| Pha 8 | Giá và nội dung Battle Pass mùa 1 |

---

## Thứ tự khuyến nghị

```
Việc 1 (Actions) ✅  →  Việc 2 (branch protection) ⏸️ bỏ qua  →  Việc 3 (database) ✅
                                                                      ↓
                            Việc 3c (pg_cron, 2 phút)   ·   Việc 6 (pháp lý)
                                                                      ↓
                                Việc 7 (duyệt PR risk:high)  ←  sẽ cần cho a3.2, c2.1
                                                                      ↓
                                                        Việc 4, 5 khi tới Pha 7
```

**Không có việc nào của anh đang CHẶN agent** (cập nhật 2026-09-04). Các việc còn lại nâng chất
lượng chứ không mở khoá lát nào:

- **Việc 3c** — chưa bật `pg_cron` thì ARPDAU đọc số của lần refresh gần nhất. Retention và funnel
  đọc sự kiện thô nên luôn tươi.
- **Việc 6** — chưa điền thì trang pháp lý tự khai mình là bản nháp.
- **§3.2** — 1 phút sửa `SUPABASE_DB_URL` sang chuỗi Session pooler, để agent khỏi ghép chuỗi thủ
  công mỗi lần chạy migration.

Sắp tới sẽ cần **Việc 7**: `a3.2-campaign-sanity` và `c2.1-ops-api-keys` đều là `risk: high`.

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
