begin;

-- doc 35 §C2.1 — nền Ops API: khoá có phạm vi + vết kiểm toán + chống lặp.
--
-- Thay cái gì: trước lát này, cả 9 endpoint `internal/v1/admin` dùng chung ĐÚNG MỘT chuỗi
-- `x-admin-key` so với `ADMIN_API_KEY_SHA256` trong biến môi trường. Hệ quả:
--   * Lộ chuỗi đó = mất tất cả — cấp coin, xoá người chơi, đổi giá, publish cấp.
--   * Không thu hồi được từng bên: đổi khoá là chặn hết mọi người cùng lúc.
--   * Không biết AI đã gọi GÌ. Không có gì để truy khi số dư của một người chơi sai.
--   * Không có trần: một vòng lặp hỏng cấp được coin cho tới khi có người nhìn thấy.
--
-- Ba cái cuối là điều kiện tiên quyết để giao quyền ghi cho AI agent (doc 35 §C2 rủi ro): một tác
-- nhân không có người ngồi cạnh thì vết kiểm toán và hạn mức là hai chốt chặn duy nhất còn lại.

-- ---- Khoá ------------------------------------------------------------------------------------
--
-- Lưu HASH, không lưu khoá. Server chỉ nhìn thấy khoá thật đúng một lần — lúc sinh ra. Đọc trộm
-- được cả bảng này vẫn không gọi được API.
create table public.ops_api_keys (
  id           uuid        primary key default gen_random_uuid(),
  name         text        not null,
  -- Phân biệt NGƯỜI với AGENT không phải để trang trí: hạn mức, phạm vi mặc định và cách đọc lại
  -- vết kiểm toán khi có sự cố đều khác nhau giữa hai loại.
  actor_kind   text        not null check (actor_kind in ('human', 'agent')),
  key_hash     text        not null unique,
  -- Dạng `nhóm:hành_động`, ví dụ 'wallet:write'. Mảng rỗng = khoá không làm được gì — đó là mặc
  -- định ĐÚNG: quên gán phạm vi phải ra khoá vô dụng, không phải khoá toàn quyền.
  scopes       text[]      not null default '{}',
  -- {"calls": 200, "coin_granted": 50000} — trần MỖI NGÀY (UTC) cho khoá này.
  daily_limits jsonb       not null default '{}'::jsonb,
  expires_at   timestamptz,
  revoked_at   timestamptz,
  created_at   timestamptz not null default now(),
  created_by   text,
  last_used_at timestamptz
);

create index ops_api_keys_active_idx on public.ops_api_keys (revoked_at) where revoked_at is null;

-- ---- Vết kiểm toán ---------------------------------------------------------------------------
--
-- Ghi MỌI lời gọi, không ngoại lệ — kể cả của người, kể cả lời gọi bị TỪ CHỐI. Lời gọi bị từ chối
-- là thứ có giá trị nhất khi truy một sự cố: nó cho biết ai đã thử làm gì.
--
-- KHÔNG lưu payload thô, chỉ `payload_hash`. Payload của admin có thể chứa dữ liệu người chơi, mà
-- bảng này phải sống lâu hơn mọi thứ khác. Hash đủ để chứng minh "hai lời gọi này giống hệt nhau"
-- — đúng thứ cần cho chống lặp — mà không biến vết kiểm toán thành một kho dữ liệu cá nhân thứ hai.
create table public.ops_audit_log (
  id              uuid        primary key default gen_random_uuid(),
  created_at      timestamptz not null default now(),
  -- `set null`: khoá bị xoá cứng thì vết vẫn còn. Vết kiểm toán mất theo khoá là vết vô dụng.
  key_id          uuid        references public.ops_api_keys(id) on delete set null,
  actor_kind      text        not null,
  actor_name      text        not null,
  action          text        not null,
  scope           text,
  target_id       text,
  payload_hash    text        not null,
  idempotency_key text,
  dry_run         boolean     not null default false,
  -- Chỉ lời gọi GHI tính vào trần `calls`. Đọc nhiều không được làm cạn hạn mức ghi.
  is_write        boolean     not null default false,
  status          text        not null check (status in ('ok', 'error', 'denied', 'replay')),
  result          jsonb       not null default '{}'::jsonb,
  -- Lượng tài nguyên đã tiêu của lời gọi này (ví dụ số coin đã cấp) — dùng cho trần theo LƯỢNG,
  -- khác với trần theo SỐ LẦN. Cấp 50.000 coin một lần và 500 lần mỗi lần 100 coin gây thiệt hại
  -- như nhau, nên chỉ đếm số lần là chưa đủ.
  units           numeric     not null default 0,
  unit_kind       text
);

-- Chống lặp: cùng một khoá gửi lại cùng `Idempotency-Key` ⇒ đụng index này ⇒ trả lại kết quả cũ
-- thay vì thực hiện lần hai. CHỈ ràng buộc trên hàng `ok`: lời gọi hỏng phải thử lại được bằng
-- đúng khoá idempotency đó, nếu không thì một lỗi mạng sẽ khoá vĩnh viễn thao tác ấy.
create unique index ops_audit_idempotency_idx
  on public.ops_audit_log (key_id, idempotency_key)
  where idempotency_key is not null and status = 'ok';

create index ops_audit_key_time_idx on public.ops_audit_log (key_id, created_at desc);
create index ops_audit_time_idx     on public.ops_audit_log (created_at desc);

-- ---- Mức tiêu dùng trong ngày ----------------------------------------------------------------
--
-- Ngày neo vào UTC, khớp `DAY_RESET_TZ` của doc 35 (chốt #3). `current_date` đọc TimeZone của
-- phiên ⇒ hai node ở hai vùng sẽ reset hạn mức vào hai thời điểm khác nhau.
create or replace function public.ops_daily_usage(p_key_id uuid, p_unit_kind text default null)
returns jsonb
language sql
stable
security definer
set search_path = public
as $$
  select jsonb_build_object(
    'calls', count(*) filter (where is_write and status = 'ok'),
    'units', coalesce(sum(units) filter (
      where status = 'ok' and p_unit_kind is not null and unit_kind = p_unit_kind
    ), 0)
  )
  from public.ops_audit_log
  where key_id = p_key_id
    and created_at >= (date_trunc('day', now() at time zone 'UTC') at time zone 'UTC');
$$;

alter table public.ops_api_keys  enable row level security;
alter table public.ops_audit_log enable row level security;

revoke all on table public.ops_api_keys  from anon, authenticated;
revoke all on table public.ops_audit_log from anon, authenticated;
revoke all on function public.ops_daily_usage(uuid, text) from public, anon, authenticated;
grant execute on function public.ops_daily_usage(uuid, text) to service_role;

-- CỐ Ý không seed khoá nào. Một khoá mặc định trong migration là một khoá nằm trong git — tức là
-- đúng vấn đề mà lát này đang gỡ bỏ. Khoá đầu tiên sinh bằng `POST internal/v1/admin/ops/keys`,
-- xác thực bằng `ADMIN_API_KEY_SHA256` cũ. Chuỗi cũ đó TỰ NGỪNG hoạt động ngay khi bảng này có
-- khoá còn hiệu lực đầu tiên — xem `ops-keys.service.ts`.

commit;
