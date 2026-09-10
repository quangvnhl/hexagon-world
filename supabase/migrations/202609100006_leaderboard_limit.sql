begin;

-- doc 35 §A5 — sửa `read_leaderboard`: cắt danh sách bằng `limit`, không bằng `hạng <= limit`.
--
-- ┌─ VÌ SAO LÀ MỘT FILE RIÊNG CHỨ KHÔNG SỬA 202609100005 ──────────────────────────────────────┐
-- │ File kia ĐÃ ÁP lên staging trước khi lỗi này lộ ra. Sửa nội dung một migration đã áp thì    │
-- │ database không còn khớp với file mô tả nó, và môi trường tiếp theo sẽ dựng ra một schema    │
-- │ khác — im lặng. `db-migrate --check` chặn đúng chuyện này bằng checksum, và nó ĐÃ chặn.     │
-- └───────────────────────────────────────────────────────────────────────────────────────────┘
--
-- ┌─ LỖI ĐƯỢC SỬA ────────────────────────────────────────────────────────────────────────────┐
-- │ `rank()` cho những người cùng điểm CÙNG một hạng. Lọc top bằng `hạng <= limit` vì thế trả  │
-- │ về mọi người trong nhóm hoà: xin 2 dòng, có hai người hoà hạng 2 ⇒ trả 3 dòng. Đó mới chỉ  │
-- │ là khó chịu. Chỗ hỏng thật nằm ở tuần đầu tiên, khi hàng nghìn người cùng có đúng 1 trận   │
-- │ thắng ⇒ TẤT CẢ cùng `rank = 1` ⇒ một yêu cầu xin 20 dòng kéo về CẢ BẢNG.                   │
-- │ Sau khi sửa: hạng hiển thị vẫn là hạng hoà thật, độ dài danh sách luôn ≤ `limit`.          │
-- └───────────────────────────────────────────────────────────────────────────────────────────┘
--
-- Thân hàm dưới đây được CHÉP BẰNG SCRIPT từ 202609100005, chỉ đổi đúng khối `select ... into`.
-- Script khẳng định: gỡ phần sửa ra thì ra lại bản đã áp TỪNG BYTE.

create or replace function public.read_leaderboard(
  p_scope     text,
  p_limit     integer default 20,
  p_player_id uuid default null
) returns jsonb language plpgsql stable security definer set search_path = public
as $$
declare
  v_key   text    := public.leaderboard_period_key(p_scope);
  v_limit integer := least(100, greatest(1, coalesce(p_limit, 20)));
  v_top   jsonb;
  v_me    jsonb;
begin
  with xep as (
    select e.player_id,
           e.score,
           e.updated_at,
           p.display_name,
           rank() over (order by e.score desc) as hang
      from public.leaderboard_entries e
      join public.players p on p.id = e.player_id
     where e.scope = p_scope
       and e.period_key = v_key
       -- Lệnh cấm (doc 35 §C3) đặt `status = 'suspended'` ⇒ rơi khỏi bảng NGAY, không cần backfill.
       and p.status = 'active'
  )
  select
    coalesce((
      select jsonb_agg(jsonb_build_object(
               'rank', hang, 'playerId', player_id, 'displayName', display_name, 'score', score
             ) order by score desc, updated_at asc, player_id asc)
        from (select * from xep order by score desc, updated_at asc, player_id asc limit v_limit) t
    ), '[]'::jsonb),
    -- Hạng của mình tính trên TOÀN bảng, nên vẫn đúng khi mình nằm ngoài top N.
    (select jsonb_build_object('rank', hang, 'score', score)
       from xep where player_id = p_player_id)
  into v_top, v_me;

  return jsonb_build_object(
    'scope', p_scope,
    'periodKey', v_key,
    'top', coalesce(v_top, '[]'::jsonb),
    'me', v_me
  );
end;
$$;

commit;
