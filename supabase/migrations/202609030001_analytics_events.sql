begin;

-- doc 35 §A1 — Bảng sự kiện phân tích. Nguồn: client (POST /v1/events) và sau này cả server (A1.4).
--
-- Vì sao PARTITION theo ngày:
--   Đây là bảng ghi nhiều nhất và có tuổi thọ ngắn nhất trong hệ thống. Xoá dữ liệu cũ bằng
--   `delete from ... where occurred_at < x` trên bảng lớn sẽ khoá bảng và sinh rác vacuum; `drop
--   partition` chỉ tốn vài mili-giây. Retention là NGHĨA VỤ pháp lý (doc 35 §C4) nên phải rẻ để
--   chạy đều, không phải việc cần can đảm mới dám bấm.
--
-- Vì sao có partition DEFAULT:
--   Partition theo ngày mà thiếu partition của ngày hôm đó thì INSERT VỠ — tức là quên chạy một
--   job bảo trì sẽ làm mất trắng dữ liệu phân tích và có thể làm hỏng cả request của người chơi.
--   Partition DEFAULT biến sự cố đó thành "dữ liệu nằm nhầm chỗ", sửa sau được. Mất dữ liệu thì
--   không sửa được.
--
-- Khử trùng: `unique (event_id, occurred_at)`. Postgres BẮT BUỘC unique index của bảng phân mảnh
--   phải chứa khoá phân mảnh, nên không thể unique riêng `event_id`. Điều này vẫn đủ vì client gửi
--   lại đúng object cũ (cùng `event_id` và cùng `ts`) — xem `packages/client/src/lib/analytics.ts`,
--   lô lỗi được đệm nguyên vẹn rồi gửi lại.

create table public.analytics_events (
  event_id    text        not null,
  -- Thời điểm sự kiện XẢY RA (client gửi lên). Đây là khoá phân mảnh.
  occurred_at timestamptz not null,
  -- Thời điểm server NHẬN. Lệch lớn giữa hai mốc ⇒ đồng hồ client sai hoặc lô bị đệm lâu vì offline.
  received_at timestamptz not null default now(),
  name        text        not null,
  schema      integer     not null,
  session_id  text        not null,
  -- Id thiết bị ẩn danh. KHÔNG phải player_id — guest cũng gửi được sự kiện.
  anon_id     text        not null,
  platform    text        not null check (platform in ('telegram', 'web')),
  build_id    text        not null,
  -- Gắn được người chơi khi request có session hợp lệ; guest thì null. Cố ý KHÔNG dùng khoá ngoại:
  -- xoá tài khoản (doc 35 §C4) không được phép làm vỡ bảng sự kiện, và sự kiện phải sống độc lập.
  player_id   uuid,
  props       jsonb       not null default '{}'::jsonb,
  primary key (event_id, occurred_at)
) partition by range (occurred_at);

-- Truy vấn chính là "sự kiện X trong khoảng thời gian Y" (funnel, DAU, ARPDAU).
create index analytics_events_name_time_idx on public.analytics_events (name, occurred_at desc);
-- Retention/cohort D1/D7 đi theo thiết bị.
create index analytics_events_anon_time_idx on public.analytics_events (anon_id, occurred_at);

-- Lưới an toàn: sự kiện của ngày chưa có partition rơi vào đây thay vì làm vỡ INSERT.
create table public.analytics_events_default partition of public.analytics_events default;

-- Tạo partition cho hôm nay và `p_days` ngày tới. Chạy lại vô hại.
-- Bỏ qua (không vỡ) ngày nào đã có dữ liệu nằm trong partition DEFAULT: tách dữ liệu ra là việc
-- phải người quyết định, không để một job bảo trì tự ý làm.
create or replace function public.ensure_analytics_partitions(p_days integer default 7)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_day     date;
  v_created integer := 0;
  v_name    text;
begin
  for i in 0..greatest(p_days, 0) loop
    v_day := (current_date + i);
    v_name := format('analytics_events_%s', to_char(v_day, 'YYYYMMDD'));
    if to_regclass('public.' || v_name) is not null then
      continue;
    end if;
    begin
      execute format(
        'create table public.%I partition of public.analytics_events for values from (%L) to (%L)',
        v_name, v_day::timestamptz, (v_day + 1)::timestamptz);
      v_created := v_created + 1;
    exception when others then
      -- Thường là do partition DEFAULT đang giữ hàng thuộc khoảng này.
      raise notice 'Bỏ qua partition % : %', v_name, sqlerrm;
    end;
  end loop;
  return v_created;
end;
$$;

-- Xoá dữ liệu quá hạn bằng cách DROP partition (rẻ), không delete từng hàng.
-- KHÔNG đụng tới partition DEFAULT — nó có thể chứa hàng của mọi ngày.
create or replace function public.purge_old_analytics_events(p_keep_days integer default 90)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_cutoff  date := current_date - greatest(p_keep_days, 1);
  v_dropped integer := 0;
  r         record;
begin
  for r in
    select c.relname
    from pg_class c
    join pg_inherits i on i.inhrelid = c.oid
    join pg_class p on p.oid = i.inhparent
    where p.relname = 'analytics_events'
      and c.relname ~ '^analytics_events_[0-9]{8}$'
  loop
    if to_date(right(r.relname, 8), 'YYYYMMDD') < v_cutoff then
      execute format('drop table public.%I', r.relname);
      v_dropped := v_dropped + 1;
    end if;
  end loop;
  return v_dropped;
end;
$$;

-- Có sẵn partition cho 2 tuần tới để việc chạy job bảo trì trễ vài ngày không thành sự cố.
select public.ensure_analytics_partitions(14);

alter table public.analytics_events enable row level security;

revoke all on table public.analytics_events from anon, authenticated;
revoke all on function public.ensure_analytics_partitions(integer) from public, anon, authenticated;
revoke all on function public.purge_old_analytics_events(integer) from public, anon, authenticated;
grant execute on function public.ensure_analytics_partitions(integer) to service_role;
grant execute on function public.purge_old_analytics_events(integer) to service_role;

commit;
