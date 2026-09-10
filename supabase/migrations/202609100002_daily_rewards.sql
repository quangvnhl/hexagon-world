begin;

-- doc 35 §B2 — điểm danh hằng ngày + chuỗi ngày. Mốc reset UTC (chốt #3).
--
-- ┌─ IDEMPOTENT BẰNG CẤU TRÚC, KHÔNG BẰNG KIỂM TRA ────────────────────────────────────────────┐
-- │ Khoá chính của `player_daily_claims` là `(player_id, claim_date)`. Nên "đã nhận hôm nay      │
-- │ chưa" KHÔNG phải một câu `if` mà người viết có thể quên hoặc chạy trong một cửa sổ đua —     │
-- │ nó là một ràng buộc mà database từ chối. Hai request song song ở đúng nửa đêm thì một cái    │
-- │ vào, một cái đụng khoá, và cả hai đều trả về cùng một kết quả.                               │
-- │ Đây cũng là lý do KHÔNG cần `Idempotency-Key` như đường mua năng lượng: ngày CHÍNH LÀ khoá.  │
-- └──────────────────────────────────────────────────────────────────────────────────────────┘
--
-- ┌─ VÌ SAO NGÀY CẮT THEO UTC CHỨ KHÔNG THEO MÚI GIỜ NGƯỜI CHƠI ──────────────────────────────┐
-- │ Không phải vì UTC "chuẩn hơn": vì nó KHÔNG CÓ giờ mùa hè. Múi giờ có DST sẽ có một ngày 25 │
-- │ giờ và một ngày 23 giờ mỗi năm; hôm đó chuỗi của người chơi hoặc đứt oan hoặc nhận hai lần. │
-- │ Cả hai đều xảy ra một lần trong năm và đều không tái hiện nổi khi có khiếu nại.              │
-- │ `packages/shared/src/daily-reward.ts` giữ ĐÚNG phép tính này cho client, để đồng hồ đếm      │
-- │ ngược không bao giờ về 0 sớm hơn hay muộn hơn quyết định của server.                          │
-- └──────────────────────────────────────────────────────────────────────────────────────────┘

-- ---- Cấu hình 7 ngày --------------------------------------------------------------------
create table public.daily_rewards_config (
  cycle_day  integer primary key check (cycle_day between 1 and 7),
  coin       integer not null default 0 check (coin >= 0),
  energy     integer not null default 0 check (energy >= 0),
  label      text    not null,
  updated_at timestamptz not null default now()
);

comment on table public.daily_rewards_config is
  'Thưởng theo ngày thứ mấy trong vòng 7. Số khởi điểm — doc 35 §10 cho phép chọn rồi chỉnh bằng remote config sau khi B9 có dữ liệu lạm phát.';

-- Số khởi điểm, cố ý KHIÊM TỐN. doc 35 Rủi ro #4: Pha 7 mở bốn nguồn phát coin cùng lúc, nên
-- mỗi nguồn phải bắt đầu nhỏ rồi nâng theo số liệu `economy_daily` (B9) — nâng thì dễ, hạ thì
-- người chơi coi là bị lấy mất.
insert into public.daily_rewards_config (cycle_day, coin, energy, label) values
  (1,  50, 0, 'Ngày 1'),
  (2,  75, 0, 'Ngày 2'),
  (3, 100, 1, 'Ngày 3'),
  (4, 125, 0, 'Ngày 4'),
  (5, 150, 0, 'Ngày 5'),
  (6, 200, 1, 'Ngày 6'),
  (7, 350, 2, 'Ngày 7 — trọn tuần')
on conflict (cycle_day) do nothing;

-- ---- Sổ nhận theo ngày ------------------------------------------------------------------
create table public.player_daily_claims (
  player_id  uuid not null references public.players(id) on delete cascade,
  -- Ngày UTC. Kiểu `date` nên không mang múi giờ nào theo.
  claim_date date not null,
  streak     integer not null check (streak >= 1),
  cycle_day  integer not null check (cycle_day between 1 and 7),
  coin       integer not null default 0,
  energy     integer not null default 0,
  created_at timestamptz not null default now(),
  primary key (player_id, claim_date)
);

create index player_daily_claims_recent_idx
  on public.player_daily_claims (player_id, claim_date desc);

-- ---- B9: khai nguồn phát MỚI ---------------------------------------------------------------
--
-- BẮT BUỘC, không phải cho đẹp. `economy_daily_summary.unclassified_entries` sẽ khác 0 nếu thiếu
-- dòng này, và đó chính là cổng lát b9 dựng ra để không nguồn phát coin nào lọt khỏi tầm nhìn.
insert into public.economy_flow_kinds (reference_type, source_group, label) values
  ('daily_claim', 'retention', 'Thưởng điểm danh hằng ngày')
on conflict (reference_type) do nothing;

-- ---- RPC ---------------------------------------------------------------------------------
--
-- Trả về CÙNG một hình dạng cho cả lần nhận thật lẫn lần gọi lại trong ngày, chỉ khác cờ
-- `already_claimed`. Client vẽ được màn hình từ một lời gọi duy nhất, không phải gọi hai lần.
create or replace function public.claim_daily_reward(p_player_id uuid)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_today       date := (now() at time zone 'UTC')::date;
  v_last        date;
  v_last_streak integer;
  v_streak      integer;
  v_cycle       integer;
  v_coin        integer;
  v_energy      integer;
  v_balance     bigint;
  v_da_nhan     boolean := false;
  v_row         public.player_daily_claims%rowtype;
begin
  -- Khoá hàng người chơi để hai request song song không cùng đọc một `v_last`.
  perform 1 from public.players where id = p_player_id for update;

  select claim_date, streak into v_last, v_last_streak
  from public.player_daily_claims
  where player_id = p_player_id
  order by claim_date desc
  limit 1;

  if v_last = v_today then
    select * into v_row from public.player_daily_claims
      where player_id = p_player_id and claim_date = v_today;
    return jsonb_build_object(
      'already_claimed', true, 'streak', v_row.streak, 'cycle_day', v_row.cycle_day,
      'coin', v_row.coin, 'energy', v_row.energy,
      'next_reset_at', ((v_today + 1)::timestamp at time zone 'UTC')
    );
  end if;

  -- Chuỗi tiếp tục CHỈ KHI lần trước đúng là hôm qua. `v_last` ở tương lai (đồng hồ máy chủ bị
  -- đẩy lùi) rơi vào nhánh else ⇒ reset — thà mất chuỗi còn hơn phát thưởng theo mốc không tin được.
  if v_last = v_today - 1 then
    v_streak := greatest(1, coalesce(v_last_streak, 0)) + 1;
  else
    v_streak := 1;
  end if;
  v_cycle := ((v_streak - 1) % 7) + 1;

  select coin, energy into v_coin, v_energy
  from public.daily_rewards_config where cycle_day = v_cycle;
  if not found then
    raise exception 'daily_rewards_config thiếu cycle_day %', v_cycle;
  end if;

  -- Ghi sổ TRƯỚC khi cấp tiền: nếu hai request cùng lọt tới đây thì cái thứ hai vỡ ở khoá chính
  -- và KHÔNG kịp cấp gì. Cấp trước rồi mới ghi sổ là mở đúng cửa sổ để cấp hai lần.
  insert into public.player_daily_claims (player_id, claim_date, streak, cycle_day, coin, energy)
  values (p_player_id, v_today, v_streak, v_cycle, v_coin, v_energy)
  on conflict (player_id, claim_date) do nothing;

  if not found then
    -- Một request khác vừa chèn xong: coi như đã nhận, không cấp thêm.
    select * into v_row from public.player_daily_claims
      where player_id = p_player_id and claim_date = v_today;
    return jsonb_build_object(
      'already_claimed', true, 'streak', v_row.streak, 'cycle_day', v_row.cycle_day,
      'coin', v_row.coin, 'energy', v_row.energy,
      'next_reset_at', ((v_today + 1)::timestamp at time zone 'UTC')
    );
  end if;

  if v_coin > 0 then
    insert into public.player_wallets(player_id, currency_code) values (p_player_id, 'coin')
      on conflict do nothing;
    select balance into v_balance from public.player_wallets
      where player_id = p_player_id and currency_code = 'coin' for update;
    v_balance := v_balance + v_coin;
    update public.player_wallets set balance = v_balance, version = version + 1, updated_at = now()
      where player_id = p_player_id and currency_code = 'coin';
    -- `reference_id` là NGÀY: cùng một khoá tự nhiên với sổ nhận ở trên, nên ràng buộc duy nhất
    -- của `wallet_ledger` là lớp chặn thứ hai cho cùng một bất biến.
    insert into public.wallet_ledger
      (player_id, currency_code, delta, reason, reference_type, reference_id, balance_after)
    values (p_player_id, 'coin', v_coin, 'daily_claim', 'daily_claim', v_today::text, v_balance)
    on conflict do nothing;
  end if;

  if v_energy > 0 then
    -- KHÔNG cho tràn: đây là thưởng, không phải thứ người chơi trả tiền để nhận. Ranh giới đó đã
    -- được chốt ở migration 202609090001 và giữ nguyên ở đây.
    perform public.grant_energy(p_player_id, v_energy, 'daily_claim', 'daily_claim', v_today::text);
  end if;

  return jsonb_build_object(
    'already_claimed', v_da_nhan, 'streak', v_streak, 'cycle_day', v_cycle,
    'coin', v_coin, 'energy', v_energy,
    'next_reset_at', ((v_today + 1)::timestamp at time zone 'UTC')
  );
end;
$$;

-- Trạng thái để client vẽ màn hình mà KHÔNG cấp gì. Tách khỏi `claim_daily_reward` vì mở ứng
-- dụng không được là một hành động cấp tiền — nếu gộp, mỗi lần mở app là một lần phát coin.
create or replace function public.read_daily_reward(p_player_id uuid)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_today  date := (now() at time zone 'UTC')::date;
  v_last   date;
  v_streak integer;
  v_next   integer;
begin
  select claim_date, streak into v_last, v_streak
  from public.player_daily_claims
  where player_id = p_player_id order by claim_date desc limit 1;

  if v_last = v_today then
    v_next := ((greatest(1, coalesce(v_streak, 1)) - 1) % 7) + 1;
  elsif v_last = v_today - 1 then
    v_next := ((greatest(1, coalesce(v_streak, 0)) + 1 - 1) % 7) + 1;
  else
    v_next := 1;
  end if;

  return jsonb_build_object(
    'claimed_today', coalesce(v_last = v_today, false),
    'streak', coalesce(v_streak, 0),
    'next_cycle_day', v_next,
    'next_reset_at', ((v_today + 1)::timestamp at time zone 'UTC'),
    'config', (select coalesce(jsonb_agg(jsonb_build_object(
                 'cycle_day', cycle_day, 'coin', coin, 'energy', energy, 'label', label
               ) order by cycle_day), '[]'::jsonb) from public.daily_rewards_config)
  );
end;
$$;

alter table public.daily_rewards_config enable row level security;
alter table public.player_daily_claims  enable row level security;

commit;
