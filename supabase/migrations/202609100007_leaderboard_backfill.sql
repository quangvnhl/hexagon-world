begin;

-- doc 35 §A5 — nạp `campaign_stars_total` từ dữ liệu ĐÃ CÓ.
--
-- ┌─ VÌ SAO PHẢI NẠP LẠI, VÀ VÌ SAO CHỈ NẠP MỘT BẢNG ──────────────────────────────────────────┐
-- │ `campaign_stars_total` là bảng MỌI THỜI, và nguồn sự thật của nó (`player_level_progress`)  │
-- │ đã có dữ liệu từ trước lát này. Không nạp thì người chơi cũ hiện 0 sao cho tới khi họ tình  │
-- │ cờ qua thêm một cấp nữa — một con số SAI nằm cạnh tên thật của họ, và họ sẽ là người phát   │
-- │ hiện ra chứ không phải ta.                                                                 │
-- │                                                                                            │
-- │ Hai bảng TUẦN cố ý KHÔNG nạp: chúng reset theo tuần nên tự lành trong vài ngày, và nạp lại  │
-- │ chúng đòi phải suy ra "ô chiếm được trong tuần này" từ lịch sử trận — một phép suy đoán về  │
-- │ quá khứ để đổi lấy vài ngày. Không đáng.                                                   │
-- └───────────────────────────────────────────────────────────────────────────────────────────┘
--
-- Đi qua CHÍNH `bump_leaderboard` chứ không `insert` thẳng: nếu sau này hàm đó đổi (thêm gate,
-- đổi khoá kỳ) thì bản nạp lại đi theo. Một câu insert chép tay ở đây là nguồn ghi thứ hai.
do $$
declare r record;
begin
  for r in
    select player_id, sum(stars)::bigint as tong
      from public.player_level_progress
     group by player_id
    having sum(stars) > 0
  loop
    perform public.bump_leaderboard(r.player_id, 'campaign_stars_total', r.tong, p_absolute => true);
  end loop;
end $$;

commit;
