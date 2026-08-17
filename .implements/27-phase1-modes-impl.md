# 27 — Kế hoạch TRIỂN KHAI P1: Practice / Tournament / nền Campaign

> **Phạm vi:** tài liệu **thực thi** (chia lát code, mỗi lát có tiêu chí "xong"). Hiện thực
> **P1** của [25-game-modes-plan.md](25-game-modes-plan.md) trên nền **P0 đã xong** (`MatchConfig`
> / `WinCondition` / `ArenaGeometry` per-instance — đã commit "Pha5"). Dành cho: Gameplay +
> Backend + Frontend.
>
> **Nguồn:** doc 25 §2 (ba mode), §1.2 (WinCondition), §1.3 (obstacle barrier), §5 (bảng P1).
> Trạng thái nền: [05-roadmap.md](05-roadmap.md) "Pha 5 — wave 2".

## 0. Tiền đề (đã có, không phải làm lại)

- `MatchConfig` + `resolveMatchConfig()` — mọi default = `CONFIG` ⇒ không truyền gì = hành vi cũ.
  Contract đã khai đủ: `map{shape,radius,wallScale,hexSize,mapMargin,cells?,obstacles?}`,
  `bots{count,difficultyMix?}`, `rules{...}`, `win{kind,kingPct,winHoldTime,targetPct?,durationSec?,totemGoal?}`, `seed`. (`match-config.ts`)
- `GameState` nhận 1 object `GameStateOptions{humanCount,spawnAt,config}` (`state.ts:188`); đọc luật
  từ `this.config`, hình học từ `this.arena` (`ArenaGeometry`).
- `checkWin` (`state.ts:915`) đã rẽ theo `config.win.kind`: `none` = endless; `king_hold` = mặc định.
  **Các evaluator `territory_pct`/`survive`/`capture_totems` mới là KHAI BÁO, chưa cắm.**
- Call-site dựng `GameState`: server `game-room.ts:51`; client `NetGameScene.tsx:59` (chỉ truyền
  `bots.count`), `GameScene.tsx:266` (không truyền gì).

## 1. Nguyên tắc thực thi

1. **Bất biến P0:** không truyền config ⇒ hành vi Y HỆT. Mỗi lát phải giữ 171/171 test cũ xanh
   *trước khi* thêm test mới.
2. **Test-first cho logic shared:** mọi thay đổi `state.ts`/`match-config.ts`/`arena.ts` kèm test
   vitest (deterministic) trước khi wiring UI.
3. **Mỗi lát tự đóng:** build (`nest build` + `next build`) xanh + test xanh + mô tả "xong" đạt →
   mới sang lát sau. Không gộp nhiều lát vào 1 commit lớn.
4. **Server-authoritative giữ nguyên:** client chỉ *dựng lại view* từ config server gửi (Tournament),
   không tự quyết luật.

## 2. Các lát công việc

Ký hiệu: **Đ.dễ / V.vừa / K.khó** · phụ thuộc ghi ở cột "Sau".

| Lát | Tên | Effort | Sau |
|-----|-----|:------:|-----|
| **S1** | Practice preset cơ bản (`/play`, `win=none` + chỉnh số bot) | Đ | — |
| **S2** | Mở rộng `MatchRules` → totem + tốc độ + profile AI (dọn nợ P0) | V | — |
| **S3** | Evaluator `WinCondition`: `territory_pct` / `survive` / `capture_totems` | V | — |
| **S4** | Hợp nhất luật thắng `GameState.checkWin` ↔ `GameRoom.stepTick` | V | S3 |
| **S5** | Serialize `MatchConfig` qua protocol (welcome) | V | — |
| **S6** | Tournament preset (`/netplay`) — server dựng `MatchConfig`, client view khớp | V | S5 |
| **S7** | Ô chướng ngại như barrier (physics + flood fill + render) | K | S2 |

### S1 — Practice preset cơ bản

**Mục tiêu:** tách chơi-đơn `/play` thành **Luyện tập cấu hình được**; bước đầu chỉ 2 trục an toàn:
điều kiện thắng `none` (endless, đã có) + chọn **số bot** (kể cả 0).

- **Đụng:**
  - `packages/client/src/config/` (mới) hoặc `packages/shared/src/match-config.ts`: thêm hằng
    `practiceConfigInput: MatchConfigInput` (ví dụ `{ win: { kind: "none" }, bots: { count } }`).
  - `GameScene.tsx:266`: `new GameState()` → `new GameState({ config: practiceConfig })`.
  - UI `StartPanel`/Practice: slider số bot → truyền vào config khi tạo ván.
- **Test:** `state.test` — ván `win.kind="none"` chạy quá `winHoldTime` **không** set `won`; `bots.count=0`
  ⇒ `players.length === humanCount`.
- **Xong khi:** vào `/play`, chỉnh số bot (0..N) áp đúng, không bao giờ hiện màn thắng; test xanh.
- **Rủi ro:** thấp. Không đụng netcode.

### S2 — Mở rộng `MatchRules` (dọn nợ P0 #1)

**Mục tiêu:** đưa cấu hình **TOTEM** + **profile tốc độ/AI bot** vào `MatchConfig.rules` để Practice/
Campaign chỉnh riêng. Hiện các phần này còn đọc thẳng `CONFIG` (chia sẻ với `totems.ts`).

- **Đụng:**
  - `match-config.ts`: `MatchRules` thêm `speed`, `botSpeed?`, totem (`totemEnabled`, `totemInterval`,
    `totemDurations`…) — default = `CONFIG`.
  - `state.ts` + `totems.ts`: đọc từ `this.config.rules` thay vì `CONFIG` cho các trường này.
    `createTotems(playable, seed)` → nhận thêm tham số totem-config.
- **Test:** default (không override) ⇒ totem sinh **giống hệt** bản cũ (so số lượng/vị trí theo seed);
  override `speed` đổi quãng đường/tick đúng tỉ lệ.
- **Xong khi:** Practice chỉnh được tốc độ + bật/tắt totem; totem mặc định bất biến; test xanh.
- **Rủi ro:** vừa — `totems.ts` deterministic dùng chung server/client, phải giữ seed-parity.

### S3 — Evaluator `WinCondition`

**Mục tiêu:** cắm 3 evaluator còn khai báo suông. Đặt trong `checkWin` (`state.ts:915`) rẽ nhánh theo `kind`.

- **Đụng:** `state.ts` `checkWin`:
  - `territory_pct`: `if (territoryPct(selfOrKing) >= win.targetPct) won`. (đã có `territoryPct()`.)
  - `survive`: đếm ngược `durationSec`; hết giờ mà self còn sống ⇒ `won` (Campaign/solo).
  - `capture_totems`: đếm totem thu được của self ≥ `totemGoal`. (cần counter totem/entity — kiểm tra
    `Entity` đã đếm chưa; nếu chưa, thêm `totemsCaptured`.)
- **Test:** mỗi kind một ca đạt & một ca chưa đạt (deterministic, bơm trạng thái trực tiếp).
- **Xong khi:** 3 kind cho kết quả đúng qua test; `king_hold`/`none` không đổi.
- **Rủi ro:** vừa — `capture_totems` có thể phải thêm counter; `survive`/`territory_pct` xác định "chủ thể"
  (self trong solo vs KING trong đấu) — chốt: đánh giá theo **self** cho solo, theo KING nếu không có self.

### S4 — Hợp nhất luật thắng server ↔ shared (dọn nợ P0 #3)

**Vấn đề:** `GameRoom.stepTick` (`game-room.ts:242-284`) **tự chạy king-countdown riêng** và liên tục
ép `gs.won=false` để vô hiệu hóa `checkWin` của GameState — hai nguồn luật song song, dễ lệch.

- **Cách:** cho `GameRoom` **ủy quyền** cho `GameState.checkWin` bằng cách truyền `MatchConfig.win`
  đúng (Tournament = `king_hold` với `winHoldTime = kingDurationSeconds`), bỏ khối đè `won=false`.
  Giữ phần "đấu loại 1 người sống → thắng ngay" (đã có cả 2 nơi — hợp nhất về `checkWin` nhánh (a)).
- **Test:** server integration — kịch bản KING giữ ngôi đủ giờ ⇒ `won`; đổi King ⇒ reset; 1 người sống ⇒
  thắng ngay. Khớp hành vi hiện tại (không hồi quy Pha 4).
- **Xong khi:** `stepTick` không còn tự quản countdown song song; test server (49) + integration xanh.
- **Rủi ro:** vừa–cao — chạm luật thắng online đã "đóng" ở Pha 4. **Làm sau S3, có test integration bọc.**

### S5 — Serialize `MatchConfig` qua protocol

**Mục tiêu:** để Tournament (S6) dựng view client **khớp** server, `welcome` phải mang `MatchConfig`
(hiện client chỉ nhận `botCount`).

- **Đụng:**
  - `protocol.ts`: thêm serialize/deserialize `MatchConfig` (JSON gói trong control-frame là đủ cho MVP —
    tần suất 1 lần/join; không cần binary chặt như snapshot). Bump protocol version.
  - `net-server.ts` `sendJoinState`/welcome: kèm config đang chạy của phòng.
  - `NetGameScene.tsx:59`: dựng `new GameState({ config })` từ config nhận được thay vì chỉ `bots.count`.
- **Test:** round-trip `resolveMatchConfig(x)` → serialize → deserialize **bằng** `x`; version mismatch đóng 4002.
- **Xong khi:** client `/netplay` dựng GameState từ config server; protocol version khớp; test xanh.
- **Rủi ro:** vừa — đổi protocol ⇒ phải cập nhật `test/load/protocol.mjs` (bản sao) + client/server đồng bộ version.

### S6 — Tournament preset

**Mục tiêu:** `/netplay` chạy bằng **`tournamentConfig` server-side**; client chỉ render theo config nhận.

- **Đụng:**
  - `game-room.ts:51`: dựng `GameState` từ `tournamentConfig` (thay vì ghép rời `bots.count`+`seed`).
    Constructor `GameRoom` nhận `MatchConfig` thay cho các param lẻ (`botCount`, `kingDurationSeconds`…).
  - Preset `tournamentConfig` = `king_hold`, `winHoldTime = kingDurationSeconds`.
  - Dựa S5 để client khớp.
- **Test:** server dựng phòng từ preset; snapshot/territory vẫn đúng; e2e client-predict không drift.
- **Xong khi:** Tournament chạy hoàn toàn qua `MatchConfig`; không còn param sân/luật rời trong `GameRoom`.
- **Rủi ro:** vừa — chạm hàm khởi tạo phòng; cần S4 (luật thắng gọn) + S5 (serialize) trước.

### S7 — Ô chướng ngại như barrier (doc 25 §1.3)

**Mục tiêu:** map có **ô chướng ngại nội bộ** chặn di chuyển + chặn flood fill, **giữ biên lục giác lồi**
(chưa cần collision lõm tổng quát). `MatchMapConfig.cells`/`obstacles` đã khai sẵn nhưng
`ArenaGeometry.mapArena` hiện **bỏ qua** chúng.

- **Đụng:**
  - `arena.ts`: `mapArena` xét `cells` (nếu `shape="custom"`) + loại `obstacles`. Thêm khái niệm ô
    **không đi được** (obstacle set) tách khỏi biên lồi.
  - `state.ts`:
    - Di chuyển: sau `slideMove`/clamp, nếu `currentHex` rơi vào obstacle ⇒ chặn (giữ vị trí cũ / trượt).
      Cần một bước rời rạc vì physics lồi không biết barrier nội bộ.
    - Flood fill `captureEnclosed`: đưa obstacle vào tập **barrier** (cùng owned∪trail) để không tràn qua.
    - `playable`/`map`/`totem spawn`/`pickSpawnHex` loại obstacle.
  - Render: `BorderRim`/`HexGridView` vẽ obstacle (hoặc lỗ) — tái dùng renderer hex.
- **Test:** đầu đâm obstacle **không** xuyên; flood fill **không** chiếm qua obstacle; spawn/totem không rơi
  vào obstacle. Map hexagon thuần (không obstacle) ⇒ bất biến.
- **Xong khi:** map thử có vài obstacle chạy đúng cả physics + fill + render; test xanh.
- **Rủi ro:** cao — chạm code nóng mỗi-tick (movement) + flood fill. Làm **cuối P1**, sau khi S2 ổn định.

## 3. Thứ tự đề xuất & phụ thuộc

```
S1 (Practice) ─────────────► giao được sớm (thấp rủi ro, tách mode /play)
S2 (rules mở rộng) ─┬──────► mở khóa Practice chỉnh tốc/totem  ─┐
S3 (evaluators) ────┼─► S4 (dedup win) ─┐                       │
S5 (serialize) ─────┴───────────────────┴─► S6 (Tournament)     │
                                                                └─► S7 (obstacle, cuối)
```

**Khuyến nghị chạy tuần tự:** **S1 → S2 → S3 → S4 → S5 → S6 → S7.** S1 giao "mode Luyện tập" ngay;
S2–S4 làm giàu luật + dọn nợ; S5–S6 lên Tournament; S7 (rủi ro cao nhất) cuối cùng khi nền đã vững.
Có thể song song: **S1/S2** (client) độc lập với **S5** (protocol) nếu chia người.

## 4. Ngoài phạm vi P1 (để P2/P3 — doc 25 §2.3, §3, §4)

- Hệ **năng lượng** server-authoritative; **Campaign** (level select + power-up trước trận).
- **Schema Level** + tiến độ Supabase + **admin API** + trình vẽ hex trực quan.
- Collision hình **lõm** tổng quát (S7 chỉ làm obstacle-as-barrier, giữ biên lồi).

## 5. Tiêu chí ĐÓNG P1

- `/play` = **Luyện tập** cấu hình được (map/bot/tốc độ/totem/`win=none`).
- `/netplay` = **Tournament** chạy hoàn toàn qua `MatchConfig` server-side, client view khớp qua protocol.
- 3 evaluator `WinCondition` hoạt động; luật thắng **một nguồn** (`checkWin`), không còn song song ở `GameRoom`.
- Obstacle-as-barrier chạy đúng physics + flood fill + render trên map thử.
- Build monorepo xanh; test tăng so với 171 (mỗi lát thêm ca); **map hexagon thuần bất biến** (không hồi quy P0/Pha 4).

## 6. Rủi ro & giảm thiểu

| Rủi ro | Giảm thiểu |
|--------|-----------|
| Đổi protocol (S5) phá client/harness | Bump version + cập nhật `test/load/protocol.mjs`; round-trip test |
| Đụng luật thắng online đã "đóng" (S4/S6) | Test integration bọc trước; làm sau khi evaluator (S3) ổn |
| Movement + flood fill nóng mỗi-tick (S7) | Làm cuối; test đầu-đâm-obstacle & fill; giữ nhánh hexagon bất biến |
| Seed-parity totem lệch server/client (S2) | Test so số lượng/vị trí totem theo seed giữa 2 lần dựng |

---
Xem thêm: quy hoạch mode [25-game-modes-plan.md](25-game-modes-plan.md) · nền P0 & trạng thái
[05-roadmap.md](05-roadmap.md) · nghiên cứu render [24-render-perf-research.md](24-render-perf-research.md).
