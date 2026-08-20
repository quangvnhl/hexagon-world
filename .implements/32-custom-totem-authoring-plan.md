# 32 — Kế hoạch VẼ TOTEM TÙY BIẾN trong trình vẽ cấp

> **Phạm vi:** tài liệu **thực thi**. Cho phép tác giả cấp **đặt totem tại ô cụ thể** (loại
> speed/slow/radar) trong trình vẽ admin, thay vì chỉ sinh ngẫu nhiên theo seed. Nền:
> [31](31-admin-editor-upgrade-plan.md) (Canvas toàn sân + obstacle) đã xong.

## 0. Hiện trạng (đã điều tra)

- **Totem hiện sinh NGẪU NHIÊN:** `createTotems(playable, seed, excluded, cfg)` (`totems.ts`) rải
  totem theo **số lượng** `rules.totems.{speedCount,slowCount,radarCount}` + seed, tránh tường/spawn.
  `state.ts` gọi trong constructor (dòng ~249) với `totemSpawnConfig()` từ `config.rules.totems`.
- **Kiểu:** `TotemKind = "speed" | "slow" | "radar"`; `TotemState = {id,kind,q,r,ownerId:-1}`.
- **Render:** client `GameScene` vẽ `game.totemStates()` → totem tác giả đặt sẽ **tự hiện** trong
  game + preview mà KHÔNG cần thêm code render phía client.
- **Trình vẽ:** hiện chỉ có obstacle (doc 31). Chưa đặt totem được.
- **Config:** `MatchMapConfig` có `obstacles?`/`cells?`; CHƯA có ô đặt totem tường minh. `CampaignLevelDraft.config`
  là `MatchConfigInput` ⇒ thêm `map.totems` sẽ tự chảy qua draft/DB.

## 1. Quyết định thiết kế (đề xuất — cần chốt trước T2/T3)

1. **Tác giả THAY THẾ ngẫu nhiên:** khi cấp có `map.totems` (≥1) → sim dùng **đúng** danh sách đó,
   BỎ sinh ngẫu nhiên. Vắng `map.totems` → giữ **nguyên** hành vi ngẫu nhiên (cấp cũ bất biến).
   *(Không trộn — để tác giả kiểm soát tuyệt đối; đơn giản, dễ đoán.)*
2. **Vị trí trong config:** thêm `MatchMapConfig.totems?: AuthoredTotem[]` với
   `AuthoredTotem = { kind: TotemKind; q: number; r: number }`. (Đặt cạnh `obstacles` — cùng là
   dữ liệu bố cục sân.)
3. **Ràng buộc ô:** totem phải ở **ô trong sân**; **một ô một totem**; ô totem **không** đồng thời là
   obstacle (loại trừ lẫn nhau trong trình vẽ). Sim lọc ô ngoài sân (như obstacle).
4. **Ownership:** totem tác giả bắt đầu **vô chủ** (`ownerId:-1`) — giống ngẫu nhiên.
5. **Đặt từng ô:** totem đặt **1 ô/lần** (không dùng cọ như obstacle) — chính xác.

## 2. Các lát công việc

| Lát | Tên | Effort | Sau |
|-----|-----|:------:|-----|
| **T1** | Shared: `AuthoredTotem` + `MatchMapConfig.totems` + `resolveMatchConfig` passthrough + `validateLevelDraft` (kind/toạ độ/trùng ô) | Đ | — |
| **T2** | Sim: `state.ts` dựng totem từ `map.totems` (lọc trong sân, deterministic) THAY ngẫu nhiên khi có; test thuần TS | V | T1 |
| **T3** | Trình vẽ: chọn công cụ Obstacle/Totem(+loại); đặt/gỡ totem trên canvas; `HexCanvas` vẽ marker totem; đếm theo loại; loại trừ obstacle | L | T1 |
| **T4** | Preview 2D hiện totem + cảnh báo `capture_totems` (totemGoal ≤ số totem) + cập nhật README/doc | Đ | T2,T3 |

### T1 — Mô hình dữ liệu + validate (shared)
- **Đụng:** `match-config.ts`: `export interface AuthoredTotem { kind: TotemKind; q: number; r: number }`
  (import `TotemKind` từ `totems.ts`); thêm `totems?: AuthoredTotem[]` vào `MatchMapConfig`;
  `resolveMatchConfig` thêm `totems: input.map?.totems`. `campaign.ts` `validateLevelDraft`: nếu có
  `config.map.totems` → mỗi phần tử kind ∈ {speed,slow,radar}, q/r số nguyên; không hai totem trùng ô.
- **Xong khi:** build shared xanh; test validate bắt kind sai/toạ độ sai/trùng ô.
- **Rủi ro:** thấp. **Nhớ:** rebuild `@hexagon/shared` để server/client/admin thấy type mới.

### T2 — Sim dựng totem tác giả
- **Đụng:** `state.ts` constructor: nếu `this.config.map.totems?.length` → map sang `TotemState[]`
  (lọc ô ∈ `this.playable`/trong sân, bỏ trùng, `ownerId:-1`, `id` tăng dần) và **bỏ** `createTotems`
  ngẫu nhiên; ngược lại giữ nhánh cũ. Giữ determinism (theo thứ tự input).
- **Xong khi:** GameState với `map.totems` sinh đúng totem đó; vắng thì y hệt cũ. Test: đặt 3 totem →
  `totemStates()` trả đúng 3, đúng kind/vị trí; ô ngoài sân bị loại.
- **Rủi ro:** vừa — đảm bảo `capture_totems` (đếm `totemsCaptured`) vẫn chạy; không phá spawn người chơi.

### T3 — Công cụ totem trong trình vẽ
- **Đụng:** `LevelEditor.tsx`: state `tool: "obstacle" | "totem"` + `totemKind`; model
  `totems: Map<HexKey, TotemKind>`. Thanh công cụ thêm nhóm chọn công cụ + loại totem + đếm theo loại.
  `HexCanvas`: prop `totems` (vẽ marker: màu/ký tự theo kind) + `tool`/`totemKind`; ở chế độ totem,
  click đặt/gỡ 1 ô (không cọ, không kéo-tô), chặn ô là obstacle (và ngược lại). `buildConfig`/`rowToForm`
  round-trip `map.totems`.
- **Xong khi:** chọn Totem→loại→click đặt; marker hiện; lưu/tải khớp; ô totem không trùng obstacle.
- **Rủi ro:** vừa — phân luồng sự kiện chuột (đặt totem vs pan vs tô obstacle) rõ ràng theo `tool`.

### T4 — Preview + validate UX + tài liệu
- **Đụng:** `Preview2D` truyền `totems` cho `HexCanvas readOnly` + chip "Totem: N (s/sl/r)". Cảnh báo
  khi `win.kind==="capture_totems"` mà `totemGoal > số totem tác giả`. README + doc này.
- **Xong khi:** preview hiện totem; cảnh báo goal hợp lý; tài liệu khớp.
- **Rủi ro:** thấp.

## 3. Thứ tự & phụ thuộc
```
T1 (data+validate) ─► T2 (sim) ─┐
T1 ─► T3 (editor) ──────────────┴► T4 (preview+doc)
```
**Khuyến nghị:** T1 → T2 (test thuần TS) → T3 → T4. Verify DB/tay sau (áp cấp có totem → chơi thử).

## 4. Ngoài phạm vi (hoãn)
- Chỉnh **bán kính/độ mạnh** từng totem (slowRadius, speedBonus) theo từng ô — vẫn dùng `rules.totems`.
- Totem có **chủ sẵn** / theo phe; totem di động; hiệu ứng mới.
- Cọ đặt totem hàng loạt; đối xứng/mirror.

## 5. Tiêu chí ĐÓNG
- Đặt/gỡ totem (speed/slow/radar) tại ô bất kỳ trong sân ở trình vẽ; lưu/tải round-trip.
- Cấp có `map.totems` → in-game sinh **đúng** totem đó (thay ngẫu nhiên); cấp cũ **bất biến**.
- `validateLevelDraft` bắt lỗi totem; `capture_totems` cảnh báo goal.
- Build cả 4 gói + test shared xanh.

## 6. Trạng thái thực thi (đã code)

| Lát | Trạng thái | Ghi chú |
|-----|:----------:|---------|
| **T1** | ✅ | `AuthoredTotem` + `MatchMapConfig.totems` + `resolveMatchConfig` passthrough; `validateLevelDraft` bắt kind/toạ độ/trùng ô. Test shared. |
| **T2** | ✅ | `state.ts`: có `map.totems` → dùng đúng danh sách (lọc trùng/ngoài sân), BỎ ngẫu nhiên; vắng → giữ ngẫu nhiên. Test: 3 tests mới. |
| **T3** | ✅ | `HexCanvas`: prop `totems`/`tool` + vẽ marker (màu+chữ T/C/R) + đặt/gỡ 1 ô. `LevelEditor`: công cụ 🧱/🔮, chọn loại, đếm; loại trừ obstacle↔totem; round-trip `map.totems`. |
| **T4** | ✅ | `Preview2D` hiện totem + cảnh báo `capture_totems` goal > số totem; README cập nhật. |
| **thêm** | ✅ | Campaign KHÔNG sinh totem ngẫu nhiên: `buildConfig` set `totemsEnabled=false`; catalog `CAMPAIGN_LEVELS` + migration `202608180006` tắt random (c3 có totem tường minh). |

**Build/test:** shared 130 + server 56 xanh; admin `vite build` + typecheck cả 4 gói xanh. Verify tay
(pane hiện): đặt totem trên canvas → footer đếm đúng (đã kiểm 3 totem). Chơi thử cần áp migration 006.

### Việc verify tay còn lại
- [ ] Áp migration `202608180006_campaign_totems_authored.sql` lên Supabase (tắt random + c3 authored).
- [ ] Hiện pane admin: 🔮 Totem → đặt vài totem → Publish → chơi `/campaign` thấy đúng totem, không có totem lạ.

---
Xem thêm: [31-admin-editor-upgrade-plan.md](31-admin-editor-upgrade-plan.md) · [25-game-modes-plan.md](25-game-modes-plan.md) · `packages/shared/src/totems.ts`.
