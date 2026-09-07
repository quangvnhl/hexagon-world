begin;

-- doc 35 §A3 lớp 2 (lát a3.2) — hạ tầng cho trần "số lần hoàn thành mỗi cấp mỗi ngày".
--
-- Phép đếm là `count(*) where player_id = ? and level_id = ? and completed_at >= <00:00 UTC>`.
-- Index sẵn có `campaign_plays(player_id, created_at desc)` KHÔNG phục vụ được câu này: nó không
-- có `level_id`, và nó sắp theo `created_at` chứ không phải `completed_at`. Thiếu index đúng thì
-- mỗi lần nộp kết quả là một lần quét theo người chơi — đúng vào đường mà kẻ farm đang đập liên tục,
-- tức là biến chính cơ chế chống farm thành công cụ khuếch đại tải.
--
-- `where completed_at is not null` — index BỘ PHẬN: phần lớn hàng trong bảng là lượt chơi chưa
-- hoàn thành và chúng không bao giờ khớp điều kiện đếm, nên không cần nằm trong index.
create index if not exists campaign_plays_completed_daily_idx
  on public.campaign_plays (player_id, level_id, completed_at desc)
  where completed_at is not null;

comment on index public.campaign_plays_completed_daily_idx is
  'doc 35 §A3 lop 2 — phuc vu tran hoan thanh/cap/ngay trong CampaignController.countCompletionsToday.';

commit;
