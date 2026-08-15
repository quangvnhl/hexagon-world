# 25 — Quy hoạch lại chế độ chơi: Luyện tập / Tournament / Cấp độ

> **Phạm vi:** tài liệu **kế hoạch** (chỉ thiết kế, **CHƯA sửa code**). Quy hoạch lại ba
> chế độ chơi, xây hệ **năng lượng**, và nghiên cứu khả thi **admin tự thiết lập bản đồ +
> nhiệm vụ mở khóa**. Dành cho: Gameplay + Backend + Frontend + Product.

## 0. Xác định lại backend (đính chính)

`packages/server` **chính là backend** của dự án: NestJS chạy trên **cổng 8910**
(`DEFAULT_PORT = 8910` — trùng `API_URL` của client), phục vụ **cả HTTP REST lẫn WebSocket**
trong cùng process, có **Supabase** (`database/supabase.service.ts`). Đã có sẵn các
controller: `auth`, `players`, `shop`, `payments` (Telegram Stars), `regions`, `matches`,
`health`, và **`admin/admin.controller.ts`**. Đã có `LobbyRewardedAdButton` (hạ tầng quảng
cáo) phía client.

⇒ **Toàn bộ năng lượng, định nghĩa cấp độ, tiến độ, và API cho admin đều xây TRONG
`packages/server` + Supabase.** Không phụ thuộc dịch vụ ngoài. Trang **vẽ bản đồ trực quan
cho admin** sẽ là **frontend riêng, tách khỏi domain backend** (backend chỉ cung cấp API).

## 1. NÚT THẮT kiến trúc (P0 — làm trước mọi mode)

Hiện `CONFIG` là **singleton `as const`** (`shared/src/config.ts`) và `arena.ts` **đóng
băng hằng số ngay lúc load module**:

```ts
export const ARENA_R = CONFIG.ARENA_RADIUS;                 // cố định toàn app
export const WALL_LIMIT = ARENA_INRADIUS * CONFIG.WALL_SCALE;
```

`GameState` đọc thẳng `CONFIG.MAP_MARGIN`, `CONFIG.BOT_COUNT`, `CONFIG.BOT_DIFFICULTY`,
`mapArena()`… ⇒ **mọi ván dùng chung một sân lục giác + một bộ luật.**

**Bắt buộc:** tách `CONFIG` → một object **`MatchConfig`** truyền vào `GameState` lúc tạo
ván; hình học sân (`ARENA_R`, `WALL_LIMIT`…) trở thành **thuộc tính per-instance** (physics
`clampInside`/`slideMove` chạy mỗi tick phải đọc theo sân của ván đó).

> Thuận lợi: **bản đồ vốn là `Set<HexKey>`** (dữ liệu thuần) — flood fill, spatial hash, tô
> màu đều chạy trên tập ô bất kỳ ⇒ bản đồ tùy biến (kể cả hình lạ + chướng ngại) **về bản
> chất đã khả thi**. Vướng duy nhất: tường va chạm đang giả định **lục giác lồi 6 nửa mặt
> phẳng**.

### 1.1 `MatchConfig` (đề xuất; mọi field có default = giá trị CONFIG hiện tại)

```
MatchConfig {
  map:   { shape: "hexagon" | "custom", radius?, cells?: HexKey[], obstacles?: HexKey[] }
  bots:  { count, difficultyMix }
  rules: { speed, turnRate, totems, killRadius, prepTime, kingPct, winHoldTime, ... }
  win:   WinCondition            // trừu tượng hóa điều kiện thắng (§1.2)
}
```

- Phải **serialize được** (server Tournament dựng GameRoom + client dựng GameState-view khớp).
- Preset theo mode: `practiceConfig`, `tournamentConfig`, và **mỗi cấp độ = một `MatchConfig`
  nạp từ dữ liệu**.

### 1.2 Trừu tượng `WinCondition` / `Objective` (P0)

Hiện điều kiện thắng **hardcode**: `KING_PCT`(20%) + `WIN_HOLD_TIME`(180s) → `declareWinner`.
Cần evaluator chạy mỗi tick trả `{ status: playing | won | lost, progress }`. Kho mục tiêu:

- `territory_pct` — đạt X% lãnh thổ
- `survive` — sống sót T giây
- `capture_totems` — thu N totem
- `beat_bots` / `reach_before_bots` — đạt X% trước bot
- `king_hold` — giữ King (mặc định Tournament hiện tại)
- `none` — không thắng/thua (Luyện tập)
- `no_death` — qua màn không chết (dùng cho tính sao)

Mỗi mode/cấp độ cắm một evaluator khác nhau.

### 1.3 Ô chướng ngại như "barrier" (P1)

Cho MVP map tùy biến: **giữ biên ngoài lục giác lồi**, coi **ô chướng ngại như barrier**
(chặn di chuyển / như tường nội bộ). Đơn giản, gọn, đủ cho cấp độ. Collision hình **lõm**
tổng quát — phức tạp, **chưa cần**.

## 2. Ba chế độ

### 2.1 Luyện tập (từ chơi đơn, route `/play`)

**Hoàn toàn do config điều khiển** — có thể cấu hình riêng cho chế độ này:

| Khía cạnh | Đề xuất |
|-----------|---------|
| Bản đồ | **Vẽ map riêng** (shape/radius/obstacles qua `MatchConfig`) |
| Bot | Điều chỉnh **số lượng + độ khó** (kể cả 0 bot) |
| Tốc độ / luật | Chỉnh `speed`, `turnRate`, totem… qua `rules` |
| Điều kiện thắng | `WinCondition = none` (endless, hồi sinh tự do, freeze-on-death đã có) |
| Năng lượng | **Miễn phí** |

### 2.2 Tournament (từ nhiều người, route `/netplay`)

| Khía cạnh | Đề xuất |
|-----------|---------|
| Bản đồ / config | Preset **phía server** — `GameRoom` dựng bằng `MatchConfig` tournament |
| Điều kiện thắng | `king_hold` **hoặc** last-man-standing (đã có `declareWinner`/`handleLastPlayer`) |
| Năng lượng | Tùy chính sách (thường miễn phí, hoặc vé giải) |

Yêu cầu: `MatchConfig` serialize để server + client GameState-view khớp.

### 2.3 Cấp độ (Campaign) — mode MỚI

Luồng: **Chọn cấp → chọn vật phẩm tăng cường → trừ 1 năng lượng → chơi map+độ khó của cấp
→ đạt Objective để qua màn & mở khóa cấp kế.**

- **Objective**: dùng trừu tượng §1.2 (mỗi cấp có 1+ mục tiêu).
- **Power-up trước trận**: ánh xạ tự nhiên vào TOTEM đã có (`SPEED`/`SLOW`/`RADAR`) +
  thêm *khiên / mạng phụ*, *khởi đầu lãnh thổ lớn hơn*. Là **consumable trong inventory**
  (đã có hệ inventory ở shop) → chọn trước trận, áp làm modifier khởi tạo lên Entity/`MatchConfig`.
- **Map + độ khó mỗi cấp**: một `MatchConfig` **nạp từ dữ liệu** (§4).

## 3. Hệ thống Năng lượng (server-authoritative)

Xây trong `packages/server` + Supabase (tái dùng mô hình ví `wallets` đã có). Năng lượng =
**một currency mới + chính sách hồi phục**, **không** lưu ở client (chống gian lận).

- **Lưu:** `energy_current`, `energy_max`, `last_refill_at`. Tính **lazy** khi đọc:
  `current = min(max, stored + floor((now - last)/regen_interval))`.
- **Cổng vào cấp độ:** endpoint **idempotent** `spend 1 energy → trả play-ticket` (tái dùng
  pattern `ticket.service.ts`/`acquireGameAccess`). Client chỉ hiển thị + đếm ngược regen.
- **Nguồn nạp:**
  - ⏳ Hồi theo thời gian (regen).
  - 🛒 Mua bằng coin/Stars — tái dùng `shop.controller.ts` + `payments` (Telegram Stars).
  - 📺 Xem quảng cáo — `LobbyRewardedAdButton`; **server xác minh** ad hoàn tất rồi mới cấp.
  - 🎁 Theo kịch bản — đăng nhập ngày, hoàn thành nhiệm vụ, thưởng qua màn.

## 4. Dữ liệu Cấp độ + Admin (nghiên cứu: **KHẢ THI**)

Khả thi và *tự nhiên* sau khi làm §1 (map đã là dữ liệu, config đã thành dữ liệu).

### 4.1 Schema định nghĩa cấp độ (admin tạo, client fetch)

```
Level {
  id, order, name,
  map:        { shape, radius?, cells?, obstacles? }   // dữ liệu thuần
  rules:      MatchConfig-overrides                     // bot, tốc độ, totem…
  objectives: Objective[]                               // JSON có kiểu (§1.2)
  stars?:     StarCriteria[]                            // 1–3 sao (tùy chọn)
  powerups:   string[]                                  // loại power-up được phép
  energyCost: 1
  unlock:     { requires: levelId | stars >= N }
  rewards:    { coin, xp, energy }
}
```

Objective/unlock là **JSON có kiểu** → dễ cho admin, dễ versioning.

### 4.2 Tiến độ người chơi (Supabase)

Có tiền lệ `progression` (XP/level). Thêm bảng `player_level_progress { levelId, status,
stars, bestScore }`. **Mở khóa cấp kế kiểm ở backend** khi qua màn (không tin client).

### 4.3 Công cụ admin (theo yêu cầu)

- **Backend (`packages/server`)**: mở rộng `admin.controller.ts` → API CRUD cho Level,
  validate schema, versioning, publish.
- **Trình vẽ hex trực quan**: xây thành **frontend RIÊNG, tách khỏi domain backend** (backend
  chỉ cung cấp API). Admin "tô" ô chướng ngại/vùng trên lưới hex bằng chuột → xuất
  `cells/obstacles`. **Tái dùng toàn bộ toán hex + renderer hex** hiện có ⇒ khả thi cao.

## 5. Bảng khả thi & lộ trình

| Hạng mục | Khả thi | Phụ thuộc | Ước lượng |
|----------|:------:|-----------|-----------|
| **P0** Refactor `CONFIG` → `MatchConfig` | ✅ | — | Vừa |
| **P0** Trừu tượng `WinCondition`/Objective | ✅ | P0 config | Nhỏ–vừa |
| **P1** Practice + Tournament preset riêng | ✅ | P0 | Nhỏ |
| **P1** Ô chướng ngại như barrier (physics) | ✅ | P0 | Vừa |
| **P2** Hệ năng lượng (server + Supabase) | ✅ | packages/server | Vừa |
| **P2** Campaign: level select + power-up + play | ✅ | P0, P1, năng lượng | Vừa |
| **P3** Schema level + tiến độ + mở khóa (Supabase) | ✅ | packages/server | Vừa |
| **P3** Admin API (mở rộng `admin.controller.ts`) | ✅ | P3 | Nhỏ–vừa |
| **P3** Trình vẽ hex trực quan (frontend admin riêng) | ✅ | P3 API | Lớn (tái dùng renderer) |

**Thứ tự đề xuất:** P0 (nền, làm ngay trong repo) → P1 (Practice/Tournament + obstacle) →
P2 (năng lượng + Campaign play) → P3 (schema level + tiến độ + admin API, rồi trình vẽ trực quan).

## 6. Quyết định đã chốt trong buổi quy hoạch

- Chơi đơn → **Luyện tập** (config riêng: vẽ map, chỉnh bot, tốc độ…).
- Nhiều người → **Tournament** (map/config riêng phía server).
- Thêm **Cấp độ**: map/độ khó mỗi cấp, chọn power-up trước trận, **tốn 1 năng lượng/lượt**.
- **Năng lượng**: hồi theo thời gian, mua ở shop, xem quảng cáo, theo kịch bản — **server-authoritative**.
- **Admin**: backend (`packages/server`) cung cấp API; **trình vẽ hex trực quan là frontend
  riêng tách khỏi domain backend**, xây sau.
- **Backend = `packages/server`** (NestJS :8910, REST + ws, Supabase) — không dùng dịch vụ ngoài.

Xem thêm nghiên cứu hiệu năng render: [24-render-perf-research.md](24-render-perf-research.md).
