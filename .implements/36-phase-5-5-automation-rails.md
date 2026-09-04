# 36 — Pha 5.5: Dựng đường ray để agent thực thi tự động

> **Loại tài liệu:** KẾ HOẠCH thi công. Chèn **trước** Pha 6 của [35-product-depth-plan.md](35-product-depth-plan.md).
>
> **Mục tiêu:** biến kế hoạch 35 (văn xuôi cho người) thành thứ một agent **tự thực thi và tự nghiệm thu** được,
> mà không cần người xác nhận ở từng bước. Không thêm tính năng người chơi nào trong pha này.
>
> **Phạm vi:** `packages/{client,server,shared,admin}`, `scripts/`, `supabase/`, `.github/`, `AGENTS.md`.

---

## 0. Vì sao cần pha này (bằng chứng trong repo)

| Quan sát | Hệ quả với thực thi tự động |
|---|---|
| **Không có `.github/`** — chưa có CI | Agent không có cổng pass/fail khách quan; "xong" chỉ là lời tự khai |
| DoD hiện tại nhiều chỗ là **verify tay**: doc 33 *"va chạm + viz 3D cần hiện pane để mắt-thường xác nhận"*, doc 34 *"cảm giác lái/3D/minimap cần hiện pane"*, doc 29 *"CHỜ: áp migration 003+004+005 lên Supabase"* | Agent **không đóng được** những việc này ⇒ chuỗi tự động đứt ngay lát đầu tiên |
| Migration áp **bằng tay** qua dashboard/psql (runbook [11](11-player-backend-runbook.md) §6) | Agent không bấm được dashboard ⇒ mọi việc chạm schema (A1, A3, B*, C2) bị chặn |
| `.env.example` **thiếu 4 biến** thực có trong `.env`: `COOKIE_SECURE`, `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY`, `SUPABASE_DATABASE_PASSWORD` | Agent dựng môi trường theo mẫu sẽ thiếu biến và hỏng theo kiểu khó đoán |
| Chưa có Playwright; test hiện là unit + integration trong process | Không có lát nào chứng minh **luồng tiền xuyên HTTP thật** còn sống sau refactor |
| **Đã từng xảy ra**: nhiều agent chung một working tree, một agent `git stash`/`reset --hard` làm revert việc dang dở của agent khác | Bật song song mà chưa chốt chính sách worktree = mất việc, không phải giả định |
| Kế hoạch 35 là văn xuôi, không có đơn vị việc máy đọc được | Agent phải tự diễn giải phạm vi mỗi phiên ⇒ trôi phạm vi, chạm file ngoài dự kiến |

**Kết luận:** thiếu 3 thứ — *cổng nghiệm thu tự động*, *đường chạm database bằng máy*, và *đơn vị việc máy đọc được*.

---

## 1. Tiêu chí đóng pha (một câu)

> Một lát bất kỳ trong `BACKLOG.yaml` chạy trọn vòng **không có người can thiệp giữa chừng**:
> agent đọc lát → sửa đúng các file được phép → chạy DoD dạng lệnh → CI xanh → orchestrator gộp.
> Nghiệm thu bằng **lát mẫu A3.1** (siết `campaign/complete`) chạy hết vòng đó.

---

## 2. R1 — CI làm cổng chất lượng

**Sản phẩm:** `.github/workflows/ci.yml` (remote đã có: `github.com/quangvnhl/hexagon-world`).

```
node 24 · corepack pnpm@11.20.0 · cache pnpm store
pnpm install --frozen-lockfile
pnpm build:shared → pnpm -r typecheck → pnpm test
pnpm verify:logic → pnpm test:release-gate → pnpm build
```

- `concurrency` + `cancel-in-progress` để PR đẩy liên tục không xếp hàng.
- **Không cần secret thật**: test server chạy với `SERVER_ROLE=all` + dummy secret (đúng cách harness load
  đang làm — `packages/server/test/load/README.md`). Job nào cần staging thì tách riêng và **chỉ chạy thủ công**.
- Kết quả CI là **định nghĩa "xong"** của mọi lát. Agent không được tự tuyên bố hoàn thành khi CI đỏ.

**DoD:** mở một PR rác ⇒ CI chạy đủ 6 bước và chặn merge khi test đỏ.

---

## 3. R2 — Nghiệm thu tự động thay cho mắt người

Chia 3 tầng, làm tầng 1 và 3 trước (không cần hạ tầng ngoài).

### Tầng 1 — Smoke UI không cần database
Playwright chạy trên client dev server: mở `/`, `/play`; assert canvas dựng được, HUD có mặt,
**console không có lỗi**, FPS meter > 0 sau 5 giây. Bắt được đúng loại lỗi hay gặp nhất khi sửa render.

### Tầng 2 — Luồng tiền xuyên HTTP thật (cần staging, xem R3)
`dev-login` (`POST /v1/auth/dev` — đã có, chặn ở production) → mua năng lượng bằng coin →
`campaign/start` → `campaign/complete` → **assert ví + `wallet_ledger` + `player_level_progress`**.
Đây là luồng dễ vỡ nhất khi refactor và là thứ bảo vệ trực tiếp phần kinh tế.

### Tầng 3 — Đổi "nhìn" thành "đo" (thuần TS, chạy trong `shared`)
Chuyển các mục verify-tay tồn đọng của doc 33/34 thành assertion số học, theo đúng mẹo đã dùng ở bản Unity
(*"đo thay vì nhìn"*, doc 00):

| Việc đang phải nhìn | Thay bằng phép đo |
|---|---|
| "3D trượt dọc viền obstacle, không kẹt" | Chạy `GameState` N tick từ vị trí/heading cố định ⇒ assert **có dịch chuyển dọc tiếp tuyến** và **không nằm trong ô obstacle** |
| "Va chạm biên polyline không xuyên" | Bắn thẳng vào đoạn biên ⇒ assert khoảng cách tới đoạn ≥ 0 sau mỗi tick |
| "Minimap khớp bán kính cấp" | Assert hàm scale world→px với `arenaR` = 20 và 130 cho tỉ lệ đúng |
| "Cấp king_hold hiện đồng hồ" | Assert `objectiveProgress` trả đúng kiểu/giá trị theo `win.kind` |

**Chấp nhận không tự động hoá:** *cảm giác chơi* (độ khó, tốc độ, "có vui không") và thẩm mỹ. Những lát chạm
vào đó phải gắn cờ `requires_human: true` trong backlog thay vì giả vờ nghiệm thu được.

---

## 4. R3 — Đường chạm database bằng máy

**Sản phẩm:**

1. **`scripts/db-migrate.mjs`** — đọc `supabase/migrations/*.sql` theo thứ tự tên, ghi bảng
   `schema_migrations(version, checksum, applied_at)`, **idempotent** (chạy lại không áp lại), dùng
   `SUPABASE_DB_URL` (biến đã có sẵn trong `.env.example`).
   - Rào an toàn: `--target staging|production`; với `production` **bắt buộc** biến môi trường xác nhận
     riêng, mặc định từ chối. Agent chỉ được gọi với `staging`.
   - Phát hiện checksum lệch (migration đã áp bị sửa nội dung) ⇒ dừng, không tự sửa.
2. **`scripts/db-seed.mjs`** — seed **xác định** (players mẫu, catalog + giá, 5 cấp campaign publish) để E2E
   tầng 2 lặp lại cho cùng kết quả. Idempotent theo khoá tự nhiên.
3. **Đồng bộ `.env.example`** — bổ sung 4 biến còn thiếu.
   *(Cập nhật 2026-09-04: phần `deploy/*.env.example` **bỏ** — chốt "tất cả đang là dev, Supabase có
   deploy vẫn là dev" nên dùng thẳng `.env` ở gốc, không tạo project staging riêng. `.gitignore` đã
   bịt sẵn `deploy/*.env` ở lát t3 phòng khi sau này cần.)*

**Ràng buộc tuyệt đối:** agent **không bao giờ** chạy migrate/seed lên production; không đọc, không in, không
commit giá trị secret.

**DoD:** trên Supabase staging trống: `db:migrate` → `db:seed` → E2E tầng 2 xanh; chạy lại cả hai lệnh lần hai
⇒ không đổi dữ liệu, không lỗi.

---

## 5. R4 — `BACKLOG.yaml`: đơn vị việc máy đọc được

**Sản phẩm:** `.implements/BACKLOG.yaml` — nguồn sự thật về *việc*, trong khi doc 35 là nguồn sự thật về *thiết kế*.

```yaml
version: 1
slices:
  - id: A3.1
    doc: "35#A3"                     # thiết kế nằm ở đâu
    title: "Server tự tính sao/điểm cho campaign/complete"
    files:                            # agent CHỈ được sửa các đường dẫn này
      - packages/server/src/campaign/campaign.controller.ts
      - packages/shared/src/campaign.ts
      - packages/server/test/campaign.spec.ts
    depends_on: []
    dod:
      - "pnpm --filter @hexagon/shared test"
      - "pnpm --filter @hexagon/server test"
      - "pnpm -r typecheck"
    risk: high
    requires_human: false
    status: todo                      # todo | doing | done | blocked
    commit: null
```

Quy tắc:

- **Một lát = một phiên agent** (~≤ 10 file). Lát to hơn phải chẻ trước khi giao.
- Agent **không được chạm file ngoài `files`**. Cần thêm ⇒ cập nhật `BACKLOG.yaml` trước, thành một diff nhìn thấy được.
- `dod` là **lệnh chạy được**, không phải câu mô tả. Không có lệnh thì lát đó chưa sẵn sàng giao.
- `requires_human: true` cho việc chạm hạ tầng ngoài, nội dung pháp lý, giá cả, hoặc cảm giác chơi.
- `status` + `commit` là bộ nhớ giữa các phiên — thứ giữ cho ba pha không trôi.

**Nội dung khởi tạo:** chẻ toàn bộ Pha 6 của doc 35 (A1, A2, A3, A4, C4, C2.1–C2.2, D1) thành lát.

---

## 6. R5 — Kỷ luật git khi chạy nhiều agent

Đã có tiền lệ hỏng việc, nên chốt thành luật:

1. **Mặc định: tuần tự, một agent một lúc.** Đơn giản, không đua, đủ nhanh cho khối lượng này.
2. **Song song chỉ khi** các lát không giao nhau về `files` **và** mỗi agent có **worktree riêng**
   (`git worktree add`). Vướng mắc đã biết: `node_modules` của pnpm workspace ⇒ mỗi worktree phải
   `pnpm install` riêng. Chấp nhận đánh đổi thời gian cài để lấy an toàn.
3. **Brief mỗi agent CẤM mọi lệnh git** (`stash`/`reset`/`checkout`/`commit`/`merge`). Agent chỉ sửa file và chạy test.
4. **Chỉ orchestrator commit và gộp**, sau khi CI xanh.
5. Một lát = một nhánh `slice/<id>`; không đẩy thẳng lên `main`.

---

## 7. R6 — Guardrail trong `AGENTS.md`

`AGENTS.md` hiện chỉ quy định platform gating của Telegram. Mở rộng thành luật đầy đủ cho agent:

- **Cấm:** sửa/đọc-in `.env`; commit secret; chạy migration lên production; xoá dữ liệu người chơi;
  `git push --force`; sửa nội dung migration **đã áp** (chỉ được thêm file mới); đổi
  `GAME_PROTOCOL_VERSION` mà không cập nhật đồng thời `shared` + `client` + `server`.
- **Bắt buộc:** giữ bất biến *"field/config mới ⇒ default = hành vi cũ"* (nguyên tắc xuyên suốt doc 27–35);
  mọi thay đổi hợp đồng trong `shared` phải cập nhật doc tương ứng; mọi endpoint ghi mới phải có idempotency.
- **Khi bí:** dừng và ghi `status: blocked` + lý do vào `BACKLOG.yaml`, **không** tự nới phạm vi.

---

## 7b. R7 — Review tự động ba tầng *(thêm 2026-09-04)*

R1 trả lời "code có chạy không". Nhưng luật ở R6 chỉ có tác dụng khi ai đó **nhớ ra nó đúng lúc** —
mà những luật quan trọng nhất (không commit `.env`, không sửa migration đã áp, không tắt test đang
đỏ) đều là loại vi phạm một lần là hỏng thật, và đều nhận ra được bằng máy.

| Tầng | Chạy khi nào | Trả lời câu hỏi | Cần gì |
|---|---|---|---|
| `CI` → `verify` | mọi PR | *Code có chạy không?* | — |
| `Review` → `guard` (`scripts/review-guard.mjs`) | mọi PR | *Có phạm luật R6 không?* | — |
| `Claude Review` → `claude` | mọi PR không phải nháp | *Thiết kế đúng chưa, bỏ sót gì?* | `ANTHROPIC_API_KEY` |
| Subagent `review-pr` (`.claude/agents/`) | khi người gõ `/review-pr` | như trên, nhưng hỏi lại và **đo** được | gói Claude Code |

Cổng `guard` là **tất định** có chủ ý: không secret, không tốn tiền, cùng câu trả lời mỗi lần —
một cổng chặn thỉnh thoảng đổi ý là một cổng chặn không ai tin. Nó kiểm 8 luật, 5 chặn 3 cảnh báo.
Có lối thoát hiểm `review-guard: bỏ qua <luật> — <lý do>` **bắt buộc kèm lý do**: một cổng chặn
không có lối thoát hợp lệ sẽ bị vô hiệu hoá cả cụm vào ngày nó cản nhầm.

Cả tầng 3 và subagent đọc cùng một gói do `scripts/review-collect.mjs` dựng (mô tả PR · khối YAML
của lát · mục thiết kế phải đọc · file thay đổi · kết quả cổng tất định · diff).

**DoD:** cổng bắt được vi phạm thật trên một PR thật. *(Đã đạt: bắt 1 chặn ở PR #7 và 1 cảnh báo ở
PR #2 ngay lần chạy đầu; tầng có suy xét tìm ra lỗi `targetPct ?? Infinity` ở PR #2 — client tuyên
bố thắng còn server từ chối mọi lần nộp.)*

---

## 8. Ai làm gì

| Hạng mục | Agent tự làm | Cần người |
|---|:---:|---|
| R1 CI | ✅ | Bật branch protection trên GitHub |
| R2 tầng 1 + tầng 3 | ✅ | — |
| R2 tầng 2 (luồng tiền) | ✅ (code) | Cung cấp Supabase **staging** |
| R3 db-migrate/seed/env | ✅ (code) | Tạo project staging, cấp `SUPABASE_DB_URL` |
| R4 BACKLOG | ✅ | Duyệt thứ tự ưu tiên |
| R5 chính sách git | ✅ (viết) | — (đã chốt, xem dưới) |
| R6 AGENTS.md | ✅ | Đọc và xác nhận danh sách cấm |

### Đã chốt (2026-09-03, cập nhật 2026-09-04)

- **Gộp PR** *(sửa 2026-09-04 — luật cũ: `risk: high` chờ người duyệt)*: orchestrator tự gộp khi
  **cả ba cổng review đều xanh** (`verify` · `guard` · `claude` — xem R7). Lát `risk: high` phải có
  thêm **một lượt review có suy xét được ghi lại thành nhận xét trên PR** trước khi gộp.
  *(Vì sao đổi: luật cũ khiến 4 lát nằm chờ sau một PR trong khi kế hoạch phải chạy tiếp. Đổi lại,
  `risk: high` không còn được gộp trong im lặng.)* Nguồn sự thật: `AGENTS.md` §4.
- **Song song:** **KHÔNG.** Chạy **tuần tự, một agent một lúc**. Khối lượng Pha 6 không đủ lớn để
  đánh đổi lấy rủi ro đua git đã từng xảy ra.

---

## 9. Thứ tự thực hiện

```
R1 CI  →  R6 AGENTS.md  →  R4 BACKLOG  →  R2 tầng 1+3  →  [cần staging] R3  →  R2 tầng 2
   └────────── không cần secret nào ──────────┘        └── cần người cấp hạ tầng ──┘
```

Bốn bước đầu chạy được **ngay, không cần bất kỳ thông tin bí mật nào**. Nghiệm thu cả pha bằng lát mẫu
**A3.1** — vừa đóng được lỗ hổng cấp thưởng của doc 35 §A3, vừa chứng minh đường ray hoạt động.

---

## 10. Rủi ro của chính pha này

| # | Rủi ro | Giảm thiểu |
|---|---|---|
| 1 | **Đường ray phình to hơn việc nó phục vụ** | Giới hạn cứng: pha này không thêm tính năng người chơi; quá 1 tuần thì cắt R2 tầng 2 sang Pha 6 |
| 2 | **CI xanh nhưng sản phẩm hỏng** (test không chạm phần thật sự vỡ) | Bắt buộc R2 tầng 3: mỗi lát gameplay phải có ít nhất một phép đo hành vi, không chỉ typecheck |
| 3 | **Seed staging trôi khỏi production** ⇒ E2E xanh giả | Seed sinh từ chính `supabase/migrations` + catalog thật, không viết tay dữ liệu song song |
| 4 | Agent lách `files` bằng cách tự sửa `BACKLOG.yaml` | Mọi thay đổi backlog là diff phải qua CI + người gộp; không cho agent gộp PR của chính nó |
| 5 | `db-migrate` chạy nhầm production | Mặc định từ chối `production`; biến xác nhận riêng chỉ người có |

---

Liên quan: [35-product-depth-plan.md](35-product-depth-plan.md) · [11-player-backend-runbook.md](11-player-backend-runbook.md) ·
[21-backend-release-gate.md](21-backend-release-gate.md) · [26-phase-5-plan.md](26-phase-5-plan.md) · `AGENTS.md`
