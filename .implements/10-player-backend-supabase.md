# Kế hoạch backend người chơi, shop và tài sản trên Supabase

## 1. Mục tiêu và phạm vi

Xây dựng lớp backend bền vững cho Hexagon World để:

- Mỗi người chơi có một `player_id` nội bộ ổn định, không phụ thuộc nền tảng.
- Ghi rõ nguồn của danh tính và từng phiên: `telegram`, `web`, và có thể mở rộng `google`, `apple`, `discord`, `facebook` mà không đổi cấu trúc chính.
- Lưu hồ sơ, thống kê tổng hợp, số dư, vật phẩm sở hữu và bộ trang bị đang dùng.
- Shop mua vật phẩm theo giao dịch nguyên tử, chống mua trùng và không tin dữ liệu từ client.
- Không để Supabase hoặc thao tác ghi DB làm chậm vòng lặp game authoritative 24 Hz.

Ngoài phạm vi giai đoạn đầu: thanh toán tiền thật, marketplace giữa người chơi, gifting, battle pass và đồng bộ nhiều thiết bị khi chưa có cơ chế liên kết danh tính.

## 2. Hiện trạng và kiến trúc đích

Server hiện dùng NestJS `createApplicationContext`, mở `ws` trực tiếp; bản tin `join` chỉ có tên/ngoại hình do client khai báo. Chưa có HTTP API, auth, database hoặc quyền sở hữu tài sản.

Production không gộp gameplay và backend dữ liệu thành một deployment. Tách thành:

```text
                              ┌──────────────────────────────┐
Web / Telegram ── HTTPS ─────>│ Control plane (trung tâm)    │
                              │ auth, profile, shop, payment │
                              │ matchmaking, region tickets  │
                              └──────────────┬───────────────┘
                                             │
                                      Supabase Postgres
                                             ▲
                      kết quả idempotent     │
                                             │
Client ── đo RTT ──> Region directory        │
   │                                         │
   ├── WSS ──> Game server Singapore ────────┤
   ├── WSS ──> Game server Tokyo ────────────┤
   └── WSS ──> Game server Europe ───────────┘
              hot path 24 Hz chỉ dùng memory
```

Local/Docker vẫn có thể chạy `SERVER_ROLE=all` trong một container để phát triển đơn giản. Production chạy `SERVER_ROLE=control` và nhiều deployment `SERVER_ROLE=game`, mỗi game deployment có `GAME_REGION` riêng.

Nguyên tắc:

1. Client không được tự khai `source=telegram` rồi được tin. Nguồn do server xác định sau xác thực.
2. `player_id` trong DB khác `entityId` 0–7 của phòng. `entityId` chỉ tồn tại trong trận.
3. WebSocket tiếp tục vận chuyển gameplay. Supabase Realtime không dùng cho input, vị trí hoặc territory.
4. Control plane cấp regional join ticket có chữ ký, sống khoảng 60 giây. Game server vùng xác minh offline bằng public key, không gọi DB khi join hoặc mỗi tick.
5. Game server chỉ nhận snapshot loadout/quyền cần cho trận và gửi kết quả idempotent về control plane; không giữ Supabase secret key.
6. Supabase secret key, bot token, Telegram payment webhook và DB chỉ thuộc control plane.

### Chiến lược nhiều vùng và ping

1. Client ping song song endpoint nhẹ của các vùng đang healthy (Singapore, Tokyo, Europe...).
2. Matchmaking chọn vùng có RTT thấp nhất nhưng vẫn xét sức chứa, mode và số người đang chờ; người chơi có thể override vùng nếu cần.
3. Control plane phát ticket chứa `player_id` (hoặc guest marker), `platform`, `region`, `match/queue`, loadout version và expiry.
4. Client mở WSS trực tiếp tới hostname vùng, ví dụ `wss://sg.game.example.com/game`.
5. Vùng không truy vấn Supabase trên hot path. Cuối trận, vùng gửi một result envelope có `event_id/match_id` và chữ ký service-to-service; control plane ghi DB/outbox.
6. Nếu control plane tạm lỗi, trận đang chạy vẫn tiếp tục; kết quả nằm trong durable retry queue của vùng. Nếu game region lỗi, chỉ người chơi vùng/trận đó bị ảnh hưởng.

Supabase project ban đầu có thể đặt gần khu vực người chơi chính/control plane. Khi quy mô toàn cầu lớn, đọc catalog có thể cache tại edge, nhưng ledger/payment vẫn có một nguồn ghi chính để tránh double spend. Không tạo một Supabase project độc lập cho mỗi vùng ở giai đoạn đầu vì sẽ làm phức tạp tài sản, order và đối soát.

## 3. Nhận diện đa nền tảng

### Telegram

Client gửi nguyên chuỗi `Telegram.WebApp.initData` tới `POST /v1/auth/telegram`. Server xác minh chữ ký bằng `TELEGRAM_BOT_TOKEN`, kiểm tra `auth_date`, sau đó mới lấy Telegram user ID, upsert identity `(telegram, telegram_user_id)` và cấp session Hexagon World. Không dùng `initDataUnsafe` để cấp tài sản.

### Web

Web guest được nhận diện cục bộ theo thiết bị để giữ tên/cài đặt và vẫn có thể chơi solo hoặc multiplayer như người chơi ẩn danh. Guest chỉ nhận regional ticket giới hạn, không tạo tài khoản bền vững trong Supabase và không được dùng profile cloud, coin, shop, inventory, thống kê bền vững hoặc payment. Kết quả trận có guest chỉ lưu dữ liệu trận ẩn danh nếu cần vận hành, không cấp reward.

Khi người dùng đăng nhập web, control plane thực hiện trực tiếp Google OAuth 2.0/OpenID Connect web-server authorization-code flow; Supabase Auth không tham gia. Control plane tạo `state` chống CSRF, chuyển hướng tới Google, nhận authorization code tại callback, đổi code lấy token và xác minh ID token bằng thư viện Google/JWT đáng tin cậy. Identity được tạo theo `(platform=web, provider=google, provider_user_id=<Google sub>)`; không dùng email làm khóa vì email có thể thay đổi.

Chỉ yêu cầu scope `openid email profile`, không yêu cầu offline access và không lưu Google access/refresh token nếu game không gọi Google API. Sau xác thực, control plane tạo Hexagon World session 1 ngày trong cookie `HttpOnly + Secure + SameSite=Lax`, xóa tham số OAuth khỏi URL rồi redirect về web. Xóa dữ liệu trình duyệt làm mất guest identity cục bộ nhưng không ảnh hưởng tài khoản Google đã đăng nhập.

### Ghi nguồn rõ ràng

Không gộp “nguồn danh tính” và “nguồn phiên” thành một cột:

- `player_identities.platform`: namespace tài sản bắt buộc, ví dụ `telegram`, `web`, nền tảng A/B.
- `player_identities.provider`: phương thức đăng nhập bên trong platform, ví dụ `telegram`, `email`, `google`.
- `player_sessions.source`: nền tảng dùng mở phiên hiện tại.
- `players.first_source`: nguồn hợp lệ đầu tiên, không ghi đè.
- `players.last_source`: nguồn hợp lệ gần nhất.
- `player_sessions.attribution`: JSON giới hạn khóa cho UTM/referral/campaign.

Identity unique theo `(platform, provider, provider_user_id)`, không chỉ theo email/provider. Không liên kết hoặc hợp nhất tài sản giữa Telegram, web hay bất kỳ platform nào. Cùng `email_1@gmail.com` đăng nhập ở platform A và B tạo hai `player_id`, hai ví và hai inventory độc lập. Thêm platform/source mới phải cập nhật allowlist, migration, test và tài liệu; không nhận chuỗi tùy ý từ client.

## 4. Mô hình dữ liệu

Mọi bảng dùng UUID, `timestamptz`, khóa ngoại và migration có version. Tiền tệ dùng số nguyên, không dùng số thực.

### Người chơi và phiên

| Bảng | Trường chính | Mục đích |
|---|---|---|
| `players` | `id`, `display_name`, `first_source`, `last_source`, `status`, `created_at`, `last_seen_at` | Hồ sơ gốc |
| `player_identities` | `id`, `player_id`, `platform`, `provider`, `provider_user_id`, `provider_username`, `verified_at`, `metadata` | Unique `(platform, provider, provider_user_id)`; không cross-platform merge |
| `player_sessions` | `id`, `player_id`, `source`, `token_hash`, `expires_at`, `revoked_at`, `last_seen_at`, `attribution` | Phiên xác thực; chỉ lưu hash token |
| `player_profiles` | `player_id`, `selected_color`, `selected_shape`, `selected_trail_pattern`, `updated_at` | Cosmetic đang dùng |
| `player_stats` | `player_id`, `matches`, `wins`, `kills`, `deaths`, `territory_captured`, `updated_at` | Chỉ số tổng hợp đọc nhanh |

Không lưu guest hoặc bot vào `players`. Guest dùng local device identity + ticket ẩn danh; bot chỉ dùng entity trong trận và cờ `is_bot` nếu cần phân tích.

### Trận đấu

| Bảng | Trường chính | Mục đích |
|---|---|---|
| `matches` | `id`, `room_id`, `mode`, `started_at`, `ended_at`, `winner_player_id`, `server_version` | Một trận authoritative |
| `match_players` | `match_id`, `player_id nullable`, `platform`, `is_guest`, `seat_id`, `kills`, `death_cause`, `final_score`, `placement` | Kết quả từng người; guest không có liên kết tài khoản |
| `processed_events` | `event_id`, `kind`, `processed_at` | Chống thưởng/kết quả trùng khi retry |

Không ghi từng tick; chỉ ghi join/leave, kết quả cuối, reward và thống kê tổng hợp.

### Shop, ví và tài sản

| Bảng | Trường chính | Mục đích |
|---|---|---|
| `shop_items` | `id`, `sku`, `type`, `asset_key`, `name`, `rarity`, `active`, `metadata` | Catalog; `asset_key` phải có trong registry client/shared |
| `shop_prices` | `id`, `item_id`, `currency_code`, `amount`, `starts_at`, `ends_at`, `active` | Giá theo thời gian |
| `player_wallets` | `player_id`, `currency_code`, `balance`, `version` | Số dư đọc nhanh |
| `wallet_ledger` | `id`, `player_id`, `currency_code`, `delta`, `reason`, `reference_type`, `reference_id`, `balance_after`, `created_at` | Sổ cái bất biến |
| `player_inventory` | `id`, `player_id`, `item_id`, `quantity`, `acquired_via`, `acquired_ref`, `created_at` | Tài sản sở hữu |
| `purchase_orders` | `id`, `player_id`, `platform`, `item_id`, `price_id`, `amount`, `currency_code`, `status`, `idempotency_key`, `created_at` | Mua bằng coin hoặc Telegram Stars |
| `payment_transactions` | `id`, `order_id`, `provider`, `external_charge_id`, `amount`, `currency`, `status`, `raw_event_hash`, `created_at` | Payment ledger; unique `(provider, external_charge_id)` |
| `player_loadouts` | `player_id`, `color_item_id`, `shape_item_id`, `trail_item_id`, `updated_at` | Trang bị đã sở hữu |

Mua hàng chạy trong một PostgreSQL function/transaction:

1. Khóa hàng ví (`FOR UPDATE`).
2. Đọc giá đang hiệu lực từ DB, không nhận giá client.
3. Kiểm tra số dư và `idempotency_key`.
4. Trừ ví, thêm ledger, cấp inventory, hoàn tất order.
5. Commit toàn bộ hoặc rollback toàn bộ.

Coin giai đoạn đầu chỉ do admin cấp. Mọi admin grant phải tạo ledger entry với `admin_actor`, lý do, reference và idempotency key; không sửa trực tiếp `player_wallets.balance` trên Dashboard. Mỗi nhóm `color`, `shape`, `trail` có đúng một item mặc định miễn phí. Admin tự chọn ba item mặc định bằng `DEFAULT_FREE_COLOR_ASSET_KEY`, `DEFAULT_FREE_SHAPE_ASSET_KEY`, `DEFAULT_FREE_TRAIL_ASSET_KEY`; giá item còn lại nằm trong `shop_prices` để cấu hình qua DB/admin UI, không hardcode giá trong `.env`.

### Thanh toán Telegram Stars

Chỉ platform `telegram` được mua digital item bằng Telegram Stars (`XTR`); tài sản nhận được vẫn thuộc namespace Telegram và không chuyển sang web.

Luồng bắt buộc:

1. Client tạo order trên control plane; server đọc giá Stars hiện hành và tạo invoice link có payload/order nonce.
2. Mini App gọi `Telegram.WebApp.openInvoice` từ thao tác người dùng.
3. Bot webhook nhận `pre_checkout_query`, xác minh order còn hiệu lực/chưa thanh toán rồi trả lời trong thời hạn Telegram yêu cầu.
4. Chỉ cấp inventory sau khi webhook nhận `successful_payment`; trạng thái `invoiceClosed=paid` ở client chỉ để UX, không phải bằng chứng cấp đồ.
5. Lưu `telegram_payment_charge_id` unique để chống cấp trùng và phục vụ `refundStarPayment`.
6. Refund phải đảo tài sản/ledger theo transaction được audit; bot cần quy trình hỗ trợ `/paysupport`.

Digital goods trong Telegram phải dùng `currency=XTR`; không cần provider token. Giá Stars được cấu hình theo item/platform trong DB.

## 5. API và WebSocket

HTTP API dự kiến:

- `POST /v1/auth/telegram`: đổi Telegram `initData` lấy session.
- `GET /v1/auth/web/google/start`: tạo state/nonce, đặt cookie ngắn hạn và redirect tới Google OAuth.
- `GET /v1/auth/web/google/callback`: kiểm tra state, đổi authorization code, xác minh Google ID token và tạo session web.
- `POST /v1/auth/refresh`, `POST /v1/auth/logout`.
- `GET /v1/regions`: danh sách game region healthy để client đo RTT.
- `POST /v1/game-tickets`: cấp ticket vùng cho tài khoản đăng nhập.
- `POST /v1/game-tickets/guest`: ticket hạn chế cho guest, không mở tính năng persistence/shop.
- `GET /v1/me`, `PATCH /v1/me/profile`.
- `GET /v1/shop/catalog`, `POST /v1/shop/purchases`.
- `GET /v1/inventory`, `PUT /v1/loadout`.
- `POST /v1/payments/telegram-stars/invoice`: tạo order + invoice link.
- `POST /v1/webhooks/telegram`: nhận pre-checkout/successful payment; xác minh webhook secret.
- `POST /internal/v1/match-results`: game region gửi kết quả có chữ ký và idempotency.
- `GET /health/live`, `GET /health/ready`.

Thay WebSocket `join(name, appearance)` bằng regional ticket ở handshake/join. Game node xác minh chữ ký/region/expiry offline rồi dùng loadout snapshot đã được control plane duyệt. Guest ticket mang `is_guest=true` và default cosmetics; authenticated ticket mang `player_id`, `platform` và loadout version.

Giai đoạn chuyển tiếp có thể cho guest legacy sau feature flag, gắn nguồn `web_legacy`, không dùng shop/tài sản và phải có ngày xóa. `@hexagon/shared` chỉ chứa DTO/type/validation và protocol; Supabase client/repository/secret chỉ ở `packages/server`.

## 6. Cấu trúc module dự kiến

```text
packages/server/src/
  config/          # đọc và validate env
  database/        # Supabase client, repository, retry/timeout
  auth/            # Telegram verifier, web login, guest ticket, session guard
  regions/         # directory, health, RTT candidates, ticket signer/verifier
  players/         # profile, identity, source attribution
  shop/            # catalog, pricing, purchase transaction
  payments/        # Telegram Stars invoice, webhook, refund/audit
  inventory/       # ownership và loadout
  matches/         # kết quả, stats, reward async
  game/            # authoritative server hiện tại
```

Không còn khuyến nghị một process production duy nhất. Có thể giữ chung monorepo/image nhưng tách entrypoint theo `SERVER_ROLE`:

- `control`: Nest HTTP API, auth/shop/payment/Supabase; không chạy game loop.
- `game`: WebSocket authoritative của một `GAME_REGION`; không cầm Supabase/Telegram secret.
- `all`: chỉ dùng local/test để chạy cả hai trên một cổng.

Ở production, control plane và từng region có hostname/deployment/autoscaling riêng. Việc dùng chung code package không có nghĩa phải deploy chung.

| Cấp độ | Chung hay riêng? |
|---|---|
| Repository/monorepo | Chung để dùng type, protocol và tooling |
| Package/image giai đoạn đầu | Có thể chung `packages/server`, nhưng có hai entrypoint/build target |
| Process/container production | Riêng: control container và game container |
| Máy/vùng/autoscaling | Riêng hoàn toàn; mỗi game region scale độc lập |
| Secret | Riêng; game node không nhận Supabase/Google/Telegram private secret |

Khi hai phần tăng nhanh hoặc cần dependency/release cadence khác nhau, tách `packages/server` thành `packages/control-server` và `packages/game-server` mà không đổi protocol. Ranh giới module/service ở trên phải được giữ ngay từ đầu để việc tách package chỉ là thao tác build/deploy, không phải viết lại nghiệp vụ.

## 7. Bảo mật và vận hành

- Validate env lúc khởi động; production thiếu key bắt buộc phải fail rõ lỗi.
- Không log token, Supabase secret/service-role key, bot token, nguyên `initData` hoặc metadata nhạy cảm.
- Production dùng TLS `https/wss`; rate limit auth, purchase, profile và WS handshake.
- Session token ngẫu nhiên đủ mạnh; DB chỉ lưu hash; hỗ trợ revoke và rotation.
- Bật RLS phòng thủ. Runtime secret/service-role key chỉ nằm server và có thể bypass RLS; nếu client truy cập Supabase trực tiếp sau này phải có policy/test riêng.
- Purchase/reward có idempotency key và unique constraint; retry lỗi tạm thời với backoff.
- Gameplay tiếp tục khi persistence lỗi nếu `SUPABASE_PERSISTENCE_REQUIRED=false`; event quan trọng vào outbox/retry. Không âm thầm mất giao dịch shop.
- Có backup/PITR, restore drill, export/xóa dữ liệu và retention policy.
- Metrics: auth theo source, DB latency/error, active sessions, purchase result, ledger mismatch, queue depth và event-loop/tick drift.

## 8. Biến môi trường

File `.env.example` ở gốc đã tạo sẵn. Copy thành `.env`; file thật vẫn bị Git bỏ qua. Docker Compose đã chuyển các biến server vào container.

| Biến | Phạm vi | Ghi chú |
|---|---|---|
| `SUPABASE_URL` | server | URL project |
| `SUPABASE_SECRET_KEY` | server secret | Khóa `sb_secret_*` ưu tiên cho project mới; không dùng `NEXT_PUBLIC_*` |
| `SUPABASE_SERVICE_ROLE_KEY` | server secret | Legacy fallback tùy chọn, không cấu hình đồng thời nếu không cần |
| `SUPABASE_DB_URL` | migration/admin secret | Chỉ migration/admin |
| `SUPABASE_DB_SCHEMA` | server | Mặc định `public` |
| `SUPABASE_REQUEST_TIMEOUT_MS` | server | Timeout DB/API |
| `SUPABASE_PERSISTENCE_REQUIRED` | server | Mặc định `false` khi rollout |
| `PLAYER_SESSION_SECRET` | server secret | Tối thiểu 32 byte ngẫu nhiên |
| `PLAYER_SESSION_TTL_SECONDS` | control | 1 ngày (`86400`) |
| `GOOGLE_OAUTH_CLIENT_ID` | control | OAuth Client ID loại Web application |
| `GOOGLE_OAUTH_CLIENT_SECRET` | control secret | Chỉ backend; không đưa vào client/image frontend |
| `GOOGLE_OAUTH_REDIRECT_URI` | control | Callback phải khớp tuyệt đối URI cấu hình trong Google Cloud |
| `GOOGLE_OAUTH_POST_LOGIN_REDIRECT_URI` | control | URL web sạch sau khi callback hoàn tất |
| `GOOGLE_OAUTH_SCOPES` | control | Mặc định `openid email profile` |
| `GOOGLE_OAUTH_STATE_SECRET` | control secret | Ký/mã hóa state chống CSRF |
| `GOOGLE_OAUTH_STATE_TTL_SECONDS` | control | State sống 10 phút |
| `TELEGRAM_BOT_TOKEN` | server secret | Xác minh `initData` |
| `TELEGRAM_INIT_DATA_MAX_AGE_SECONDS` | server | Chặn initData cũ |
| `TELEGRAM_WEBHOOK_SECRET` | control secret | Xác minh update gửi tới webhook |
| `TELEGRAM_STARS_ENABLED` | control | Feature flag payment Stars |
| `PLAYER_SOURCE_DEFAULT` | server | `web` |
| `PLAYER_SOURCE_ALLOWLIST` | server | `web,telegram` |
| `SHOP_DEFAULT_CURRENCY` | server | `coin` |
| `SHOP_CATALOG_CACHE_TTL_SECONDS` | server | Cache catalog |
| `SHOP_PURCHASE_IDEMPOTENCY_TTL_SECONDS` | server | Giữ key chống trùng |
| `DEFAULT_FREE_ITEMS_PER_CATEGORY` | control | `1`; đúng một item miễn phí trong mỗi nhóm |
| `DEFAULT_FREE_COLOR_ASSET_KEY` | control | Item màu mặc định, hiện `color:0` |
| `DEFAULT_FREE_SHAPE_ASSET_KEY` | control | Item model mặc định, hiện `shape:cube` |
| `DEFAULT_FREE_TRAIL_ASSET_KEY` | control | Item trail mặc định, hiện `trail:solid` |
| `MATCH_HISTORY_RETENTION_DAYS` | control/job | `30`; job xóa lịch sử hết hạn |
| `SERVER_ROLE` | deployment | `control`, `game`, hoặc `all` cho local |
| `GAME_REGION` | game node | Mã vùng như `sg`, `jp`, `eu`, local dùng `local` |
| `CONTROL_PLANE_URL` | game node | Endpoint internal gửi kết quả/health |
| `REGION_TICKET_PRIVATE_KEY_BASE64` | control secret | Private key mã hóa Base64, chỉ control plane dùng ký ticket |
| `REGION_TICKET_PUBLIC_KEY_BASE64` | game node | Public key Base64 xác minh ticket offline; được phép phân phối |
| `REGION_TICKET_TTL_SECONDS` | control/game | Mặc định 60 giây |

Supabase chỉ là persistence cho dữ liệu game; Supabase Auth không được dùng cho Google login. Client không cần khóa Supabase. Google Client Secret và Supabase secret/service-role key chỉ tồn tại trong control plane.

## 9. Lộ trình triển khai

### P0 — Chốt sản phẩm và threat model (đã chốt)

- Guest theo thiết bị được chơi nhưng không có persistence/shop; chỉ tài khoản đăng nhập dùng tính năng backend.
- Tài khoản/tài sản tách tuyệt đối theo platform, không hợp nhất Telegram ↔ web.
- Coin chỉ do admin cấp; mỗi nhóm item có một mặc định miễn phí, giá còn lại do admin cấu hình.
- Telegram platform mua digital goods bằng Stars; session 1 ngày, lịch sử trận 30 ngày, xóa account thủ công.

**DoD:** câu trả lời được ghi thành ADR; không ngầm định quyết định tiền thật/danh tính.

### P1 — Database và cấu hình

- Thêm Supabase SDK và env validator.
- Migration player, identity, session trong `supabase/migrations`; seed source/currency. Mọi thay đổi remote đi qua migration, không sửa schema production trực tiếp trên Dashboard.
- Repository interface và in-memory fake cho test.
- Health/readiness, timeout, structured logging.

**DoD:** migration được kiểm thử; server không log secret; lỗi Supabase không nghẽn tick.

### P2 — Auth đa nguồn và WebSocket

- Endpoint Telegram + test chữ ký/thời gian.
- Google OAuth trực tiếp qua control plane, authorization-code callback, ID-token verification, session refresh/revoke; guest chỉ có local identity và restricted ticket.
- Region directory, RTT selection và ticket ký bất đối xứng.
- WS vùng xác minh ticket trước join; ánh xạ `player_id/guest ↔ room/entityId`.
- Ghi first/last/session source và last seen.

**DoD:** giả mạo Telegram/source bị từ chối; reconnect giữ đúng player; báo cáo tách nguồn.

### P3 — Hồ sơ, trận và thống kê

- Profile/loadout cơ bản.
- Tạo `match_id`, ghi kết quả và cập nhật stats idempotent.
- Outbox/retry; dashboard lỗi/queue.
- Scheduled retention job xóa/anonymize match history quá 30 ngày.
- Admin-only account deletion command/runbook: preview phạm vi, revoke session, xử lý payment/ledger theo retention pháp lý rồi mới xóa/anonymize dữ liệu liên quan.

**DoD:** retry không tăng đôi wins/kills/reward; DB chậm không tụt tick rate.

### P4 — Shop, ví và inventory

- Migration catalog/wallet/ledger/inventory/order/loadout.
- Seed item tương ứng registry màu, GLB và trail hiện có.
- API catalog, purchase, inventory, equip.
- Telegram Stars invoice, bot webhook, successful-payment fulfillment và refund audit.
- Transaction mua và job đối soát ledger.

**DoD:** không âm ví, không double purchase, không equip đồ chưa sở hữu, rollback không lệch dữ liệu.

### P5 — Hardening và rollout

- RLS tests, rate limit, load test và chaos test timeout.
- Backup/restore drill, staging migration, alert/runbook.
- Deploy control plane và region đầu tiên gần người chơi chính; sau đó thêm vùng theo p95 RTT/nhu cầu.
- Feature flags: auth persistence → stats → inventory read → purchase write → Stars.
- Rollout 5% → 25% → 100%; theo dõi error/latency/tick, regional capacity và rollback flag.

**DoD:** staging qua migration + restore; production có alert, rollback và reconciliation.

## 10. Kiểm thử

- Unit: source normalizer, Telegram verifier, token hashing, price validation, ownership.
- Integration: unique identity, session expiry/revoke, concurrent wallet lock, idempotency.
- Protocol: auth/guest → region selection → ticket → join → reconnect → signed match result.
- Security: OAuth state/nonce mismatch, callback replay, forged/expired Google ID token, forged/expired initData/ticket, wrong-region ticket, source spoof, replay purchase/payment, IDOR, payload quá lớn.
- Payment: pre-checkout timeout, duplicate/reordered webhook, client báo paid giả, refund và duplicate `telegram_payment_charge_id`.
- Load: connection/auth burst, DB/control-plane chậm hoặc mất kết nối; đo event-loop lag, tick drift và retry queue vùng.
- Reconciliation: tổng ledger khớp balance; inventory/order không mồ côi.

## 11. Cơ chế tự động hỏi tư vấn

Trong triển khai, agent/đội phát triển phải chủ động dừng và hỏi người phụ trách khi:

- Có nhiều lựa chọn làm đổi trải nghiệm, doanh thu, quyền sở hữu hoặc khả năng khôi phục.
- Đụng tới tiền thật, quảng cáo đổi thưởng, hoàn tiền, chuyển tài sản hoặc dữ liệu cá nhân mới.
- Cần thay schema/protocol không tương thích hoặc xóa dữ liệu.
- Thiếu secret/quyền/môi trường production.
- Yêu cầu mâu thuẫn với ledger, chống gian lận hoặc authoritative server.

Câu hỏi phải kèm bối cảnh, phương án khuyến nghị, 1–2 lựa chọn khác, tác động và mặc định an toàn. Sau trả lời, ghi quyết định vào ADR trước khi tiếp tục.

### Điểm còn cần hỏi ở đúng giai đoạn

1. Trước P1: Google OAuth Client ID/secret và redirect URI chính xác cho dev/staging/prod trong Google Cloud Console.
2. Trước seed catalog P4: xác nhận ba asset key mặc định miễn phí và bảng giá coin/Stars.
3. Trước production Stars: URL webhook, quy trình `/paysupport`, quyền admin refund và chính sách thu hồi item sau refund.
4. Trước mở region thứ hai: các khu vực người chơi thực tế, ngưỡng RTT/capacity để matchmaking chọn hoặc chuyển vùng.

## 12. Definition of Done

- Telegram/web luôn có source do server xác minh; báo cáo được first/last/session source.
- Tài sản gắn `player_id`, không gắn tên hoặc entity seat.
- Shop dùng giá server, transaction nguyên tử, ledger bất biến và idempotency.
- Client không nhận secret Supabase/Telegram.
- Mất Supabase không kéo tụt game loop; giao dịch quan trọng không mất âm thầm.
- Migration, security/load test, monitoring, backup/restore và runbook có bằng chứng trước rollout 100%.

## 13. Nhật ký quyết định (ADR)

| ID | Trạng thái | Quyết định mặc định hiện tại |
|---|---|---|
| ADR-001 | Đề xuất | Supabase lưu bền vững; `ws` vẫn vận chuyển gameplay |
| ADR-002 | Đề xuất | Telegram auth bằng `initData` server-side |
| ADR-003 | Đã chốt | Guest theo thiết bị, không có dữ liệu/tính năng backend; web đăng nhập Google OAuth trực tiếp qua control plane, không dùng Supabase Auth |
| ADR-004 | Đã chốt | Không hợp nhất cross-platform; identity unique theo platform + provider + external ID |
| ADR-005 | Đã chốt | Coin chỉ admin grant có audit; mỗi nhóm color/shape/trail có một item miễn phí do admin chọn, giá còn lại do admin cấu hình |
| ADR-006 | Đã chốt | Telegram shop dùng Stars/XTR và chỉ cấp đồ sau successful payment webhook |
| ADR-007 | Đã chốt | Session 1 ngày; match history 30 ngày; account deletion do admin thực hiện |
| ADR-008 | Đã chốt | Production tách control plane khỏi regional game servers; local được chạy role `all` |
