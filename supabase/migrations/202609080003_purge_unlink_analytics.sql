-- doc 35 §C4 (lát c4.2, bổ sung) — cắt liên kết sự kiện phân tích khi xoá tài khoản.
--
-- File RIÊNG chứ không sửa `202609080002`: migration đó đã áp, và AGENTS.md §1 cấm sửa nội dung
-- file migration đã áp. (Tôi đã thử sửa thẳng và cổng `db-migrate` chặn lại đúng bằng checksum —
-- ghi ra đây vì đó chính là lý do cổng đó tồn tại.)
--
-- ---- VÌ SAO ------------------------------------------------------------------------------------
--
-- Trang `/privacy` (lát c4.1) viết về sự kiện sử dụng:
--
--   "chúng đã không gắn với danh tính của bạn ngay từ đầu, nên không còn cách nào tìm ra chúng
--    thuộc về ai để mà xoá"
--
-- Vế sau của câu đó KHÔNG đúng khi viết bản `202609080002`. Đo trên DB dev: **28 trên 53** sự kiện
-- có `player_id` khác null. Lát `a1.4` thêm sự kiện phát từ SERVER (mua hàng, cấp năng lượng, kết
-- trận) và chúng gắn thẳng người chơi — đó chính là "cách tìm ra chúng thuộc về ai".
--
-- Hai đường xử lý, và chọn đường khó hơn có chủ ý:
--   (a) sửa câu trên trang cho khớp thực tế — hạ thấp lời hứa;
--   (b) làm cho lời hứa thành đúng — cắt cột nối khi tài khoản bị xoá hẳn.
--
-- Chọn (b). GIỮ hàng sự kiện (chúng là số liệu tổng hợp, và xoá đi làm hỏng mọi báo cáo lịch sử),
-- chỉ đặt `player_id = null`. Sau đó không còn đường nào từ một sự kiện về một con người.
--
-- Vế "ngay từ đầu" của câu vẫn không chính xác — nhưng đó là câu chữ pháp lý của chủ dự án, không
-- phải thứ agent tự sửa. Đã nêu ra để người quyết định.

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

  -- MỚI so với 202609080002: cắt liên kết, không xoá hàng.
  update public.analytics_events set player_id = null where player_id = any(v_ids);

  -- GIỮ NGUYÊN, có chủ ý và đã nói trước với người dùng ở `/privacy`:
  --   wallet_ledger · purchase_orders · player_energy_ledger  (chứng từ, ON DELETE RESTRICT)

  update public.players
     set display_name = 'Deleted Player',
         purged_at    = now()
   where id = any(v_ids);

  return v_count;
end;
$$;

revoke all on function public.purge_deleted_players(integer) from anon, authenticated;
