begin;

-- doc 35 §B3 — nhiệm vụ ngày/tuần.
--
-- ┌─ TIẾN ĐỘ CHỈ ĐƯỢC CỘNG TRONG RPC SERVER ───────────────────────────────────────────────────┐
-- │ KHÔNG có endpoint nào cho client khai "tôi vừa thắng một trận". Tiến độ cộng bên trong      │
-- │ `record_match_result` và `complete_campaign_level` — đúng hai chỗ mà server đã tự biết      │
-- │ chuyện gì xảy ra.                                                                           │
-- │ Đây là cùng bài học với lỗ hổng campaign ở A3: thứ gì cấp tiền thì client không được là     │
-- │ nguồn tin. Nhiệm vụ cấp coin, nên nhiệm vụ nằm trong nhóm đó.                                │
-- └────────────────────────────────────────────────────────────────────────────────────────────┘
--
-- ┌─ KHOÁ CHU KỲ PHẢI KHỚP CLIENT ─────────────────────────────────────────────────────────────┐
-- │ `packages/shared/src/quest.ts` tính khoá tuần bằng JS. Hàm dưới đây tính bằng Postgres.     │
-- │ Hai bên PHẢI ra cùng một chuỗi, nếu không người chơi làm xong nhiệm vụ mà tiến độ rơi vào   │
-- │ chu kỳ khác — và không có gì đỏ lên, chỉ có một người chơi tưởng mình bị ăn gian.           │
-- │ ĐÃ ĐỐI CHIẾU: 1100 ngày liên tục (2024-12 → 2027-12), lệch 0 — gồm cả ba giao thừa và       │
-- │ năm 53 tuần.                                                                                │
-- └────────────────────────────────────────────────────────────────────────────────────────────┘

create table public.quest_definitions (
  id         text primary key,
  period     text not null check (period in ('daily', 'weekly')),
  goal_kind  text not null check (goal_kind in
               ('match_play', 'match_win', 'territory_capture', 'campaign_complete', 'ad_watch')),
  goal_value integer not null check (goal_value > 0),
  coin       integer not null default 0 check (coin >= 0),
  energy     integer not null default 0 check (energy >= 0),
  label      text not null,
  active     boolean not null default true,
  sort       integer not null default 0
);

-- 3 nhiệm vụ/ngày + 2 nhiệm vụ/tuần (doc 35 §10 cho phép tự chọn bộ khởi điểm).
-- Số thưởng CỐ Ý khiêm tốn — Pha 7 mở bốn nguồn phát coin cùng lúc (doc 35 Rủi ro #4).
insert into public.quest_definitions (id, period, goal_kind, goal_value, coin, energy, label, sort) values
  ('daily_play_3',       'daily',  'match_play',        3,  60, 0, 'Chơi 3 trận',                1),
  ('daily_capture_150',  'daily',  'territory_capture', 150, 80, 0, 'Chiếm 150 ô',               2),
  ('daily_campaign_1',   'daily',  'campaign_complete', 1,  70, 1, 'Hoàn thành 1 cấp Campaign',  3),
  ('weekly_play_20',     'weekly', 'match_play',        20, 300, 1, 'Chơi 20 trận trong tuần',   1),
  ('weekly_win_3',       'weekly', 'match_win',         3,  400, 2, 'Thắng 3 trận trong tuần',   2)
on conflict (id) do nothing;

create table public.player_quest_progress (
  player_id  uuid not null references public.players(id) on delete cascade,
  quest_id   text not null references public.quest_definitions(id) on delete cascade,
  -- 'YYYY-MM-DD' cho daily, 'IYYY-Www' cho weekly. Chu kỳ mới = hàng mới, nên KHÔNG cần một
  -- công việc nền nào đi reset tiến độ — thứ hay quên chạy và hay chạy sai giờ.
  period_key text not null,
  progress   integer not null default 0 check (progress >= 0),
  claimed_at timestamptz,
  updated_at timestamptz not null default now(),
  primary key (player_id, quest_id, period_key)
);

create index player_quest_progress_player_idx
  on public.player_quest_progress (player_id, period_key);

-- ---- B9: khai nguồn phát MỚI ---------------------------------------------------------------
insert into public.economy_flow_kinds (reference_type, source_group, label) values
  ('quest_reward', 'retention', 'Thưởng hoàn thành nhiệm vụ')
on conflict (reference_type) do nothing;

-- ---- Khoá chu kỳ ---------------------------------------------------------------------------
create or replace function public.quest_period_key(p_period text, p_at timestamptz default now())
returns text language sql immutable set search_path = public as $$
  select case when p_period = 'weekly'
    then to_char(p_at at time zone 'UTC', 'IYYY-"W"IW')
    else to_char(p_at at time zone 'UTC', 'YYYY-MM-DD')
  end;
$$;

-- ---- Cộng tiến độ --------------------------------------------------------------------------
--
-- Cộng cho MỌI nhiệm vụ đang bật có cùng `goal_kind`, ở chu kỳ hiện tại của chính nhiệm vụ đó.
-- Một trận thắng vì vậy cộng cả `match_play` lẫn `match_win`, cả bản ngày lẫn bản tuần — đúng
-- như người chơi mong đợi, và không cần bên gọi biết có bao nhiêu nhiệm vụ tồn tại.
--
-- `p_amount` cộng dồn chứ không đặt: `territory_capture` nhảy theo số ô chiếm được trong trận.
create or replace function public.bump_quest_progress(
  p_player_id uuid, p_goal_kind text, p_amount integer default 1
) returns void language plpgsql security definer set search_path = public as $$
begin
  if p_player_id is null or coalesce(p_amount, 0) <= 0 then return; end if;

  insert into public.player_quest_progress (player_id, quest_id, period_key, progress)
  select p_player_id, q.id, public.quest_period_key(q.period), p_amount
  from public.quest_definitions q
  where q.active and q.goal_kind = p_goal_kind
  on conflict (player_id, quest_id, period_key) do update
    -- KHÔNG chặn trên ở `goal_value`: giữ số thật giúp trả lời "người này vượt bao nhiêu" khi
    -- có khiếu nại, và `claim` vẫn chỉ trả thưởng đúng một lần nhờ `claimed_at`.
    set progress = public.player_quest_progress.progress + excluded.progress,
        updated_at = now();
end;
$$;

-- ---- Nhận thưởng ---------------------------------------------------------------------------
create or replace function public.claim_quest_reward(p_player_id uuid, p_quest_id text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_q       public.quest_definitions%rowtype;
  v_key     text;
  v_progress integer;
  v_balance bigint;
  v_ok      boolean;
begin
  select * into v_q from public.quest_definitions where id = p_quest_id and active;
  if not found then return jsonb_build_object('ok', false, 'reason', 'quest_not_found'); end if;

  v_key := public.quest_period_key(v_q.period);
  perform 1 from public.players where id = p_player_id for update;

  -- MỘT câu lệnh vừa kiểm "đủ tiến độ" vừa kiểm "chưa nhận" vừa đánh dấu đã nhận. Tách thành
  -- select rồi update là mở một cửa sổ đua đúng bằng khoảng giữa hai câu.
  update public.player_quest_progress
     set claimed_at = now()
   where player_id = p_player_id and quest_id = p_quest_id and period_key = v_key
     and claimed_at is null and progress >= v_q.goal_value
  returning progress into v_progress;
  v_ok := found;

  if not v_ok then
    select progress into v_progress from public.player_quest_progress
      where player_id = p_player_id and quest_id = p_quest_id and period_key = v_key;
    return jsonb_build_object(
      'ok', false,
      'reason', case when v_progress is null then 'no_progress'
                     when v_progress < v_q.goal_value then 'not_completed'
                     else 'already_claimed' end,
      'progress', coalesce(v_progress, 0), 'goal_value', v_q.goal_value);
  end if;

  if v_q.coin > 0 then
    insert into public.player_wallets(player_id, currency_code) values (p_player_id, 'coin')
      on conflict do nothing;
    select balance into v_balance from public.player_wallets
      where player_id = p_player_id and currency_code = 'coin' for update;
    v_balance := v_balance + v_q.coin;
    update public.player_wallets set balance = v_balance, version = version + 1, updated_at = now()
      where player_id = p_player_id and currency_code = 'coin';
    -- `reference_id` gồm CẢ chu kỳ: cùng một nhiệm vụ tuần sau là một khoản thưởng khác, và
    -- ràng buộc duy nhất của `wallet_ledger` phải cho phép điều đó trong khi vẫn chặn nhận lại.
    insert into public.wallet_ledger
      (player_id, currency_code, delta, reason, reference_type, reference_id, balance_after)
    values (p_player_id, 'coin', v_q.coin, 'quest_reward', 'quest_reward',
            p_quest_id || ':' || v_key, v_balance)
    on conflict do nothing;
  end if;

  if v_q.energy > 0 then
    perform public.grant_energy(p_player_id, v_q.energy, 'quest_reward', 'quest_reward',
                                p_quest_id || ':' || v_key);
  end if;

  return jsonb_build_object('ok', true, 'quest_id', p_quest_id, 'coin', v_q.coin,
                            'energy', v_q.energy, 'progress', v_progress);
end;
$$;

-- ---- Đọc ------------------------------------------------------------------------------------
create or replace function public.read_quests(p_player_id uuid)
returns jsonb language sql security definer set search_path = public as $$
  select coalesce(jsonb_agg(jsonb_build_object(
           'id', q.id, 'period', q.period, 'goal_kind', q.goal_kind, 'goal_value', q.goal_value,
           'coin', q.coin, 'energy', q.energy, 'label', q.label,
           'period_key', public.quest_period_key(q.period),
           'progress', coalesce(p.progress, 0),
           'claimed', p.claimed_at is not null,
           'completed', coalesce(p.progress, 0) >= q.goal_value
         ) order by q.period, q.sort), '[]'::jsonb)
  from public.quest_definitions q
  left join public.player_quest_progress p
    on p.player_id = p_player_id and p.quest_id = q.id
   and p.period_key = public.quest_period_key(q.period)
  where q.active;
$$;

-- ---- Nối vào hai RPC đã có ------------------------------------------------------------------
--
-- `create or replace` GIỮ NGUYÊN chữ ký, nên không tạo hàm nạp chồng (bài học từ migration
-- 202609090001, chỗ thêm một tham số đã đẻ ra một overload và làm lời gọi cũ thành nhập nhằng).
--
-- Phần thân dưới đây là bản gốc + đúng ba dòng cộng tiến độ, không sửa gì khác.
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
    end if;
  end loop;
  return true;
end;
$$;

-- ---- complete_campaign_level: them moc campaign_complete --------------------------------
--
-- Than ham duoi day duoc CHEP BANG SCRIPT tu 202608180002 (dinh nghia DUY NHAT — da kiem:
-- khong migration nao khac dinh nghia lai ham nay), roi chen dung MOT dong bump_quest_progress.
-- Chep bang may chu khong go tay: mot ky tu sai o day se am tham doi hanh vi cap thuong
-- campaign, va khong cong nao bat duoc vi ham van chay binh thuong.
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
  return (select to_jsonb(p) from player_level_progress p
          where p.player_id = p_player_id and p.level_id = v_play.level_id);
end;
$$;

alter table public.quest_definitions      enable row level security;
alter table public.player_quest_progress  enable row level security;

commit;
