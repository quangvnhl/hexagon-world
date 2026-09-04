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

## Việc 1 — Bật GitHub Actions ⛔ ĐANG CHẶN MỌI LÁT

Không có Actions thì không có cổng "xong", agent không được phép gộp gì.

1. Mở https://github.com/quangvnhl/hexagon-world/settings/actions
2. Mục **Actions permissions** → chọn **Allow all actions and reusable workflows** → **Save**.
3. Mở tab **Actions** của repo. Nếu có banner đề nghị bật workflow, bấm **I understand my workflows, go ahead and enable them**.

Kiểm tra đạt:

```bash
gh workflow list
```

Phải in ra dòng có tên `CI`. (Hiện đang rỗng.)

---

## Việc 2 — Branch protection cho `main`

**Làm SAU khi CI đã chạy ít nhất một lần**, vì tên status check chỉ xuất hiện sau lần chạy đầu.

1. Mở https://github.com/quangvnhl/hexagon-world/settings/branches
2. **Add branch protection rule** → Branch name pattern: `main`
3. Tick **Require a pull request before merging**
4. Tick **Require status checks to pass before merging** → ô tìm kiếm gõ `verify` → chọn check **verify**
5. **Create** / **Save changes**

Từ đây mọi thay đổi vào `main` đều phải qua PR có CI xanh — kể cả của agent.

---

## Việc 3 — Supabase STAGING ⛔ đang chặn 8 lát

Chặn: `r3.1-db-migrate`, `r3.2-db-seed`, `r2.2-e2e-money`, `a3.2`, `a1.3`, `a1.5`, `a2.1`, `c2.1`.

### 3.1 Tạo project

1. Vào https://supabase.com/dashboard → **New project**
2. Name: `hexagon-world-staging` · Region: **Southeast Asia (Singapore)** · Database Password: bấm
   **Generate** rồi **lưu vào trình quản lý mật khẩu** (sẽ cần ở bước 3.2).
3. Đợi project khởi tạo xong (~2 phút).

### 3.2 Lấy 3 giá trị

| Giá trị | Lấy ở đâu |
|---|---|
| `SUPABASE_URL` | Settings → **API** → *Project URL* (dạng `https://xxxx.supabase.co`) |
| `SUPABASE_SECRET_KEY` | Settings → **API** → *Project API keys* → **service_role** (bấm Reveal) |
| `SUPABASE_DB_URL` | Settings → **Database** → *Connection string* → tab **URI**; thay `[YOUR-PASSWORD]` bằng mật khẩu ở bước 3.1 |

### 3.3 Ghi vào file env cục bộ

Chạy trong thư mục repo (thay giá trị thật vào giữa hai dấu nháy):

```bash
mkdir -p deploy && printf 'SUPABASE_URL=%s\nSUPABASE_SECRET_KEY=%s\nSUPABASE_DB_URL=%s\n' 'DÁN_URL' 'DÁN_SERVICE_KEY' 'DÁN_DB_URL' > deploy/staging.env
```

Rồi chặn Git đụng tới nó:

```bash
grep -qxF 'deploy/*.env' .gitignore || echo 'deploy/*.env' >> .gitignore
```

Kiểm tra đạt (chỉ in tên biến, KHÔNG in giá trị):

```bash
grep -oE '^[A-Z_]+=' deploy/staging.env
```

Phải ra đúng 3 dòng. Sau đó nhắn cho agent: **"staging sẵn sàng"**.

> ⚠️ Tuyệt đối không đưa key **production** vào file này. Script `db-migrate` mặc định từ chối
> `--target production`; agent chỉ được phép chạy `--target staging`.

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
Việc 1 (Actions)  →  đợi CI chạy 1 lần  →  Việc 2 (branch protection)
                                              ↓
                                        Việc 3 (Supabase staging)   ← mở khoá 8 lát
                                              ↓
                              Việc 6 (nội dung pháp lý)  →  Việc 4, 5 khi tới Pha 7
```

**Chỉ Việc 1 là đang chặn ngay lúc này.** Việc 3 sẽ chặn khi agent làm tới các lát cần database —
làm sớm được thì agent chạy liên tục không phải dừng.

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
