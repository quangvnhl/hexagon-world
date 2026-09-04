# Luật bắt buộc cho mọi agent làm việc trong repository này

> Đọc file này TRƯỚC khi sửa bất cứ thứ gì. Luật ở đây thắng mọi suy đoán tiện tay.
> Nguồn thiết kế: `.implements/` (đọc `README.md` để biết thứ tự). Nguồn *việc*: `.implements/BACKLOG.yaml`.
> Bối cảnh vì sao có file này: `.implements/36-phase-5-5-automation-rails.md` (R5, R6).

## 0. Vòng làm việc chuẩn của một lát

1. Nhận **một lát** (`id`) trong `.implements/BACKLOG.yaml`. Một lát = một phiên agent.
2. Đọc mục thiết kế mà `doc:` trỏ tới trước khi viết dòng code đầu tiên.
3. **Chỉ sửa các đường dẫn liệt kê trong `files:`** của lát đó.
4. Chạy đủ mọi lệnh trong `dod:`. Đỏ ⇒ chưa xong, không được tuyên bố hoàn thành.
5. Bí, thiếu thông tin, hoặc phải chạm file ngoài `files:` ⇒ đặt `status: blocked` kèm lý do,
   **dừng lại**. Không tự nới phạm vi.

## 1. CẤM (không có ngoại lệ)

- **Git:** agent thực thi lát **không chạy bất kỳ lệnh git nào** — `stash`, `reset`, `checkout`,
  `commit`, `merge`, `rebase`, `push`. Chỉ orchestrator commit và gộp.
  *(Đã từng mất việc vì nhiều agent chung một working tree cùng chạy `stash`/`reset --hard`.)*
- `git push --force` dưới mọi hình thức.
- **Sửa, đọc-in ra màn hình, hoặc commit `.env`** (mọi biến thể: `.env`, `packages/*/.env`,
  `deploy/*.env`) và `client_secret_*.json`. Chỉ được sửa `.env.example` — và chỉ ghi tên biến,
  giá trị để rỗng hoặc placeholder.
- **Chạy migration/seed lên production.** Agent chỉ được `--target staging`.
- **Xoá dữ liệu người chơi**, dù trên staging.
- **Sửa nội dung file migration ĐÃ áp** trong `supabase/migrations/`. Chỉ được thêm file mới.
- Đổi `GAME_PROTOCOL_VERSION` mà không cập nhật đồng thời `shared` + `client` + `server`.
- Commit khi CI đỏ, hoặc tắt/bỏ qua một test đang đỏ để cho xanh.

## 2. BẮT BUỘC

- **Bất biến "default = hành vi cũ".** Mọi field/config/cờ mới phải có giá trị mặc định giữ
  nguyên trải nghiệm hiện tại của `/play`, `/netplay`, `/campaign`. Nguyên tắc xuyên suốt doc 27–36.
- **Không tin client.** Mọi thứ có giá trị (coin, XP, năng lượng, sao, mở khoá, phần thưởng
  quảng cáo) phải do server tự tính hoặc tự xác minh. Xem `.implements/35-product-depth-plan.md` §A3.
- **Idempotency.** Mọi endpoint ghi mới nhận `Idempotency-Key` hoặc có khoá tự nhiên chống lặp.
- **Hợp đồng nằm ở `shared`.** Đổi toán hex, protocol, `MatchConfig` ⇒ phải cập nhật doc tương ứng
  trong `.implements/` trong cùng lát.
- **Nghiệm thu bằng số, không bằng mắt.** Lát chạm gameplay phải có ít nhất một phép ĐO hành vi
  (vị trí sau N tick, khoảng cách tới tường, số ô chiếm được), không chỉ typecheck. Xem doc 36 R2 tầng 3.
- **Tất định.** Test/script không được phụ thuộc `Math.random`. `GameState` hiện vẫn dùng
  `Math.random` cho spawn/bot ⇒ phải ghim RNG ở tầng test cho tới khi lát `T1` xong.
- **Tiếng Việt** cho comment, tài liệu và commit message — theo đúng phần còn lại của repo.

## 3. Quy tắc nền tảng (Telegram) — giữ nguyên, vẫn bắt buộc

Đọc và tuân thủ `.implements/15-telegram-platform-gating-and-adsgram.md` trước khi thêm hoặc sửa
bất kỳ tính năng dành riêng cho Telegram.

- Không suy luận Telegram từ URL, route, user-agent, hostname, tên tài khoản hoặc một cờ do
  client tự truyền.
- Trước khi tải SDK hay gọi API Telegram/AdsGram, phải xác nhận `window.Telegram.WebApp` tồn tại
  và `initData` có đủ dữ liệu Telegram Mini App.
- Mọi SDK Telegram-only phải được lazy-load sau khi platform gate thành công.
- Web và các platform khác phải tiếp tục hoạt động nếu Telegram/AdsGram không tồn tại hoặc bị
  lỗi (fail-open).
- Logic cấp tài sản/phần thưởng có giá trị phải được backend xác minh; không tin `initDataUnsafe`,
  Telegram ID hoặc kết quả quảng cáo do client tự khai.

> Bản client hiện tại phục vụ **Telegram Mini App**; bản web (Google login + cổng thanh toán) làm
> sau (doc 35, quyết định #1). Vẫn giữ fail-open để không tự khoá đường sang web.

## 4. Chạy song song và gộp PR (đã chốt 2026-09-03)

- **Tuần tự, một agent một lúc.** Không chạy song song ở giai đoạn này.
  *(Nếu sau này bật: chỉ khi các lát không giao nhau về `files:` và mỗi agent có `git worktree`
  riêng — mỗi worktree phải `pnpm install` riêng vì pnpm workspace.)*
- Một lát = một nhánh `slice/<id>`. **Không đẩy thẳng lên `main`.**
- **Gộp:** orchestrator tự gộp khi CI xanh, **TRỪ lát `risk: high`** — chờ người duyệt.
  Lát chạm tiền, tài khoản người chơi, migration hoặc quyền Ops API đều là `risk: high`.

## 5. Định nghĩa "XONG"

Job `verify` (`.github/workflows/ci.yml`) và job `guard` (`.github/workflows/review.yml`) đều xanh,
**và** mọi lệnh trong `dod:` của lát xanh. Không có tiêu chí nào khác. Tự khai "đã chạy thử thấy ổn"
không tính.

## 6. Ba tầng review (doc 36 R7)

| Tầng | Chạy khi nào | Trả lời câu hỏi | Cần gì |
|---|---|---|---|
| `CI` → job `verify` | mọi push/PR | *Code có chạy không?* | không |
| `Review` → job `guard` | mọi PR | *Có phạm luật ở §1–§2 không?* | không |
| `Claude Review` | mọi PR không phải nháp | *Thiết kế có đúng không, bỏ sót gì không?* | secret `ANTHROPIC_API_KEY` |

Trước khi mở PR, chạy tại máy để khỏi phải chờ CI:

```bash
pnpm review:guard
```

Cổng `guard` biến các luật ở §1–§2 thành phép kiểm máy: bí mật lọt vào commit, sửa migration đã áp,
tắt test đang đỏ, log trong đường nóng gameplay, server đọc thẳng giá trị có giá từ `body`,
`Math.random` trong `shared`, endpoint ghi thiếu chống lặp.

**Lối thoát hiểm** khi cổng chặn nhầm — viết ở dòng NGAY TRÊN dòng bị bắt:

```
// review-guard: bỏ qua <id-luật> — <lý do đủ dài để người sau hiểu>
```

Lý do dưới 8 ký tự không được tính là lý do. Miễn trừ được in ra trong log để người duyệt còn thấy.
Thêm luật mới thì thêm cả test trong `scripts/review-guard.test.mjs` — một cổng chặn viết sai hoặc
bỏ lọt, hoặc chặn nhầm rồi bị vô hiệu hoá cả cụm.
