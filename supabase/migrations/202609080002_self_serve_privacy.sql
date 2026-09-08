-- doc 35 §C4 (lát c4.2) — tự xoá tài khoản, và thứ THẬT SỰ xoá nó sau thời gian chờ.
--
-- Trang `/privacy` (lát c4.1) đã hứa nguyên văn:
--
--   "Khi bạn yêu cầu xoá, tài khoản bị vô hiệu ngay và dữ liệu chơi bị xoá hẳn sau 30 ngày"
--
-- `DELETE /v1/me` lo vế đầu. File này lo vế sau — nếu không thì lời hứa kia là một câu sai, và đó
-- là loại sai đắt nhất trong một chính sách riêng tư.
--
-- ---- VÌ SAO KHÔNG PHẢI `delete from players` ---------------------------------------------------
--
-- Lược đồ đã mã hoá sẵn chính sách kế toán bằng khoá ngoại, và nó CHẶN việc xoá thẳng:
--
--   wallet_ledger        player_id -> players  ON DELETE RESTRICT
--   purchase_orders      player_id -> players  ON DELETE RESTRICT
--   player_energy_ledger player_id -> players  ON DELETE RESTRICT
--
-- Ba bảng đó là chứng từ giao dịch — pháp luật buộc giữ, và trang `/privacy` đã nói rõ chúng không
-- bị xoá theo. `delete from players` sẽ ném lỗi khoá ngoại, nên "xoá hẳn" ở đây có nghĩa chính xác
-- là: **xoá dữ liệu chơi + gỡ mọi định danh, giữ lại chứng từ trên một hàng người chơi vô danh**.
-- Mọi bảng dữ liệu chơi khác đều ON DELETE CASCADE hoặc được xoá tường minh dưới đây.
--
-- Sau khi chạy, không còn đường nào đi từ hàng còn lại về một con người: `player_identities` (nơi
-- chứa telegram/google id và username) bị xoá sạch, tên hiển thị bị thay.

alter table public.players
  add column if not exists purged_at timestamptz;

-- Câu hỏi vận hành duy nhất mà lát này sinh ra: "còn tài khoản nào quá hạn chờ mà chưa xoá?"
create index if not exists players_pending_purge_idx
  on public.players (deleted_at)
  where status = 'deleted' and purged_at is null;

-- ---- purge_deleted_players --------------------------------------------------------------------
--
-- `p_grace_days` mặc định 30 — PHẢI khớp `LEGAL.deletionGraceDays` trong
-- `packages/client/src/lib/legal.ts`. Có một test khoá hai con số này lại với nhau, y như cách
-- `analyticsRetentionDays` được khoá với `purge_old_analytics_events`: hứa một đằng làm một nẻo là
-- chuyện chỉ cần một lần sửa vội là xảy ra.
--
-- Idempotent: chạy lại không đụng hàng đã có `purged_at`.
create or replace function public.purge_deleted_players(p_grace_days integer default 30)
returns integer language plpgsql security definer set search_path = public
as $$
declare v_cutoff timestamptz; v_ids uuid[]; v_count integer;
begin
  v_cutoff := now() - make_interval(days => greatest(0, p_grace_days));

  select coalesce(array_agg(id), '{}') into v_ids
  from public.players
  where status = 'deleted' and purged_at is null and deleted_at is not null and deleted_at < v_cutoff;

  v_count := coalesce(array_length(v_ids, 1), 0);
  if v_count = 0 then return 0; end if;

  -- Định danh trước tiên: đây là thứ nối hàng dữ liệu với một con người.
  delete from public.player_identities where player_id = any(v_ids);
  delete from public.player_sessions   where player_id = any(v_ids);

  -- Dữ liệu chơi. Liệt kê tường minh thay vì dựa vào CASCADE: thêm một bảng mới mà quên nó ở đây
  -- thì dữ liệu ở lại vĩnh viễn, và không có gì báo. Danh sách này phải được soát khi thêm bảng.
  delete from public.player_profiles       where player_id = any(v_ids);
  delete from public.player_stats          where player_id = any(v_ids);
  delete from public.player_progression    where player_id = any(v_ids);
  delete from public.player_inventory      where player_id = any(v_ids);
  delete from public.player_loadouts       where player_id = any(v_ids);
  delete from public.player_wallets        where player_id = any(v_ids);
  delete from public.player_energy         where player_id = any(v_ids);
  delete from public.player_xp_ledger      where player_id = any(v_ids);
  delete from public.player_level_progress where player_id = any(v_ids);
  delete from public.campaign_plays        where player_id = any(v_ids);

  -- GIỮ LẠI, có chủ ý và đã nói trước với người dùng ở `/privacy`:
  --   wallet_ledger · purchase_orders · player_energy_ledger  (chứng từ, ON DELETE RESTRICT)
  --   analytics_events                                        (vốn đã ẩn danh, tự hết hạn 90 ngày)

  update public.players
     set display_name = 'Deleted Player',
         purged_at    = now()
   where id = any(v_ids);

  return v_count;
end;
$$;

revoke all on function public.purge_deleted_players(integer) from anon, authenticated;

comment on function public.purge_deleted_players(integer) is
  'doc 35 §C4 — xoá dữ liệu chơi + gỡ định danh của tài khoản đã quá hạn chờ. Giữ chứng từ giao dịch. Mặc định 30 ngày phải khớp LEGAL.deletionGraceDays.';
