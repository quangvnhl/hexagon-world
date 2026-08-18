begin;

-- Năng lượng server-authoritative (doc 28 §E3). Mô hình HỒI LƯỜI: chỉ lưu `energy_current` +
-- `last_refill_at`; giá trị thực = min(max, stored + floor((now-last)/interval)). Tính khi đọc,
-- và VẬT CHẤT HÓA (persist) khi spend/grant. Số kinh tế đặt ở `energy_rules` (chỉnh không cần deploy).

-- Một hàng tinh chỉnh (giống progression_rules) — CHỐT P2: max 50, hồi 1 điểm / 180 giây.
create table public.energy_rules (
  singleton boolean primary key default true check (singleton),
  energy_max integer not null default 50 check (energy_max > 0),
  regen_interval_seconds integer not null default 180 check (regen_interval_seconds > 0),
  updated_at timestamptz not null default now()
);
insert into public.energy_rules(singleton) values (true);

create table public.player_energy (
  player_id uuid primary key references public.players(id) on delete cascade,
  energy_current integer not null check (energy_current >= 0),
  last_refill_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- Sổ cái idempotent (giống wallet_ledger): mỗi (player, reference_type, reference_id) chỉ ghi 1 lần.
create table public.player_energy_ledger (
  id uuid primary key default gen_random_uuid(),
  player_id uuid not null references public.players(id) on delete restrict,
  delta integer not null,
  reason text not null,
  reference_type text not null,
  reference_id text not null,
  balance_after integer not null check (balance_after >= 0),
  created_at timestamptz not null default now(),
  unique (player_id, reference_type, reference_id)
);
create index player_energy_ledger_player_idx on public.player_energy_ledger(player_id, created_at desc);

-- Tạo hàng năng lượng (đầy) khi tạo player mới — mẫu ensure_player_progression.
create or replace function public.ensure_player_energy()
returns trigger language plpgsql security definer set search_path = public
as $$
declare v_max integer;
begin
  select energy_max into v_max from energy_rules where singleton = true;
  insert into player_energy(player_id, energy_current, last_refill_at)
  values (new.id, coalesce(v_max, 50), now()) on conflict do nothing;
  return new;
end;
$$;

create trigger players_create_energy
after insert on public.players
for each row execute function public.ensure_player_energy();

-- Backfill player hiện có (đầy năng lượng).
insert into public.player_energy(player_id, energy_current, last_refill_at)
select id, (select energy_max from energy_rules where singleton = true), now()
from public.players
on conflict do nothing;

-- ĐỌC (thuần, KHÔNG ghi): trả trạng thái năng lượng hiện tại + mốc điểm kế.
create or replace function public.read_energy(p_player_id uuid)
returns jsonb language plpgsql stable security definer set search_path = public
as $$
declare
  v_max integer; v_interval integer;
  v_stored integer; v_last timestamptz;
  v_gained integer; v_current integer; v_next timestamptz;
begin
  select energy_max, regen_interval_seconds into v_max, v_interval from energy_rules where singleton = true;
  select energy_current, last_refill_at into v_stored, v_last from player_energy where player_id = p_player_id;
  if v_stored is null then
    -- chưa có hàng (an toàn): coi như đầy từ bây giờ.
    return jsonb_build_object('current', v_max, 'max', v_max, 'regen_interval_seconds', v_interval, 'next_at', null);
  end if;
  v_gained := floor(greatest(0, extract(epoch from (now() - v_last))) / v_interval);
  v_current := least(v_max, v_stored + v_gained);
  if v_current >= v_max then
    v_next := null;
  else
    v_next := v_last + make_interval(secs => (v_gained + 1) * v_interval);
  end if;
  return jsonb_build_object('current', v_current, 'max', v_max, 'regen_interval_seconds', v_interval, 'next_at', v_next);
end;
$$;

-- TRỪ năng lượng (cổng vào cấp Campaign). Idempotent theo (reference_type, reference_id).
-- Hồi lười TRƯỚC khi trừ; ném 'insufficient_energy' nếu không đủ.
create or replace function public.spend_energy(
  p_player_id uuid,
  p_amount integer,
  p_reason text,
  p_reference_type text,
  p_reference_id text
) returns jsonb language plpgsql security definer set search_path = public
as $$
declare
  v_max integer; v_interval integer;
  v_stored integer; v_last timestamptz;
  v_gained integer; v_refilled integer; v_new_last timestamptz;
begin
  if p_amount <= 0 then raise exception 'amount_must_be_positive'; end if;
  if exists(select 1 from player_energy_ledger
            where player_id = p_player_id and reference_type = p_reference_type and reference_id = p_reference_id) then
    return read_energy(p_player_id); -- đã xử lý (replay) → trả nguyên trạng
  end if;

  select energy_max, regen_interval_seconds into v_max, v_interval from energy_rules where singleton = true;
  insert into player_energy(player_id, energy_current) values (p_player_id, v_max) on conflict do nothing;
  select energy_current, last_refill_at into v_stored, v_last from player_energy where player_id = p_player_id for update;

  v_gained := floor(greatest(0, extract(epoch from (now() - v_last))) / v_interval);
  v_refilled := least(v_max, v_stored + v_gained);
  -- Neo đồng hồ hồi: nếu đã chạm max → now(); ngược lại dời theo số điểm NGUYÊN đã hồi.
  v_new_last := case when v_stored + v_gained >= v_max then now() else v_last + make_interval(secs => v_gained * v_interval) end;

  if v_refilled < p_amount then raise exception 'insufficient_energy'; end if;
  v_refilled := v_refilled - p_amount;

  update player_energy set energy_current = v_refilled, last_refill_at = v_new_last, updated_at = now()
    where player_id = p_player_id;
  insert into player_energy_ledger(player_id, delta, reason, reference_type, reference_id, balance_after)
    values (p_player_id, -p_amount, p_reason, p_reference_type, p_reference_id, v_refilled);
  return read_energy(p_player_id);
end;
$$;

-- CỘNG năng lượng (regen thưởng / mua / quảng cáo). Idempotent; kẹp ở max (MVP không cho vượt).
create or replace function public.grant_energy(
  p_player_id uuid,
  p_amount integer,
  p_reason text,
  p_reference_type text,
  p_reference_id text
) returns jsonb language plpgsql security definer set search_path = public
as $$
declare
  v_max integer; v_interval integer;
  v_stored integer; v_last timestamptz;
  v_gained integer; v_refilled integer; v_new_last timestamptz;
begin
  if p_amount <= 0 then raise exception 'amount_must_be_positive'; end if;
  if exists(select 1 from player_energy_ledger
            where player_id = p_player_id and reference_type = p_reference_type and reference_id = p_reference_id) then
    return read_energy(p_player_id);
  end if;

  select energy_max, regen_interval_seconds into v_max, v_interval from energy_rules where singleton = true;
  insert into player_energy(player_id, energy_current) values (p_player_id, v_max) on conflict do nothing;
  select energy_current, last_refill_at into v_stored, v_last from player_energy where player_id = p_player_id for update;

  v_gained := floor(greatest(0, extract(epoch from (now() - v_last))) / v_interval);
  v_refilled := least(v_max, v_stored + v_gained);
  v_new_last := case when v_stored + v_gained >= v_max then now() else v_last + make_interval(secs => v_gained * v_interval) end;

  v_refilled := least(v_max, v_refilled + p_amount);
  -- Nếu sau khi cộng đạt/vượt max → neo đồng hồ về now() (đầy, dừng hồi).
  if v_refilled >= v_max then v_new_last := now(); end if;

  update player_energy set energy_current = v_refilled, last_refill_at = v_new_last, updated_at = now()
    where player_id = p_player_id;
  insert into player_energy_ledger(player_id, delta, reason, reference_type, reference_id, balance_after)
    values (p_player_id, p_amount, p_reason, p_reference_type, p_reference_id, v_refilled);
  return read_energy(p_player_id);
end;
$$;

alter table public.energy_rules enable row level security;
alter table public.player_energy enable row level security;
alter table public.player_energy_ledger enable row level security;

revoke all on public.energy_rules, public.player_energy, public.player_energy_ledger from anon, authenticated;
revoke all on function public.ensure_player_energy() from public, anon, authenticated;
revoke all on function public.read_energy(uuid) from public, anon, authenticated;
revoke all on function public.spend_energy(uuid, integer, text, text, text) from public, anon, authenticated;
revoke all on function public.grant_energy(uuid, integer, text, text, text) from public, anon, authenticated;
grant execute on function public.read_energy(uuid) to service_role;
grant execute on function public.spend_energy(uuid, integer, text, text, text) to service_role;
grant execute on function public.grant_energy(uuid, integer, text, text, text) to service_role;

commit;
