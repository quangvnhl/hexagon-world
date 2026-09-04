begin;

-- doc 35 §A2 — Remote config + feature flag.
--
-- Vấn đề: mọi tham số đang nằm trong shared/src/config.ts + .env ⇒ đổi giá năng lượng, tần suất
-- quảng cáo, độ khó bot đều phải build + deploy. Không có kill-switch: sự cố lúc 2 giờ sáng thì
-- không tắt được thứ đang hỏng.
--
-- Bảng cố ý ĐƠN GIẢN. Mọi thứ khôn ngoan (ép kiểu, chọn đối tượng, fallback) nằm ở
-- packages/shared/src/remote-config.ts để client và server dùng CHUNG một luật — nếu nhét vào SQL
-- thì client sẽ có luật thứ hai và hai bên sẽ trôi khỏi nhau.
--
-- `audience` là jsonb chứ không phải cột riêng: điều kiện chọn đối tượng sẽ còn thay đổi (theo
-- vùng, theo cấp, theo cohort) và mỗi lần đổi mà phải migration thì sẽ không ai đổi.

create table public.remote_config (
  key         text primary key,
  value       jsonb       not null,
  -- { platforms?: ("telegram"|"web")[], rollout?: 0..100, minBuild?: text }. NULL = áp cho tất cả.
  audience    jsonb,
  -- Tăng mỗi lần sửa. Có mặt để trang admin phát hiện ghi đè lẫn nhau (doc 35 §A2), chưa dùng ở a2.1.
  version     integer     not null default 1,
  updated_at  timestamptz not null default now(),
  updated_by  text
);

-- Lịch sử thay đổi. Kill-switch là thứ được bấm đúng lúc đang hoảng; hôm sau không ai nhớ ai bấm
-- gì. Ghi lại giá trị TRƯỚC và SAU để còn quay lại được.
create table public.remote_config_audit (
  id          bigserial primary key,
  key         text        not null,
  old_value   jsonb,
  new_value   jsonb,
  old_audience jsonb,
  new_audience jsonb,
  changed_at  timestamptz not null default now(),
  changed_by  text
);
create index remote_config_audit_key_idx on public.remote_config_audit (key, changed_at desc);

create or replace function public.remote_config_write_audit()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.remote_config_audit (key, old_value, new_value, old_audience, new_audience, changed_by)
  values (
    coalesce(new.key, old.key),
    case when tg_op = 'INSERT' then null else old.value end,
    case when tg_op = 'DELETE' then null else new.value end,
    case when tg_op = 'INSERT' then null else old.audience end,
    case when tg_op = 'DELETE' then null else new.audience end,
    case when tg_op = 'DELETE' then old.updated_by else new.updated_by end
  );
  return null;
end;
$$;

create trigger remote_config_audit_trg
  after insert or update or delete on public.remote_config
  for each row execute function public.remote_config_write_audit();

-- Bảng để TRỐNG có chủ ý: không có dòng nào thì mọi khoá dùng mặc định trong shared. Seed sẵn các
-- khoá ở đây sẽ tạo ra hai nguồn sự thật cho cùng một con số, và bản seed sẽ lặng lẽ lỗi thời.

alter table public.remote_config enable row level security;
alter table public.remote_config_audit enable row level security;
revoke all on table public.remote_config from anon, authenticated;
revoke all on table public.remote_config_audit from anon, authenticated;
revoke all on function public.remote_config_write_audit() from public, anon, authenticated;

commit;
