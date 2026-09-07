# Ops API — runbook khoá, phạm vi và vết kiểm toán

> Lát `c2.1-ops-api-keys` (doc 35 §C2). Đây là bộ API vận hành mà **người** và **AI agent** dùng
> ngang hàng nhau. Trước lát này, cả 9 endpoint dùng chung đúng một chuỗi `x-admin-key`.

## Chuỗi dùng chung cũ tự chết như thế nào

Cổng đóng Pha 6 đòi *"`x-admin-key` dùng chung **đã bị gỡ**"*. Nhưng phải có đường vào để tạo khoá
đầu tiên, nếu không thì gỡ xong là tự khoá mình ra ngoài.

Cách giải: `ADMIN_API_KEY_SHA256` vẫn dùng được, **nhưng chỉ khi `ops_api_keys` chưa có khoá nào còn
hiệu lực**. Tạo khoá thật đầu tiên chính là hành động gỡ chuỗi dùng chung — không có biến môi trường
nào để quên tắt, không cần ai nhớ đi dọn.

```
chưa có khoá thật  →  chuỗi cũ dùng được  →  tạo khoá đầu tiên  →  chuỗi cũ chết ngay
```

Thu hồi hết khoá thật thì chuỗi cũ **sống lại** — đó là đường thoát hiểm khi mất hết khoá, và cũng
là lý do `ADMIN_API_KEY_SHA256` phải tiếp tục được giữ bí mật.

## Tạo khoá đầu tiên

```bash
curl -X POST "$API/internal/v1/admin/ops/keys" \
  -H "x-admin-key: $CHUOI_ADMIN_CU" \
  -H "Idempotency-Key: $(uuidgen)" \
  -H "content-type: application/json" \
  -d '{"name":"nguoi-van-hanh","actorKind":"human","scopes":["players:read","players:write","wallet:write","catalog:write","levels:read","levels:write","levels:publish","audit:read","keys:read","keys:write","ops:admin"]}'
```

Đáp lại chứa `key` — **chuỗi này chỉ hiện đúng một lần**. Server lưu hash, không lưu khoá; mất là
phải thu hồi và tạo lại. Dán nó vào ô khoá của trình vẽ admin (header không đổi tên nên
`packages/admin` chạy nguyên, không cần bản mới).

## Tạo khoá cho AI agent

Doc 35 §C2 rủi ro: agent chạy **read-only trong 2 tuần đầu**. Khoá đầu tiên của agent nên là:

```json
{
  "name": "agent-doc-so",
  "actorKind": "agent",
  "scopes": ["players:read", "levels:read", "analytics:read", "audit:read"],
  "dailyLimits": { "calls": 200 },
  "expiresAt": "2026-10-01T00:00:00Z"
}
```

Không truyền `dailyLimits` thì khoá `agent` nhận mặc định `{"calls": 200, "coin_granted": 50000}` —
mặc định có trần, không phải mặc định vô hạn.

> ⚠️ Mở phạm vi **ghi** cho agent là hạng mục doc 35 §10 ghi rõ **phải xin xác nhận trước khi bật**.

## Phạm vi

| Phạm vi | Cho phép |
|---|---|
| `players:read` / `players:write` | đọc hồ sơ · xoá mềm tài khoản |
| `wallet:write` | cấp coin |
| `catalog:write` | đổi giá · đổi vật phẩm mặc định |
| `config:write` | remote config (dành cho C2.3+) |
| `levels:read` / `levels:write` / `levels:publish` | trình vẽ cấp chiến dịch |
| `bans:write` | khoá tài khoản (dành cho C3) |
| `analytics:read` | truy vấn phân tích (dành cho C2.3) |
| `audit:read` · `keys:read` · `keys:write` | tự quản Ops API |
| `ops:admin` | dọn dữ liệu, thao tác hệ thống |

`scopes: []` = khoá **không làm được gì**. Đó là mặc định đúng: quên gán phạm vi phải ra khoá vô
dụng, không phải khoá toàn quyền.

`*` chỉ tồn tại cho khoá bootstrap và **không cấp được qua API** — `sanitizeScopes` loại bỏ nó.

## Bốn luật mà code thi hành, không phải quy ước

1. **Endpoint quên `@Ops({...})` bị TỪ CHỐI**, không phải cho qua. Bề mặt Ops API sẽ còn lớn nhiều ở
   C2.3–C2.4; một endpoint lọt ra ngoài hệ thống phạm vi là endpoint không hạn mức, không vết.
2. **Mọi lời gọi ghi phải có `Idempotency-Key`**, ép ở tầng guard chứ không để từng handler tự nhớ.
   Gửi lại cùng khoá + cùng payload ⇒ trả kết quả cũ. Cùng khoá + payload **khác** ⇒ `409`, vì trả
   kết quả cũ ở đó sẽ nuốt mất thao tác vừa yêu cầu.
3. **Mọi lời gọi vào `ops_audit_log`** — kể cả bị từ chối, kể cả hỏng. Lời gọi bị từ chối là thứ có
   giá trị nhất khi truy sự cố.
4. **Hỏng thì đóng.** Không đọc được mức tiêu dùng ⇒ coi như đã chạm trần. Mốc `expires_at` hỏng ⇒
   coi như đã hết hạn.

## Hạn mức ngày

Hai trần tách nhau, vì cấp 50.000 coin một lần và 500 lần mỗi lần 100 coin gây thiệt hại như nhau:

- `calls` — số lời gọi **ghi** thành công/ngày. Đọc không tiêu hạn mức này.
- `coin_granted` — tổng coin cấp/ngày. Kiểm **trước** khi cấp, tính cả phần sắp cấp.

Ngày neo vào **UTC**, khớp `DAY_RESET_TZ` của doc 35 (chốt #3). Chạm trần trả `429` với
`retryable: true` — "thử lại sau", khác hẳn "sai tham số".

## Đọc vết kiểm toán

```bash
curl "$API/internal/v1/admin/ops/audit?limit=100" -H "x-admin-key: $KEY"
```

Hoặc bằng SQL khi cần truy sâu:

```sql
select created_at, actor_kind, actor_name, action, target_id, status, units, unit_kind
from public.ops_audit_log
where created_at >= now() - interval '24 hours'
order by created_at desc;
```

`payload_hash` là hash, **không** phải payload thô: payload admin có thể chứa dữ liệu người chơi, mà
bảng này sống lâu hơn mọi thứ khác. Hash đủ để chứng minh "hai lời gọi giống hệt nhau" — đúng thứ
cần cho chống lặp — mà không biến vết kiểm toán thành kho dữ liệu cá nhân thứ hai.

## Thu hồi

```bash
curl -X DELETE "$API/internal/v1/admin/ops/keys/$ID" \
  -H "x-admin-key: $KEY" -H "Idempotency-Key: $(uuidgen)"
```

Thu hồi khoá **không tồn tại** trả `404` có chủ ý: nó thường nghĩa là đang thu hồi nhầm id và tin
rằng đã xong.

Khoá bị thu hồi **không bị xoá** — hàng vẫn còn để vết kiểm toán cũ vẫn truy ngược được tới nó.

---

Liên quan: [35-product-depth-plan.md](35-product-depth-plan.md) §C2 · [38-lo-trinh-dai-han.md](38-lo-trinh-dai-han.md) ·
`supabase/migrations/202609070001_ops_api_keys.sql` · `packages/server/src/admin/`
