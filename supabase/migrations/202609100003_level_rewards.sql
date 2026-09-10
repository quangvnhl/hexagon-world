begin;

-- doc 35 §B4 — thưởng khi lên cấp. Biến XP từ con số trang trí thành động lực.
--
-- ┌─ HIỆN TRẠNG ĐO ĐƯỢC (2026-09-10) ──────────────────────────────────────────────────────────┐
-- │ `progression_levels` đã có 100 cấp (1..100) với `level, xp_required, metadata` — và lên cấp │
-- │ KHÔNG cấp gì cả. Người chơi thấy một con số tăng lên rồi thôi.                               │
-- │ Có sẵn cột `metadata jsonb`, nhưng doc 35 §B4 chốt cột `rewards` RIÊNG, và giữ đúng vậy:     │
-- │ trộn "dữ liệu hiển thị" với "thứ cấp tiền" vào một cột là mời một lần sửa nhãn vô tình đổi   │
-- │ tiền thưởng.                                                                                 │
-- └────────────────────────────────────────────────────────────────────────────────────────────┘
--
-- ┌─ NHẬN TẤT CẢ MỘT LẦN, IDEMPOTENT THEO TỪNG CẤP ───────────────────────────────────────────┐
-- │ `player_level_rewards_claimed(player_id, level)` là khoá chính. Nên RPC có thể quét mọi cấp │
-- │ chưa nhận và cấp một lượt: cấp nào đã nhận thì `on conflict do nothing` bỏ qua, không cần    │
-- │ client nhớ đã nhận tới đâu.                                                                  │
-- │ Quan trọng với người chơi quay lại sau một thời gian dài: họ lên 6 cấp trong một phiên và    │
-- │ không phải bấm 6 lần — nhưng vẫn không có cách nào nhận hai lần cho cùng một cấp.            │
-- └──────────────────────────────────────────────────────────────────────────────────────────┘

alter table public.progression_levels
  add column if not exists rewards jsonb not null default '{}'::jsonb;

comment on column public.progression_levels.rewards is
  'Thưởng khi ĐẠT cấp này: {"coin": n, "energy": n}. Rỗng = cấp không có thưởng. doc 35 §B4.';

-- Mốc thưởng: mỗi 5 cấp, dày hơn ở đoạn đầu để người mới thấy tiến độ sớm.
--
-- Số CỐ Ý khiêm tốn. doc 35 Rủi ro #4: Pha 7 mở bốn nguồn phát coin cùng lúc, nên mỗi nguồn bắt
-- đầu nhỏ rồi nâng theo `economy_daily` (B9). Nâng thì dễ; hạ thì người chơi coi là bị lấy mất.
update public.progression_levels set rewards = jsonb_build_object('coin', 100)
  where level in (2, 3, 4) and rewards = '{}'::jsonb;
update public.progression_levels set rewards = jsonb_build_object('coin', 250, 'energy', 1)
  where level % 5 = 0 and level between 5 and 25 and rewards = '{}'::jsonb;
update public.progression_levels set rewards = jsonb_build_object('coin', 500, 'energy', 2)
  where level % 10 = 0 and level > 25 and rewards = '{}'::jsonb;

-- ---- Sổ đã nhận -------------------------------------------------------------------------
create table public.player_level_rewards_claimed (
  player_id  uuid not null references public.players(id) on delete cascade,
  level      integer not null references public.progression_levels(level),
  coin       integer not null default 0,
  energy     integer not null default 0,
  created_at timestamptz not null default now(),
  primary key (player_id, level)
);

-- ---- B9: khai nguồn phát MỚI ---------------------------------------------------------------
insert into public.economy_flow_kinds (reference_type, source_group, label) values
  ('level_reward', 'progression', 'Thưởng đạt mốc cấp độ')
on conflict (reference_type) do nothing;

-- ---- RPC ---------------------------------------------------------------------------------
create or replace function public.claim_level_rewards(p_player_id uuid)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_level    integer;
  v_coin     integer := 0;
  v_energy   integer := 0;
  v_levels   integer[] := '{}';
  v_balance  bigint;
  r          record;
begin
  perform 1 from public.players where id = p_player_id for update;

  select level into v_level from public.player_progression where player_id = p_player_id;
  if v_level is null then
    return jsonb_build_object('claimed_levels', '[]'::jsonb, 'coin', 0, 'energy', 0, 'level', 1);
  end if;

  -- Mọi cấp ĐÃ ĐẠT, CÓ thưởng, và CHƯA nhận. `for update` trên hàng người chơi ở trên đã chặn
  -- hai request song song cùng quét ra một tập.
  for r in
    select pl.level, coalesce((pl.rewards->>'coin')::int, 0) coin,
           coalesce((pl.rewards->>'energy')::int, 0) energy
    from public.progression_levels pl
    where pl.level <= v_level
      and pl.rewards <> '{}'::jsonb
      and not exists (select 1 from public.player_level_rewards_claimed c
                      where c.player_id = p_player_id and c.level = pl.level)
    order by pl.level
  loop
    -- Ghi sổ TRƯỚC khi cấp: hai request cùng lọt tới đây thì cái thứ hai vỡ ở khoá chính và
    -- KHÔNG kịp cấp gì. Cùng một luật với điểm danh (b2).
    insert into public.player_level_rewards_claimed (player_id, level, coin, energy)
    values (p_player_id, r.level, r.coin, r.energy)
    on conflict (player_id, level) do nothing;
    if not found then
      continue;  -- request khác vừa nhận cấp này
    end if;

    v_levels := v_levels || r.level;
    v_coin   := v_coin + r.coin;
    v_energy := v_energy + r.energy;
  end loop;

  if v_coin > 0 then
    insert into public.player_wallets(player_id, currency_code) values (p_player_id, 'coin')
      on conflict do nothing;
    select balance into v_balance from public.player_wallets
      where player_id = p_player_id and currency_code = 'coin' for update;
    v_balance := v_balance + v_coin;
    update public.player_wallets set balance = v_balance, version = version + 1, updated_at = now()
      where player_id = p_player_id and currency_code = 'coin';
    -- `reference_id` là DANH SÁCH CẤP đã nhận trong lượt này. Nó vừa là khoá tự nhiên (cùng tập
    -- cấp không bao giờ nhận lại được, vì sổ ở trên đã chặn), vừa nói cho người đọc ledger biết
    -- chính xác lượt này gồm những cấp nào — thứ mà một dòng gộp "level_reward" không nói được.
    insert into public.wallet_ledger
      (player_id, currency_code, delta, reason, reference_type, reference_id, balance_after)
    values (p_player_id, 'coin', v_coin, 'level_reward', 'level_reward',
            array_to_string(v_levels, ','), v_balance)
    on conflict do nothing;
  end if;

  if v_energy > 0 then
    -- Không cho tràn: thưởng, không phải thứ người chơi trả tiền để nhận (ranh giới chốt ở
    -- migration 202609090001).
    perform public.grant_energy(p_player_id, v_energy, 'level_reward', 'level_reward',
                                array_to_string(v_levels, ','));
  end if;

  return jsonb_build_object(
    'claimed_levels', to_jsonb(v_levels), 'coin', v_coin, 'energy', v_energy, 'level', v_level);
end;
$$;

-- Đọc thuần: mốc nào đã nhận, mốc nào đang chờ, mốc kế tiếp là gì. KHÔNG cấp gì.
create or replace function public.read_level_rewards(p_player_id uuid)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_level integer;
  v_xp    bigint;
begin
  select level, total_xp into v_level, v_xp from public.player_progression where player_id = p_player_id;
  v_level := coalesce(v_level, 1);

  return jsonb_build_object(
    'level', v_level,
    'total_xp', coalesce(v_xp, 0),
    'pending', (
      select coalesce(jsonb_agg(jsonb_build_object(
               'level', pl.level,
               'coin', coalesce((pl.rewards->>'coin')::int, 0),
               'energy', coalesce((pl.rewards->>'energy')::int, 0)) order by pl.level), '[]'::jsonb)
      from public.progression_levels pl
      where pl.level <= v_level and pl.rewards <> '{}'::jsonb
        and not exists (select 1 from public.player_level_rewards_claimed c
                        where c.player_id = p_player_id and c.level = pl.level)),
    'next', (
      select jsonb_build_object('level', pl.level, 'xp_required', pl.xp_required,
               'coin', coalesce((pl.rewards->>'coin')::int, 0),
               'energy', coalesce((pl.rewards->>'energy')::int, 0))
      from public.progression_levels pl
      where pl.level > v_level and pl.rewards <> '{}'::jsonb
      order by pl.level limit 1)
  );
end;
$$;

alter table public.player_level_rewards_claimed enable row level security;

commit;
