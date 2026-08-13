begin;

-- Server-owned progression tuning. Keeping one row makes the match-result RPC
-- deterministic while still allowing operators to tune rewards without a deploy.
create table public.progression_rules (
  singleton boolean primary key default true check (singleton),
  base_match_xp bigint not null default 20 check (base_match_xp >= 0),
  win_bonus_xp bigint not null default 100 check (win_bonus_xp >= 0),
  xp_per_kill bigint not null default 10 check (xp_per_kill >= 0),
  territory_units_per_xp integer not null default 10 check (territory_units_per_xp > 0),
  max_kills_rewarded integer not null default 100 check (max_kills_rewarded >= 0),
  max_territory_rewarded integer not null default 100000 check (max_territory_rewarded >= 0),
  max_xp_per_match bigint not null default 5000 check (max_xp_per_match >= 0),
  updated_at timestamptz not null default now()
);

insert into public.progression_rules(singleton) values (true);

-- xp_required is cumulative XP at the beginning of a level. The seeded curve
-- is intentionally data-driven so it can be replaced without changing code.
create table public.progression_levels (
  level integer primary key check (level >= 1),
  xp_required bigint not null unique check (xp_required >= 0),
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

insert into public.progression_levels(level, xp_required)
select level, 100::bigint * (level - 1)::bigint * (level - 1)::bigint
from generate_series(1, 100) as level;

create table public.player_progression (
  player_id uuid primary key references public.players(id) on delete cascade,
  total_xp bigint not null default 0 check (total_xp >= 0),
  level integer not null default 1 check (level >= 1),
  updated_at timestamptz not null default now()
);

create table public.player_xp_ledger (
  id uuid primary key default gen_random_uuid(),
  player_id uuid not null references public.players(id) on delete cascade,
  event_id uuid not null references public.processed_events(event_id) on delete restrict,
  match_id uuid not null,
  xp_delta bigint not null check (xp_delta >= 0),
  reason jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  unique (player_id, event_id)
);
create index player_xp_ledger_player_idx
  on public.player_xp_ledger(player_id, created_at desc);

alter table public.match_players
  add column xp_earned bigint not null default 0 check (xp_earned >= 0);

create or replace function public.progression_level_for_xp(p_total_xp bigint)
returns integer language sql stable security definer set search_path = public
as $$
  select coalesce(max(level), 1)
  from progression_levels
  where xp_required <= greatest(coalesce(p_total_xp, 0), 0);
$$;

create or replace function public.ensure_player_progression()
returns trigger language plpgsql security definer set search_path = public
as $$
begin
  insert into player_progression(player_id) values (new.id) on conflict do nothing;
  return new;
end;
$$;

create trigger players_create_progression
after insert on public.players
for each row execute function public.ensure_player_progression();

insert into public.player_progression(player_id)
select id from public.players
on conflict do nothing;

-- Match results are accepted only through the service-role RPC. Reward inputs
-- are normalized and capped here, and guests never receive persistent XP.
create or replace function public.record_match_result(p_payload jsonb) returns boolean
language plpgsql security definer set search_path = public
as $$
declare
  v_event_id uuid := (p_payload->>'eventId')::uuid;
  v_match_id uuid := (p_payload->>'matchId')::uuid;
  v_winner_player_id uuid := nullif(p_payload->>'winnerPlayerId','')::uuid;
  v_participant jsonb;
  v_player_id uuid;
  v_kills integer;
  v_deaths integer;
  v_territory integer;
  v_score integer;
  v_xp bigint;
  v_is_authenticated boolean;
  v_rules progression_rules%rowtype;
begin
  select * into v_rules from progression_rules where singleton = true;
  if not found then raise exception 'progression_rules_missing'; end if;

  insert into processed_events(event_id,kind) values(v_event_id,'match_result') on conflict do nothing;
  if not found then return false; end if;

  insert into matches(id,room_id,region,mode,started_at,ended_at,winner_player_id,server_version)
  values(v_match_id,p_payload->>'roomId',p_payload->>'region',p_payload->>'mode',
    (p_payload->>'startedAt')::timestamptz,(p_payload->>'endedAt')::timestamptz,
    v_winner_player_id,p_payload->>'serverVersion');

  for v_participant in select * from jsonb_array_elements(p_payload->'players') loop
    v_player_id := nullif(v_participant->>'playerId','')::uuid;
    v_kills := least(greatest(coalesce((v_participant->>'kills')::integer, 0), 0), 1000000);
    v_deaths := least(greatest(coalesce((v_participant->>'deaths')::integer, 0), 0), 1000000);
    v_territory := least(greatest(coalesce((v_participant->>'territoryCaptured')::integer, 0), 0), 100000000);
    v_score := least(greatest(coalesce((v_participant->>'finalScore')::integer, 0), 0), 100000000);

    v_is_authenticated := v_player_id is not null
      and not coalesce((v_participant->>'isGuest')::boolean, false)
      and exists (
        select 1 from players p
        where p.id = v_player_id and p.status = 'active'
          and exists (select 1 from player_identities i where i.player_id = p.id)
      );

    if v_is_authenticated then
      v_xp := least(
        v_rules.max_xp_per_match,
        v_rules.base_match_xp
          + least(v_kills, v_rules.max_kills_rewarded)::bigint * v_rules.xp_per_kill
          + floor(least(v_territory, v_rules.max_territory_rewarded)::numeric / v_rules.territory_units_per_xp)::bigint
          + case when v_player_id = v_winner_player_id then v_rules.win_bonus_xp else 0 end
      );
    else
      v_xp := 0;
    end if;

    insert into match_players(match_id,participant_key,player_id,platform,is_guest,seat_id,kills,deaths,territory_captured,death_cause,final_score,placement,xp_earned)
    values(v_match_id,v_participant->>'participantKey',v_player_id,
      v_participant->>'platform',coalesce((v_participant->>'isGuest')::boolean,false),
      (v_participant->>'seatId')::integer,v_kills,v_deaths,v_territory,
      v_participant->>'deathCause',v_score,
      nullif(v_participant->>'placement','')::integer,v_xp);

    if v_is_authenticated then
      update player_stats set
        matches=matches+1,
        wins=wins+case when v_player_id=v_winner_player_id then 1 else 0 end,
        kills=kills+v_kills,
        deaths=deaths+v_deaths,
        territory_captured=territory_captured+v_territory,
        updated_at=now()
      where player_id=v_player_id;

      insert into player_progression(player_id,total_xp,level,updated_at)
      values(v_player_id,v_xp,progression_level_for_xp(v_xp),now())
      on conflict (player_id) do update set
        total_xp=player_progression.total_xp+excluded.total_xp,
        level=progression_level_for_xp(player_progression.total_xp+excluded.total_xp),
        updated_at=now();

      insert into player_xp_ledger(player_id,event_id,match_id,xp_delta,reason)
      values(v_player_id,v_event_id,v_match_id,v_xp,jsonb_build_object(
        'base',v_rules.base_match_xp,
        'kills',least(v_kills,v_rules.max_kills_rewarded),
        'territory',least(v_territory,v_rules.max_territory_rewarded),
        'won',v_player_id=v_winner_player_id
      ));
    end if;
  end loop;
  return true;
end;
$$;

alter table public.progression_rules enable row level security;
alter table public.progression_levels enable row level security;
alter table public.player_progression enable row level security;
alter table public.player_xp_ledger enable row level security;

revoke all on public.progression_rules, public.progression_levels, public.player_progression, public.player_xp_ledger
  from anon, authenticated;
revoke all on function public.progression_level_for_xp(bigint) from public, anon, authenticated;
revoke all on function public.ensure_player_progression() from public, anon, authenticated;
revoke all on function public.record_match_result(jsonb) from public, anon, authenticated;
grant execute on function public.record_match_result(jsonb) to service_role;

commit;
