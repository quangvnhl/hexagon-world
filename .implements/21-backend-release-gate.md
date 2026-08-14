# Backend release gate cho staging và production

## Mục tiêu

`scripts/release-gate.mjs` là gate offline chạy trước deploy. Script chỉ đọc file env cục bộ,
shared protocol source và metadata cấu hình; không gọi staging/production, không thay đổi DB,
không đăng ký Telegram webhook và không thực hiện deploy.

Gate tập trung ngăn các lỗi cấu hình có thể phát hiện trước khi phát hành:

- placeholder/secret rỗng;
- URL localhost, HTTP/WS không mã hóa hoặc OAuth callback sai path;
- production dùng role `all`;
- secret control plane bị đưa sang game node;
- region directory không khớp deployment;
- Ed25519 key pair hoặc game-result secret không khớp;
- server override protocol lệch khỏi version được client/shared build vào bundle.

## Chuẩn bị file đầu vào

Tạo một file cho control plane và một file cho mỗi game deployment. `.gitignore` đã bỏ qua
`.env*`; pipeline nên materialize file vào thư mục tạm và xóa bằng cơ chế cleanup của runner.
Không commit file thật và không dùng `.env.example` làm đầu vào release.

Ví dụ cấu trúc:

```text
deploy/control.production.env
deploy/game-sg.production.env
deploy/game-jp.production.env
```

Control plane phải khai báo tối thiểu các nhóm sau:

- `NODE_ENV=production`, `SERVER_ROLE=control`;
- Supabase server URL/key;
- session, Google OAuth, Telegram webhook/auth và admin secrets;
- regional private ticket key, result secret;
- `CORS_ALLOWED_ORIGINS` và `GAME_REGIONS_JSON` với URL public thật.

Game node phải khai báo:

- `NODE_ENV=production`, `SERVER_ROLE=game`, `GAME_REGION`;
- HTTPS `CONTROL_PLANE_URL`;
- regional public ticket key và cùng `GAME_RESULT_SECRET` với control;
- durable `GAME_RESULT_SPOOL_DIR`;
- `GAME_PROTOCOL_VERSION` khớp `packages/shared/src/protocol-version.ts`.

Game env không được chứa Supabase secret/DB URL, session secret, Google secret, Telegram
secret, admin hash hoặc regional private key. `REGION_TICKET_PUBLIC_KEY_BASE64` không phải
secret và là key duy nhất của cặp ticket được phân phối cho game node.

## Chạy gate

Một region:

```powershell
pnpm release:check -- --target production --control deploy/control.production.env --game deploy/game-sg.production.env
```

Nhiều region:

```powershell
pnpm release:check -- `
  --target production `
  --control deploy/control.production.env `
  --game deploy/game-sg.production.env `
  --game deploy/game-jp.production.env
```

Kết quả thành công chỉ in target, số game node và protocol version. Lỗi chỉ nêu file, tên
biến và nguyên nhân; không in giá trị biến. Warning region chưa có file game trong release set
không làm gate thất bại, để hỗ trợ rollout từng region. Mọi `FAIL` trả exit code `1`.

Chạy automation test của chính gate:

```powershell
pnpm test:release-gate
```

## Tích hợp pipeline

Thứ tự job phát hành khuyến nghị:

1. Secret manager materialize control/game env vào runner tạm.
2. Chạy `pnpm test:release-gate` để kiểm tra logic gate.
3. Chạy `pnpm release:check -- ...` với toàn bộ deployment trong release set.
4. Chỉ khi exit code `0`, chạy typecheck/test/build và bước deploy do pipeline quản lý.
5. Cleanup file env bằng lifecycle/cleanup của runner, kể cả khi job thất bại.
6. Sau deploy mới chạy smoke test read-only trong runbook; release gate không thay thế
   readiness, OAuth registration, webhook verification, migration hoặc restore drill.

Không truyền secret trực tiếp trên command line vì process list và log pipeline có thể lưu
lại argument. Không bật shell tracing (`set -x` hoặc tương đương) ở bước materialize secret.

## Giới hạn có chủ đích

Gate không xác nhận rằng:

- Google Cloud đã đăng ký callback URI;
- Telegram webhook đang trỏ đúng deployment;
- Supabase migration đã được áp dụng;
- DNS/TLS/reverse proxy đang hoạt động;
- spool volume thực sự persistent;
- backup có thể restore.

Các mục này cần smoke test/readiness và bài diễn tập staging riêng. Gate tuyệt đối không tự
gọi production để tránh biến kiểm tra cấu hình thành một thao tác có tác dụng phụ.
