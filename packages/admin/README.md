# @hexagon/admin — Trình vẽ cấp Campaign (app admin RIÊNG)

Frontend admin tách khỏi game client (doc [30](../../.implements/30-phase3-L6-admin-app-plan.md)).
SPA thuần **Vite + React + TS**, KHÔNG SSR, KHÔNG kéo R3F. Chỉ chứa trình vẽ cấp
Campaign: tô ô chướng ngại + form objective/thưởng/unlock → **Lưu + Publish**.

## Vì sao tách riêng
- **Cô lập:** công cụ admin không nằm trong bundle/domain người chơi (giảm bề mặt tấn công).
- **Deploy + kiểm soát truy cập riêng** (mạng nội bộ / subdomain / IP allowlist ở proxy).
- **Bundle game nhỏ hơn.**

## Chạy local (dev)
```bash
# 1) Server game phải chạy (cổng 8910) và .env có :3899 trong CORS_ALLOWED_ORIGINS.
pnpm dev:server

# 2) App admin (cổng 3899)
pnpm dev:admin           # = pnpm --filter @hexagon/admin dev
```
Mở http://localhost:3899 → nhập **ADMIN KEY** (khớp `ADMIN_API_KEY_SHA256` phía server)
→ **Tải danh sách** → chọn **Sửa** một cấp (hoặc **+ Mới**) → **Lưu + Publish**. Cấp published
hiện ở `/campaign` trong game client.

### Thao tác bản đồ (Canvas toàn sân — doc 31)
- **Vẽ toàn sân thật:** bản đồ hiển thị đúng toàn bộ sân lục giác theo *bán kính sân* của cấp
  (mặc định 130 ≈ 16.6k ô), không còn giới hạn quanh tâm.
- **Tô obstacle:** giữ chuột trái **kéo-tô**; **Alt+trái** hoặc **chuột phải kéo** để xóa. Chọn
  **cỡ cọ** (1–4) ở thanh dưới để tô nhanh nhiều ô. Chỉ tô được ô nằm trong sân.
- **Di chuyển (pan):** giữ **Space + kéo**, hoặc **chuột giữa/phải kéo**. **Cuộn** để zoom quanh
  con trỏ. Nút **Fit** canh vừa toàn sân.
- **Bán kính sân:** ô *Bán kính sân* trong form (≤150) → thu nhỏ sân (vd 20) để dựng cấp maze gọn,
  vừa màn hình. Áp dụng khi **rời ô nhập / Enter** (không đổi từng phím). Thu nhỏ sẽ **cắt**
  obstacle/totem rơi ngoài sân mới (khớp hành vi sim).
- **Totem (admin tự vẽ — doc 32):** chọn công cụ **🔮 Totem** + loại (⚡ Tốc / 🐌 Chậm / 📡 Radar),
  **bấm 1 ô** để đặt/gỡ (marker màu hiện trên bản đồ). Campaign **KHÔNG** sinh totem ngẫu nhiên
  nữa — chỉ có totem admin đặt. Ô totem không trùng ô chướng ngại.
- **Hiện đường collider (doc 33):** ô chọn trong form → in-game vẽ đường viền va chạm của obstacle
  (vàng) + biên sân (đỏ) để thấy rõ mặt trượt. Obstacle nay cho 3D object **trượt** dọc viền
  (không còn kẹt).
- **Panel key** (trên-trái) **thu gọn** được (▾/▸, nhớ trạng thái); **form thông tin** cố định phải.

> **Xem thử (2D):** preview tĩnh — canvas sân + obstacle (đọc-thôi) + tóm tắt luật, KHÔNG mô phỏng
> trận. Muốn thử-chơi thật: Publish (nháp) rồi mở `/campaign` trong game client.

## Cấu hình

| Biến | Nơi đặt | Ý nghĩa |
|------|---------|---------|
| `VITE_API_URL` | app admin (`packages/admin/.env.local`) | URL server game admin gọi tới. Mặc định `http://localhost:8910`. |
| `ADMIN_API_KEY_SHA256` | **server** (`.env`) | SHA-256 (lowercase) của admin token. App gửi token gốc ở header `x-admin-key`; server so hash. |
| `CORS_ALLOWED_ORIGINS` | **server** (`.env`) | Phải chứa origin app admin (dev: `http://localhost:3899`). |

Tạo hash admin token:
```bash
node -e "console.log(require('crypto').createHash('sha256').update(process.argv[1]).digest('hex'))" "YOUR_ADMIN_TOKEN"
```

## Build & deploy (tách khỏi game)
```bash
pnpm build:admin         # = pnpm --filter @hexagon/admin build → packages/admin/dist (tĩnh)
```
- `dist/` là site tĩnh — deploy lên **host RIÊNG** (subdomain nội bộ, sau reverse proxy /
  IP allowlist). KHÔNG phục vụ chung host game.
- Đặt `VITE_API_URL` (build-time) trỏ tới origin server thật.
- Thêm origin admin production vào `CORS_ALLOWED_ORIGINS` của server.
- `build:admin` **KHÔNG** nằm trong `pnpm build` mặc định → deploy độc lập với game.
