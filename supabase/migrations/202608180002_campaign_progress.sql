begin;

-- Tiến độ Campaign + cổng trả-tiền-bằng-năng-lượng (doc 28 §E4).
--
-- LUỒNG chống gian lận (sim chạy client, nhưng cổng + thưởng server-authoritative):
--   start_campaign_level → TRỪ 1 năng lượng (idempotent) + tạo 1 "play" (nonce trả tiền).
--   complete_campaign_level(playId) → TIÊU play đó (chỉ 1 lần) → mở khóa cấp kế + phát thưởng.
-- Không có play (chưa trả năng lượng) ⇒ không complete được. Mở khóa/thưởng KHÔNG tin client.

-- Một lượt chơi ĐÃ TRẢ năng lượng. `idempotency_key` chống double-charge; `completed_at` chống
-- nhận thưởng nhiều lần.
create table public.campaign_plays (
  id uuid primary key default gen_random_uuid(),
  player_id uuid not null references public.players(id) on delete cascade,
  level_id text not null,
  idempotency_key text not null,
  created_at timestamptz not null default now(),
  completed_at timestamptz,
  outcome text,
  unique (player_id, idempotency_key)
);
create index campaign_plays_player_idx on public.campaign_plays(player_id, created_at desc);

create table public.player_level_progress (
  player_id uuid not null references public.players(id) on delete cascade,
  level_id text not null,
  status text not null default 'cleared',
  stars integer not null default 0 check (stars between 0 and 3),
  best_score integer not null default 0 check (best_score >= 0),
  completed_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (player_id, level_id)
);

-- BẮT ĐẦU cấp: trừ 1 năng lượng (idempotent qua ledger) + tạo/đọc play tương ứng idempotency_key.
-- KHÔNG kiểm mở khóa ở đây (server kiểm bằng catalog shared trước khi gọi). Trả playId + năng lượng.
create or replace function public.start_campaign_level(
  p_player_id uuid,
  p_level_id text,
  p_idempotency_key text
) returns jsonb language plpgsql security definer set search_path = public
as $$
declare v_play_id uuid; v_energy jsonb;
begin
  select id into v_play_id from campaign_plays
    where player_id = p_player_id and idempotency_key = p_idempotency_key;
  if v_play_id is not null then
    -- replay: đã trừ + đã tạo play → trả nguyên trạng (không trừ lần nữa).
    return jsonb_build_object('playId', v_play_id, 'energy', read_energy(p_player_id));
  end if;

  -- Trừ 1 năng lượng (idempotent theo idempotency_key). Ném 'insufficient_energy' nếu không đủ.
  v_energy := spend_energy(p_player_id, 1, 'campaign_start', 'campaign_play', p_idempotency_key);

  insert into campaign_plays(player_id, level_id, idempotency_key)
    values (p_player_id, p_level_id, p_idempotency_key)
    returning id into v_play_id;

  return jsonb_build_object('playId', v_play_id, 'energy', v_energy);
end;
$$;

-- HOÀN TẤT cấp: tiêu play (chỉ 1 lần) → upsert progress (giữ MAX sao/điểm) + phát thưởng.
-- `p_rewards` = {coin,xp,energy} do SERVER lấy từ catalog (client không gửi số thưởng).
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

  return (select to_jsonb(p) from player_level_progress p
          where p.player_id = p_player_id and p.level_id = v_play.level_id);
end;
$$;

alter table public.campaign_plays enable row level security;
alter table public.player_level_progress enable row level security;

revoke all on public.campaign_plays, public.player_level_progress from anon, authenticated;
revoke all on function public.start_campaign_level(uuid, text, text) from public, anon, authenticated;
revoke all on function public.complete_campaign_level(uuid, uuid, integer, integer, jsonb) from public, anon, authenticated;
grant execute on function public.start_campaign_level(uuid, text, text) to service_role;
grant execute on function public.complete_campaign_level(uuid, uuid, integer, integer, jsonb) to service_role;

commit;
