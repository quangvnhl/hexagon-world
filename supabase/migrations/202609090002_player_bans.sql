begin;

-- doc 35 §C3 — cấm người chơi, có thời hạn hoặc vĩnh viễn.
--
-- ┌─ THI HÀNH ĐÃ CÓ SẴN — ĐỪNG DỰNG CƠ CHẾ THỨ HAI ─────────────────────────────────────────────┐
-- │ `SessionService.resolve` đã từ chối mọi phiên có `players.status <> 'active'` và ném          │
-- │ `player_inactive` (session.service.ts:40). Nên chỉ cần lệnh cấm ĐẶT `status = 'suspended'` là │
-- │ toàn bộ bề mặt HTTP đóng ngay, kể cả các endpoint viết sau này.                               │
-- │                                                                                              │
-- │ Ticket vùng cũng đóng theo, gián tiếp: `POST game-tickets` (không phải bản `guest`) đi qua    │
-- │ `sessions.resolve` để biết người chơi là ai, nên người bị cấm không lấy được ticket.          │
-- │                                                                                              │
-- │ CHỖ KHÔNG ĐÓNG, nói thẳng ra để không ai tưởng nhầm: WS `join` KHÔNG ticket là ẩn danh — nó   │
-- │ không mang danh tính nào để mà cấm. Lệnh cấm ràng vào TÀI KHOẢN; chơi ẩn danh không có tài    │
-- │ khoản. Bịt chỗ đó là bật `requireTicket`, một quyết định triển khai chứ không phải một bảng.  │
-- └──────────────────────────────────────────────────────────────────────────────────────────────┘
--
-- Bảng này là SỔ, không phải trạng thái. Trạng thái sống nằm ở `players.status` — một chỗ duy nhất
-- để mọi lớp thi hành đọc. Sổ trả lời câu "vì sao, ai làm, tới bao giờ", tức là thứ cần khi có
-- khiếu nại và là thứ `players.status` không mang nổi.

create table public.player_bans (
  id          uuid primary key default gen_random_uuid(),
  player_id   uuid not null references public.players(id) on delete cascade,
  reason      text not null check (length(btrim(reason)) > 0),
  -- `null` = vĩnh viễn. Cố ý KHÔNG dùng một mốc xa như year 9999: "vĩnh viễn" và "tới 9999" là hai
  -- ý định khác nhau, và gộp chúng lại thì sau này không tách ra được nữa.
  until       timestamptz,
  actor       text not null,
  created_at  timestamptz not null default now(),
  lifted_at   timestamptz,
  lifted_by   text
);

-- Mỗi người chơi chỉ có TỐI ĐA MỘT lệnh cấm đang hiệu lực. Không có ràng buộc này thì "gỡ cấm"
-- trở thành mơ hồ: gỡ cái nào?
create unique index player_bans_active_uniq
  on public.player_bans(player_id) where lifted_at is null;

create index player_bans_until_idx
  on public.player_bans(until) where lifted_at is null and until is not null;

alter table public.player_bans enable row level security;
revoke all on public.player_bans from anon, authenticated;

-- ================================================================================================
-- ban_player — ghi sổ + khoá tài khoản, trong MỘT giao dịch
-- ================================================================================================
create or replace function public.ban_player(
  p_player_id uuid,
  p_reason text,
  p_until timestamptz,
  p_actor text
) returns jsonb language plpgsql security definer set search_path = public
as $$
declare v_status public.player_status; v_id uuid;
begin
  if coalesce(btrim(p_reason), '') = '' then raise exception 'reason_required'; end if;

  select status into v_status from players where id = p_player_id for update;
  if v_status is null then raise exception 'player_not_found'; end if;
  -- Người đã tự xoá tài khoản thì KHÔNG lật sang 'suspended': làm vậy là dựng lại một tài khoản mà
  -- người ta đã yêu cầu xoá, và `purge_deleted_players` sẽ không còn nhận ra nó nữa.
  if v_status = 'deleted' then raise exception 'player_deleted'; end if;

  update player_bans set lifted_at = now(), lifted_by = p_actor
    where player_id = p_player_id and lifted_at is null;

  insert into player_bans(player_id, reason, until, actor)
    values (p_player_id, btrim(p_reason), p_until, p_actor)
    returning id into v_id;

  update players set status = 'suspended' where id = p_player_id;

  -- Thu hồi phiên NGAY. Không có dòng này thì người bị cấm vẫn chơi tiếp tới khi phiên hết hạn —
  -- tối đa `PLAYER_SESSION_TTL_SECONDS` (mặc định 24 giờ), tức lệnh cấm có hiệu lực vào ngày mai.
  update player_sessions set revoked_at = now()
    where player_id = p_player_id and revoked_at is null;

  return jsonb_build_object('banId', v_id, 'playerId', p_player_id, 'until', p_until, 'status', 'suspended');
end;
$$;

-- ================================================================================================
-- unban_player — gỡ sổ + mở tài khoản
-- ================================================================================================
create or replace function public.unban_player(p_player_id uuid, p_actor text)
returns jsonb language plpgsql security definer set search_path = public
as $$
declare v_status public.player_status; v_n integer;
begin
  select status into v_status from players where id = p_player_id for update;
  if v_status is null then raise exception 'player_not_found'; end if;

  update player_bans set lifted_at = now(), lifted_by = p_actor
    where player_id = p_player_id and lifted_at is null;
  get diagnostics v_n = row_count;

  -- Chỉ mở khoá khi đang 'suspended'. Gỡ cấm KHÔNG được hồi sinh một tài khoản đã xoá.
  if v_status = 'suspended' then
    update players set status = 'active' where id = p_player_id;
  end if;

  return jsonb_build_object('playerId', p_player_id, 'lifted', v_n,
    'status', case when v_status = 'suspended' then 'active' else v_status::text end);
end;
$$;

-- ================================================================================================
-- expire_player_bans — trả tự do khi hết hạn
-- ================================================================================================
-- Lệnh cấm CÓ THỜI HẠN mà không có gì hết hạn nó thì nó là cấm vĩnh viễn, chỉ khác ở chỗ không ai
-- định thế. Hàm này chạy theo lịch (pg_cron, cùng chỗ với `purge_deleted_players` — doc 37 Việc 3d).
create or replace function public.expire_player_bans()
returns integer language plpgsql security definer set search_path = public
as $$
declare v_ids uuid[];
begin
  select array_agg(player_id) into v_ids from player_bans
    where lifted_at is null and until is not null and until <= now();
  if v_ids is null then return 0; end if;

  update player_bans set lifted_at = now(), lifted_by = 'system:expire'
    where player_id = any(v_ids) and lifted_at is null;
  update players set status = 'active'
    where id = any(v_ids) and status = 'suspended';
  return array_length(v_ids, 1);
end;
$$;

revoke all on function public.ban_player(uuid, text, timestamptz, text) from public, anon, authenticated;
revoke all on function public.unban_player(uuid, text) from public, anon, authenticated;
revoke all on function public.expire_player_bans() from public, anon, authenticated;
grant execute on function public.ban_player(uuid, text, timestamptz, text) to service_role;
grant execute on function public.unban_player(uuid, text) to service_role;
grant execute on function public.expire_player_bans() to service_role;

commit;
