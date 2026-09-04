begin;

-- doc 35 §A1.5 — bảng tổng hợp NGÀY cho bảng sự kiện.
--
-- Vì sao cần tổng hợp thay vì cứ truy vấn thẳng `analytics_events`:
--   `analytics_events` là bảng ghi nhiều nhất hệ thống và bị xoá theo hạn (drop partition sau 90
--   ngày — doc 35 §C4 là nghĩa vụ pháp lý). Mọi con số xu hướng dài hơn 90 ngày phải nằm ở đâu đó
--   KHÁC, nếu không thì đến ngày purge là mất luôn lịch sử. Ba bảng dưới đây nhỏ, không bị purge,
--   và là thứ duy nhất còn lại sau khi sự kiện thô bị xoá.
--
-- ==========================================================================================
-- BA LUẬT ĐÚNG-SAI CỦA CHỖ NÀY. Cả ba đều là loại sai KHÔNG tự lộ ra — báo cáo vẫn chạy, con
-- số vẫn trông hợp lý.
-- ==========================================================================================
--
-- LUẬT 1 — Đếm bằng `count(distinct event_id)`, KHÔNG bao giờ `count(*)`.
--   `202609040001_analytics_source.sql` đã ghi: `energy_spend`/`energy_grant` lấy `occurred_at` từ
--   đồng hồ request (RPC năng lượng không trả mốc thời gian), nên gọi lại CÓ THỂ sinh hai hàng cùng
--   `event_id`. Ở đây luật đó được thi hành bằng cách viết `count(distinct event_id)` cho MỌI tên
--   sự kiện, kể cả các tên hiện không thể trùng. Đồng nhất thì không có chỗ để quên; viết
--   `count(*)` cho tên "an toàn" rồi `distinct` cho tên "nguy hiểm" là mời người sau chọn nhầm.
--
-- LUẬT 2 — Tính duy nhất KHÔNG cộng được.
--   `sum(devices)` trên nhiều tên sự kiện KHÔNG ra DAU: một người chơi phát `app_open` +
--   `match_start` + `match_end` sẽ bị đếm ba lần. Vì vậy DAU nằm ở bảng RIÊNG
--   (`analytics_daily_kpi`), tính một lần từ sự kiện thô. Đây là lý do bảng thứ hai tồn tại, không
--   phải để cho tiện.
--
-- LUẬT 3 — Ngày phải neo vào UTC, không vào `TimeZone` của phiên.
--   `occurred_at::date` cho kết quả KHÁC NHAU tuỳ tham số phiên của người chạy. Cùng một truy vấn,
--   hai người, hai kết quả — và không ai biết. Mọi chỗ cắt ngày dưới đây đều
--   `(occurred_at at time zone 'UTC')::date`, khớp đúng biên partition của bảng sự kiện.
--
-- SỰ KIỆN ĐẾN MUỘN: client đệm lô vào localStorage khi offline và gửi lại sau NHIỀU NGÀY
--   (`packages/client/src/lib/analytics.ts`). Nên con số của một ngày đã chốt VẪN CÒN THAY ĐỔI.
--   `refresh_analytics_daily` do đó là phép tính LẠI trọn ngày (xoá rồi ghi), idempotent, và
--   `refresh_analytics_rollups` mặc định quét lại 3 ngày gần nhất chứ không chỉ hôm qua.

-- ---- Tổng hợp theo (ngày × nguồn × nền tảng × tên) ----------------------------------------
--
-- CỐ Ý KHÔNG fan-out theo `props`: mỗi tên sự kiện có bộ khoá props riêng, nên một bảng tổng hợp
-- cố phủ hết props sẽ có hàng chục cột rỗng và không ai truy vấn nổi. Câu hỏi cần tới props
-- (funnel FTUE đi theo `props->>'step'`) đọc thẳng sự kiện thô qua `analytics_events_name_time_idx`
-- — index đó tồn tại chính vì việc này.
create table public.analytics_daily (
  day      date   not null,
  source   text   not null,
  platform text   not null,
  name     text   not null,
  -- count(distinct event_id) — xem LUẬT 1.
  events   bigint not null default 0,
  -- Thiết bị duy nhất (anon_id). Guest cũng có, nên đây là mẫu số của mọi funnel trước đăng nhập.
  devices  bigint not null default 0,
  -- Tài khoản duy nhất (player_id). Luôn <= devices.
  players  bigint not null default 0,
  primary key (day, source, platform, name)
);

create index analytics_daily_name_day_idx on public.analytics_daily (name, day desc);

-- ---- KPI theo (ngày × nền tảng) ------------------------------------------------------------
--
-- Tồn tại vì LUẬT 2: DAU và doanh thu không suy được từ bảng trên.
create table public.analytics_daily_kpi (
  day            date    not null,
  platform       text    not null,
  dau_devices    bigint  not null default 0,
  dau_players    bigint  not null default 0,
  -- Thiết bị lần đầu xuất hiện trong ngày này (đọc từ analytics_device_first_seen).
  new_devices    bigint  not null default 0,
  -- Tổng Telegram Stars thu được. Đơn vị là STARS, không phải tiền pháp định: tỉ giá Stars→USD do
  -- Telegram quyết định và đổi được, nên quy đổi ở tầng báo cáo, không đông cứng vào bảng.
  revenue_stars  numeric not null default 0,
  paying_players bigint  not null default 0,
  primary key (day, platform)
);

-- ---- Neo cohort: ngày đầu tiên thấy mỗi thiết bị ------------------------------------------
--
-- Retention D1/D7 cần biết "thiết bị này thuộc cohort ngày nào". Tính lại bằng `min(occurred_at)`
-- mỗi lần hỏi là quét toàn bảng sự kiện; bảng này biến nó thành một phép join.
--
-- Sống LÂU HƠN sự kiện thô: sau khi partition ngày X bị purge, hàng ở đây vẫn nói được rằng thiết
-- bị đó thuộc cohort X. Đó là điều kiện để vẽ được đường retention dài hơn 90 ngày.
create table public.analytics_device_first_seen (
  anon_id   text primary key,
  first_day date not null,
  -- Nền tảng ở lần thấy ĐẦU TIÊN. Thiết bị đổi nền tảng về sau không viết lại cohort.
  platform  text not null
);

create index analytics_device_first_seen_day_idx on public.analytics_device_first_seen (first_day, platform);

-- ---- Tính lại trọn một ngày ----------------------------------------------------------------
--
-- Idempotent: xoá rồi ghi lại. Chạy bao nhiêu lần cũng ra một kết quả, và chạy lại sau khi lô
-- offline về muộn sẽ SỬA con số cũ thay vì cộng thêm vào.
create or replace function public.refresh_analytics_daily(p_day date)
returns bigint
language plpgsql
security definer
set search_path = public
as $$
declare
  -- Biên UTC, khớp đúng biên partition. Xem LUẬT 3.
  v_from timestamptz := (p_day::timestamp at time zone 'UTC');
  v_to   timestamptz := ((p_day + 1)::timestamp at time zone 'UTC');
  v_rows bigint := 0;
begin
  delete from public.analytics_daily where day = p_day;

  insert into public.analytics_daily (day, source, platform, name, events, devices, players)
  select p_day, e.source, e.platform, e.name,
         count(distinct e.event_id),   -- LUẬT 1
         count(distinct e.anon_id),
         count(distinct e.player_id)
  from public.analytics_events e
  where e.occurred_at >= v_from and e.occurred_at < v_to
  group by e.source, e.platform, e.name;

  get diagnostics v_rows = row_count;

  -- Cohort TRƯỚC KPI: `new_devices` đọc từ bảng first_seen nên bảng đó phải mới trước đã.
  --
  -- `least(...)` chứ không phải ghi đè: sự kiện đến muộn có thể CHỨNG MINH rằng thiết bị đã xuất
  -- hiện SỚM HƠN ngày ta từng ghi. Ghi đè vô điều kiện sẽ đẩy thiết bị sang cohort mới hơn và làm
  -- retention của cohort cũ tự nhiên đẹp lên — sai theo hướng dễ chịu, loại sai tệ nhất.
  insert into public.analytics_device_first_seen as f (anon_id, first_day, platform)
  select distinct on (e.anon_id) e.anon_id, p_day, e.platform
  from public.analytics_events e
  where e.occurred_at >= v_from and e.occurred_at < v_to
  order by e.anon_id, e.occurred_at
  on conflict (anon_id) do update
    set first_day = least(f.first_day, excluded.first_day),
        platform  = case when excluded.first_day < f.first_day then excluded.platform else f.platform end;

  delete from public.analytics_daily_kpi where day = p_day;

  insert into public.analytics_daily_kpi
    (day, platform, dau_devices, dau_players, new_devices, revenue_stars, paying_players)
  with day_events as (
    select * from public.analytics_events
    where occurred_at >= v_from and occurred_at < v_to
  ),
  actives as (
    select platform,
           count(distinct anon_id)   as dau_devices,
           count(distinct player_id) as dau_players
    from day_events
    group by platform
  ),
  -- Doanh thu KHÔNG dùng được `count(distinct)` — phải cộng một cột số. Nên phải khử trùng ở tầng
  -- HÀNG trước rồi mới `sum`, nếu không một hàng trùng sẽ cộng thẳng vào doanh thu. Hiện
  -- `purchase_fulfilled` lấy `occurred_at` từ `purchase_orders.updated_at` nên đã tất định và
  -- không thể trùng; `distinct on` ở đây là để câu này vẫn đúng nếu về sau có nguồn tiền khác
  -- không tất định như vậy.
  paid as (
    select distinct on (event_id) event_id, platform, player_id,
           coalesce((props->>'amount')::numeric, 0) as stars
    from day_events
    where source = 'server' and name = 'purchase_fulfilled'
    order by event_id, occurred_at
  ),
  money as (
    select platform,
           coalesce(sum(stars), 0)   as revenue_stars,
           count(distinct player_id) as paying_players
    from paid
    group by platform
  ),
  fresh as (
    select platform, count(*) as new_devices
    from public.analytics_device_first_seen
    where first_day = p_day
    group by platform
  )
  select p_day,
         a.platform,
         a.dau_devices,
         a.dau_players,
         coalesce(f.new_devices, 0),
         coalesce(m.revenue_stars, 0),
         coalesce(m.paying_players, 0)
  from actives a
  left join money m on m.platform = a.platform
  left join fresh f on f.platform = a.platform;

  return v_rows;
end;
$$;

-- Quét lại N ngày gần nhất (kể cả HÔM NAY — ngày đang chạy dở vẫn cần số liệu).
-- Mặc định 3 ngày: đủ để hứng phần lớn lô offline mà không phải tính lại cả tháng mỗi đêm.
create or replace function public.refresh_analytics_rollups(p_days integer default 3)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  -- `current_date` đọc TimeZone của phiên ⇒ job chạy ở hai máy có thể tính hai ngày khác nhau.
  v_today date := (now() at time zone 'UTC')::date;
  v_done  integer := 0;
begin
  for i in 0..greatest(p_days, 0) loop
    perform public.refresh_analytics_daily(v_today - i);
    v_done := v_done + 1;
  end loop;
  return v_done;
end;
$$;

alter table public.analytics_daily              enable row level security;
alter table public.analytics_daily_kpi          enable row level security;
alter table public.analytics_device_first_seen  enable row level security;

revoke all on table public.analytics_daily             from anon, authenticated;
revoke all on table public.analytics_daily_kpi         from anon, authenticated;
revoke all on table public.analytics_device_first_seen from anon, authenticated;
revoke all on function public.refresh_analytics_daily(date)      from public, anon, authenticated;
revoke all on function public.refresh_analytics_rollups(integer) from public, anon, authenticated;
grant execute on function public.refresh_analytics_daily(date)      to service_role;
grant execute on function public.refresh_analytics_rollups(integer) to service_role;

-- Nạp lần đầu: quét lại 14 ngày dữ liệu đã có trong bảng sự kiện.
select public.refresh_analytics_rollups(14);

commit;
