# Truy vấn phân tích — D1/D7, funnel FTUE, ARPDAU

> Lát `a1.5-rollup-queries` (doc 35 §A1). Nguồn số: `analytics_events` (thô, giữ 90 ngày) +
> ba bảng tổng hợp của `supabase/migrations/202609040002_analytics_rollup.sql`.
>
> Mọi truy vấn dưới đây **đã chạy thật trên database dev ngày 2026-09-04** và trả về số. Không có
> câu nào ở đây là mã giả.

## Chạy ở đâu

Supabase Studio → **SQL Editor**, hoặc bất cứ client Postgres nào. Các bảng đã bật RLS và bị
`revoke` khỏi `anon`/`authenticated`, nên chỉ chạy được bằng khoá `service_role` — đúng ý: đây là
số liệu vận hành, không phải dữ liệu người chơi tự đọc.

---

## Ba luật phải nhớ trước khi viết truy vấn mới

Cả ba đều là loại sai **không tự lộ ra**: báo cáo vẫn chạy, con số vẫn trông hợp lý.

### 1. `count(distinct event_id)`, không bao giờ `count(*)`

`energy_spend` và `energy_grant` lấy `occurred_at` từ đồng hồ của request (RPC năng lượng không
trả về mốc thời gian nào), nên gọi lại **có thể** sinh hai hàng cùng `event_id`. Unique key là
`(event_id, occurred_at)` nên database không chặn được.

Đã chứng minh trên dev: ghi 2 hàng thô cùng `event_id` → `analytics_daily.events = 1`.

Cộng một cột **số** (doanh thu) thì `count(distinct)` không cứu được — phải khử trùng ở tầng hàng
bằng `distinct on (event_id)` **rồi mới** `sum`. Đã chứng minh: 2 hàng × 250 Stars → `revenue_stars = 250`,
không phải 500.

### 2. `source` quyết định câu hỏi nào đọc được

| Câu hỏi | Đọc `source` | Vì sao |
|---|---|---|
| Hành vi, funnel, retention | `client` | Client phát sớm, phủ cả ván không nộp kết quả |
| Tiền, liêm chính, kinh tế | `server` | Lời khai của client về việc mình vừa được cộng tiền không phải dữ liệu |

`match_end` và `campaign_level_complete` được phát ở **cả hai** phía. Truy vấn quên lọc `source`
sẽ đếm gấp đôi.

### 3. Cắt ngày theo UTC

`occurred_at::date` đọc `TimeZone` của phiên ⇒ hai người chạy cùng một câu, ra hai kết quả khác
nhau, và không ai biết. Luôn viết `(occurred_at at time zone 'UTC')::date` — khớp đúng biên
partition của bảng sự kiện.

---

## Q1 — Retention D1/D7 theo cohort

Cohort neo vào `analytics_device_first_seen` (thiết bị, không phải tài khoản: phần lớn funnel xảy
ra trước khi đăng nhập). Bảng đó **sống lâu hơn** sự kiện thô, nên đường retention vẫn vẽ được sau
khi partition 90 ngày bị purge.

```sql
with cohort as (
  select anon_id, first_day, platform
  from public.analytics_device_first_seen
  where first_day >= (now() at time zone 'UTC')::date - 30
),
back as (
  select distinct c.first_day, c.platform, c.anon_id,
         ((e.occurred_at at time zone 'UTC')::date - c.first_day) as day_n
  from cohort c
  join public.analytics_events e
    on e.anon_id = c.anon_id
   and e.occurred_at >= (c.first_day::timestamp at time zone 'UTC')
   and e.occurred_at <  ((c.first_day + 8)::timestamp at time zone 'UTC')
),
agg as (
  select first_day, platform,
         count(distinct anon_id) filter (where day_n = 0) as co_size,
         count(distinct anon_id) filter (where day_n = 1) as d1,
         count(distinct anon_id) filter (where day_n = 7) as d7
  from back group by first_day, platform
)
select first_day as ngay_cohort, platform, co_size, d1, d7,
       -- Cohort chưa đủ tuổi thì trả NULL, KHÔNG trả 0. Xem ghi chú bên dưới.
       case when first_day + 1 <= (now() at time zone 'UTC')::date
            then round(100.0 * d1 / nullif(co_size, 0), 1) end as d1_pct,
       case when first_day + 7 <= (now() at time zone 'UTC')::date
            then round(100.0 * d7 / nullif(co_size, 0), 1) end as d7_pct
from agg
order by first_day desc;
```

**Cái bẫy mà `case when` ở trên vá:** cohort hôm nay chưa thể có D1, cohort 3 ngày trước chưa thể
có D7. Nếu cứ chia thì mọi cohort trẻ đều hiện **0%** — trông y hệt một cú sập retention, và người
đọc sẽ phản ứng với một sự cố không tồn tại. `NULL` nói đúng điều đang xảy ra: *chưa biết*.

**D1 nghĩa là "quay lại đúng ngày N+1"**, không phải "quay lại trong vòng 24 giờ" và cũng không
phải "còn hoạt động ở ngày N+1 trở đi". Ba định nghĩa này cho ba con số khác nhau; đây là định
nghĩa cổ điển và là cái doc 35 §8 dùng làm mốc.

Kết quả trên dev (2026-09-04), dữ liệu thật từ đợt kiểm thử FTUE:

| ngay_cohort | platform | co_size | d1 | d7 | d1_pct | d7_pct |
|---|---|---|---|---|---|---|
| 2026-09-04 | web | 2 | 0 | 0 | NULL | NULL |
| 2026-09-03 | web | 1 | 0 | 0 | 0.0 | NULL |

---

## Q2 — Funnel FTUE

Mốc của doc 35 §8: **hoàn thành FTUE ≥ 70%**.

Đọc thẳng sự kiện thô, không qua rollup: bước FTUE nằm trong `props->>'step'`, mà bảng tổng hợp
**cố ý không** fan-out theo props (mỗi tên sự kiện có bộ khoá props riêng; một bảng cố phủ hết sẽ
có hàng chục cột rỗng). Index `analytics_events_name_time_idx` tồn tại chính cho truy vấn này.

```sql
with s as (
  select e.anon_id, e.props->>'step' as step, e.props->>'outcome' as outcome
  from public.analytics_events e
  where e.name = 'ftue_step' and e.source = 'client'
    and e.occurred_at >= (now() at time zone 'UTC') - interval '30 days'
)
select count(distinct anon_id) filter (where step = 'move')    as b1_lai,
       count(distinct anon_id) filter (where step = 'claim')   as b2_chiem,
       count(distinct anon_id) filter (where step = 'survive') as b3_song,
       count(distinct anon_id) filter (where outcome = 'complete') as xong,
       count(distinct anon_id) filter (where outcome = 'skipped')  as bo_qua,
       round(100.0 * count(distinct anon_id) filter (where outcome = 'complete')
             / nullif(count(distinct anon_id) filter (where step = 'move'), 0), 1) as ty_le_xong_pct
from s;
```

Kết quả trên dev: `b1_lai=2, b2_chiem=1, b3_song=1, xong=1, bo_qua=1, ty_le_xong_pct=50.0`
(mẫu 2 thiết bị — đủ để chứng minh câu truy vấn chạy, không đủ để kết luận gì về sản phẩm).

**Rơi ở bước nào** — đây mới là con số hành động được, vì "70%" không nói cho ai biết phải sửa gì:

```sql
select props->>'step' as bo_dở_o_buoc, count(distinct anon_id) as thiet_bi
from public.analytics_events
where name = 'ftue_step' and source = 'client' and props->>'outcome' = 'skipped'
  and occurred_at >= (now() at time zone 'UTC') - interval '30 days'
group by 1 order by thiet_bi desc;
```

Mẫu số `b1_lai` là thiết bị **vào được bước 1**, không phải mọi thiết bị mở app. Chênh lệch giữa
`app_open` và `b1_lai` là người rơi *trước cả FTUE* — hỏng tải trang, chặn WebGL, thoát ngay. Muốn
thấy chỗ đó:

```sql
select
  (select count(distinct anon_id) from public.analytics_events
    where name = 'app_open' and occurred_at >= (now() at time zone 'UTC') - interval '30 days') as mo_app,
  (select count(distinct anon_id) from public.analytics_events
    where name = 'ftue_step' and occurred_at >= (now() at time zone 'UTC') - interval '30 days') as vao_ftue;
```

---

## Q3 — ARPDAU

Đơn vị là **Telegram Stars**, không quy ra tiền pháp định: tỉ giá Stars→USD do Telegram quyết định
và đổi được, nên đông cứng nó vào bảng là tự tạo một con số sai theo thời gian.

```sql
select day, platform,
       dau_devices, dau_players, new_devices,
       revenue_stars, paying_players,
       round(revenue_stars / nullif(dau_devices, 0), 4) as arpdau_stars,
       round(revenue_stars / nullif(paying_players, 0), 2) as arppu_stars,
       -- Cảnh báo tươi/cũ: rollup KHÔNG tự chạy (xem "Bảo trì" bên dưới).
       case when day = (now() at time zone 'UTC')::date then 'hôm nay (đang chạy dở)' end as ghi_chu
from public.analytics_daily_kpi
where day >= (now() at time zone 'UTC')::date - 30
order by day desc, platform;
```

`arpdau` chia cho **thiết bị** (`dau_devices`) chứ không phải tài khoản: guest cũng chơi được và
cũng là chi phí phục vụ. `arppu` chia cho người **thật sự trả tiền** — hai con số trả lời hai câu
hỏi khác nhau, đừng lẫn.

Trên dev hiện `revenue_stars = 0` ở mọi ngày vì chưa có giao dịch Stars thật. Đường tính đã được
kiểm bằng một hàng tổng hợp tạm (250 Stars, ghi 2 lần cùng `event_id`) — ra đúng 250 — rồi xoá.

---

## Q4 — Tự soát: rollup có khớp sự kiện thô không

Chạy câu này **trước** khi tin bất kỳ con số nào ở trên. Mọi hàng `lech = true` nghĩa là rollup cũ
hoặc sai; chạy lại `refresh_analytics_rollups`.

```sql
with raw as (
  select (occurred_at at time zone 'UTC')::date as day, source, platform, name,
         count(distinct event_id) as events, count(distinct anon_id) as devices
  from public.analytics_events group by 1,2,3,4
)
select coalesce(r.day, d.day) as day, coalesce(r.name, d.name) as name,
       r.events as raw_events, d.events as roll_events,
       r.devices as raw_devices, d.devices as roll_devices,
       (r.events is distinct from d.events or r.devices is distinct from d.devices) as lech
from raw r
full outer join public.analytics_daily d
  on d.day = r.day and d.source = r.source and d.platform = r.platform and d.name = r.name
order by lech desc, day desc, name;
```

`full outer join` chứ không phải `left join`: phải bắt được **cả hai** hướng lệch — ngày có trong
rollup mà không còn trong sự kiện thô (đã purge, bình thường) lẫn ngày có sự kiện mà rollup bỏ sót
(bất thường).

Trên dev: 8/8 hàng `lech = false`.

---

## Bảo trì

`refresh_analytics_rollups(p_days)` tính **lại** trọn từng ngày (xoá rồi ghi), nên chạy bao nhiêu
lần cũng ra một kết quả. Đã kiểm: chạy 2 lần liên tiếp trên dev, hash của toàn bảng không đổi.

Mặc định quét lại **3 ngày** chứ không chỉ hôm qua, vì client đệm lô sự kiện vào `localStorage` khi
offline và gửi lại sau nhiều ngày (`packages/client/src/lib/analytics.ts`). Con số của một ngày đã
chốt vẫn còn thay đổi.

```sql
select public.refresh_analytics_rollups(3);   -- nhịp hằng ngày
select public.refresh_analytics_rollups(90);  -- dựng lại toàn bộ
```

### ⚠️ Chưa có lịch chạy tự động

`pg_cron` **có sẵn nhưng chưa bật** trên project dev (`pg_available_extensions` → `installed_version`
là NULL). Agent cố ý không tự bật trong migration: extension này dựng một background worker và các
job của nó nằm ngoài repo, không ai đọc code mà thấy được.

Cho tới khi bật, **`analytics_daily_kpi` chỉ mới bằng lần refresh gần nhất** — cột `ghi_chu` ở Q3 và
câu Q4 là để chỗ cũ đó lộ ra thay vì im lặng. Q1 và Q2 đọc sự kiện thô nên luôn tươi.

Cách bật (việc của người, ~2 phút) — xem [37-viec-can-nguoi-thuc-hien.md](37-viec-can-nguoi-thuc-hien.md):

```sql
create extension if not exists pg_cron;
select cron.schedule('analytics-rollup', '20 0 * * *',
                     $$select public.refresh_analytics_rollups(3)$$);
```

---

Liên quan: [35-product-depth-plan.md](35-product-depth-plan.md) §A1 ·
`supabase/migrations/202609030001_analytics_events.sql` ·
`202609040001_analytics_source.sql` · `202609040002_analytics_rollup.sql`
