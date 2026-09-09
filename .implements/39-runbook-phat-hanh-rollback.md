# 39 — Sổ tay PHÁT HÀNH và ROLLBACK

> doc 35 §C5. Viết **trước** khi cần dùng, vì thứ này chỉ được đọc lúc 2 giờ sáng khi có gì đó hỏng
> — và lúc đó không ai đủ tỉnh để tự nghĩ ra thứ tự đúng.

Liên quan: [35 §C5/§C6](35-product-depth-plan.md) · [38 Chặng 1](38-lo-trinh-dai-han.md) ·
[11 runbook backend](11-player-backend-runbook.md) · `AGENTS.md` §1

---

## 0. Ba thứ chưa có, và ai làm được

Sổ tay này mô tả **thứ tự và cách hoàn tác**. Nó không tự deploy được, vì ba việc dưới đây cần tài
khoản của chủ dự án:

| Việc | Vì sao agent không làm được |
|---|---|
| Chọn nơi chạy server + control plane | Cần tài khoản và thẻ |
| Domain + HTTPS | Cần mua |
| Supabase **production riêng** | Tạo project là thao tác trên tài khoản |

Khi ba việc đó xong, workflow deploy viết được ngay — hình dạng của nó đã cố định ở §2 dưới đây.

---

## 1. Thứ tự phát hành — KHÔNG ĐƯỢC ĐỔI

```
1. migration  →  2. server  →  3. client
```

**Vì sao đúng thứ tự này.** Migration phải tương thích NGƯỢC: schema mới vẫn phải phục vụ được code
CŨ đang chạy, vì trong khoảng giữa bước 1 và bước 2 chính là code cũ đang chạy trên schema mới.
Server trước client vì server là bên đặt ra hợp đồng; client mới nói chuyện với server cũ sẽ gửi
thứ server chưa hiểu.

**Cổng chặn giữa bước 1 và 2:**

```bash
node scripts/db-migrate.mjs --target staging --check
```

Thoát `1` nếu còn migration chưa áp, và in ra tên từng cái. Đặt bước này **trước** bước deploy code
trong workflow; nó tồn tại để một lần quên không trở thành một sự cố.

> Cờ riêng chứ không dùng `--dry-run`: `--dry-run` luôn thoát `0`, nên một bước CI dùng nó sẽ **xanh
> kể cả khi còn migration chưa áp**. Một cổng luôn xanh không phải là cổng.

### Migration PHÁ VỠ phải tách làm hai lần phát hành

Cổng trên **không cứu được** trường hợp này, và không giả vờ là cứu được. Đổi tên hoặc bỏ một cột
đang được code cũ đọc sẽ làm hỏng ngay giữa bước 1 và bước 2.

```
Lần 1:  thêm cột mới  →  deploy code đọc CẢ HAI cột
Lần 2:  (sau khi chắc không còn ai đọc cột cũ)  bỏ cột cũ
```

---

## 2. Hình dạng workflow deploy

Khi đã chọn xong nơi chạy, workflow chỉ cần đúng các bước sau, theo đúng thứ tự:

```
1. checkout + pnpm install --frozen-lockfile
2. pnpm -r typecheck · pnpm -r test · pnpm build          ← không deploy thứ chưa xanh
3. node scripts/release-gate.mjs --env-file <env thật>    ← chặn placeholder và rò secret sang role game
4. node scripts/db-migrate.mjs --target production --yes  ← CHỈ NGƯỜI chạy được nhánh này
5. node scripts/db-migrate.mjs --check                    ← cổng: xác nhận không còn gì chờ
6. deploy server   (chỗ phụ thuộc nhà cung cấp)
7. kiểm /health/ready trả database=true                   ← trước khi đụng tới client
8. deploy client   (chỗ phụ thuộc nhà cung cấp)
9. kiểm khói: mở trang, chơi hết FTUE
```

### Nơi chạy đã chốt: một VPS, Docker Compose, client ở cùng chỗ

`deploy/docker-compose.yml` dựng bốn tiến trình: `caddy` (TLS + cổng vào duy nhất), `control`,
`game`, `client`. **Ba tiến trình server chứ không phải một** là vì `release-gate.mjs` từ chối
`SERVER_ROLE=all` ở production và từ chối cấp secret control plane cho node game — node game nhận
WebSocket từ Internet nên nó là thứ dễ bị chiếm nhất, và nó không cần khoá Supabase để làm việc.

Bước 6/8 nay là `.github/workflows/deploy.yml`. Hai tính chất cố ý của nó:

* **Không giữ một secret ứng dụng nào.** `control.env` và `game.env` nằm trên máy chủ, do người
  vận hành tạo, và deploy không đọc cũng không ghi đè. Workflow chỉ cần quyền đẩy image lên GHCR
  và một khoá SSH. Một lần rò log của nó không làm lộ tiền hay dữ liệu người chơi.
* **Không chạy migration.** Bước 4 và 5 dưới đây vẫn là việc của người, làm TRƯỚC khi bấm deploy.
  Đặt `ALLOW_PRODUCTION_MIGRATE` vào secret của workflow chính là vô hiệu hoá cái rào đang bảo vệ
  production.

`scripts/compose.test.mjs` giữ ba điều hỏng âm thầm, mỗi điều kèm một phép thử ngược chứng minh
luật bắt được bản đã phá: spool kết quả trận nằm trên volume bền (mỗi file là tiền của một người
chơi), node game không nhận secret của control plane, và `/metrics` không lộ ra Internet.

Trước lát này, bước dựng image chưa từng chạy ở đâu; `.github/workflows/image.yml` nay dựng thật
cả hai stage rồi kiểm đúng đường dẫn `CMD` trỏ tới.

Chuẩn bị một lần trên máy chủ:

```
mkdir -p /opt/hexworld && cd /opt/hexworld
# chép deploy/control.env.example và deploy/game.env.example vào rồi điền
node scripts/release-gate.mjs --target production --control control.env --game game.env
```

Trong GitHub, environment `production` cần:

```
secrets:    DEPLOY_SSH_KEY · DEPLOY_KNOWN_HOSTS
variables:  DEPLOY_HOST · DEPLOY_USER · DEPLOY_PATH · DOMAIN · API_DOMAIN · GAME_DOMAIN
```

`DEPLOY_KNOWN_HOSTS` là khoá máy chủ đã ghim, KHÔNG dùng `ssh-keyscan` trong workflow: keyscan tin
bất cứ thứ gì trả lời, nên nó biến việc xác thực máy chủ thành thủ tục trang trí.

Bước 4 có rào cứng trong `db-migrate.mjs`: `--target production` bị **từ chối** trừ khi có biến môi
trường `ALLOW_PRODUCTION_MIGRATE=yes-i-know`. Agent không bao giờ có biến đó (AGENTS.md §1).

---

## 3. Rollback — từng phần, theo thứ tự ngược

Nguyên tắc: **hoàn tác thứ mới nhất trước**. Client là thứ dễ hoàn tác nhất và thường là đủ.

### 3.1 Rollback CLIENT (rẻ nhất, làm trước)

Deploy lại bản build trước. Không đụng database, không đụng server.

Đủ khi: lỗi giao diện, lỗi render, một màn hình vỡ. **Không đủ** khi lỗi nằm ở dữ liệu server trả về.

> Telegram Mini App **không ép cập nhật được** (doc 35 §A8): sau khi rollback client, vẫn còn người
> đang mở bản lỗi. Họ chỉ nhận bản cũ khi mở lại app.

### 3.2 Rollback SERVER

Deploy lại image trước đó. Kiểm tra **trước khi bấm**:

- Bản server cũ có đọc được schema hiện tại không? Nếu migration vừa rồi tương thích ngược thì có.
  Nếu không → **không được** rollback server; phải sửa tới (fix-forward).
- `GAME_PROTOCOL_VERSION` của bản cũ có nằm trong cửa sổ client đang chạy không?
  Xem `MIN_SUPPORTED_GAME_PROTOCOL` trong `packages/shared/src/protocol-version.ts`.
  Rollback server xuống dưới `MIN` của client đang chạy sẽ ngắt hết kết nối.

### 3.3 Rollback MIGRATION — gần như luôn là câu trả lời SAI

**Mặc định: đừng.** Hoàn tác một migration đã chạy trên dữ liệu thật là cách nhanh nhất để mất dữ
liệu, và AGENTS.md §1 cấm sửa nội dung file migration đã áp.

Cách đúng là **thêm một migration mới bù lại thay đổi**:

```bash
# viết supabase/migrations/<ngày giờ>_hoan_tac_<gì đó>.sql
node scripts/db-migrate.mjs --target production --yes
```

Chỉ khi migration vừa áp làm **mất** dữ liệu và không bù được bằng SQL thì mới tới PITR (§4).

---

## 4. Khôi phục từ sao lưu (C6)

Bật PITR trong Supabase, và **diễn tập một lần** trước khi phát hành.

> Chưa từng thử khôi phục = coi như chưa có backup. Đây là thứ duy nhất đứng giữa một sai lầm và
> mất sạch dữ liệu người chơi.

**Diễn tập tối thiểu** (làm trên project dev, không phải production):

1. Ghi lại `select count(*) from players` và mốc thời gian hiện tại.
2. Khôi phục về mốc đó trong dashboard Supabase.
3. So lại số đếm. Ghi lại **mất bao lâu** — con số đó chính là RTO thật của bạn, và nó thường lớn
   hơn nhiều so với dự đoán.

Quyết định khôi phục thật **phải do người bấm**. Agent không tự chạy bước này.

### `GAME_RESULT_SPOOL_DIR`

Phải nằm trên **volume bền**, không phải thư mục tạm của container. Mỗi file tồn trong đó là một
kết quả trận chưa ghi được — tức XP và tiền của một người chơi đang nằm chờ. Container khởi động
lại mà volume không bền thì số đó mất luôn, im lặng. Có alert tồn đọng ở §C1.

---

## 5. Kiểm sau phát hành — 5 phút, làm mỗi lần

| # | Kiểm | Đạt khi |
|---|---|---|
| 1 | `GET /health/ready` | `database=true` |
| 2 | Mở Mini App, chơi hết FTUE | không lỗi console, canvas có ngữ cảnh WebGL |
| 3 | `pnpm test:e2e:money` trỏ vào môi trường vừa deploy | 2/2 xanh |
| 4 | Số file trong `GAME_RESULT_SPOOL_DIR` | không tăng dần |
| 5 | `analytics_events` có sự kiện mới trong 5 phút gần nhất | có |

Bước 3 là bước duy nhất chứng minh **luồng tiền** còn nguyên sau khi deploy. Nó ghi vào database
thật, nên chạy thủ công và có chủ ý.

---

## 6. Cửa sổ tương thích protocol

`packages/shared/src/protocol-version.ts` khai hai hằng:

| Hằng | Nghĩa |
|---|---|
| `GAME_PROTOCOL_VERSION` | phiên bản server đang nói |
| `MIN_SUPPORTED_GAME_PROTOCOL` | phiên bản **cũ nhất** server còn nhận |

Kỷ luật, không có ngoại lệ:

- **Thêm vào** (thêm trường tuỳ chọn, thêm loại bản tin): tăng `GAME_PROTOCOL_VERSION`, **giữ
  nguyên** `MIN`.
- **Phá vỡ** (đổi nghĩa một trường, bỏ trường, đổi bố cục nhị phân): tăng **cả hai**, đặt `MIN` =
  phiên bản mới.

Đặt `MIN` thấp hơn mức thật sự đọc được **tệ hơn không có cửa sổ**: client cũ sẽ kết nối được rồi
giải mã sai, và lỗi hiện ra giữa ván dưới dạng vị trí nhảy loạn — chứ không phải một thông báo
"hãy cập nhật".

Hiện tại `MIN` **bằng** `GAME_PROTOCOL_VERSION`: cửa sổ rộng đúng một phiên bản, hành vi không đổi
so với trước. Cơ chế đã có; lần tăng *thêm vào* kế tiếp dùng được ngay.
