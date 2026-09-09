begin;

-- doc 37 Việc 9 — MUA năng lượng khi đầy bình không được trừ coin mà không giao hàng.
--
-- ┌─ LỖI ĐƯỢC SỬA ───────────────────────────────────────────────────────────────────────────────┐
-- │ Lát r2.2 (E2E luồng tiền) đo được trên database dev, trong giao dịch rollback:                │
-- │   đầy bình 50/50 ⇒ coin −100, năng lượng  +0   (mất TRỌN 20/20 điểm đã trả tiền)              │
-- │   gần đầy 45/50 ⇒ coin −100, năng lượng  +5   (mất 15/20)                                     │
-- │ `purchase_energy_with_coin` trừ coin VÔ ĐIỀU KIỆN rồi mới gọi `grant_energy`, mà hàm đó kẹp   │
-- │ ở `energy_rules.energy_max`. Nút mua trong client KHÔNG bị vô hiệu khi đầy                    │
-- │ (CampaignScene.tsx:80 không có `disabled`), nên đây là lỗ chạm tới được bằng một cú bấm bình  │
-- │ thường, không phải chỉ bằng request tự chế.                                                   │
-- └──────────────────────────────────────────────────────────────────────────────────────────────┘
--
-- CÁCH XỬ: **cho TRÀN trên trần** ở đường MUA — chủ dự án chốt 2026-09-09 (doc 37 Việc 9, phương
-- án B). Người chơi luôn nhận đúng thứ đã trả tiền. doc 28 §E3 từng ghi đúng câu hỏi này
-- ("cap ≤ max **hoặc cho vượt** — **cần chốt**") và để ngỏ từ đó tới nay; đây là lần chốt.
--
-- CHỈ đường MUA được tràn. Thưởng campaign (`grant_energy` với 5 tham số) giữ nguyên hành vi kẹp:
-- tiền của người chơi mới là thứ bắt buộc phải giao đủ, còn thưởng là thứ ta cho thêm.
--
-- ┌─ HAI CHỖ SẼ ÂM THẦM HUỶ PHẦN TRÀN NẾU KHÔNG SỬA CÙNG ────────────────────────────────────────┐
-- │ Cho tràn KHÔNG chỉ là bỏ một phép `least` ở chỗ cộng. Hai hàm khác cũng kẹp xuống `v_max`     │
-- │ trong bước hồi lười, và chúng chạy SAU:                                                       │
-- │   • `read_energy`  — đọc 70/50 sẽ trả về 50: phần tràn biến mất ngay khi client hỏi.          │
-- │   • `spend_energy` — người chơi ở 70/50 tiêu 1 điểm sẽ còn 49, MẤT 20 điểm vừa mua.           │
-- │ Sửa thiếu một trong hai thì cả phương án B thành vô nghĩa, và tệ hơn lỗi ban đầu: người chơi  │
-- │ trả tiền, thấy số tăng, rồi số tự tụt.                                                        │
-- └──────────────────────────────────────────────────────────────────────────────────────────────┘
--
-- Luật chung sau lát này: **hồi lười chỉ LẤP TỚI trần, không bao giờ KÉO XUỐNG số đang có.**
-- Viết thành `case when v_stored >= v_max then v_stored else least(v_max, v_stored + v_gained) end`.

-- ================================================================================================
-- 1. read_energy — giữ phần tràn khi đọc
-- ================================================================================================
-- Nền là bản của 202608180003 (đã thêm refill_coin_cost / refill_energy_amount), KHÔNG phải bản
-- gốc 202608180001 — chép nhầm nền sẽ lặng lẽ gỡ hai trường đó khỏi API và làm hỏng nút mua.
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
  -- Hồi chỉ lấp TỚI trần; đang ở trên trần thì không hồi và cũng không bị kéo xuống.
  v_current := case when v_stored >= v_max then v_stored else least(v_max, v_stored + v_gained) end;
  if v_current >= v_max then
    v_next := null;
  else
    v_next := v_last + make_interval(secs => (v_gained + 1) * v_interval);
  end if;
  return jsonb_build_object('current', v_current, 'max', v_max, 'regen_interval_seconds', v_interval,
    'next_at', v_next, 'refill_coin_cost', v_cost, 'refill_energy_amount', v_amount);
end;
$$;

-- ================================================================================================
-- 2. spend_energy — tiêu điểm không được xoá phần tràn
-- ================================================================================================
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
    return read_energy(p_player_id);
  end if;

  select energy_max, regen_interval_seconds into v_max, v_interval from energy_rules where singleton = true;
  insert into player_energy(player_id, energy_current) values (p_player_id, v_max) on conflict do nothing;
  select energy_current, last_refill_at into v_stored, v_last from player_energy where player_id = p_player_id for update;

  v_gained := floor(greatest(0, extract(epoch from (now() - v_last))) / v_interval);
  -- Đổi so với 202608180001: giữ phần tràn thay vì `least(v_max, v_stored + v_gained)`.
  v_refilled := case when v_stored >= v_max then v_stored else least(v_max, v_stored + v_gained) end;
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

-- ================================================================================================
-- 3. grant_energy — thêm cờ cho tràn, mặc định TẮT
-- ================================================================================================
-- DROP trước rồi CREATE, chứ không `create or replace` với thêm một tham số: thêm tham số là tạo
-- một hàm NẠP CHỒNG mới, và khi đó lời gọi 5 tham số khớp được cả hai (bản 6 tham số có default)
-- ⇒ Postgres báo `function ... is not unique` và MỌI đường cấp năng lượng chết. Drop rồi tạo lại
-- để chỉ còn đúng một hàm.
--
-- `complete_campaign_level` (202608180002) gọi hàm này với 5 tham số. plpgsql phân giải lời gọi
-- lúc CHẠY chứ không lúc tạo, nên drop không làm hỏng nó; nó sẽ bám vào bản mới với default false,
-- tức thưởng campaign giữ nguyên hành vi kẹp ở trần.
drop function if exists public.grant_energy(uuid, integer, text, text, text);

create function public.grant_energy(
  p_player_id uuid,
  p_amount integer,
  p_reason text,
  p_reference_type text,
  p_reference_id text,
  -- Mặc định FALSE có chủ ý: cho tràn là ngoại lệ phải gọi tên, không phải hành vi mặc định mà
  -- người viết lời gọi mới vô tình nhận được.
  p_allow_overflow boolean default false
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
  v_refilled := case when v_stored >= v_max then v_stored else least(v_max, v_stored + v_gained) end;
  v_new_last := case when v_stored + v_gained >= v_max then now() else v_last + make_interval(secs => v_gained * v_interval) end;

  -- Chỗ DUY NHẤT khác giữa hai chế độ.
  v_refilled := case when p_allow_overflow then v_refilled + p_amount
                     else least(v_max, v_refilled + p_amount) end;
  if v_refilled >= v_max then v_new_last := now(); end if;

  update player_energy set energy_current = v_refilled, last_refill_at = v_new_last, updated_at = now()
    where player_id = p_player_id;
  insert into player_energy_ledger(player_id, delta, reason, reference_type, reference_id, balance_after)
    values (p_player_id, p_amount, p_reason, p_reference_type, p_reference_id, v_refilled);
  return read_energy(p_player_id);
end;
$$;

-- ================================================================================================
-- 4. purchase_energy_with_coin — đã trả tiền thì phải nhận đủ
-- ================================================================================================
create or replace function public.purchase_energy_with_coin(
  p_player_id uuid,
  p_idempotency_key text
) returns jsonb language plpgsql security definer set search_path = public
as $$
declare
  v_cost integer; v_amount integer; v_balance bigint;
begin
  select refill_coin_cost, refill_energy_amount into v_cost, v_amount from energy_rules where singleton = true;

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

  -- `true` = CHO TRÀN. Đây là điểm sửa của lát này: đã trừ tiền thì phải giao đủ số điểm, kể cả
  -- khi người chơi đang đầy bình. Không có nhánh nào giữa "trừ tiền" và dòng này có thể làm số
  -- điểm giao ít hơn số đã bán.
  return grant_energy(p_player_id, v_amount, 'energy_purchase', 'energy_purchase', p_idempotency_key, true);
end;
$$;

-- ================================================================================================
-- 5. Quyền — cấp lại cho chữ ký MỚI của grant_energy (drop đã xoá quyền của chữ ký cũ)
-- ================================================================================================
revoke all on function public.grant_energy(uuid, integer, text, text, text, boolean) from public, anon, authenticated;
grant execute on function public.grant_energy(uuid, integer, text, text, text, boolean) to service_role;

commit;
