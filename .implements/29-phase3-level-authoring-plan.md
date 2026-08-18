# 29 — Kế hoạch P3: Schema Level trên Supabase + Admin API + Trình vẽ hex

> **Phạm vi:** tài liệu **thực thi** (chia lát code). Hiện thực **P3** của
> [25-game-modes-plan.md](25-game-modes-plan.md) §4 trên nền **P2 đã xong** (Campaign chơi được:
> catalog hardcode `campaign.ts`, năng lượng, tiến độ). Mục tiêu: **admin tự tạo/sửa cấp** (map +
> objective + thưởng + mở khóa) **không cần deploy**, thay catalog hardcode bằng dữ liệu Supabase.
>
> **Nguồn:** doc 25 §4 (schema Level, tiến độ, admin, trình vẽ). Nền: [28-phase2-energy-campaign-impl.md](28-phase2-energy-campaign-impl.md).

## 0. Tiền đề (đã có, không phải làm lại)

- **Type + helper Campaign thuần** trong shared (`campaign.ts`): `CampaignLevel`, `validateCampaignCatalog`,
  `isUnlocked`, `campaignStars`, `applyPowerups`, `PowerupKind`. → **giữ nguyên**; P3 chỉ đổi **NGUỒN dữ liệu**
  (server thay vì hằng `CAMPAIGN_LEVELS`).
- **Tiến độ + cổng** đã DB-authoritative: `campaign_plays`, `player_level_progress`, RPC start/complete;
  `CampaignController` (`/v1/campaign/{levels?,progress,start,complete}`). `level_id` là **text** ⇒ giữ
  nguyên khi cấp chuyển sang DB (progress cũ không vỡ nếu giữ id `c1..c5`).
- **Admin đã có khung**: `AdminController` (`internal/v1/admin`, header `x-admin-key` so `adminApiKeyHash`),
  RPC `security definer` → `service_role`, migration mẫu (validate + versioning như `set_shop_price`).
- **Toán + renderer hex** tái dùng được cho trình vẽ (`HexGridView`/`BorderRim`/`arena.ts`).

## 1. Quyết định thiết kế (đề xuất — cần chốt trước L3/L5)

1. **Server là NGUỒN SỰ THẬT của cấp.** `campaign_levels` (Supabase) thay hằng `CAMPAIGN_LEVELS`.
   Client + `complete` RPC đọc cấp (config/rewards/unlock) từ DB. Hằng shared thành **seed + fallback**.
2. **`config` lưu JSONB** = `MatchConfigInput` (đúng type shared) → validate bằng chính `resolveMatchConfig`
   + kiểm objective/unlock ở server trước khi publish. Versioning + `published` cờ.
3. **Thưởng đọc từ DB cấp** (không còn `levelById` hardcode trong `complete`). Vẫn **không tin client**.
4. **Trình vẽ hex (MVP)**: route `/admin/levels` **trong client hiện có**, gate bằng admin key (nhập tay),
   tái dùng renderer hex. doc 25 §4.3 muốn **frontend admin RIÊNG** — tách app để sau (L6, khi ổn định).
5. **Hình bản đồ**: MVP giữ **biên lục giác lồi + obstacle** (như P1 S7). Cho phép **custom-cells (hình lõm)**
   là mở rộng cần collision lõm — **hoãn**, chỉ mở khi editor thực sự cần (ghi ở §4).

## 2. Các lát công việc

| Lát | Tên | Effort | DB | Sau |
|-----|-----|:------:|:--:|-----|
| **L1** | Migration `campaign_levels` + seed 5 cấp hiện tại (id `c1..c5`) | V | ✔ | — |
| **L2** | Đọc cấp từ server: `GET /v1/campaign/levels` + client fetch (bỏ hằng cứng ở client) | V | ✔ | L1 |
| **L3** | `complete`/`start` đọc cấp từ DB (thưởng/unlock từ DB, không dùng hằng) | V | ✔ | L1 |
| **L4** | Admin API CRUD level (`internal/v1/admin/levels`) + RPC upsert/publish + validate schema | V | ✔ | L1 |
| **L5** | Trình vẽ hex `/admin/levels` (client): tô ô/obstacle + form objective/thưởng/unlock + publish | K | — | L4 |
| **L6** | (Tùy) tách trình vẽ thành frontend admin RIÊNG | K | — | L5 |

### L1 — Migration `campaign_levels` + seed

- **Đụng:** `supabase/migrations/2026xxxx_campaign_levels.sql`:
  ```sql
  create table campaign_levels (
    id text primary key,
    sort_order int not null unique,
    name text not null,
    config jsonb not null,          -- MatchConfigInput
    powerups text[] not null default '{}',
    unlock_requires text references campaign_levels(id),
    rewards jsonb not null,         -- {coin,xp,energy}
    published boolean not null default false,
    version int not null default 1,
    updated_at timestamptz not null default now()
  );
  ```
  Seed 5 cấp hiện tại (id `c1..c5`, `published=true`) khớp hằng `CAMPAIGN_LEVELS` → progress cũ giữ nguyên.
- **Test:** không test-run DB ở dev; đối chiếu seed = hằng shared bằng script/so tay.
- **Xong khi:** bảng + seed áp được; `select` ra 5 cấp `published`.
- **Rủi ro:** thấp (thuần schema + seed).

### L2 — Đọc cấp từ server

- **Đụng:** `CampaignController` thêm `GET /v1/campaign/levels` → cấp `published` (sort theo `sort_order`),
  ánh xạ jsonb → `CampaignLevel`. Client `CampaignScene` fetch danh sách này thay `CAMPAIGN_LEVELS`; validate
  bằng `validateCampaignCatalog` trước khi render (an toàn dữ liệu admin nhập).
- **Test:** controller mock trả rows → map đúng `CampaignLevel[]`; client render theo danh sách fetch.
- **Xong khi:** `/campaign` hiện cấp từ DB; sửa cấp trong DB → client thấy ngay (không deploy).
- **Rủi ro:** vừa — dữ liệu ngoài → phải validate + fallback nếu fetch lỗi (dùng hằng shared làm fallback).

### L3 — start/complete đọc cấp từ DB

- **Đụng:** `CampaignController.start` kiểm unlock bằng cấp DB (thay `levelById` hằng); `complete` lấy `rewards`
  từ hàng `campaign_levels` (thay `levelById(...).rewards`). RPC `complete_campaign_level` giữ nguyên (nhận
  `p_rewards`) — controller đổ rewards từ DB vào.
- **Test:** complete dùng rewards DB (mock) không dùng client số; unlock theo cấp DB.
- **Xong khi:** thưởng/mở khóa hoàn toàn theo DB; không còn phụ thuộc hằng shared ở server.
- **Rủi ro:** vừa — chạm luồng thưởng đã chạy; giữ test bọc.

### L4 — Admin API CRUD level

- **Đụng:** `AdminController` thêm `POST/PUT/DELETE internal/v1/admin/levels[/:id]` + `POST .../publish`.
  RPC `upsert_campaign_level(p_json jsonb, p_admin_actor)` — **validate server-side**: `resolveMatchConfig`
  không ném; `win.kind` hợp lệ; `unlock_requires` tồn tại + không tạo chu trình; `sort_order` duy nhất;
  bump `version`. `delete` = soft (unpublish).
- **Test:** RPC verify tay ở Supabase; controller test auth + validate (mock rpc).
- **Xong khi:** tạo/sửa/publish 1 cấp qua API (curl + x-admin-key) → xuất hiện ở `/campaign`.
- **Rủi ro:** vừa — validate JSON là điểm dễ sai; test kỹ ca hỏng (unlock vòng, config lạ).

### L5 — Trình vẽ hex trực quan (`/admin/levels`)

- **Đụng:** route `app/admin/levels/page.tsx` (client), gate nhập admin key (gửi header). Lưới hex tái dùng
  renderer: click ô → toggle obstacle; form: số bot, objective (kind + tham số), powerups, rewards, unlock,
  sort_order; **preview** ván bằng GameScene(config) đang dựng; nút **Publish** → `internal/v1/admin/levels`.
- **Test:** thuần hóa hàm build-config-từ-UI + test; UI verify tay.
- **Xong khi:** admin vẽ 1 cấp mới bằng chuột → publish → chơi được ở `/campaign`, không sửa code.
- **Rủi ro:** cao — UI mới nhiều; cắt nhỏ: (a) tô obstacle + preview; (b) form objective/thưởng; (c) publish.

### L6 — (Tùy) tách frontend admin riêng

Chuyển `/admin/*` sang app độc lập (đúng doc 25 §4.3) khi trình vẽ ổn định. Chỉ hạ tầng (routing/deploy),
không đổi API. Làm sau, không chặn P3 lõi.

## 3. Thứ tự & phụ thuộc

```
L1 (schema+seed) ─┬─► L2 (client đọc DB) ─┐
                  ├─► L3 (start/complete DB) ─┼─► (Campaign chạy hoàn toàn bằng dữ liệu)
                  └─► L4 (admin CRUD) ───────┴─► L5 (trình vẽ) ─► L6 (tách app, tùy)
```

**Khuyến nghị:** **L1 → L2 → L3** (chuyển nguồn dữ liệu, giữ 5 cấp cũ chạy y nguyên) → **L4** (admin API) →
**L5** (trình vẽ). L1–L3 là "đổi ống dẫn" ít rủi ro; L4–L5 mở năng lực tạo cấp.

## 4. Ngoài phạm vi P3 (hoãn)

- **Custom-cells / map hình LÕM** + collision lõm tổng quát — chỉ mở khi editor cần hình phi-lục-giác.
- **StarCriteria dữ liệu** (hiện sao suy từ số lần chết) — có thể đưa vào schema cấp sau.
- Kiểm duyệt/nhiều tác giả/nháp-nhiều-phiên bản nâng cao (chỉ versioning cơ bản ở L4).

## 5. Tiêu chí ĐÓNG P3

- Cấp Campaign đọc **từ Supabase** (`campaign_levels`), 5 cấp cũ giữ nguyên trải nghiệm + progress.
- Admin tạo/sửa/publish cấp qua **API** (L4) và/hoặc **trình vẽ hex** (L5) — **không deploy code**.
- Thưởng/mở khóa/objective **server-authoritative theo DB**; validate chặn cấu hình hỏng.
- Build monorepo xanh; test tăng; Campaign cũ + `/play` + `/netplay` bất biến.

---
Xem thêm: quy hoạch [25-game-modes-plan.md](25-game-modes-plan.md) §4 · nền P2
[28-phase2-energy-campaign-impl.md](28-phase2-energy-campaign-impl.md) · lộ trình [05-roadmap.md](05-roadmap.md).
