begin;

-- doc 35 §A1.4 — thêm trục NGUỒN cho bảng sự kiện.
--
-- Vấn đề mà cột này giải: `match_end` và `campaign_level_complete` được phát ở CẢ HAI phía.
-- Client phát sớm, phủ được cả ván không nộp kết quả — tốt cho funnel. Server phát muộn hơn nhưng
-- là thứ duy nhất dùng được để đếm tiền và soát liêm chính. Nếu hai nguồn nằm chung mà không phân
-- biệt được thì mọi phép đếm về sau đều nhân đôi, và cái sai đó KHÔNG tự lộ ra: con số vẫn trông
-- hợp lý, chỉ là gấp đôi sự thật.
--
-- `default 'client'`: mọi hàng đã có trong bảng đều do `POST /v1/events` ghi, nên mặc định này
-- đúng với dữ liệu cũ mà không cần backfill. Bảng phân mảnh nhận ADD COLUMN ở bảng cha và lan
-- xuống mọi partition, kể cả DEFAULT.
alter table public.analytics_events
  add column if not exists source text not null default 'client'
  check (source in ('client', 'server'));

-- Truy vấn tiền/liêm chính luôn kèm `source = 'server'` và lọc theo tên + thời gian. Không có
-- index này thì mỗi câu hỏi về doanh thu phải quét toàn bảng sự kiện — bảng ghi nhiều nhất hệ thống.
create index if not exists analytics_events_source_name_time_idx
  on public.analytics_events (source, name, occurred_at desc);

comment on column public.analytics_events.source is
  'client = do POST /v1/events ghi (lời khai của client); server = do server tự phát (tin cậy). '
  'Số liệu hành vi đọc client; số liệu tiền và liêm chính đọc server.';

-- KHỬ TRÙNG CHO SỰ KIỆN SERVER — đọc kỹ trước khi viết truy vấn tổng hợp.
--
-- `unique (event_id, occurred_at)` chỉ khử được trùng khi CẢ HAI trường lặp lại y hệt. Sự kiện
-- server sinh `event_id` TẤT ĐỊNH từ chính dữ kiện nghiệp vụ (id ván, id đơn hàng, khoá idempotency),
-- nên trường đó luôn lặp lại. Còn `occurred_at`:
--
--   * `match_end`          → lấy `endedAt` của envelope   → TẤT ĐỊNH ⇒ khử trùng ở tầng database.
--   * `campaign_level_complete` → lấy `campaign_plays.completed_at` → TẤT ĐỊNH ⇒ khử trùng được.
--   * `purchase_fulfilled` → lấy `purchase_orders.updated_at`       → TẤT ĐỊNH ⇒ khử trùng được.
--   * `energy_spend` / `energy_grant` → RPC không trả về mốc thời gian nào ⇒ dùng giờ của request
--     ⇒ gọi lại (client bấm hai lần, mạng chập chờn) CÓ THỂ sinh hai hàng cùng `event_id`.
--
-- Vì vậy MỌI truy vấn tổng hợp trên sự kiện server phải đếm `count(distinct event_id)`, không phải
-- `count(*)`. Đây là quy ước bắt buộc, không phải lời khuyên — xem `.implements/analytics-queries.md`
-- (lát a1.5). Sửa RPC năng lượng để trả về mốc thời gian là cách đóng nốt lỗ này về sau.
create index if not exists analytics_events_server_dedupe_idx
  on public.analytics_events (event_id)
  where source = 'server';

commit;
