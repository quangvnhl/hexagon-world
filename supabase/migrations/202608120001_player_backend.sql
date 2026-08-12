begin;

create extension if not exists pgcrypto;

create type public.player_status as enum ('active', 'suspended', 'deleted');
create type public.shop_item_type as enum ('color', 'shape', 'trail');
create type public.order_status as enum ('pending', 'paid', 'fulfilled', 'cancelled', 'refunded', 'failed');
create type public.payment_status as enum ('pending', 'succeeded', 'refunded', 'failed');

create table public.players (
  id uuid primary key default gen_random_uuid(),
  display_name text not null check (char_length(display_name) between 1 and 32),
  first_source text not null,
  last_source text not null,
  status public.player_status not null default 'active',
  created_at timestamptz not null default now(),
  last_seen_at timestamptz not null default now(),
  deleted_at timestamptz
);

create table public.player_identities (
  id uuid primary key default gen_random_uuid(),
  player_id uuid not null references public.players(id) on delete cascade,
  platform text not null,
  provider text not null,
  provider_user_id text not null,
  provider_username text,
  verified_at timestamptz not null default now(),
  metadata jsonb not null default '{}'::jsonb,
  unique (platform, provider, provider_user_id)
);
create index player_identities_player_idx on public.player_identities(player_id);

create table public.player_sessions (
  id uuid primary key default gen_random_uuid(),
  player_id uuid not null references public.players(id) on delete cascade,
  source text not null,
  token_hash text not null unique,
  attribution jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  expires_at timestamptz not null,
  last_seen_at timestamptz not null default now(),
  revoked_at timestamptz
);
create index player_sessions_active_idx on public.player_sessions(token_hash, expires_at)
  where revoked_at is null;

create table public.player_profiles (
  player_id uuid primary key references public.players(id) on delete cascade,
  selected_color text not null,
  selected_shape text not null,
  selected_trail_pattern text not null,
  updated_at timestamptz not null default now()
);

create table public.player_stats (
  player_id uuid primary key references public.players(id) on delete cascade,
  matches bigint not null default 0 check (matches >= 0),
  wins bigint not null default 0 check (wins >= 0),
  kills bigint not null default 0 check (kills >= 0),
  deaths bigint not null default 0 check (deaths >= 0),
  territory_captured bigint not null default 0 check (territory_captured >= 0),
  updated_at timestamptz not null default now()
);

create table public.shop_items (
  id uuid primary key default gen_random_uuid(),
  sku text not null unique,
  type public.shop_item_type not null,
  asset_key text not null unique,
  name text not null,
  rarity text not null default 'common',
  active boolean not null default true,
  is_default_free boolean not null default false,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create unique index one_default_item_per_type
  on public.shop_items(type) where is_default_free;

create table public.shop_prices (
  id uuid primary key default gen_random_uuid(),
  item_id uuid not null references public.shop_items(id) on delete cascade,
  platform text not null,
  currency_code text not null check (currency_code in ('coin', 'XTR')),
  amount bigint not null check (amount >= 0),
  starts_at timestamptz not null default now(),
  ends_at timestamptz,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  check (ends_at is null or ends_at > starts_at)
);
create index shop_prices_lookup_idx
  on public.shop_prices(item_id, platform, currency_code, active, starts_at, ends_at);

create table public.player_wallets (
  player_id uuid not null references public.players(id) on delete cascade,
  currency_code text not null,
  balance bigint not null default 0 check (balance >= 0),
  version bigint not null default 0,
  updated_at timestamptz not null default now(),
  primary key (player_id, currency_code)
);

create table public.wallet_ledger (
  id uuid primary key default gen_random_uuid(),
  player_id uuid not null references public.players(id) on delete restrict,
  currency_code text not null,
  delta bigint not null,
  reason text not null,
  reference_type text not null,
  reference_id text not null,
  balance_after bigint not null check (balance_after >= 0),
  admin_actor text,
  created_at timestamptz not null default now(),
  unique (player_id, currency_code, reference_type, reference_id)
);
create index wallet_ledger_player_idx on public.wallet_ledger(player_id, created_at desc);

create table public.player_inventory (
  id uuid primary key default gen_random_uuid(),
  player_id uuid not null references public.players(id) on delete cascade,
  item_id uuid not null references public.shop_items(id) on delete restrict,
  quantity integer not null default 1 check (quantity > 0),
  acquired_via text not null,
  acquired_ref text not null,
  created_at timestamptz not null default now(),
  unique (player_id, item_id)
);

create table public.player_loadouts (
  player_id uuid primary key references public.players(id) on delete cascade,
  color_item_id uuid references public.shop_items(id) on delete restrict,
  shape_item_id uuid references public.shop_items(id) on delete restrict,
  trail_item_id uuid references public.shop_items(id) on delete restrict,
  updated_at timestamptz not null default now()
);

create table public.purchase_orders (
  id uuid primary key default gen_random_uuid(),
  player_id uuid not null references public.players(id) on delete restrict,
  platform text not null,
  item_id uuid not null references public.shop_items(id) on delete restrict,
  price_id uuid not null references public.shop_prices(id) on delete restrict,
  amount bigint not null check (amount >= 0),
  currency_code text not null,
  status public.order_status not null default 'pending',
  idempotency_key text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (player_id, idempotency_key)
);

create table public.payment_transactions (
  id uuid primary key default gen_random_uuid(),
  order_id uuid not null references public.purchase_orders(id) on delete restrict,
  provider text not null,
  external_charge_id text not null,
  amount bigint not null check (amount >= 0),
  currency text not null,
  status public.payment_status not null,
  raw_event_hash text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (provider, external_charge_id)
);

create table public.matches (
  id uuid primary key,
  room_id text not null,
  region text not null,
  mode text not null,
  started_at timestamptz not null,
  ended_at timestamptz not null,
  winner_player_id uuid references public.players(id) on delete set null,
  server_version text not null,
  created_at timestamptz not null default now()
);
create index matches_retention_idx on public.matches(ended_at);

create table public.match_players (
  match_id uuid not null references public.matches(id) on delete cascade,
  participant_key text not null,
  player_id uuid references public.players(id) on delete set null,
  platform text not null,
  is_guest boolean not null default false,
  seat_id integer not null,
  kills integer not null default 0,
  deaths integer not null default 0,
  territory_captured integer not null default 0,
  death_cause text,
  final_score integer not null default 0,
  placement integer,
  primary key (match_id, participant_key)
);

create table public.processed_events (
  event_id uuid primary key,
  kind text not null,
  processed_at timestamptz not null default now()
);

create or replace function public.create_player_with_defaults(
  p_platform text,
  p_provider text,
  p_provider_user_id text,
  p_display_name text,
  p_provider_username text default null,
  p_metadata jsonb default '{}'::jsonb
) returns uuid
language plpgsql security definer set search_path = public
as $$
declare
  v_player_id uuid;
  v_item record;
begin
  select player_id into v_player_id
  from player_identities
  where platform = p_platform and provider = p_provider and provider_user_id = p_provider_user_id;

  if v_player_id is not null then
    update players set last_seen_at = now(), last_source = p_platform where id = v_player_id;
    return v_player_id;
  end if;

  insert into players(display_name, first_source, last_source)
  values (left(coalesce(nullif(trim(p_display_name), ''), 'Player'), 32), p_platform, p_platform)
  returning id into v_player_id;

  insert into player_identities(player_id, platform, provider, provider_user_id, provider_username, metadata)
  values (v_player_id, p_platform, p_provider, p_provider_user_id, p_provider_username, coalesce(p_metadata, '{}'::jsonb));

  insert into player_stats(player_id) values (v_player_id);
  insert into player_wallets(player_id, currency_code) values (v_player_id, 'coin');

  for v_item in select id, type, asset_key from shop_items where active and is_default_free loop
    insert into player_inventory(player_id, item_id, acquired_via, acquired_ref)
    values (v_player_id, v_item.id, 'default', 'account-created') on conflict do nothing;
  end loop;

  insert into player_loadouts(player_id, color_item_id, shape_item_id, trail_item_id)
  select v_player_id,
    (array_agg(id) filter (where type = 'color'))[1],
    (array_agg(id) filter (where type = 'shape'))[1],
    (array_agg(id) filter (where type = 'trail'))[1]
  from shop_items where active and is_default_free;

  insert into player_profiles(player_id, selected_color, selected_shape, selected_trail_pattern)
  select v_player_id,
    coalesce(max(asset_key) filter (where type = 'color'), 'color:0'),
    coalesce(max(asset_key) filter (where type = 'shape'), 'shape:cube'),
    coalesce(max(asset_key) filter (where type = 'trail'), 'trail:solid')
  from shop_items where active and is_default_free;

  return v_player_id;
end;
$$;

create or replace function public.admin_grant_coin(
  p_player_id uuid,
  p_amount bigint,
  p_admin_actor text,
  p_reason text,
  p_reference_id text
) returns bigint
language plpgsql security definer set search_path = public
as $$
declare v_balance bigint;
begin
  if p_amount <= 0 then raise exception 'amount_must_be_positive'; end if;
  insert into player_wallets(player_id, currency_code) values (p_player_id, 'coin') on conflict do nothing;
  select balance into v_balance from player_wallets
    where player_id = p_player_id and currency_code = 'coin' for update;
  if exists(select 1 from wallet_ledger where player_id=p_player_id and currency_code='coin' and reference_type='admin_grant' and reference_id=p_reference_id) then
    return v_balance;
  end if;
  v_balance := v_balance + p_amount;
  update player_wallets set balance=v_balance, version=version+1, updated_at=now()
    where player_id=p_player_id and currency_code='coin';
  insert into wallet_ledger(player_id,currency_code,delta,reason,reference_type,reference_id,balance_after,admin_actor)
  values(p_player_id,'coin',p_amount,p_reason,'admin_grant',p_reference_id,v_balance,p_admin_actor);
  return v_balance;
end;
$$;

create or replace function public.configure_default_shop_items(
  p_color_asset_key text,
  p_shape_asset_key text,
  p_trail_asset_key text
) returns boolean
language plpgsql security definer set search_path = public
as $$
begin
  if not exists(select 1 from shop_items where type='color' and asset_key=p_color_asset_key and active)
    or not exists(select 1 from shop_items where type='shape' and asset_key=p_shape_asset_key and active)
    or not exists(select 1 from shop_items where type='trail' and asset_key=p_trail_asset_key and active)
  then raise exception 'default_asset_not_found'; end if;
  update shop_items set is_default_free=false where is_default_free;
  update shop_items set is_default_free=true
    where (type='color' and asset_key=p_color_asset_key)
       or (type='shape' and asset_key=p_shape_asset_key)
       or (type='trail' and asset_key=p_trail_asset_key);
  return true;
end;
$$;

create or replace function public.set_shop_price(
  p_item_id uuid,
  p_platform text,
  p_currency_code text,
  p_amount bigint
) returns uuid
language plpgsql security definer set search_path = public
as $$
declare v_price_id uuid;
begin
  if p_currency_code not in ('coin','XTR') or p_amount < 0 then raise exception 'invalid_price'; end if;
  if p_currency_code='XTR' and p_platform<>'telegram' then raise exception 'xtr_requires_telegram'; end if;
  if not exists(select 1 from shop_items where id=p_item_id and active) then raise exception 'item_not_found'; end if;
  update shop_prices set active=false where item_id=p_item_id and platform=p_platform and currency_code=p_currency_code and active;
  insert into shop_prices(item_id,platform,currency_code,amount) values(p_item_id,p_platform,p_currency_code,p_amount) returning id into v_price_id;
  return v_price_id;
end;
$$;

create or replace function public.purchase_item_with_coin(
  p_player_id uuid,
  p_platform text,
  p_item_id uuid,
  p_idempotency_key text
) returns uuid
language plpgsql security definer set search_path = public
as $$
declare
  v_price shop_prices%rowtype;
  v_balance bigint;
  v_order_id uuid;
begin
  select id into v_order_id from purchase_orders
    where player_id=p_player_id and idempotency_key=p_idempotency_key;
  if v_order_id is not null then return v_order_id; end if;

  if exists(select 1 from player_inventory where player_id=p_player_id and item_id=p_item_id) then
    raise exception 'item_already_owned';
  end if;

  select * into v_price from shop_prices
  where item_id=p_item_id and platform=p_platform and currency_code='coin' and active
    and starts_at <= now() and (ends_at is null or ends_at > now())
  order by starts_at desc limit 1;
  if v_price.id is null then raise exception 'price_not_found'; end if;

  insert into player_wallets(player_id,currency_code) values(p_player_id,'coin') on conflict do nothing;
  select balance into v_balance from player_wallets
    where player_id=p_player_id and currency_code='coin' for update;
  if v_balance < v_price.amount then raise exception 'insufficient_balance'; end if;

  insert into purchase_orders(player_id,platform,item_id,price_id,amount,currency_code,status,idempotency_key)
  values(p_player_id,p_platform,p_item_id,v_price.id,v_price.amount,'coin','fulfilled',p_idempotency_key)
  returning id into v_order_id;

  v_balance := v_balance - v_price.amount;
  update player_wallets set balance=v_balance,version=version+1,updated_at=now()
    where player_id=p_player_id and currency_code='coin';
  insert into wallet_ledger(player_id,currency_code,delta,reason,reference_type,reference_id,balance_after)
  values(p_player_id,'coin',-v_price.amount,'shop_purchase','purchase_order',v_order_id::text,v_balance);
  insert into player_inventory(player_id,item_id,acquired_via,acquired_ref)
  values(p_player_id,p_item_id,'coin',v_order_id::text);
  return v_order_id;
end;
$$;

create or replace function public.fulfill_telegram_stars_order(
  p_order_id uuid,
  p_charge_id text,
  p_amount bigint,
  p_raw_event_hash text
) returns uuid
language plpgsql security definer set search_path = public
as $$
declare v_order purchase_orders%rowtype;
begin
  select * into v_order from purchase_orders where id=p_order_id for update;
  if v_order.id is null or v_order.platform <> 'telegram' or v_order.currency_code <> 'XTR' then
    raise exception 'invalid_order';
  end if;
  if v_order.amount <> p_amount then raise exception 'amount_mismatch'; end if;
  if exists(select 1 from payment_transactions where provider='telegram_stars' and external_charge_id=p_charge_id) then
    return p_order_id;
  end if;
  insert into payment_transactions(order_id,provider,external_charge_id,amount,currency,status,raw_event_hash)
  values(p_order_id,'telegram_stars',p_charge_id,p_amount,'XTR','succeeded',p_raw_event_hash);
  insert into player_inventory(player_id,item_id,acquired_via,acquired_ref)
  values(v_order.player_id,v_order.item_id,'telegram_stars',p_charge_id) on conflict do nothing;
  update purchase_orders set status='fulfilled',updated_at=now() where id=p_order_id;
  return p_order_id;
end;
$$;

create or replace function public.record_match_result(p_payload jsonb) returns boolean
language plpgsql security definer set search_path = public
as $$
declare
  v_event_id uuid := (p_payload->>'eventId')::uuid;
  v_match_id uuid := (p_payload->>'matchId')::uuid;
  v_participant jsonb;
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
    if nullif(v_participant->>'playerId','') is not null then
      update player_stats set
        matches=matches+1,
        wins=wins+case when (v_participant->>'playerId')=coalesce(p_payload->>'winnerPlayerId','') then 1 else 0 end,
        kills=kills+coalesce((v_participant->>'kills')::integer,0),
        deaths=deaths+coalesce((v_participant->>'deaths')::integer,0),
        territory_captured=territory_captured+coalesce((v_participant->>'territoryCaptured')::integer,0),
        updated_at=now()
      where player_id=(v_participant->>'playerId')::uuid;
    end if;
  end loop;
  return true;
end;
$$;

create or replace function public.purge_old_match_history(p_retention_days integer default 30)
returns bigint language plpgsql security definer set search_path=public
as $$
declare v_count bigint;
begin
  delete from matches where ended_at < now() - make_interval(days => greatest(1,p_retention_days));
  get diagnostics v_count = row_count;
  return v_count;
end;
$$;

alter table public.players enable row level security;
alter table public.player_identities enable row level security;
alter table public.player_sessions enable row level security;
alter table public.player_profiles enable row level security;
alter table public.player_stats enable row level security;
alter table public.shop_items enable row level security;
alter table public.shop_prices enable row level security;
alter table public.player_wallets enable row level security;
alter table public.wallet_ledger enable row level security;
alter table public.player_inventory enable row level security;
alter table public.player_loadouts enable row level security;
alter table public.purchase_orders enable row level security;
alter table public.payment_transactions enable row level security;
alter table public.matches enable row level security;
alter table public.match_players enable row level security;
alter table public.processed_events enable row level security;

revoke all on all tables in schema public from anon, authenticated;
revoke all on all functions in schema public from public, anon, authenticated;
grant execute on function public.create_player_with_defaults(text,text,text,text,text,jsonb) to service_role;
grant execute on function public.admin_grant_coin(uuid,bigint,text,text,text) to service_role;
grant execute on function public.configure_default_shop_items(text,text,text) to service_role;
grant execute on function public.set_shop_price(uuid,text,text,bigint) to service_role;
grant execute on function public.purchase_item_with_coin(uuid,text,uuid,text) to service_role;
grant execute on function public.fulfill_telegram_stars_order(uuid,text,bigint,text) to service_role;
grant execute on function public.record_match_result(jsonb) to service_role;
grant execute on function public.purge_old_match_history(integer) to service_role;

commit;
