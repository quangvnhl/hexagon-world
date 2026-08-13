begin;

create table public.coin_packages (
  id uuid primary key default gen_random_uuid(),
  sku text not null unique,
  name text not null,
  coin_amount bigint not null check (coin_amount > 0),
  stars_amount bigint not null check (stars_amount > 0),
  active boolean not null default true,
  sort_order integer not null default 0,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index coin_packages_active_sort_idx
  on public.coin_packages(active, sort_order, id);

insert into public.coin_packages(sku, name, coin_amount, stars_amount, active, sort_order)
values
  ('starter', 'Starter', 100, 25, true, 10),
  ('popular', 'Popular', 500, 100, true, 20),
  ('mega', 'Mega', 1200, 200, true, 30)
on conflict (sku) do update set
  name = excluded.name,
  coin_amount = excluded.coin_amount,
  stars_amount = excluded.stars_amount,
  active = excluded.active,
  sort_order = excluded.sort_order,
  updated_at = now();

alter table public.purchase_orders
  add column product_kind text not null default 'shop_item',
  add column coin_package_id uuid references public.coin_packages(id) on delete restrict,
  add column coin_amount bigint,
  add column expires_at timestamptz;

alter table public.purchase_orders
  alter column item_id drop not null,
  alter column price_id drop not null;

alter table public.purchase_orders
  add constraint purchase_orders_product_kind_check
    check (product_kind in ('shop_item', 'coin_package')),
  add constraint purchase_orders_product_shape_check
    check (
      (
        product_kind = 'shop_item'
        and item_id is not null
        and price_id is not null
        and coin_package_id is null
        and coin_amount is null
      )
      or
      (
        product_kind = 'coin_package'
        and platform = 'telegram'
        and currency_code = 'XTR'
        and amount > 0
        and item_id is null
        and price_id is null
        and coin_package_id is not null
        and coin_amount > 0
      )
    ),
  add constraint purchase_orders_expiry_check
    check (expires_at is null or expires_at > created_at);

create index purchase_orders_coin_package_idx
  on public.purchase_orders(coin_package_id, created_at desc)
  where product_kind = 'coin_package';

-- A Telegram Stars order can have at most one successful charge. The provider's
-- charge-id uniqueness already prevents one charge from being used by two orders.
create unique index payment_transactions_one_succeeded_telegram_order_idx
  on public.payment_transactions(order_id)
  where provider = 'telegram_stars' and status = 'succeeded';

create or replace function public.fulfill_telegram_stars_coin_order(
  p_order_id uuid,
  p_charge_id text,
  p_amount bigint,
  p_raw_event_hash text
) returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_order public.purchase_orders%rowtype;
  v_existing_payment public.payment_transactions%rowtype;
  v_balance bigint;
begin
  if p_order_id is null
     or nullif(btrim(p_charge_id), '') is null
     or p_amount <= 0
     or nullif(btrim(p_raw_event_hash), '') is null then
    raise exception 'invalid_payment_event';
  end if;

  select *
    into v_order
    from public.purchase_orders
   where id = p_order_id
   for update;

  if not found
     or v_order.platform <> 'telegram'
     or v_order.currency_code <> 'XTR'
     or v_order.product_kind <> 'coin_package'
     or v_order.coin_package_id is null
     or v_order.coin_amount is null
     or v_order.coin_amount <= 0 then
    raise exception 'invalid_order';
  end if;

  -- A repeated successful_payment update with the same charge is a no-op, but a
  -- charge already attached to another order (or with different facts) is rejected.
  select *
    into v_existing_payment
    from public.payment_transactions
   where provider = 'telegram_stars'
     and external_charge_id = p_charge_id
   for update;

  if found then
    if v_existing_payment.order_id = p_order_id
       and v_existing_payment.status = 'succeeded'
       and v_existing_payment.amount = p_amount
       and v_existing_payment.currency = 'XTR'
       and v_order.status = 'fulfilled' then
      return p_order_id;
    end if;
    raise exception 'duplicate_charge';
  end if;

  if v_order.status <> 'pending' then
    raise exception 'order_not_pending';
  end if;
  if v_order.amount <> p_amount then
    raise exception 'amount_mismatch';
  end if;
  -- Expiry is enforced before Telegram pre-checkout is approved. A confirmed
  -- successful_payment may arrive after that deadline, so fulfillment must not
  -- leave a charged player without the purchased coin.

  if exists (
    select 1
      from public.payment_transactions
     where order_id = p_order_id
       and provider = 'telegram_stars'
       and status = 'succeeded'
  ) or exists (
    select 1
      from public.wallet_ledger
     where player_id = v_order.player_id
       and currency_code = 'coin'
       and reference_type = 'purchase_order'
       and reference_id = p_order_id::text
  ) then
    raise exception 'order_already_fulfilled';
  end if;

  insert into public.payment_transactions(
    order_id,
    provider,
    external_charge_id,
    amount,
    currency,
    status,
    raw_event_hash
  ) values (
    p_order_id,
    'telegram_stars',
    p_charge_id,
    p_amount,
    'XTR',
    'succeeded',
    p_raw_event_hash
  );

  insert into public.player_wallets(player_id, currency_code)
  values (v_order.player_id, 'coin')
  on conflict (player_id, currency_code) do nothing;

  select balance
    into v_balance
    from public.player_wallets
   where player_id = v_order.player_id
     and currency_code = 'coin'
   for update;

  v_balance := v_balance + v_order.coin_amount;

  update public.player_wallets
     set balance = v_balance,
         version = version + 1,
         updated_at = now()
   where player_id = v_order.player_id
     and currency_code = 'coin';

  insert into public.wallet_ledger(
    player_id,
    currency_code,
    delta,
    reason,
    reference_type,
    reference_id,
    balance_after
  ) values (
    v_order.player_id,
    'coin',
    v_order.coin_amount,
    'telegram_stars_purchase',
    'purchase_order',
    p_order_id::text,
    v_balance
  );

  update public.purchase_orders
     set status = 'fulfilled',
         updated_at = now()
   where id = p_order_id;

  return p_order_id;
end;
$$;

alter table public.coin_packages enable row level security;

revoke all on public.coin_packages from anon, authenticated;
grant select on public.coin_packages to service_role;
revoke all on function public.fulfill_telegram_stars_coin_order(uuid, text, bigint, text)
  from public, anon, authenticated;
grant execute on function public.fulfill_telegram_stars_coin_order(uuid, text, bigint, text)
  to service_role;

commit;
