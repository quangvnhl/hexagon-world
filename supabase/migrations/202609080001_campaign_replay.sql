-- doc 35 §A3 lớp 3 (lát a3.3) — chỗ chứa cho việc chạy lại input để xác minh kết quả campaign.
--
-- Ba cột thêm vào `campaign_plays`, và một lý do cho từng cột:
--
--   seed          Server cấp, KHÔNG phải client chọn. Đây là điểm mấu chốt của cả lớp 3: nếu chạy
--                 lại bằng seed do client gửi thì kẻ gian chỉ cần gửi kèm một seed khớp với ván
--                 giả của mình. Cột này là bản duy nhất đáng tin.
--                 `0` giữ nghĩa "chưa có seed" — trùng với quy ước của `GameState` (seed 0 ⇒
--                 `Math.random`), nên mọi lượt chơi CŨ vẫn đọc được và chỉ đơn giản là không xác
--                 minh được.
--   input_trace   Chuỗi input client ghi lại. `jsonb` chứ không phải `text`: cần truy vấn được
--                 `input_trace->>'v'` khi đổi phiên bản định dạng.
--   verify_status Kết quả xét: null = chưa xét · pending · ok · mismatch · skipped · error.
--                 `mismatch` là ĐÁNG XEM LẠI, không phải kết luận gian lận — doc 35 §A3 lớp 3 nói
--                 rõ "lệch ⇒ đánh dấu nghi vấn, KHÔNG thu hồi tự động".
--
-- Không có cột nào NOT NULL trừ `seed` (có default), nên migration này không đụng gì tới lượt chơi
-- đang có.

alter table public.campaign_plays
  add column if not exists seed          integer not null default 0,
  add column if not exists input_trace   jsonb,
  add column if not exists verify_status text,
  add column if not exists verify_detail jsonb;

-- Chỉ mục cho câu hỏi vận hành duy nhất mà lớp này sinh ra: "còn lượt nào lệch chưa ai xem?"
-- Partial index vì đại đa số hàng có `verify_status` null hoặc 'ok'.
create index if not exists campaign_plays_verify_idx
  on public.campaign_plays (verify_status, completed_at desc)
  where verify_status is not null and verify_status <> 'ok';

-- ---- start_campaign_level: cấp seed cùng lúc tạo lượt chơi ------------------------------------
--
-- Sinh seed TRONG RPC chứ không phải ở tầng ứng dụng sau khi RPC trả về. Lý do là tính idempotent:
-- gọi lại cùng `idempotency_key` phải trả về ĐÚNG seed cũ. Nếu tầng ứng dụng ghi seed bằng một lệnh
-- UPDATE riêng thì một lần thử lại sau lỗi mạng sẽ ghi đè seed của ván đang chơi dở, và ván đó vĩnh
-- viễn không xác minh được nữa.
--
-- Dải 1..2147483647: tránh 0 vì 0 có nghĩa "không seed" ở `GameState`. Seed không cần bí mật —
-- client bắt buộc phải biết nó mới chơi được; nó chỉ cần do SERVER quyết định.
create or replace function public.start_campaign_level(
  p_player_id uuid,
  p_level_id text,
  p_idempotency_key text
) returns jsonb language plpgsql security definer set search_path = public
as $$
declare v_play_id uuid; v_energy jsonb; v_seed integer;
begin
  select id, seed into v_play_id, v_seed from campaign_plays
    where player_id = p_player_id and idempotency_key = p_idempotency_key;
  if v_play_id is not null then
    -- replay: đã trừ + đã tạo play → trả nguyên trạng (không trừ lần nữa), KÈM seed cũ.
    return jsonb_build_object('playId', v_play_id, 'seed', v_seed, 'energy', read_energy(p_player_id));
  end if;

  -- Trừ 1 năng lượng (idempotent theo idempotency_key). Ném 'insufficient_energy' nếu không đủ.
  v_energy := spend_energy(p_player_id, 1, 'campaign_start', 'campaign_play', p_idempotency_key);

  v_seed := (floor(random() * 2147483646) + 1)::integer;

  insert into campaign_plays(player_id, level_id, idempotency_key, seed)
    values (p_player_id, p_level_id, p_idempotency_key, v_seed)
    returning id into v_play_id;

  return jsonb_build_object('playId', v_play_id, 'seed', v_seed, 'energy', v_energy);
end;
$$;
