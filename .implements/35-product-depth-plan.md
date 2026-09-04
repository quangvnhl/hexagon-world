# 35 — Kế hoạch tính năng chuyên sâu: Kỹ thuật · Kinh doanh · Vận hành · Vòng đời

> **Phạm vi cửa sổ làm việc này:** CHỈ `packages/client`, `packages/server`, `packages/shared`,
> `packages/admin` (+ `supabase/`, `scripts/`). Bản Unity **đã được dời hẳn ra khỏi repo này**
> (2026-09-04) sang `D:\dev\BeeKing_Unity` + `D:\dev\.implements_unity`, đúng theo quyết định #2
> ở §1 ("khi cần bản mobile sẽ tách dự án riêng"). Quyết định kiến trúc liên quan vẫn ghi ở §A8.
>
> **Loại tài liệu:** KẾ HOẠCH (chưa sửa code). Nền: [05-roadmap.md](05-roadmap.md) (Pha 0–5),
> [10](10-player-backend-supabase.md) (backend người chơi), [26](26-phase-5-plan.md) (vận hành + SLO),
> [25](25-game-modes-plan.md)/[27](27-phase1-modes-impl.md)/[28](28-phase2-energy-campaign-impl.md) (chế độ chơi),
> [29](29-phase3-level-authoring-plan.md)–[34](34-campaign-features-plan.md) (level authoring).
>
> **Nguyên tắc bất biến (giữ từ các doc trước):** mọi field/config mới **default = hành vi cũ**;
> `/play`, `/netplay`, `/campaign` hiện tại không đổi trải nghiệm khi chưa bật cờ.

---

## Quyết định đã CHỐT (2026-09-03)

| # | Vấn đề | Chốt | Ảnh hưởng |
|---|---|---|---|
| 1 | Nền tảng của bản client hiện tại | **Telegram Mini App**. Bản web làm **sau khi bản Telegram hoàn thiện**, khi đó mới thêm đăng nhập Google + cổng thanh toán. | §B8 lùi sang giai đoạn web; §C4 ưu tiên yêu cầu của Telegram/Stars; §A2 mọi cờ có trục `platform` |
| 2 | Bản Unity | **Chỉ là thử nghiệm — không bàn tới trong lộ trình này.** Khi cần bản mobile sẽ tách dự án riêng. | §A8 rút gọn, bỏ hạng mục golden vector khỏi P1 |
| 3 | Mốc reset ngày | **UTC** (hằng `DAY_RESET_TZ = "UTC"` đặt trong `shared`) | §B2, §B3, §B6, §A5 dùng chung một mốc |
| 4 | Thứ tự | **Pha 6 (đo + liêm chính) trước mọi tính năng kiếm tiền** | §7 giữ nguyên thứ tự |
| 5 | Ngưỡng quảng cáo | **5 rewarded/ngày, giãn cách ≥ 3 phút**, giữ interstitial cuối trận | §B1; số nằm trong remote config để chỉnh không cần deploy |
| 6 | Mùa / Battle Pass | **Có làm, ở Pha 8** | §B6 |
| 7 | Tiến độ guest | **KHÔNG cho claim sang tài khoản.** Guest chỉ chơi, muốn giữ tiến độ thì đăng nhập trước. | §D2 đổi hướng: chặn mất mát *trước*, không cứu *sau* |
| 8 | Nhân lực & vận hành | **Xây API vận hành đầy đủ** để cả **người** lẫn **AI agent** đều vận hành được | §C2 nâng thành trục thiết kế riêng (Ops API-first), có phần nền vào Pha 6 |

---

## 0. Tóm tắt điều hành

Sản phẩm đã có **lõi chơi tốt** (3 chế độ, server authoritative 24 Hz, netcode tối ưu, level editor,
kinh tế coin/energy/Stars). Thứ đang thiếu **không phải gameplay** mà là **bộ máy biến game thành sản phẩm
sống được**: không đo được người chơi, không đổi được tham số nếu không deploy, có lỗ hổng cấp thưởng,
không có vòng lặp giữ chân hằng ngày, và không có công cụ vận hành.

Ba câu chốt:

1. **Không đo ⇒ không kinh doanh.** Hiện có metrics *hạ tầng* (`/metrics` Prometheus, doc 26 B3) nhưng
   **KHÔNG có một sự kiện phân tích người chơi nào** (`grep -ri analytics packages/*/src` = rỗng). Không tính
   được D1/D7, funnel FTUE, ARPDAU, hiệu quả quảng cáo. Mọi quyết định kinh doanh sau đây sẽ là đoán mò.
2. **Có lỗ hổng kinh tế đang mở.** `POST /v1/campaign/complete`
   ([campaign.controller.ts:60](../packages/server/src/campaign/campaign.controller.ts)) **tin thẳng**
   `objectiveMet`, `stars`, `score` do client gửi (chỉ clamp 0–3 / ≥0). Client sửa tay có thể farm
   coin + XP + energy vô hạn. Phải bịt **trước khi** đổ tiền UA hoặc mở rộng kinh tế.
3. **Chưa có vòng lặp quay lại.** Không daily reward, không streak, không nhiệm vụ, không leaderboard,
   không thông báo, không giới thiệu bạn. Với casual/.io trên Telegram, đây mới là phần giữ chân chính —
   nội dung (Campaign) chỉ tiêu thụ một lần.

**Đề xuất thứ tự:** Pha 6 *Đo & Liêm chính* → Pha 7 *Giữ chân & Doanh thu* → Pha 8 *Mùa & Mở rộng*.
Chi tiết §7.

---

## 1. Ảnh chụp hiện trạng theo 4 trục

| Trục | ĐÃ CÓ (căn cứ mã nguồn) | CÒN THIẾU |
|---|---|---|
| **Kỹ thuật** | Server authoritative NestJS 24 Hz, protocol nhị phân v5/v6, delta + AoI, prediction/reconcile, spatial hash, rate-limit ws (doc 26 B1), `/metrics` Prometheus + harness load, `MatchConfig`/`WinCondition` per-match, level editor + obstacle/totem/cứ điểm/biên (doc 29–34), 253+ unit test | Analytics sự kiện, remote config/feature flag, A/B test, xác minh kết quả Campaign phía server, leaderboard, MMR, CI, error reporting, log có cấu trúc, E2E tự động luồng tiền |
| **Kinh doanh** | Ví coin + `wallet_ledger` bất biến, `shop_items`/`shop_prices`/inventory/loadout, XP + level curve DB, năng lượng (kiếm/mua), 3 gói coin Telegram Stars idempotent, AdsGram placement (rewarded lobby + interstitial end-game) | Rewarded ads **chưa cấp thưởng thật** (thiếu Reward URL S2S), daily/streak, nhiệm vụ, thưởng theo level, gói ưu đãi/starter pack, battle pass, giới thiệu bạn, thanh toán ngoài Telegram, bảng theo dõi lạm phát coin |
| **Vận hành** | SLO đề xuất (doc 26 §2), release gate offline (`pnpm release:check`), runbook migration (doc 11), spool kết quả trận, multi-region directory, admin API (grant coin, xoá player, giá catalog, CRUD level) | Alerting/on-call, công cụ CSKH, ban/mute + lọc tên, trang `/terms` `/privacy` `/paysupport` (Stars **yêu cầu**), tự xoá/xuất dữ liệu (GDPR), CI/CD + rollback, diễn tập khôi phục, theo dõi chi phí |
| **Vòng đời** | 3 chế độ chơi, 5+ cấp Campaign publish từ DB, guest chơi được, đăng nhập Google/Telegram/dev | FTUE/tutorial, chuyển đổi guest→tài khoản, thông báo quay lại, nhịp phát hành nội dung, party/phòng riêng (hoãn từ Pha 4), mùa/sự kiện, tiêu chí khai tử tính năng |

---

## 2. Khung ưu tiên

| Mức | Nghĩa | Tiêu chí |
|---|---|---|
| **P0** | Chặn "phát hành thật + tiêu tiền UA" | Rò rỉ kinh tế, mù dữ liệu, rủi ro pháp lý/nền tảng |
| **P1** | Đòn bẩy giữ chân & doanh thu đầu tiên | Tác động đo được lên D1/D7/ARPDAU trong 1 mùa |
| **P2** | Mở rộng khi đã có số | Cần dữ liệu P0/P1 mới quyết định đúng |
| **P3** | Để dành | Chỉ làm khi quy mô/nhân lực cho phép |

---

## 3. Trục A — KỸ THUẬT

### A1. Nền phân tích sự kiện (P0) — *việc quan trọng nhất của cả kế hoạch*

**Vấn đề:** không có bất kỳ event nào. Không biết người chơi rơi ở bước nào, chế độ nào được chơi,
quảng cáo có làm giảm phiên không.

**Thiết kế:**

| Lớp | Nội dung |
|---|---|
| `packages/shared/src/analytics.ts` | `ANALYTICS_SCHEMA_VERSION`, union `AnalyticsEvent` (tên snake_case cố định), hàm `makeEvent()` gắn `event_id` (uuid client) + `ts`. Đặt ở `shared` để **client, server và admin dùng chung một danh sách tên** — chống trôi tên sự kiện. |
| `packages/client/src/lib/analytics.ts` | Hàng đợi trong bộ nhớ, gộp lô ≤ 20 sự kiện / 5 s, `navigator.sendBeacon` khi `visibilitychange`/unload, đệm `localStorage` khi offline, `session_id` mỗi phiên + `anon_id` bền theo thiết bị. **Không gửi PII** (không email, không initData). |
| `POST /v1/events` (server) | Nhận lô; session tuỳ chọn (guest gửi `anon_id`); dùng lại `net/rate-limit.ts` (sliding window ~60 lô/phút/IP); ghi `analytics_events` (partition theo ngày); khử trùng theo `event_id` (unique). |
| Sự kiện phía server | `match_end` (từ `match-result-reporter`), `purchase_fulfilled` (webhook Stars), `energy_spend/grant`, `campaign_complete` — **nguồn tin cậy**, không phụ thuộc client. |
| Rollup | Migration tạo view/RPC `analytics_daily` (DAU, người mới, số trận, ARPDAU, ad impression, retention D1/D7 bằng cohort `first_seen_date`). Chạy bằng `pg_cron` hoặc gọi từ admin. |

**Bộ sự kiện tối thiểu (chốt ngay, khoá tên):**
`app_open` · `ftue_step` · `login_success` · `mode_select` · `match_start` · `match_end` ·
`campaign_level_start` / `_complete` / `_fail` · `energy_empty` · `energy_purchase` · `shop_open` ·
`purchase_start` / `_success` / `_fail` · `ad_request` / `_impression` / `_reward` / `_error` ·
`invite_sent` / `_accepted` · `session_end`.

**Lát:** A1.1 schema shared · A1.2 client batcher · A1.3 endpoint + bảng + khử trùng · A1.4 sự kiện server ·
A1.5 rollup + 3 truy vấn mẫu (retention, funnel FTUE, ARPDAU).
**DoD:** chạy 1 ngày thật → truy vấn ra D1 cohort và funnel FTUE 5 bước; 0 PII trong bảng.
**Rủi ro:** thấp về kỹ thuật, cao về *kỷ luật đặt tên* — khoá danh sách tên trong `shared`, thêm tên mới phải sửa union (typecheck bắt lỗi).

### A2. Remote config + feature flag (P0)

**Vấn đề:** mọi tham số nằm trong `shared/src/config.ts` + `.env` ⇒ đổi giá năng lượng, tần suất quảng cáo,
độ khó bot đều phải **build + deploy**. Không có kill-switch.

**Thiết kế:** bảng `remote_config(key text pk, value jsonb, audience jsonb, version int, updated_at)`;
`GET /v1/config?platform&build` trả bundle + `ETag` (client cache 5 phút, luôn có fallback = hằng trong `shared`);
`audience` cho phép bật theo % người chơi (hash `player_id`) ⇒ **nền cho A/B test**.

**Khoá kill-switch tối thiểu:** `ads.enabled`, `ads.rewarded_daily_cap`, `stars.enabled`, `netplay.enabled`,
`campaign.enabled`, `energy.regen_seconds`, `energy.purchase_price`, `bots.difficulty_profile`.

**Admin:** trang mới trong `packages/admin` — bảng key/value, sửa JSON có validate, lịch sử thay đổi (audit).
**DoD:** đổi giá năng lượng và tắt quảng cáo trên production **không deploy**; client mất mạng vẫn chạy bằng fallback.

### A3. Liêm chính kết quả Campaign + chống gian lận lớp 2 (P0 — an ninh kinh tế)

**Lỗ hổng cụ thể:** `complete()` nhận `objectiveMet: true` và `stars` từ client rồi gọi thẳng RPC
`complete_campaign_level` để **mở khoá + cấp coin/XP/energy**. Không kiểm thời gian, không kiểm mục tiêu,
không kiểm số lần.

**Thiết kế 4 lớp (làm lớp 1–2 ngay, lớp 3 sau):**

1. **Server tự tính sao & điểm.** Client gửi *dữ kiện thô* (`deaths`, `elapsedMs`, `territoryPct`,
   `objectiveKind`), server đối chiếu `campaign_levels.config` rồi tự đánh giá đạt/không và gọi
   `campaignStars()` ([shared/src/campaign.ts:163](../packages/shared/src/campaign.ts)) — **bỏ hẳn việc nhận `stars`**.
2. **Chặn phi lý.** `campaign_plays.started_at` đã có ⇒ ép `elapsed ≥ minTime(level)` (suy từ bán kính +
   ngưỡng %), `elapsed ≤ maxTime`, trần số lần hoàn thành/cấp/ngày, rate-limit theo `player_id`.
3. **Xác minh sâu (P2).** Client gửi kèm `inputTrace` nén (seq + heading, cỡ vài KB); server **chạy lại**
   `GameState` bằng chính `shared` (TS thuần, chạy được ở Node) với seed lưu trong `campaign_plays` và so kết quả.
   Chạy bất đồng bộ (hàng đợi), lệch ⇒ đánh dấu nghi vấn, **không thu hồi tự động**.
4. **Điểm rủi ro + soft-ban.** `player_risk_score`; admin xem và khoá thưởng thay vì khoá tài khoản.

**DoD:** test tích hợp — request giả `objectiveMet=true` với `elapsed=0` bị từ chối; farm 20 lần/phút bị chặn;
người chơi thật không bị ảnh hưởng.
**Rủi ro:** trung bình — phải giữ chuẩn đánh giá **giống hệt** client, nếu không sẽ từ chối oan. Dùng chung
evaluator trong `shared` cho cả hai phía.

### A4. CI, error reporting, log có cấu trúc (P0)

- **CI** `.github/workflows/ci.yml` (hiện **không có** thư mục `.github/`): pnpm + cache → `build:shared` →
  `typecheck` 4 gói → `test` → `release:check` → `build`. Chặn merge khi đỏ.
- **Error reporting:** Sentry (hoặc GlitchTip self-host) cho client + server; scrub PII/initData/token;
  gắn `release` = commit sha để quy lỗi theo bản.
- **Log có cấu trúc:** pino + `request_id`; tách log gameplay (nóng, chỉ đếm) khỏi log control plane.
- **E2E luồng tiền (Playwright, chạy trên staging):** dev-login → mua năng lượng bằng coin → start/complete
  campaign → kiểm ví + ledger. Đây là luồng dễ vỡ nhất khi refactor.

### A5. Leaderboard (P1)

Bảng `leaderboard_entries(scope, period_key, player_id, score, updated_at)` + unique `(scope, period_key, player_id)`;
cập nhật **trong** RPC `record_match_result` / `complete_campaign_level` (một nguồn ghi).
Scope khởi điểm: `weekly_territory`, `campaign_stars_total`, `weekly_wins`.
`GET /v1/leaderboard?scope&limit` trả top N + **hạng của mình** (window function). Redis chỉ khi B2 (doc 26 §5).
**Gate:** chỉ tài khoản đã xác thực (guest không lên bảng) + gate theo `player_risk_score` (A3).

### A6. Ghép trận theo trình độ — MMR (P2)

Hiện ghép phòng không xét trình độ ⇒ người mới bị "nghiền". Đề xuất điểm ẩn đơn giản theo thứ hạng cuối trận
(Elo/Glicko rút gọn), ghép theo dải nới dần theo thời gian chờ, thiếu người thì **bù bot theo dải** (bot quota đã có).
Casual: ưu tiên **thời gian chờ ngắn** hơn độ chính xác ghép.

### A7. Hiệu năng client & thiết bị yếu (P1) — phần còn lại của doc 24

- Atlas + UV cho skin premium; flood-fill tăng dần (2 mục còn mở của [24](24-render-perf-research.md)).
- **Bậc chất lượng theo FPS đo được** (giảm particle/shadow/độ phân giải) — quan trọng với máy Android tầm thấp.
- Khôi phục khi **mất WebGL context** (tab nền lâu trên mobile) — hiện chưa xử lý.
- Cắt bundle: R3F/three là phần nặng nhất; tách route `/campaign` `/netplay`.

### A8. Tương thích phiên bản client ↔ server (P2)

*(Đã chốt #2: bản Unity chỉ là thử nghiệm ⇒ bỏ hạng mục "golden vector chống trôi luật" khỏi lộ trình này.
Chỉ dựng lại nếu sau này tách dự án mobile riêng — khi đó là hạng mục P0 của dự án đó.)*

Việc còn cần cho chính bản Telegram: Mini App **không có cửa hàng để ép cập nhật**, người chơi có thể giữ
bundle cũ trong cache ⇒ phải chịu được client cũ nói chuyện với server mới.

- Ma trận tương thích protocol (v5/v6…) + **cửa sổ hỗ trợ** (đề xuất: 2 phiên bản, ~30 ngày), viết vào
  `protocol-version.ts`; server từ chối phiên bản quá cũ bằng mã đóng rõ nghĩa và client hiện màn "tải lại".
- Gắn `build_id` vào mọi sự kiện analytics (A1) và error report (A4) ⇒ biết bao nhiêu % còn ở bản cũ trước khi cắt.

---

## 4. Trục B — KINH DOANH

### B1. Rewarded ads cấp thưởng THẬT (P1)

Hiện trạng ([08](08-adsgram-plan.md)): "Reward URL chưa có; callback client không được cấp coin" ⇒ quảng cáo
đang chạy mà **không tạo doanh thu có ý nghĩa cho người chơi** (không có thưởng ⇒ không ai xem).

**Thiết kế:** cấu hình Reward URL của AdsGram → `POST /v1/webhooks/adsgram` (verify secret/chữ ký) → RPC
`grant_ad_reward` **idempotent theo `impression_id`** → ghi `wallet_ledger` với `reason='ad_reward'`.
Trần theo cấu hình remote (A2): **5 lượt/ngày, giãn cách ≥ 3 phút** (chốt #5; ngày tính theo UTC — chốt #3).
Giữ interstitial cuối trận như hiện tại.
Bắt buộc tuân thủ platform gate [15](15-telegram-platform-gating-and-adsgram.md) (chỉ Telegram, fail-open).
**DoD:** callback giả không cấp coin; gửi lặp không cộng hai lần; `ad_reward` hiện trong analytics + economy view.

### B2. Điểm danh hằng ngày + chuỗi ngày (P1)

`daily_rewards_config` (theo ngày 1..7, vòng lặp, thưởng tăng dần) + `player_daily_claims(player_id, claim_date)`
unique ⇒ idempotent tự nhiên. RPC `claim_daily_reward`. UI ở Welcome, mở tự động 1 lần/ngày.
**Mốc reset: UTC** (chốt #3) — đặt hằng `DAY_RESET_TZ` trong `shared` và dùng chung cho quest, mùa, leaderboard.
Client hiển thị đồng hồ đếm ngược tới mốc reset để người chơi ở múi giờ khác không bị bất ngờ.

### B3. Nhiệm vụ ngày/tuần (P1)

`quest_definitions(id, period, goal_kind, goal_value, rewards)` + `player_quest_progress`.
Tiến độ **chỉ cập nhật trong RPC server** (`record_match_result`, `complete_campaign_level`, `grant_ad_reward`) —
không tin client. Loại mục tiêu khởi điểm: chơi N trận, chiếm N ô, thắng 1 trận, hoàn thành 1 cấp, xem 1 quảng cáo.

### B4. Thưởng theo cấp XP (P1)

`progression_levels` đã có curve nhưng **lên cấp không có gì**. Thêm cột `rewards jsonb` + bảng claim
(`player_level_rewards_claimed`) ⇒ biến XP từ con số trang trí thành động lực.

### B5. Gói ưu đãi & giá theo thời gian (P1)

`shop_prices` **đã có** `starts_at/ends_at/active` nhưng chưa có UI/admin khai thác. Thêm:
- **Starter pack** (giá thấp, giá trị cao, chỉ hiện 72 h sau lần đăng nhập đầu),
- **thưởng x2 cho lần mua đầu tiên**,
- offer theo trạng thái (người mới / người quay lại) — targeting dùng `audience` của A2.

### B6. Mùa & Battle Pass (P2 — **đã chốt: làm ở Pha 8**)

`seasons(id, starts_at, ends_at)`, `season_tiers(tier, free_reward, premium_reward)`,
`player_season_progress(player_id, season_id, points, premium)`. Điểm mùa từ trận + nhiệm vụ.
Mở premium bằng coin (web) hoặc Stars (Telegram). Nội dung thưởng **tái dùng `shop_items` sẵn có** ⇒ chi phí nội dung thấp.
Đây là đòn bẩy doanh thu + giữ chân lớn nhất, nhưng chỉ nên làm **sau khi A1 đã có số** để định giá đúng.

### B7. Giới thiệu bạn / vòng lan truyền Telegram (P1)

Telegram Mini App có sẵn deep link `start_param` ⇒ chi phí lan truyền gần bằng 0.
`player_referrals(referrer_id, invitee_id, status, rewarded_at)`; **thưởng khi invitee đạt mốc thật**
(ví dụ level 3 hoặc hoàn thành cấp 3) để chống farm tài khoản ảo. Nút chia sẻ + theo dõi k-factor trong analytics.

### B8. Bản web + cổng thanh toán (P3 — **sau khi bản Telegram hoàn thiện**, chốt #1)

Không làm trong Pha 6–8. Ghi lại để **không tự khoá đường** khi thiết kế bây giờ:

- **Trục `platform` phải có sẵn từ đầu** ở remote config (A2), analytics (A1), leaderboard (A5) và mọi bảng
  kinh tế mới (B2–B6) — thêm cột/nhãn `platform` ngay, dù hôm nay chỉ có một giá trị `telegram`. Bổ sung sau
  sẽ phải backfill toàn bộ.
- **Ràng buộc bất biến của [10](10-player-backend-supabase.md): tài sản KHÔNG hợp nhất giữa platform.** Bản web
  (Google login) sẽ là `player_id` + ví + inventory **độc lập**. Đây là quyết định đã có, không phải lỗi cần sửa —
  nhưng phải nói rõ với người chơi ở giao diện web ngay từ ngày đầu.
- Khi mở web: chọn cổng (Stripe quốc tế / MoMo–ZaloPay nội địa), tái dùng nguyên khung `purchase_orders` +
  `payment_transactions` + `processed_events` đã chạy đúng với Stars (idempotency đã được kiểm chứng ở Pha 4).

### B9. Bảng theo dõi kinh tế (P1)

View `economy_daily` từ `wallet_ledger`: coin **phát hành** theo nguồn (ad/quest/daily/level/admin/Stars) vs
coin **tiêu** theo sink (energy/shop/battle pass); tỉ lệ lạm phát; cảnh báo khi phát hành/tiêu vượt ngưỡng.
Không có bảng này thì mọi thay đổi thưởng đều là đoán.

---

## 5. Trục C — VẬN HÀNH

### C1. Cảnh báo & trực vận hành (P1)

SLO đã có (doc 26 §2) nhưng **không có alert**. Quy tắc Prometheus tối thiểu:
`stepRoom` p95 > 5 ms · event-loop lag p95 > 10 ms · drop rate > 1 % · tỉ lệ 5xx control plane ·
**webhook Stars lỗi** · **số file tồn trong `GAME_RESULT_SPOOL_DIR`** (mất kết quả trận = mất XP/tiền của người chơi) ·
`/health/ready` database=false. Mỗi alert **kèm runbook** (nối tiếp [11](11-player-backend-runbook.md)).

### C2. Ops API-first — vận hành bởi NGƯỜI và AI AGENT (P1; phần nền ở Pha 6) — chốt #8

**Quyết định nền:** không xây "trang admin có vài nút". Xây **một bộ API vận hành đầy đủ**; giao diện admin
(`packages/admin`) và **AI agent** là **hai client ngang hàng** của cùng bộ API đó. Hệ quả: mọi thao tác vận
hành phải gọi được bằng máy, có hợp đồng rõ, có kiểm toán, và có rào an toàn — vì một agent sẽ gọi chúng
không có người ngồi cạnh.

Hiện trạng: `internal/v1/admin` mới có 8 endpoint (grant coin, xoá player, đổi giá, defaults, retention, CRUD
level) và xác thực bằng **một** `x-admin-key` duy nhất, **không phân quyền, không kiểm toán, không idempotency**
([admin.controller.ts](../packages/server/src/admin/admin.controller.ts)). Đây là nền không đủ an toàn để giao
cho tự động hoá.

#### 6 nguyên tắc bắt buộc

1. **API-first:** không thao tác nào chỉ làm được bằng UI hoặc SQL tay. Nếu người làm được thì agent phải làm được.
2. **Hợp đồng máy đọc:** sinh **OpenAPI 3.1** từ NestJS (`@nestjs/swagger`) tại `internal/v1/admin/openapi.json`
   ⇒ agent tự khám phá endpoint/tham số, không cần nhúng tri thức vào prompt.
3. **Khoá có phạm vi:** thay `x-admin-key` đơn lẻ bằng bảng
   `ops_api_keys(id, name, actor_kind: 'human'|'agent', scopes[], key_hash, daily_limits jsonb, expires_at, revoked_at)`.
   Scope dạng `players:read` · `wallet:write` · `config:write` · `levels:publish` · `bans:write` · `analytics:read`.
   Key của agent **mặc định chỉ read** + vài scope ghi hẹp.
4. **Idempotent + kiểm toán:** mọi ghi nhận `Idempotency-Key`; mọi lời gọi ghi vào
   `ops_audit_log(actor_kind, key_id, action, target_id, payload_hash, dry_run, result, created_at)`. **Không có
   ngoại lệ** — kể cả thao tác của người.
5. **Rào an toàn cho tự động hoá:** mọi endpoint ghi hỗ trợ `?dry_run=true` (trả **kết quả dự kiến**, không đổi
   dữ liệu); hạn mức theo key (`daily_limits`, ví dụ cấp ≤ 50.000 coin/ngày); nhóm **rủi ro cao**
   (xoá người chơi, đổi giá, publish cấp, cấp coin vượt ngưỡng, đổi cờ ảnh hưởng > 25 % người chơi) yêu cầu
   `X-Ops-Confirm` lấy từ chính lời gọi `dry_run` trước đó, **hoặc** key có cờ `requires_human`.
6. **Lỗi máy đọc được:** `{ code, message, hint, retryable }` — agent phân biệt được "sai tham số" với "thử lại sau".

#### Bề mặt endpoint mục tiêu

| Nhóm | Đọc | Ghi |
|---|---|---|
| Người chơi | `GET players/search` · `GET players/:id` (hồ sơ + ví + progression + risk) · `GET players/:id/ledger` · `/matches` · `/campaign` | `POST players/:id/wallet/grant` (đã có) · `/wallet/revoke` · `POST players/:id/ban` · `/unban` · `POST players/:id/risk-review` |
| Kinh tế | `GET economy/daily` (B9) · `GET orders` · `GET orders/:id` | `PUT catalog/:itemId/price` (đã có) · `PUT catalog/defaults` (đã có) · `POST energy/grant` |
| Cấu hình | `GET config` · `GET config/:key/history` | `PUT config/:key` · `POST config/:key/rollout` (đổi % audience) |
| Nội dung | `GET levels` (đã có) · `GET quests` · `GET seasons` | `POST levels` · `PUT levels/:id/publish` (đã có) · `POST quests/rotate` · `POST seasons/:id/publish` |
| Phân tích | `GET analytics/query?name=&params=` — **whitelist truy vấn có tham số**, không cho SQL tự do | — |
| Hệ thống | `GET health/deep` · `GET metrics/slo` · `GET ops/alerts` (alert đang mở) · `GET ops/spool` (kết quả trận tồn) | `POST ops/spool/retry` · `POST ops/announcement` · `POST retention/matches` (đã có) |

#### Playbook máy đọc được (thứ cho phép agent tự xử lý sự cố)

Mỗi alert ở §C1 gắn một bản ghi `ops_playbooks(alert_key, điều kiện, các bước gọi API, ngưỡng dừng, khi nào
phải gọi người)`. Agent đọc playbook → gọi API theo bước → ghi audit → dừng và báo người khi chạm ngưỡng.
Ví dụ *spool tồn đọng*: `GET ops/spool` → nếu < 100 file thì `POST ops/spool/retry` → kiểm lại sau 5 phút →
vẫn tồn ⇒ mở việc cho người kèm 20 dòng log cuối.

**Lát:** C2.1 `ops_api_keys` + scope + audit + idempotency (thay `x-admin-key`, **Pha 6**) ·
C2.2 OpenAPI + `dry_run` + mã lỗi chuẩn · C2.3 nhóm endpoint đọc (người chơi, kinh tế, hệ thống) ·
C2.4 nhóm endpoint ghi + rào rủi ro cao · C2.5 `ops_playbooks` + 5 playbook đầu · C2.6 UI admin mỏng dựng trên chính API.

**DoD:** một agent chỉ có OpenAPI + **một key scope hẹp** hoàn thành được 5 kịch bản, mỗi kịch bản để lại vết
kiểm toán đầy đủ: (1) khiếu nại mất coin → tra ledger → hoàn coin đúng một lần; (2) spool tồn đọng → retry;
(3) hạ % rollout của một cờ đang gây lỗi; (4) publish 2 cấp mới theo lịch; (5) khoá tài khoản theo `risk_score`.
Và: thử vượt hạn mức ⇒ bị chặn; thử thao tác rủi ro cao không có `X-Ops-Confirm` ⇒ bị chặn.

**Rủi ro:** cao nhất trong cả kế hoạch — đây là quyền ghi vào **tiền và tài khoản người chơi**, giao cho tự động
hoá. Giảm thiểu: agent chạy **read-only trong 2 tuần đầu**, mọi playbook chạy `dry_run` và cho người duyệt cho
tới khi tỉ lệ đúng ổn định; hạn mức ngày + kiểm toán bất biến là hai chốt chặn cuối.

### C3. An toàn cộng đồng (P1)

Chưa có chat trong `net-server` ⇒ bề mặt hiện tại là **tên hiển thị**. Cần: lọc từ cấm + chuẩn hoá unicode
(chống lách bằng ký tự lạ), `player_bans(player_id, reason, until, actor)`, dùng `players.status` sẵn có.
Nếu sau này mở chat/party ⇒ phải có report/block **trước khi** mở.

### C4. Pháp lý & quyền riêng tư (P0 — điều kiện của Telegram Stars)

*(Chốt #1: giai đoạn này chỉ phục vụ Telegram Mini App. Yêu cầu cho bản web — chính sách cookie, cổng thanh
toán, thuế — để lại khi mở web ở §B8.)*

Doc 18 ghi rõ production Stars **phải có** `/terms`, `/paysupport`, quy trình `refundStarPayment` —
client hiện **không có route nào trong số đó** (`packages/client/app/` chỉ có `/`, `/play`, `/netplay`, `/campaign`).
Bổ sung: `/terms`, `/privacy`, `/paysupport`; tự phục vụ **xoá tài khoản** (`DELETE /v1/me`) và **xuất dữ liệu**
(`GET /v1/me/export`) — hiện chỉ admin xoá được; nêu rõ độ tuổi tối thiểu.

### C5. Phát hành & tương thích (P1)

CD staging → production; **gate migration** trước khi đổi code đọc schema mới; cửa sổ tương thích protocol
(client cũ vs server mới — `protocol-version.ts`); kế hoạch rollback từng phần (client, server, migration).

### C6. Sao lưu & khôi phục (P1)

Bật PITR Supabase + **diễn tập khôi phục hàng quý** (chưa từng thử = coi như chưa có backup).
`GAME_RESULT_SPOOL_DIR` phải nằm trên volume bền, có alert tồn đọng (C1).

### C7. Chi phí (P2)

Theo dõi chi phí Supabase/băng thông/số node game trên mỗi DAU, đối chiếu ARPDAU. Với casual, biên lợi nhuận
mỏng ⇒ phải biết ngưỡng DAU mà hạ tầng bắt đầu lỗ.

---

## 6. Trục D — VÒNG ĐỜI SẢN PHẨM

### D1. FTUE — 90 giây đầu (P0 cho casual)

Hiện **không có tutorial**. Người mới vào Welcome và phải tự hiểu. Đề xuất: vào thẳng một ván Practice có
dẫn dắt, **không bắt đăng nhập**, 3 bước — (1) di chuyển, (2) vẽ vòng để chiếm đất, (3) hạ 1 bot / đạt mốc %.
Đo bằng `ftue_step` (A1); mục tiêu hoàn thành ≥ 70 %.

### D2. Guest → tài khoản: chặn mất mát TRƯỚC, không cứu SAU (P1) — chốt #7

**Đã chốt: KHÔNG cho claim tiến độ guest.** Vì vậy thiết kế phải chuyển trọng tâm sang *ngăn người chơi lỡ tay
tích tiến độ trên guest rồi mất*:

- Trong Telegram Mini App, `initData` **luôn có sẵn** ⇒ mặc định **đăng nhập Telegram ngay và im lặng**;
  guest chỉ còn là đường dự phòng khi xác thực lỗi (fail-open theo doc 15), không phải lựa chọn mặc định.
- Khi đang ở chế độ guest: **nói rõ trước, không nói sau** — nhãn thường trực "Đang chơi khách — tiến độ
  không được lưu", và chặn cứng các luồng tích luỹ có giá trị (mua, nhiệm vụ, mùa) thay vì cho làm rồi mất.
- Nếu xác thực Telegram lỗi: hiện nút thử lại rõ ràng + ghi `login_failed` (A1) — tỉ lệ này chính là chỉ số
  sức khoẻ onboarding cần theo dõi, vì mỗi lần lỗi là một người chơi rơi vào nhánh không lưu được gì.

### D3. Vòng lặp quay lại (P1)

Năng lượng đầy → **thông báo qua Telegram bot** (opt-in, dùng bot token đã có); nhắc chuỗi điểm danh sắp mất;
sự kiện cuối tuần nhân đôi thưởng (bật bằng remote config A2). Kiểm soát tần suất để không bị người dùng chặn bot.

### D4. Nhịp nội dung (P1)

Level editor đã sẵn ⇒ đặt nhịp **2–4 cấp mới/tuần**: thêm `published_at`/lịch phát hành, xem thử trên staging,
và A/B độ khó (A2 + A1) để chỉnh tỉ lệ vượt cấp về khoảng lành mạnh (~55–70 % ở lần thử đầu cho cấp thường).

### D5. Xã hội (P2/P3)

Phòng riêng/party (**đã hoãn từ Pha 4**) → chơi cùng bạn từ Telegram; clan/team để dành P3.

### D6. Quản trị vòng đời tính năng

Mỗi tính năng mới phải khai báo **chỉ số thành công + ngày đánh giá**; không đạt sau 1 mùa ⇒ tắt bằng flag (A2)
rồi gỡ code. Tránh tích tụ tính năng chết trong một codebase đã khá lớn.

---

## 7. Lộ trình đề xuất

### Pha 6 — "Đo được & không rò rỉ" (P0)

| Việc | Trục | Ghi chú |
|---|---|---|
| A1 Analytics sự kiện | KT | Nền cho mọi quyết định sau |
| A2 Remote config + flag | KT | Nền cho A/B + kill-switch |
| A3 Liêm chính Campaign (lớp 1–2) | KT | **Bịt lỗ hổng cấp thưởng** |
| A4 CI + error reporting + E2E luồng tiền | KT | Chặn hồi quy |
| C4 Trang pháp lý + tự xoá/xuất dữ liệu | VH | Điều kiện của Telegram Stars |
| **C2.1–C2.2 Nền Ops API** (key có scope + audit + idempotency + OpenAPI + `dry_run`) | VH | Chốt #8 — phải có **trước** khi mở endpoint ghi cho agent |
| D1 FTUE có hướng dẫn | VĐ | Đo bằng A1 ngay khi xong |

**Gate đóng pha:** truy vấn được D1/D7 + funnel FTUE; request campaign giả bị từ chối; CI xanh trên PR;
đổi 1 tham số kinh tế không cần deploy; `x-admin-key` dùng chung **đã bị gỡ**, mọi thao tác admin có vết kiểm toán.

### Pha 7 — "Giữ chân & doanh thu" (P1)

B1 rewarded ads thật (5/ngày, giãn 3 phút) · B2 điểm danh/streak (reset UTC) · B3 nhiệm vụ · B4 thưởng theo cấp ·
B7 giới thiệu bạn qua Telegram · A5 leaderboard · **B9 bảng kinh tế (dựng TRƯỚC B1–B4)** ·
C1 alerting · **C2.3–C2.6 bề mặt Ops API đầy đủ + playbook + UI admin mỏng** · D3 thông báo quay lại · D4 nhịp nội dung.

**Gate đóng pha:** D1/D7 cải thiện đo được so với mốc Pha 6; ARPDAU > 0 và tách được theo nguồn (ads/Stars);
mọi alert có playbook, và agent hoàn thành 5 kịch bản vận hành ở DoD §C2.

### Pha 8 — "Mùa & mở rộng" (P2)

**B6 battle pass/mùa (đã chốt làm ở pha này)** · B5 gói ưu đãi targeting · A6 MMR · A7 perf/thiết bị yếu ·
A8 cửa sổ tương thích client · A3 lớp 3 (chạy lại input) · D5 party · **B2-Redis scale ngang (doc 26 §5) chỉ khi
số đo chạm trần 64 người/8 phòng** · C7 chi phí.
*(B8 bản web + cổng thanh toán: SAU Pha 8, khi bản Telegram đã hoàn thiện — chốt #1.)*

---

## 8. Chỉ số & mục tiêu khởi điểm (đề xuất — chốt lại sau khi A1 có số thật)

| Nhóm | Chỉ số | Mục tiêu khởi điểm |
|---|---|---|
| Onboarding | Hoàn thành FTUE | ≥ 70 % |
| Giữ chân | D1 / D7 | ≥ 35 % / ≥ 12 % |
| Gắn kết | Phiên/DAU · phút/DAU | ≥ 3 · ≥ 12 |
| Doanh thu | ARPDAU (Telegram) · tỉ lệ trả tiền | ≥ 0,01 USD · ≥ 1,5 % |
| Quảng cáo | Rewarded impression/DAU · tỉ lệ hoàn thành | ≥ 1,2 · ≥ 85 % |
| Lan truyền | k-factor | ≥ 0,15 |
| Kỹ thuật | Giữ nguyên SLO doc 26 §2 | không hồi quy |
| Liêm chính | Tỉ lệ complete bị từ chối (người thật) | < 0,1 % |

---

## 9. Rủi ro chính

| # | Rủi ro | Giảm thiểu |
|---|---|---|
| 1 | **Ôm quá nhiều cùng lúc** — kế hoạch này lớn hơn nhiều lần Pha 5 | Cắt theo pha, mỗi pha có gate số liệu; không mở Pha 7 khi Pha 6 chưa đóng |
| 2 | **Phụ thuộc một nền tảng duy nhất** — chốt #1 đặt toàn bộ doanh thu giai đoạn này lên Telegram (Stars + AdsGram + bot push). Telegram đổi chính sách = mất cả kênh phân phối lẫn kênh thu tiền | Chấp nhận có chủ đích để đi nhanh. Giảm thiểu: giữ mã **không khoá chặt vào Telegram** (platform gate doc 15 đã tách sẵn), gắn nhãn `platform` vào mọi bảng mới từ đầu (§B8) để mở web sau không phải backfill |
| 3 | **Agent vận hành gây thiệt hại** — key ghi bị lộ, hoặc agent hiểu sai playbook rồi cấp/thu tiền hàng loạt | §C2: read-only 2 tuần đầu · `dry_run` bắt buộc · hạn mức ngày theo key · `X-Ops-Confirm` cho nhóm rủi ro cao · kiểm toán bất biến để truy vết và hoàn tác |
| 4 | **Lạm phát coin** khi thêm nhiều nguồn thưởng (B1–B4 cùng lúc) | B9 dựng **trước** B1–B4; trần thưởng qua remote config |
| 5 | **Quảng cáo làm hại giữ chân** | Rollout theo cờ 5→25→100 % (doc 08), so D7 giữa nhóm |
| 6 | **Từ chối oan** khi siết A3 | Evaluator dùng chung trong `shared`; giai đoạn đầu chỉ ghi nhận + cảnh báo, chưa chặn cứng |
| 7 | Chi phí Supabase tăng theo `analytics_events` | Partition theo ngày + purge > 90 ngày, chỉ giữ rollup |

---

## 10. Trạng thái quyết định

**8 câu hỏi mở đã được chốt hết (2026-09-03)** — xem bảng "Quyết định đã CHỐT" ở đầu tài liệu.
Không còn hạng mục nào chặn việc bắt đầu Pha 6.

Các chi tiết nhỏ sẽ giải quyết ngay trong lúc làm, **không cần dừng lại hỏi**:

- Danh sách thưởng cụ thể của 7 ngày điểm danh và của từng mốc level (B2, B4) — chọn số khởi điểm rồi
  chỉnh bằng remote config sau khi B9 có dữ liệu lạm phát.
- Bộ nhiệm vụ ngày/tuần đầu tiên (B3) — bắt đầu bằng 3 nhiệm vụ/ngày, 2 nhiệm vụ/tuần.
- Nội dung 3 bước FTUE và ngưỡng "đạt" của mỗi bước (D1).
- Danh sách whitelist truy vấn cho `GET analytics/query` (C2) — mở dần theo nhu cầu thật của agent.

Hạng mục **cần quay lại xin xác nhận trước khi bật**, vì đụng tiền thật hoặc tài khoản người chơi:

1. Bật quyền **ghi** của Ops API cho AI agent (sau 2 tuần chạy read-only — §C2 rủi ro).
2. Ngưỡng hạn mức ngày của từng key agent (`daily_limits`, ví dụ trần coin/ngày).
3. Bảng giá và nội dung Battle Pass mùa 1 (Pha 8).

---

Liên quan: [05-roadmap.md](05-roadmap.md) · [10](10-player-backend-supabase.md) · [15](15-telegram-platform-gating-and-adsgram.md) ·
[18](18-telegram-stars-coin-packages.md) · [24](24-render-perf-research.md) · [26](26-phase-5-plan.md) · [34](34-campaign-features-plan.md)
