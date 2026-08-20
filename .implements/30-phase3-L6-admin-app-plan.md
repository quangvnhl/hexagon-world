# 30 — Kế hoạch L6: Tách trình vẽ cấp thành APP ADMIN RIÊNG

> **Phạm vi:** tài liệu **thực thi** (chia lát code). Hiện thực **L6** của
> [29-phase3-level-authoring-plan.md](29-phase3-level-authoring-plan.md) — chuyển trình vẽ cấp
> (`/admin/levels`) từ **trong game client** ra **một frontend admin RIÊNG**, đúng chủ trương
> [25-game-modes-plan.md](25-game-modes-plan.md) §4.3 ("trình vẽ hex trực quan là frontend riêng,
> tách khỏi domain backend"). Nền: P3 L1–L5 đã xong (schema + admin API + trình vẽ chạy trong client).

## 0. Vì sao tách (giá trị) & hiện trạng

**Giá trị:** (1) **cô lập** — công cụ admin KHÔNG nằm trong bundle/domain người chơi (giảm bề mặt tấn
công, không lộ endpoint admin trên trang game); (2) **deploy + kiểm soát truy cập riêng** (mạng nội bộ /
subdomain / IP allowlist); (3) **bundle game nhỏ hơn** (bỏ code admin khỏi client).

**Hiện trạng (L5):** trình vẽ ở `packages/client`:
- `app/admin/levels/page.tsx` → `src/components/LevelEditor.tsx` (form + lưới SVG obstacle + "Xem thử"
  bằng `GameScene`).
- API admin ở `src/lib/backend.ts`: `adminListLevels/adminUpsertLevel/adminPublishLevel` (+ `json`, `API_URL`),
  gửi header **`x-admin-key`** → server so `sha256` với `ADMIN_API_KEY_SHA256`.
- Dùng `@hexagon/shared`: `axialToPixel`, `key`, `validateLevelDraft`, các type.
- Server CORS: `corsAllowedOrigins` (mặc định origin của `GOOGLE_OAUTH_POST_LOGIN_REDIRECT_URI` = `:3890`).

## 1. Quyết định thiết kế (cần chốt trước L6a/L6b)

1. **Framework app admin:** đề xuất **Vite + React + TS** (SPA thuần, không cần SSR, build nhẹ/nhanh,
   không kéo Next). *Đánh đổi:* Next giữ đồng bộ với client nhưng nặng hơn cho một tool nội bộ.
2. **"Xem thử" (preview):** app admin **KHÔNG kéo R3F/GameScene** (nặng, gắn chặt client). Đề xuất
   **preview 2D nhẹ**: tái dùng lưới SVG hex sẵn có để vẽ **bố cục obstacle + tóm tắt config/objective**
   (không sim sống). Ai cần thử-chơi thật thì Publish (nháp) rồi mở `/campaign`. *(Giữ 3D preview chỉ khi
   chấp nhận phụ thuộc R3F trong app admin — không khuyến nghị.)*
3. **Xác thực:** giữ **`x-admin-key`** (đơn giản, đã có). Tăng cứng: CORS allowlist đúng origin admin +
   cho header `x-admin-key` qua preflight; (tùy) rate-limit endpoint admin; (tùy) IP allowlist ở reverse proxy.
   RBAC/đăng nhập admin đầy đủ = ngoài phạm vi.
4. **Client dùng chung API:** tách một **admin API client tối giản** (3 hàm + `API_URL`) đặt trong app admin
   (không phụ thuộc `packages/client`). `validateLevelDraft` + toán hex vẫn lấy từ `@hexagon/shared`.
5. **Domain/deploy:** app admin chạy origin RIÊNG (vd `:3899` dev, subdomain `admin.*` prod) → thêm vào
   `CORS_ALLOWED_ORIGINS`. Không phục vụ chung host game.

## 2. Các lát công việc

| Lát | Tên | Effort | Sau |
|-----|-----|:------:|-----|
| **L6a** | Scaffold `packages/admin` (Vite+React+TS) + workspace dep `@hexagon/shared` + env `VITE_API_URL` | V | — |
| **L6b** | Chuyển `LevelEditor` + lưới hex + admin API client vào `packages/admin`; đổi "Xem thử" → preview 2D | V | L6a |
| **L6c** | Server: CORS cho origin admin + header `x-admin-key`; (tùy) rate-limit admin; tài liệu env | Đ | — |
| **L6d** | Gỡ `/admin/levels` + `LevelEditor` + helper admin khỏi `packages/client` (giữ `validateLevelDraft` ở shared) | Đ | L6b |
| **L6e** | Wiring build/deploy: script `dev:admin`/`build:admin`, root scripts, hướng dẫn deploy riêng | Đ | L6a |

### L6a — Scaffold app admin
- **Đụng:** `packages/admin/` mới: `package.json` (`@hexagon/admin`, deps: react/react-dom/vite/@vitejs/plugin-react,
  `@hexagon/shared: workspace:*`), `vite.config.ts`, `tsconfig.json`, `index.html`, `src/main.tsx`, `src/App.tsx`.
  Env `VITE_API_URL` (mặc định `http://localhost:8910`). Cổng dev vd 3899.
- **Xong khi:** `pnpm --filter @hexagon/admin dev` chạy, trang trắng "Admin" render; import được `@hexagon/shared`.
- **Rủi ro:** thấp — chú ý `pnpm-workspace` đã gồm `packages/*` nên tự nhận; allowBuilds không cần thêm.

### L6b — Chuyển trình vẽ sang app admin
- **Đụng:** copy logic `LevelEditor.tsx` (form + `EDIT_CELLS`/`hexPoints`/`toDraft`/`validateLevelDraft`) vào
  `packages/admin/src/LevelEditor.tsx`. Thêm `src/api.ts` tối giản: `API_URL`, `json()`, `adminListLevels/
  adminUpsertLevel/adminPublishLevel` (header `x-admin-key`). **Bỏ** `GameScene`; thay "Xem thử" bằng panel
  **preview 2D**: cùng lưới SVG + nhãn objective/bot/mạng/thưởng.
- **Xong khi:** app admin: nhập key → tải danh sách → tô obstacle → validate → Publish → cấp xuất hiện ở `/campaign`.
- **Rủi ro:** vừa — preview 2D thay 3D là hạ cấp có chủ ý; giữ đủ thông tin để dựng cấp đúng.

### L6c — CORS + tăng cứng server
- **Đụng:** đảm bảo `CORS_ALLOWED_ORIGINS` gồm origin admin; cấu hình CORS cho **header `x-admin-key`** +
  method `GET/POST/PUT/DELETE` ở preflight (kiểm `main.ts`/nơi bật CORS). (Tùy) rate-limit route
  `internal/v1/admin/*`. Không cần cookie ⇒ không bật credentials cho origin admin.
- **Xong khi:** app admin gọi API xuyên origin không lỗi CORS; header key qua được preflight.
- **Rủi ro:** vừa — CORS/preflight dễ sai; test bằng gọi thật từ app admin.

### L6d — Gỡ admin khỏi game client
- **Đụng:** xóa `packages/client/app/admin/levels/page.tsx`, `src/components/LevelEditor.tsx`, và 3 helper
  admin + `AdminLevelRow` trong `src/lib/backend.ts`. Giữ nguyên `validateLevelDraft` ở `@hexagon/shared`
  (dùng bởi app admin + có thể server). Kiểm client vẫn build; bundle không còn code admin.
- **Xong khi:** game client không còn route/`/admin`; `next build` xanh; không ai vào admin từ domain game.
- **Rủi ro:** thấp — xóa thuần; đảm bảo không còn import lạc.

### L6e — Build/deploy
- **Đụng:** `packages/admin/package.json` scripts `dev`/`build`/`typecheck`; root `dev:admin`/`build:admin`
  (KHÔNG gộp admin vào `build` mặc định của game để deploy độc lập). README/hướng dẫn: env `VITE_API_URL`,
  `ADMIN_API_KEY_SHA256` (server), `CORS_ALLOWED_ORIGINS` thêm origin admin, deploy host riêng.
- **Xong khi:** build ra tĩnh app admin; tài liệu đủ để deploy tách khỏi game.
- **Rủi ro:** thấp.

## 3. Thứ tự & phụ thuộc
```
L6a (scaffold) ─► L6b (chuyển editor) ─► L6d (gỡ khỏi client)
L6c (CORS) ─────────────────────────────► (chạy xuyên origin)
L6a ─► L6e (build/deploy)
```
**Khuyến nghị:** L6a → L6b → **L6c** (mở CORS để app admin gọi được) → kiểm smoke đầu-cuối → **L6d** (gỡ
khỏi client) → L6e (deploy). Gỡ khỏi client (L6d) **làm sau khi** app riêng đã chạy ổn.

## 4. Ngoài phạm vi L6 (hoãn)
- RBAC/đăng nhập admin nhiều người + **audit log** thay đổi cấp.
- 3D preview trong app admin (giữ 2D); map hình lõm/custom-cells; StarCriteria theo dữ liệu.
- CI/CD riêng cho app admin (chỉ tài liệu deploy thủ công ở L6e).

## 5. Tiêu chí ĐÓNG L6
- Trình vẽ chạy ở **app admin riêng** (origin khác), CRUD/publish cấp OK; game client **không còn** code/route admin.
- CORS + `x-admin-key` hoạt động xuyên origin; server không phục vụ admin trên domain game.
- `@hexagon/shared` (`validateLevelDraft` + toán hex) dùng chung; build cả 3 app + admin xanh.
- Campaign người chơi (`/campaign`) đọc cấp từ DB **bất biến** so với L5.

## 6. Trạng thái thực thi (đã code)

| Lát | Trạng thái | Ghi chú |
|-----|:----------:|---------|
| **L6a** | ✅ | `packages/admin` scaffold (Vite 6 + React 19 + TS), cổng 3899, dep `@hexagon/shared`. Vite `commonjsOptions.include`+`optimizeDeps` để đọc named export từ CJS dist. Root `dev:admin`/`build:admin`. |
| **L6b** | ✅ | `src/api.ts` (x-admin-key, `VITE_API_URL`) + `src/LevelEditor.tsx` (port, bỏ R3F). "Xem thử" = **preview 2D** (`HexGrid` dùng chung + chip tóm tắt). Verify tay ở Vite dev 3899. |
| **L6c** | ✅ | `.env.example` + `.env` local thêm `:3899` vào `CORS_ALLOWED_ORIGINS`. KHÔNG đổi code server — cors mặc định đã phản chiếu `x-admin-key` + đủ method (kiểm OPTIONS thật: origin allowed → 204 `Allow-Headers: x-admin-key`). |
| **L6d** | ✅ | Xóa `app/admin/levels/page.tsx`, `src/components/LevelEditor.tsx`, helper admin + `AdminLevelRow` trong client. `next build` xanh (7 route, hết `/admin/levels`), client test 58/58. |
| **L6e** | ✅ | Scripts `dev`/`build`/`preview`/`typecheck` cho admin; root `dev:admin`/`build:admin` (ngoài `build` mặc định). `packages/admin/README.md` + `.env.example`. `.gitignore` bỏ `dist/` admin, giữ `.env.example`. |

**Build/test sau L6:** admin `tsc --noEmit` + `vite build` xanh; client `next build` xanh + 58/58; shared/server không đổi.

### Việc verify tay còn lại (cần môi trường chạy)
- [ ] Thêm `:3899` vào `CORS_ALLOWED_ORIGINS` trong `.env` local **và RESTART server** (server đang chạy còn dùng allowlist cũ ⇒ origin admin bị chặn 500 tới khi restart).
- [ ] Đặt `ADMIN_API_KEY_SHA256` phía server; nhập token gốc ở app admin → **Tải danh sách** phải trả 200 (không lỗi CORS).
- [ ] Tạo/sửa 1 cấp nháp → Publish → mở `/campaign` game client thấy cấp mới (đọc từ DB, bất biến so với L5).
- [ ] (Tùy) deploy `packages/admin/dist` lên host riêng với `VITE_API_URL` production.

> **Tiếp nối:** nâng cấp trình vẽ (Canvas toàn sân, sửa cấp, UI toàn màn hình) ở
> [31-admin-editor-upgrade-plan.md](31-admin-editor-upgrade-plan.md).

---
Xem thêm: [31-admin-editor-upgrade-plan.md](31-admin-editor-upgrade-plan.md) · [29-phase3-level-authoring-plan.md](29-phase3-level-authoring-plan.md) · [25-game-modes-plan.md](25-game-modes-plan.md) §4.3 · [05-roadmap.md](05-roadmap.md).
