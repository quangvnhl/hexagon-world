begin;

-- doc 35 §C2.5 (lát c2.2) — loại lời gọi THỬ KHÔ khỏi phép đếm hạn mức ngày.
--
-- `?dry_run=true` không đổi một dòng dữ liệu nào; nó chỉ đọc trạng thái hiện tại và trả kết quả dự
-- kiến. Tính nó vào hạn mức sẽ tạo ra một khuyến khích ngược đúng chỗ nguy hiểm nhất:
--
--   §C2.5 muốn agent LUÔN thử khô trước khi làm thật. Nhưng nếu mỗi thao tác vì thế tốn hai suất
--   hạn mức, thì cách rẻ nhất để hoàn thành công việc trong hạn mức là **bỏ bước thử khô** — tức là
--   bỏ đúng cái rào an toàn mà hạn mức đang cố bảo vệ.
--
-- Không sửa file migration cũ (`202609070001`) — luật AGENTS.md: migration đã áp chỉ được thay bằng
-- file mới. `create or replace` giữ nguyên chữ ký nên mọi nơi gọi không phải đổi.
create or replace function public.ops_daily_usage(p_key_id uuid, p_unit_kind text default null)
returns jsonb
language sql
stable
security definer
set search_path = public
as $$
  select jsonb_build_object(
    'calls', count(*) filter (where is_write and status = 'ok' and not dry_run),
    'units', coalesce(sum(units) filter (
      where status = 'ok' and not dry_run and p_unit_kind is not null and unit_kind = p_unit_kind
    ), 0)
  )
  from public.ops_audit_log
  where key_id = p_key_id
    and created_at >= (date_trunc('day', now() at time zone 'UTC') at time zone 'UTC');
$$;

-- Vết kiểm toán VẪN ghi lời gọi thử khô (cột `dry_run = true`). Chúng chỉ không tính vào hạn mức.
-- Biết một agent đã xem trước những gì trước khi hành động là thông tin có giá trị khi truy sự cố.

commit;
