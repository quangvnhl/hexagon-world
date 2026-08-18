begin;

-- Mua NĂNG LƯỢNG bằng coin (doc 28 §4 — nguồn nạp ngoài regen). Giá đặt ở energy_rules
-- (chỉnh không cần deploy). Tái dùng ví coin + grant_energy đã có, idempotent.

alter table public.energy_rules
  add column if not exists refill_coin_cost integer not null default 100 check (refill_coin_cost >= 0),
  add column if not exists refill_energy_amount integer not null default 20 check (refill_energy_amount > 0);

-- Bổ sung giá vào read_energy để client dựng nút mua (giữ nguyên các trường cũ).
create or replace function public.read_energy(p_player_id uuid)
returns jsonb language plpgsql stable security definer set search_path = public
as $$
declare
  v_max integer; v_interval integer; v_cost integer; v_amount integer;
  v_stored integer; v_last timestamptz;
  v_gained integer; v_current integer; v_next timestamptz;
begin
  select energy_max, regen_interval_seconds, refill_coin_cost, refill_energy_amount
    into v_max, v_interval, v_cost, v_amount from energy_rules where singleton = true;
  select energy_current, last_refill_at into v_stored, v_last from player_energy where player_id = p_player_id;
  if v_stored is null then
    return jsonb_build_object('current', v_max, 'max', v_max, 'regen_interval_seconds', v_interval,
      'next_at', null, 'refill_coin_cost', v_cost, 'refill_energy_amount', v_amount);
  end if;
  v_gained := floor(greatest(0, extract(epoch from (now() - v_last))) / v_interval);
  v_current := least(v_max, v_stored + v_gained);
  if v_current >= v_max then v_next := null;
  else v_next := v_last + make_interval(secs => (v_gained + 1) * v_interval); end if;
  return jsonb_build_object('current', v_current, 'max', v_max, 'regen_interval_seconds', v_interval,
    'next_at', v_next, 'refill_coin_cost', v_cost, 'refill_energy_amount', v_amount);
end;
$$;

-- Mua 1 gói năng lượng bằng coin. Idempotent theo p_idempotency_key (cả trừ coin lẫn cộng năng lượng).
create or replace function public.purchase_energy_with_coin(
  p_player_id uuid,
  p_idempotency_key text
) returns jsonb language plpgsql security definer set search_path = public
as $$
declare
  v_cost integer; v_amount integer; v_balance bigint;
begin
  select refill_coin_cost, refill_energy_amount into v_cost, v_amount from energy_rules where singleton = true;

  -- Đã xử lý key này rồi? → trả nguyên trạng (không trừ/cộng lần nữa).
  if exists(select 1 from wallet_ledger
            where player_id = p_player_id and currency_code = 'coin'
              and reference_type = 'energy_purchase' and reference_id = p_idempotency_key) then
    return read_energy(p_player_id);
  end if;

  insert into player_wallets(player_id, currency_code) values (p_player_id, 'coin') on conflict do nothing;
  select balance into v_balance from player_wallets
    where player_id = p_player_id and currency_code = 'coin' for update;
  if v_balance < v_cost then raise exception 'insufficient_coin'; end if;

  v_balance := v_balance - v_cost;
  update player_wallets set balance = v_balance, version = version + 1, updated_at = now()
    where player_id = p_player_id and currency_code = 'coin';
  insert into wallet_ledger(player_id, currency_code, delta, reason, reference_type, reference_id, balance_after)
    values (p_player_id, 'coin', -v_cost, 'energy_purchase', 'energy_purchase', p_idempotency_key, v_balance);

  return grant_energy(p_player_id, v_amount, 'energy_purchase', 'energy_purchase', p_idempotency_key);
end;
$$;

revoke all on function public.purchase_energy_with_coin(uuid, text) from public, anon, authenticated;
grant execute on function public.purchase_energy_with_coin(uuid, text) to service_role;

commit;
