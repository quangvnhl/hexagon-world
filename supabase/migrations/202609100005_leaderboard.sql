begin;

-- doc 35 §A5 — bảng xếp hạng.
--
-- ┌─ MỘT NGUỒN GHI, VÀ ĐÓ LÀ ĐIỀU KHÓ GIỮ NHẤT ────────────────────────────────────────────────┐
-- │ Điểm xếp hạng được cộng BÊN TRONG `record_match_result` / `complete_campaign_level` — hai   │
-- │ hàm mà server đã tự biết chuyện gì xảy ra. Không có endpoint nào cho client báo điểm.       │
-- │ Hai nguồn ghi vào một bảng xếp hạng là cách chắc nhất để có hai con số khác nhau cho cùng   │
-- │ một người, và người chơi sẽ là bên phát hiện ra chứ không phải ta.                          │
-- └────────────────────────────────────────────────────────────────────────────────────────────┘
--
-- ┌─ VÌ SAO `campaign_stars_total` GHI TUYỆT ĐỐI CHỨ KHÔNG CỘNG DỒN ───────────────────────────┐
-- │ Sao của campaign KHÔNG phải một dòng sự kiện — nó là trạng thái: `player_level_progress`    │
-- │ giữ `stars = greatest(cũ, mới)` cho mỗi cấp. Chơi lại một cấp đã 2 sao và được 3 sao thì    │
-- │ tổng phải tăng 1, không phải tăng 3. Cộng dồn ở đây là một cỗ máy lạm phát sao: chơi lại    │
-- │ cùng một cấp mười lần là cộng thêm mười lần điểm.                                          │
-- │ Nên chỗ này ĐỌC LẠI tổng từ nguồn sự thật rồi GHI ĐÈ. Đắt hơn một phép cộng, và đúng.       │
-- └────────────────────────────────────────────────────────────────────────────────────────────┘

create table public.leaderboard_entries (
  scope       text        not null,
  period_key  text        not null,
  player_id   uuid        not null references public.players(id) on delete cascade,
  score       bigint      not null default 0,
  updated_at  timestamptz not null default now(),
  primary key (scope, period_key, player_id)
);

-- Truy vấn duy nhất của bảng này là "top N của một (scope, kỳ)". Index phủ đúng hình dạng đó.
create index leaderboard_entries_rank_idx
  on public.leaderboard_entries (scope, period_key, score desc, updated_at);

alter table public.leaderboard_entries enable row level security;
revoke all on public.leaderboard_entries from anon, authenticated;

-- ================================================================================================
-- leaderboard_period_key — kỳ của một scope
-- ================================================================================================
--
-- GỌI LẠI `quest_period_key` chứ KHÔNG chép công thức `to_char`. Hai bản sao của một công thức
-- khoá kỳ là thứ trôi ra khỏi nhau âm thầm: sửa một chỗ, chỗ kia vẫn chạy, và tiến độ tuần của
-- nhiệm vụ với tuần của bảng xếp hạng sẽ lệch nhau đúng vào tuần giao thừa ISO.
create or replace function public.leaderboard_period_key(p_scope text, p_at timestamptz default now())
returns text language sql stable set search_path = public as $$
  select case when p_scope like 'weekly\_%' then public.quest_period_key('weekly', p_at) else 'all' end;
$$;

-- ================================================================================================
-- bump_leaderboard — chỗ ghi DUY NHẤT
-- ================================================================================================
--
-- `p_absolute => true` để GHI ĐÈ thay vì cộng (xem khối chú thích về `campaign_stars_total`).
--
-- KHÔNG có gate cấm ở đây, và đó là chủ ý: lệnh cấm được thi hành lúc ĐỌC (`read_leaderboard`
-- lọc `players.status = 'active'`). Đặt gate ở đây thì cấm xong vẫn còn tên trên bảng cho tới
-- lần ghi kế tiếp — mà một người bị cấm thì theo định nghĩa là không còn ghi nữa.
-- Guest không cần chặn: guest có `player_id` null nên chưa bao giờ đi tới được hàm này.
create or replace function public.bump_leaderboard(
  p_player_id uuid,
  p_scope     text,
  p_value     bigint,
  p_absolute  boolean default false
) returns void language plpgsql security definer set search_path = public
as $$
declare
  v_key text := public.leaderboard_period_key(p_scope);
begin
  if p_player_id is null then return; end if;
  -- Điểm 0 không tạo hàng rác: một trận không chiếm được ô nào vẫn là một trận hợp lệ, nhưng nó
  -- không có lý do gì để sinh một dòng điểm 0 trong bảng xếp hạng.
  -- Áp cho CẢ hai chế độ: `campaign_stars_total` là một tổng chỉ có thể tăng (mỗi cấp giữ
  -- `greatest(cũ, mới)`), nên không có trường hợp hợp lệ nào cần ghi đè xuống 0.
  if p_value is null or p_value <= 0 then return; end if;

  insert into public.leaderboard_entries (scope, period_key, player_id, score, updated_at)
  values (p_scope, v_key, p_player_id, p_value, now())
  on conflict (scope, period_key, player_id) do update set
    -- Trong ON CONFLICT, hàng ĐANG CÓ được nhắc tới bằng tên bảng KHÔNG kèm schema.
    score = case when p_absolute then p_value else leaderboard_entries.score + p_value end,
    updated_at = now();
end;
$$;

-- ================================================================================================
-- read_leaderboard — top N + hạng của CHÍNH MÌNH
-- ================================================================================================
--
-- Hạng của mình phải tính trên TOÀN bảng chứ không phải trong top N — nếu không thì người ở hạng
-- 5000 sẽ thấy mình "không có hạng", tức là đúng thứ làm người ta bỏ bảng xếp hạng.
--
-- `rank()` chứ không `row_number()`: hai người cùng điểm thì cùng hạng. Riêng THỨ TỰ hiển thị của
-- top N vẫn phải tất định (`updated_at`, rồi `player_id`), nếu không cùng một truy vấn sẽ trả thứ
-- tự khác nhau giữa hai lần gọi và bảng sẽ nhấp nháy trước mắt người xem.
create or replace function public.read_leaderboard(
  p_scope     text,
  p_limit     integer default 20,
  p_player_id uuid default null
) returns jsonb language plpgsql stable security definer set search_path = public
as $$
declare
  v_key   text    := public.leaderboard_period_key(p_scope);
  v_limit integer := least(100, greatest(1, coalesce(p_limit, 20)));
  v_top   jsonb;
  v_me    jsonb;
begin
  with xep as (
    select e.player_id,
           e.score,
           e.updated_at,
           p.display_name,
           rank() over (order by e.score desc) as hang
      from public.leaderboard_entries e
      join public.players p on p.id = e.player_id
     where e.scope = p_scope
       and e.period_key = v_key
       -- Lệnh cấm (doc 35 §C3) đặt `status = 'suspended'` ⇒ rơi khỏi bảng NGAY, không cần backfill.
       and p.status = 'active'
  )
  select
    coalesce(jsonb_agg(jsonb_build_object(
      'rank', hang, 'playerId', player_id, 'displayName', display_name, 'score', score
    ) order by score desc, updated_at asc, player_id asc) filter (where hang <= v_limit), '[]'::jsonb),
    (select jsonb_build_object('rank', hang, 'score', score)
       from xep where player_id = p_player_id)
  into v_top, v_me
  from xep;

  return jsonb_build_object(
    'scope', p_scope,
    'periodKey', v_key,
    'top', coalesce(v_top, '[]'::jsonb),
    'me', v_me
  );
end;
$$;

-- ================================================================================================
-- record_match_result / complete_campaign_level — dựng lại để CỘNG ĐIỂM XẾP HẠNG
-- ================================================================================================
--
-- Thân hai hàm dưới đây được CHÉP BẰNG SCRIPT từ 202609100004 (định nghĩa mới nhất — script đã
-- khẳng định mỗi hàm chỉ có đúng một định nghĩa ở đó), rồi chèn đúng các dòng `bump_leaderboard`.
-- Script còn khẳng định: gỡ phần chèn ra thì ra lại BẢN GỐC TỪNG BYTE, và mốc campaign nằm SAU
-- nhánh replay. Khẳng định thứ hai là bài học của lát b3: ở đó một chuỗi neo thụt 2 dấu cách đã
-- khớp nhầm vào nhánh replay thụt 4, biến việc chơi lại thành một lỗ farm.

create or replace function public.record_match_result(p_payload jsonb) returns boolean
language plpgsql security definer set search_path = public
as $$
declare
  v_event_id uuid := (p_payload->>'eventId')::uuid;
  v_match_id uuid := (p_payload->>'matchId')::uuid;
  v_participant jsonb;
  v_player_id uuid;
begin
  insert into processed_events(event_id,kind) values(v_event_id,'match_result') on conflict do nothing;
  if not found then return false; end if;
  insert into matches(id,room_id,region,mode,started_at,ended_at,winner_player_id,server_version)
  values(v_match_id,p_payload->>'roomId',p_payload->>'region',p_payload->>'mode',
    (p_payload->>'startedAt')::timestamptz,(p_payload->>'endedAt')::timestamptz,
    nullif(p_payload->>'winnerPlayerId','')::uuid,p_payload->>'serverVersion');
  for v_participant in select * from jsonb_array_elements(p_payload->'players') loop
    insert into match_players(match_id,participant_key,player_id,platform,is_guest,seat_id,kills,deaths,territory_captured,death_cause,final_score,placement)
    values(v_match_id,v_participant->>'participantKey',nullif(v_participant->>'playerId','')::uuid,
      v_participant->>'platform',coalesce((v_participant->>'isGuest')::boolean,false),
      (v_participant->>'seatId')::integer,coalesce((v_participant->>'kills')::integer,0),
      coalesce((v_participant->>'deaths')::integer,0),coalesce((v_participant->>'territoryCaptured')::integer,0),
      v_participant->>'deathCause',coalesce((v_participant->>'finalScore')::integer,0),
      nullif(v_participant->>'placement','')::integer);
    v_player_id := nullif(v_participant->>'playerId','')::uuid;
    if v_player_id is not null then
      update player_stats set
        matches=matches+1,
        wins=wins+case when (v_participant->>'playerId')=coalesce(p_payload->>'winnerPlayerId','') then 1 else 0 end,
        kills=kills+coalesce((v_participant->>'kills')::integer,0),
        deaths=deaths+coalesce((v_participant->>'deaths')::integer,0),
        territory_captured=territory_captured+coalesce((v_participant->>'territoryCaptured')::integer,0),
        updated_at=now()
      where player_id=v_player_id;

      -- doc 35 §B3 — ba dòng DUY NHẤT thêm vào hàm này.
      perform public.bump_quest_progress(v_player_id, 'match_play', 1);
      if (v_participant->>'playerId') = coalesce(p_payload->>'winnerPlayerId','') then
        perform public.bump_quest_progress(v_player_id, 'match_win', 1);
      end if;
      perform public.bump_quest_progress(v_player_id, 'territory_capture',
        coalesce((v_participant->>'territoryCaptured')::integer, 0));

      -- doc 35 §A5 — bốn dòng DUY NHẤT thêm vào hàm này.
      perform public.bump_leaderboard(v_player_id, 'weekly_territory',
        coalesce((v_participant->>'territoryCaptured')::integer, 0));
      if (v_participant->>'playerId') = coalesce(p_payload->>'winnerPlayerId','') then
        perform public.bump_leaderboard(v_player_id, 'weekly_wins', 1);
      end if;
    end if;
  end loop;
  return true;
end;
$$;

create or replace function public.complete_campaign_level(
  p_play_id uuid,
  p_player_id uuid,
  p_stars integer,
  p_score integer,
  p_rewards jsonb
) returns jsonb language plpgsql security definer set search_path = public
as $$
declare
  v_play campaign_plays%rowtype;
  v_stars integer := least(3, greatest(0, coalesce(p_stars, 0)));
  v_score integer := greatest(0, coalesce(p_score, 0));
  v_coin bigint := greatest(0, coalesce((p_rewards->>'coin')::bigint, 0));
  v_xp bigint := greatest(0, coalesce((p_rewards->>'xp')::bigint, 0));
  v_energy integer := greatest(0, coalesce((p_rewards->>'energy')::integer, 0));
  v_balance bigint;
begin
  select * into v_play from campaign_plays where id = p_play_id and player_id = p_player_id for update;
  if v_play.id is null then raise exception 'play_not_found'; end if;

  if v_play.completed_at is not null then
    -- replay: đã tính thưởng → trả progress hiện tại, không thưởng lại.
    return (select to_jsonb(p) from player_level_progress p
            where p.player_id = p_player_id and p.level_id = v_play.level_id);
  end if;

  update campaign_plays set completed_at = now(), outcome = 'won' where id = p_play_id;

  insert into player_level_progress(player_id, level_id, status, stars, best_score, completed_at, updated_at)
    values (p_player_id, v_play.level_id, 'cleared', v_stars, v_score, now(), now())
    on conflict (player_id, level_id) do update set
      stars = greatest(player_level_progress.stars, excluded.stars),
      best_score = greatest(player_level_progress.best_score, excluded.best_score),
      updated_at = now();

  -- Thưởng coin (idempotent theo play id).
  if v_coin > 0 then
    insert into player_wallets(player_id, currency_code) values (p_player_id, 'coin') on conflict do nothing;
    select balance into v_balance from player_wallets where player_id = p_player_id and currency_code = 'coin' for update;
    v_balance := v_balance + v_coin;
    update player_wallets set balance = v_balance, version = version + 1, updated_at = now()
      where player_id = p_player_id and currency_code = 'coin';
    insert into wallet_ledger(player_id, currency_code, delta, reason, reference_type, reference_id, balance_after)
      values (p_player_id, 'coin', v_coin, 'campaign_reward', 'campaign_play', p_play_id::text, v_balance)
      on conflict do nothing;
  end if;

  -- Thưởng XP (idempotent nhờ complete chỉ chạy 1 lần / play).
  if v_xp > 0 then
    insert into player_progression(player_id, total_xp, level, updated_at)
      values (p_player_id, v_xp, progression_level_for_xp(v_xp), now())
      on conflict (player_id) do update set
        total_xp = player_progression.total_xp + excluded.total_xp,
        level = progression_level_for_xp(player_progression.total_xp + excluded.total_xp),
        updated_at = now();
  end if;

  -- Thưởng năng lượng (idempotent theo play id).
  if v_energy > 0 then
    perform grant_energy(p_player_id, v_energy, 'campaign_reward', 'campaign_play', p_play_id::text);
  end if;

  -- doc 35 §B3 — DONG DUY NHAT them vao ham nay, va no nam o duong HOAN THANH THAT.
  -- KHONG dat o nhanh replay phia tren: choi lai mot cap da xong se cong tien do moi lan,
  -- tuc la mot lo farm nhiem vu daily_campaign_1.
  perform public.bump_quest_progress(p_player_id, 'campaign_complete', 1);

  -- doc 35 §A5 — dòng DUY NHẤT thêm vào hàm này, cũng ở đường HOÀN THÀNH THẬT.
  -- Ghi ĐÈ bằng tổng đọc lại từ `player_level_progress` chứ không cộng dồn: chơi lại một cấp đã
  -- xong sẽ chạy qua đây, và cộng dồn thì mỗi lần chơi lại là một lần bơm sao.
  perform public.bump_leaderboard(p_player_id, 'campaign_stars_total',
    (select coalesce(sum(stars), 0) from player_level_progress where player_id = p_player_id),
    p_absolute => true);
  return (select to_jsonb(p) from player_level_progress p
          where p.player_id = p_player_id and p.level_id = v_play.level_id);
end;
$$;


commit;
