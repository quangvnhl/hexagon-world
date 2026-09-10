begin;

-- doc 35 §B9 — bảng theo dõi kinh tế: coin PHÁT HÀNH theo nguồn vs coin TIÊU theo sink.
--
-- ┌─ VÌ SAO LÁT NÀY PHẢI ĐI TRƯỚC B1–B4 ────────────────────────────────────────────────────────┐
-- │ doc 35 Rủi ro #4. Pha 7 sắp mở BỐN nguồn phát coin mới cùng lúc (quảng cáo, điểm danh,       │
-- │ nhiệm vụ, thưởng cấp). Không có bảng này thì đó là thả coin vào một cái thùng không đáy:     │
-- │ lạm phát không hiện ra ở đâu cả cho tới lúc giá trong shop trở nên vô nghĩa, và khi đó thì   │
-- │ đã muộn — coin đã nằm trong ví người chơi, thu lại là cướp.                                  │
-- └────────────────────────────────────────────────────────────────────────────────────────────┘
--
-- ┌─ HAI LUẬT THIẾT KẾ, ĐỀU RÚT TỪ ĐO ĐẠC CHỨ KHÔNG TỪ GIẢ ĐỊNH ────────────────────────────────┐
-- │                                                                                             │
-- │ LUẬT 1 — Chiều tiền lấy từ DẤU của `delta`, KHÔNG lấy từ tên.                                │
-- │   `reason` là chữ tự do do người gọi đặt. Đo trên DB dev 2026-09-10: bốn giá trị đang có là   │
-- │   `campaign_reward`, `energy_purchase`, `telegram_stars_purchase`, và `dev top-up` — cái      │
-- │   cuối có DẤU CÁCH và không theo snake_case như ba cái kia. Bất kỳ phép phân loại nào dựa     │
-- │   vào hình dạng của tên đều sẽ vỡ ở đúng hàng đó. `delta` thì không bao giờ mơ hồ.            │
-- │                                                                                             │
-- │ LUẬT 2 — Một loại giao dịch CHƯA ĐƯỢC KHAI phải HIỆN RA thành một con số, không được im.     │
-- │   Đây là điểm chết người của mọi bảng kinh tế: một nguồn phát coin mới mà bảng không biết     │
-- │   sẽ lặng lẽ rơi khỏi phần "phát hành", và tỉ lệ lạm phát trông vẫn LÀNH MẠNH trong khi coin  │
-- │   đang chảy ra ngoài tầm nhìn. Vì vậy `economy_daily_summary` có cột                          │
-- │   `unclassified_entries`: mỗi lát Pha 7 thêm một nguồn phát BẮT BUỘC phải khai nó vào         │
-- │   `economy_flow_kinds`, nếu không con số đó khác 0 và người đọc thấy ngay.                    │
-- └────────────────────────────────────────────────────────────────────────────────────────────┘
--
-- Ngày neo vào UTC (chốt #3), viết `(created_at at time zone 'UTC')::date` giống hệt
-- `analytics_rollup` — `created_at::date` cho kết quả KHÁC NHAU tuỳ tham số `TimeZone` của phiên,
-- tức là cùng một truy vấn, hai người, hai con số, và không ai biết.
--
-- Dùng VIEW chứ không phải bảng tổng hợp như `analytics_daily`: `wallet_ledger` được ghi trong
-- CÙNG giao dịch với việc đổi số dư, nên không có chuyện dữ liệu đến muộn — thứ buộc analytics
-- phải tính lại nhiều ngày. View luôn đúng ở thời điểm đọc và không cần lịch chạy lại.

-- ---- Từ điển loại giao dịch ---------------------------------------------------------------
--
-- Khai theo `reference_type` chứ không theo `reason`: `reference_type` nằm trong ràng buộc duy
-- nhất của `wallet_ledger` `(player_id, currency_code, reference_type, reference_id)` nên nó là
-- cột CÓ CẤU TRÚC; `reason` chỉ là nhãn cho người đọc.
--
-- Bảng này CỐ Ý không nói chiều tiền (xem LUẬT 1) — nó chỉ đặt tên và gom nhóm.
create table public.economy_flow_kinds (
  reference_type text primary key,
  -- Nhóm để gộp báo cáo: gameplay · admin · energy · stars · ads · retention …
  source_group   text not null,
  label          text not null,
  created_at     timestamptz not null default now()
);

comment on table public.economy_flow_kinds is
  'Từ điển reference_type của wallet_ledger. Thêm nguồn phát coin mới ⇒ PHẢI thêm một hàng ở đây, nếu không economy_daily_summary.unclassified_entries sẽ khác 0.';

-- Bốn loại ĐANG CÓ THẬT trên DB (đo 2026-09-10). Cố ý KHÔNG khai trước các loại của Pha 7
-- (ad_reward, daily_claim, quest_reward, level_reward, referral_reward): khai trước là tự bịt
-- mắt mình, vì khi đó lát thêm nguồn phát sẽ không bao giờ thấy `unclassified_entries` nhảy lên
-- và sẽ không ai nhớ phải nghĩ về lạm phát.
insert into public.economy_flow_kinds (reference_type, source_group, label) values
  ('campaign_play',   'gameplay', 'Thưởng hoàn thành cấp Campaign'),
  ('admin_grant',     'admin',    'Cấp tay qua Ops API'),
  ('energy_purchase', 'energy',   'Mua năng lượng bằng coin'),
  ('purchase_order',  'stars',    'Mua coin bằng Telegram Stars')
on conflict (reference_type) do nothing;

-- ---- Chi tiết theo (ngày × tiền tệ × loại × lý do × chiều) ---------------------------------
create view public.economy_daily
with (security_invoker = true) as
select
  (l.created_at at time zone 'UTC')::date              as day,
  l.currency_code,
  l.reference_type,
  coalesce(k.source_group, 'chua_khai')                as source_group,
  l.reason,
  -- LUẬT 1: chiều tiền từ dấu của delta. `delta = 0` không nên tồn tại, nhưng nếu có thì xếp vào
  -- faucet để nó không biến mất khỏi mọi tổng — thà thấy một hàng lạ còn hơn mất nó.
  case when l.delta < 0 then 'sink' else 'faucet' end  as flow,
  (k.reference_type is null)                           as unclassified,
  count(*)::bigint                                     as entries,
  count(distinct l.player_id)::bigint                  as players,
  sum(l.delta)::bigint                                 as net,
  sum(abs(l.delta))::bigint                            as volume
from public.wallet_ledger l
left join public.economy_flow_kinds k on k.reference_type = l.reference_type
group by 1, 2, 3, 4, 5, 6, 7;

comment on view public.economy_daily is
  'Chi tiết dòng tiền theo ngày UTC. Chiều tiền lấy từ dấu của delta, không từ tên (doc 35 §B9).';

-- ---- Tổng hợp theo (ngày × tiền tệ) -------------------------------------------------------
create view public.economy_daily_summary
with (security_invoker = true) as
select
  day,
  currency_code,
  sum(case when flow = 'faucet' then volume else 0 end)::bigint as issued,
  sum(case when flow = 'sink'   then volume else 0 end)::bigint as spent,
  sum(net)::bigint                                              as net,
  -- Phát hành / tiêu. `nullif` để một ngày chưa có chỗ tiêu nào trả NULL thay vì lỗi chia 0 —
  -- NULL đọc là "chưa đủ dữ liệu", còn một con số bịa ra thì đọc là "lành mạnh".
  round(
    sum(case when flow = 'faucet' then volume else 0 end)::numeric
    / nullif(sum(case when flow = 'sink' then volume else 0 end), 0),
    3
  )                                                             as inflation_ratio,
  sum(case when unclassified then entries else 0 end)::bigint   as unclassified_entries,
  count(distinct case when unclassified then reference_type end)::bigint as unclassified_kinds
from public.economy_daily
group by 1, 2;

comment on view public.economy_daily_summary is
  'Tổng hợp ngày. `unclassified_entries` > 0 nghĩa là có nguồn tiền chưa khai trong economy_flow_kinds — xem đó là lỗi cấu hình, không phải chuyện nhỏ (doc 35 §B9 LUẬT 2).';

-- RLS: giống mọi bảng khác trong repo — bật, không policy ⇒ chỉ `service_role` (bỏ qua RLS) đọc
-- được. Hai view đặt `security_invoker = true` nên chúng ÁP RLS của `wallet_ledger` bên dưới chứ
-- không mượn quyền của chủ view; thiếu dòng đó là mở toang sổ tiền cho vai `anon`.
alter table public.economy_flow_kinds enable row level security;

commit;
