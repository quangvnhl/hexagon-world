begin;

-- doc 35 §D4 — lịch phát hành cấp.
--
-- ┌─ THỨ THIẾU LÀ LỊCH, KHÔNG PHẢI CÔNG CỤ ───────────────────────────────────────────────────┐
-- │ Level editor đã sẵn. Hôm nay muốn ra 3 cấp/tuần thì phải có người ngồi bấm "publish" đúng  │
-- │ vào sáng thứ Hai — nhịp nội dung phụ thuộc vào việc ai đó nhớ ra. Cột này biến "ra lúc     │
-- │ nào" thành dữ liệu, để soạn xong cả tuần trong một lần rồi quên đi.                        │
-- └───────────────────────────────────────────────────────────────────────────────────────────┘
--
-- ┌─ BẢNG SỰ THẬT CỦA HAI CỘT (mặc định = HÀNH VI CŨ) ─────────────────────────────────────────┐
-- │ published = false                     → nháp, không bao giờ hiện. (không đổi)              │
-- │ published = true, published_at null   → đã ra, hiện ngay. ← MỌI HÀNG CŨ RƠI VÀO Ô NÀY      │
-- │ published = true, published_at ≤ now  → đã tới giờ, hiện.                                  │
-- │ published = true, published_at > now  → ĐÃ DUYỆT nhưng CHƯA TỚI GIỜ, không hiện.           │
-- │                                                                                            │
-- │ `published` = "đã duyệt cho ra", `published_at` = "ra lúc nào". Gộp hai ý đó vào một cột   │
-- │ thì "nháp" và "đã duyệt, chờ ngày" trở nên không phân biệt được — mà đó đúng là hai trạng  │
-- │ thái mà người soạn nội dung cần thấy khác nhau.                                            │
-- └───────────────────────────────────────────────────────────────────────────────────────────┘

alter table public.campaign_levels
  add column if not exists published_at timestamptz;

-- Chỉ có ích khi lọc các cấp đã duyệt mà chưa tới giờ — số này luôn nhỏ.
create index if not exists campaign_levels_lich_idx
  on public.campaign_levels (published_at)
  where published and published_at is not null;

-- ================================================================================================
-- campaign_levels_live — ĐỊNH NGHĨA DUY NHẤT của "cấp đang sống"
-- ================================================================================================
--
-- Đặt luật ở SQL chứ không ở server, vì hai lý do đo được:
--  1. `now()` phải là đồng hồ của DATABASE. Nếu server tự tính mốc rồi gửi xuống, hai node game
--     có đồng hồ lệch nhau sẽ bất đồng về việc một cấp đã ra hay chưa — và người chơi sẽ thấy
--     cấp mới xuất hiện rồi biến mất tuỳ vào node nào nhận request.
--  2. Mọi nơi đọc danh sách cấp đều đọc CÙNG một luật. Một bản sao thứ hai của điều kiện này
--     trong TypeScript là chỗ để nó trôi ra khỏi bản gốc.
create or replace view public.campaign_levels_live as
  select id, sort_order, name, config, powerups, unlock_requires, rewards, published_at
    from public.campaign_levels
   where published
     and (published_at is null or published_at <= now());

alter view public.campaign_levels_live set (security_invoker = true);

-- ================================================================================================
-- publish_campaign_level — thêm tham số lịch
-- ================================================================================================
--
-- DROP rồi CREATE chứ không `create or replace`: Postgres nhận dạng hàm theo DANH SÁCH KIỂU, nên
-- thêm một tham số (dù có default) sẽ tạo ra hàm THỨ HAI, và lời gọi hai tham số cũ trở thành
-- nhập nhằng — `function is not unique`, một lỗi lúc chạy chứ không phải lúc migrate.
drop function if exists public.publish_campaign_level(text, boolean);

create function public.publish_campaign_level(
  p_id text,
  p_published boolean,
  p_published_at timestamptz default null
) returns jsonb language plpgsql security definer set search_path = public
as $$
declare v_row campaign_levels%rowtype;
begin
  -- Gỡ publish thì XOÁ lịch: một cấp bị gỡ mà vẫn giữ ngày hẹn sẽ tự bật lại khi tới ngày,
  -- và người gỡ nó sẽ không có mặt ở đó để hiểu vì sao.
  update campaign_levels
     set published = p_published,
         published_at = case when p_published then p_published_at else null end,
         updated_at = now()
   where id = p_id
  returning * into v_row;
  if v_row.id is null then raise exception 'level_not_found'; end if;

  return jsonb_build_object(
    'id', v_row.id,
    'published', v_row.published,
    'publishedAt', v_row.published_at,
    -- `live` là câu trả lời cho "người chơi có thấy không" — tính ở đây để bên gọi không
    -- phải dựng lại luật lần nữa.
    'live', v_row.published and (v_row.published_at is null or v_row.published_at <= now())
  );
end;
$$;

revoke all on function public.publish_campaign_level(text, boolean, timestamptz) from public, anon, authenticated;
grant execute on function public.publish_campaign_level(text, boolean, timestamptz) to service_role;
grant select on public.campaign_levels_live to service_role;

commit;
