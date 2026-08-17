# 28 — Kế hoạch TRIỂN KHAI P2: Năng lượng + Campaign (chơi được)

> **Phạm vi:** tài liệu **thực thi** (chia lát code, mỗi lát có tiêu chí "xong"). Hiện thực
> **P2** của [25-game-modes-plan.md](25-game-modes-plan.md) §2.3 + §3 trên nền **P1 đã xong**
> (`MatchConfig` / evaluator `WinCondition` / obstacle-barrier — branch `phase1/modes`, 203 test).
> Dành cho: Gameplay + Backend + Frontend.
>
> **Nguồn:** doc 25 §2.3 (Campaign), §3 (năng lượng server-authoritative), §5 (bảng P2).
> Nền backend thực tế đã khảo sát: ví `player_wallets`/`wallet_ledger` (idempotent,
> `security definer` RPC → `service_role`), `TicketService` (ký EdDSA/HS256), progression
> (`record_match_result`), controller REST trong `ControlModule`, client REST qua `lib/backend.ts`.

## 0. Tiền đề (đã có, không phải làm lại)

- **Ví + ledger idempotent**: `player_wallets(player_id,currency_code,balance,version)` +
  `wallet_ledger` khóa `unique(player_id,currency_code,reference_type,reference_id)`. RPC mẫu
  `purchase_item_with_coin`, `admin_grant_coin` — copy pattern cho năng lượng.
  (`supabase/migrations/202608120001_player_backend.sql`)
- **Ký ticket**: `TicketService.issue/verify` (EdDSA khi có key, HS256 fallback) — mẫu cho
  **play-ticket Campaign** (chứng minh đã trừ năng lượng). (`regions/ticket.service.ts`)
- **REST**: controller đăng ký ở `ControlModule`; `sessions.resolve(req)` lấy player; client gọi
  qua `json()` trong `lib/backend.ts` (`credentials:"include"`, idempotencyKey = `crypto.randomUUID()`).
- **Sim đơn client-side**: `/play` đã chạy `GameState` cục bộ với `MatchConfigInput`; evaluator
  `territory_pct`/`survive`/`capture_totems` (S3) + obstacle (S7) đã hoạt động → Campaign tái dùng.

## 1. Quyết định thiết kế (default đề xuất — cần bạn xác nhận trước khi vào E3/E4)

1. **Campaign chạy sim CLIENT-SIDE** (giống `/play`), **KHÔNG** server-authoritative như Tournament.
   Lý do: chơi đơn, tái dùng path hiện có, không tốn phòng server. Chống gian lận đặt ở **cổng
   năng lượng** (trừ ở server) + **xác minh khi nộp kết quả** (play-ticket ký + phần thưởng/mở khóa
   tính & cap ở server, idempotent). Đủ cho MVP; nếu cần chặt hơn → chuyển sim lên server ở P4.
2. **Kinh tế năng lượng** (chỉnh trong bảng `energy_rules` singleton, không cần deploy):
   `energy_max = 30`, `regen_interval = 300s` (5 phút/1 điểm), `cost = 1/cấp`. **Cần bạn chốt số.**
3. **Catalog cấp độ = DỮ LIỆU HARDCODE trong shared** cho P2 (`campaign.ts`, ~5 cấp mẫu dùng
   obstacle + evaluator). Schema Level trên Supabase + trình vẽ admin = **P3** (doc 25 §4).
4. **Tiến độ (unlock/sao) trên Supabase**, verify mở khóa ở backend (không tin client).
5. **Power-up trước trận** = modifier khởi tạo áp lên `MatchConfig`/Entity: `head_start` (lãnh thổ
   khởi đầu lớn hơn), `shield`/`extra_life` (1 mạng phụ), + ánh xạ totem sẵn có (`speed`). Là
   consumable trong inventory (hệ shop đã có).

## 2. Các lát công việc

Ký hiệu: **Đ.dễ / V.vừa / K.khó** · phụ thuộc ghi ở cột "Sau" · cột "DB" = chạm Supabase.

| Lát | Tên | Effort | DB | Sau |
|-----|-----|:------:|:--:|-----|
| **E1** | Catalog Campaign trong shared (`campaign.ts`, ~5 cấp mẫu) | V | — | — |
| **E2** | Power-up → modifier khởi tạo (head_start / extra_life / speed) | V | — | — |
| **E3** | Năng lượng: migration + RPC (read/spend/grant) + `EnergyController` REST | V | ✔ | — |
| **E4** | Tiến độ Campaign: migration + RPC complete + `CampaignController` (verify ticket) | V | ✔ | E1,E3 |
| **E5** | Client Campaign: route `/campaign`, chọn cấp, thanh năng lượng + đếm hồi | K | — | E1,E3 |
| **E6** | Client: chọn power-up (inventory) + HUD objective (tiến độ/thắng/thua per-cấp) | V | — | E2,E4,E5 |

### E1 — Catalog Campaign (shared, test-first, KHÔNG chạm backend)

**Mục tiêu:** định nghĩa cấp độ **là dữ liệu thuần** để cả client (chọn/chơi) lẫn server (verify
thưởng/mở khóa) cùng import. Ship sớm, rủi ro thấp.

- **Đụng:** `packages/shared/src/campaign.ts` (mới) + export ở `index.ts`.
  ```ts
  interface CampaignLevel {
    id: string; order: number; name: string;
    config: MatchConfigInput;        // map/obstacle/bot/rules/win (objective nằm ở win)
    powerups: PowerupKind[];         // loại power-up được phép ở cấp này
    unlock: { requires: string | null };  // id cấp trước (null = mở sẵn)
    rewards: { coin: number; xp: number; energy: number };
  }
  export const CAMPAIGN_LEVELS: readonly CampaignLevel[];
  export function levelById(id): CampaignLevel | undefined;
  export function isUnlocked(id, cleared: Set<string>): boolean;  // thuần, dùng chung client/server
  ```
  ~5 cấp mẫu: (1) `territory_pct` 30% không obstacle; (2) `survive` 60s ít bot; (3) `capture_totems`;
  (4) `territory_pct` có obstacle (dùng S7); (5) tổng hợp khó hơn.
- **Test:** `campaign.test.ts` — mọi `config` qua `resolveMatchConfig` không ném; `order` duy nhất &
  tăng; chuỗi `unlock` không vòng lặp/không trỏ id lạ; `isUnlocked` đúng (cấp 1 mở sẵn, cấp kế cần
  cấp trước trong `cleared`).
- **Xong khi:** import được ở client & server; `pnpm --filter @hexagon/shared test` xanh.
- **Rủi ro:** thấp. Thuần dữ liệu.

### E2 — Power-up → modifier khởi tạo (shared, test-first)

**Mục tiêu:** biến power-up đã chọn thành modifier áp lúc dựng ván. MVP 3 loại: `speed` (qua totem/
rules), `head_start` (bán kính lãnh thổ khởi đầu lớn hơn — `rules.startRadius`), `extra_life` (1 lần
hồi sinh không tính thua ở cấp `no_death`/hữu hạn mạng).

- **Đụng:** `campaign.ts` (hoặc `powerups.ts`): `type PowerupKind`; `applyPowerups(base: MatchConfigInput,
  picks: PowerupKind[]): MatchConfigInput` (thuần). `state.ts`: hỗ trợ `extra_life` (đếm mạng phụ ở
  Entity — chỉ khi có power-up, default 0 = bất biến).
- **Test:** `powerups.test.ts` — `head_start` tăng `startRadius`; `speed` tăng dải tốc độ; không chọn
  gì ⇒ config **bằng** base (bất biến); `extra_life` cho hồi sinh đúng 1 lần.
- **Xong khi:** áp/không-áp cho kết quả xác định qua test; không đụng đường chơi mặc định.
- **Rủi ro:** vừa — `extra_life` chạm vòng đời chết/hồi sinh; giữ default 0 để bất biến.

### E3 — Năng lượng: migration + RPC + REST (server + Supabase)

**Mục tiêu:** năng lượng **server-authoritative**, hồi lười (lazy) khi đọc; cổng vào cấp = trừ 1 +
cấp play-ticket idempotent.

- **Migration** `supabase/migrations/2026xxxx_energy.sql`:
  - `energy_rules(singleton bool pk, energy_max int=30, regen_interval_seconds int=300, updated_at)`.
  - `player_energy(player_id uuid pk → players, energy_current int, last_refill_at timestamptz,
    updated_at)`; trigger tạo row khi tạo player (mẫu `ensure_player_progression`).
  - `player_energy_ledger` (idempotent, `unique(player_id,reference_type,reference_id)` — mẫu `wallet_ledger`).
  - RPC `security definer` → `service_role`:
    - `read_energy(p_player_id) → (current,max,regen_interval,next_at)`: `current =
      min(max, stored + floor((now-last)/interval))`, dời `last_refill_at` theo số điểm đã hồi.
    - `spend_energy(p_player_id, p_amount, p_reason, p_reference_id) → new_current`: lazy-refill trước,
      kiểm đủ, trừ, ghi ledger idempotent (đã có reference ⇒ trả nguyên trạng).
    - `grant_energy(p_player_id, p_amount, p_reason, p_reference_id) → new_current`: cộng, cap ≤ max**hoặc
      cho vượt** (ads/thưởng) — **cần chốt**; idempotent.
- **Server** `energy/energy.controller.ts` + đăng ký `ControlModule`:
  - `GET /v1/energy` → `read_energy` (client hiện thanh + đếm ngược).
  - `POST /v1/energy/spend` `{ levelId, idempotencyKey }` → `spend_energy(1)` rồi
    `TicketService.issue`-style **play-ticket** (jti, playerId, levelId, iat, exp) → client giữ, nộp lại ở E4.
- **Test:** unit RPC không chạy được ở đây (không có Postgres) → viết **test thuần cho công thức
  lazy-refill** (tách hàm TS `computeRegen()` client dùng + đối chiếu tay), và test controller mức
  service (mock `db.rpc`). Migration verify tay khi có Supabase.
- **Xong khi:** endpoint trả năng lượng + regen; spend trừ đúng + idempotent (mock); build server xanh.
- **Rủi ro:** vừa–cao — **schema DB không test-run ở máy này**; số kinh tế cần bạn chốt. **Cần duyệt.**

### E4 — Tiến độ Campaign: migration + RPC complete + REST

**Mục tiêu:** nộp kết quả cấp → verify play-ticket → mở khóa cấp kế + phát thưởng, **idempotent**,
**không tin client** cho unlock.

- **Migration** `..._campaign_progress.sql`:
  - `player_level_progress(player_id, level_id text, status text, stars int default 0, best_score int,
    completed_at, primary key(player_id,level_id))`.
  - RPC `complete_campaign_level(p_player_id, p_level_id, p_stars, p_score, p_reference_id, p_rewards jsonb)`:
    idempotent (reference = jti của play-ticket); upsert progress (giữ max stars/score); phát thưởng qua
    `grant coin`/`grant_energy`/xp (tái dùng ví). **Cấp play-ticket là bằng chứng đã trừ năng lượng**;
    rewards cap theo catalog (server đối chiếu `CAMPAIGN_LEVELS`, không nhận số từ client).
- **Server** `campaign/campaign.controller.ts`:
  - `GET /v1/campaign/progress` → danh sách progress người chơi (client tô khóa/sao).
  - `POST /v1/campaign/complete` `{ playTicket, levelId, objectiveMet, stars, score }`: verify ticket
    (chữ ký + exp + levelId khớp), chặn nếu `objectiveMet=false`, gọi RPC.
- **Test:** verify play-ticket (chữ ký/hết hạn/levelId lệch) test được thuần TS; RPC verify tay ở Supabase.
- **Xong khi:** hoàn tất cấp mở khóa cấp kế ở server; replay cùng ticket không nhân đôi thưởng (mock).
- **Rủi ro:** vừa — phụ thuộc E1 (đối chiếu catalog) + E3 (ticket). **Cần duyệt cùng E3.**

### E5 — Client Campaign: route + chọn cấp + năng lượng

**Mục tiêu:** màn `/campaign`: lưới cấp (khóa/mở/sao), thanh năng lượng + đếm hồi, bấm cấp → trừ
năng lượng → vào chơi bằng `GameScene` với `config` của cấp.

- **Đụng:** `app/campaign/page.tsx` (mới); `lib/backend.ts` thêm `getEnergy()/spendEnergy(levelId)/
  getCampaignProgress()/completeCampaignLevel(...)`; `StartPanel` thêm lối vào "🗺️ Cấp độ";
  tái dùng `GameScene` (đã nhận `config`) + HUD.
- **Test:** client component render (vitest) — lưới cấp khóa đúng theo progress; disable khi hết năng lượng.
- **Xong khi:** vào `/campaign`, chọn cấp mở, trừ 1 năng lượng, chơi map của cấp; thanh hồi đếm đúng.
- **Rủi ro:** vừa — UI mới; phụ thuộc E1/E3.

### E6 — Client: power-up + HUD objective

**Mục tiêu:** trước trận chọn power-up (từ inventory consumable); trong trận HUD hiện tiến độ
objective; kết trận thắng/thua theo evaluator → nộp `complete` → cập nhật mở khóa/sao.

- **Đụng:** panel chọn power-up (map inventory → `PowerupKind`, `applyPowerups`); `HUD.tsx` hiện tiến độ
  theo `config.win.kind` (%, đếm ngược, totem đã thu); màn kết nối `completeCampaignLevel`.
- **Test:** HUD hiện đúng tiến độ theo từng `win.kind`; nộp completes gọi API đúng (mock).
- **Xong khi:** chơi trọn 1 cấp: chọn power-up → đạt objective → mở khóa cấp kế hiện ra.
- **Rủi ro:** vừa — phụ thuộc gần hết chuỗi trên.

## 3. Thứ tự & phụ thuộc

```
E1 (catalog) ─┬─────────────► E5 (client select) ─┐
E2 (power-up)─┼───────────────────────────────────┼─► E6 (power-up + HUD objective)
E3 (energy DB+REST) ─┬─► E4 (progress DB+REST) ────┘
                     └────► E5
```

**Khuyến nghị:** **E1 → E2** (shared, test-first, ship & commit ngay — KHÔNG chạm DB, an toàn) →
**[chốt kinh tế + duyệt schema]** → **E3 → E4** (backend) → **E5 → E6** (client). E1/E2 không chặn
bởi quyết định kinh tế nên làm trước để có tiến độ chắc chắn.

## 4. Ngoài phạm vi P2 (để P3 — doc 25 §4)

- **Schema Level trên Supabase** (thay catalog hardcode) + **admin API** CRUD level + **trình vẽ
  hex trực quan** (frontend admin riêng).
- Sim Campaign **server-authoritative** (nếu cần chống gian lận chặt hơn) — cân nhắc P4.
- Nguồn nạp năng lượng nâng cao: **xem quảng cáo** (`LobbyRewardedAdButton` + verify server),
  đăng nhập ngày, nhiệm vụ — MVP P2 chỉ làm **regen theo giờ** (+ hook grant sẵn cho mua/thưởng).

## 5. Tiêu chí ĐÓNG P2

- Vào `/campaign`, chọn cấp mở khóa, **trừ 1 năng lượng (server)**, chơi map+độ khó của cấp, đạt
  objective → **mở khóa cấp kế (server verify)** + nhận thưởng; thất bại không mở khóa.
- Thanh năng lượng hiển thị + **hồi theo giờ** đúng công thức lazy; hết năng lượng chặn vào cấp.
- Power-up chọn trước trận áp đúng modifier; không chọn ⇒ bất biến.
- Toàn bộ cổng năng lượng + thưởng + mở khóa **idempotent** & **server-authoritative** (replay không nhân đôi).
- Build monorepo xanh; test tăng so với 203; **các mode cũ (`/play`, `/netplay`) bất biến**.

## 6. Rủi ro & giảm thiểu

| Rủi ro | Giảm thiểu |
|--------|-----------|
| Schema DB không test-run ở máy dev | Tách công thức regen thành hàm TS test được; RPC theo mẫu ví đã kiểm chứng; verify tay khi có Supabase |
| Kinh tế năng lượng là quyết định sản phẩm | Đưa vào `energy_rules` (chỉnh không cần deploy); chốt số với bạn trước E3 |
| Sim client-side ⇒ gian lận qua màn | Cổng năng lượng ở server + play-ticket ký + thưởng/mở khóa cap theo catalog server + idempotent |
| Đụng vòng đời chết/hồi sinh (E2 extra_life) | Default 0 mạng phụ ⇒ bất biến; test bọc |

---
Xem thêm: quy hoạch mode [25-game-modes-plan.md](25-game-modes-plan.md) · nền P1
[27-phase1-modes-impl.md](27-phase1-modes-impl.md) · lộ trình [05-roadmap.md](05-roadmap.md).
