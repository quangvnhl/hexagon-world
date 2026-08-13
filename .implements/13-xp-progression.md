# XP và progression

## Phạm vi

Migration `202608130001_player_progression.sql` bổ sung progression lâu dài cho tài khoản đã xác thực. Guest vẫn chơi và có thống kê trong trận, nhưng không được ghi `player_stats`, XP hoặc XP ledger.

## Công thức mặc định

```text
XP trận = min(
  max_xp_per_match,
  base_match_xp
  + min(kills, max_kills_rewarded) * xp_per_kill
  + floor(min(territory, max_territory_rewarded) / territory_units_per_xp)
  + win_bonus_xp nếu thắng
)
```

Giá trị mặc định nằm trong bảng `progression_rules`: 20 XP tham gia, 100 XP thắng, 10 XP/kill, 1 XP/10 ô và tối đa 5.000 XP/trận. Server không nhận hệ số XP từ client; RPC `record_match_result` đọc config trực tiếp từ database và chặn/cap input trước khi tính.

Level lấy từ `progression_levels.xp_required` theo XP tích lũy. Seed ban đầu có level 1–100 với ngưỡng `100 * (level - 1)^2`. Có thể thay curve bằng cách cập nhật các hàng trong bảng; luôn giữ level 1 với `xp_required = 0`, ngưỡng XP duy nhất và tăng dần theo level.

Sau khi đổi curve đã có dữ liệu thật, đồng bộ lại level lưu sẵn trong cùng một transaction:

```sql
update public.player_progression
set level = public.progression_level_for_xp(total_xp), updated_at = now();
```

Khi chỉnh công thức, cập nhật đúng hàng `singleton = true` của `progression_rules` và đặt `updated_at = now()`. Không cấp quyền ghi các bảng config cho client; chỉ thao tác bằng service/admin database.

## Tính idempotent và audit

- `processed_events.event_id` khiến cùng một kết quả trận chỉ được xử lý một lần.
- `player_xp_ledger` có unique `(player_id, event_id)` để bảo vệ thêm và lưu giải trình XP.
- Chỉ participant có `playerId`, `isGuest = false`, player `active` và có identity mới nhận XP.
- `match_players.xp_earned` lưu phần XP của chính trận đó; lịch sử trận vẫn có thể bị purge sau thời hạn lưu trữ, còn XP ledger được giữ lại.

`GET /v1/me` trả thêm `progression: { total_xp, level, updated_at }` và giữ `stats` riêng.

## Rollback

Chỉ rollback khi chắc chắn không còn code đọc progression. Chạy trong transaction và sao lưu `player_progression`/`player_xp_ledger` trước. Cần khôi phục phiên bản cũ của `record_match_result` từ migration `202608120001_player_backend.sql`, sau đó:

```sql
begin;
drop trigger if exists players_create_progression on public.players;
drop function if exists public.ensure_player_progression();
drop function if exists public.progression_level_for_xp(bigint);
alter table public.match_players drop column if exists xp_earned;
drop table if exists public.player_xp_ledger;
drop table if exists public.player_progression;
drop table if exists public.progression_levels;
drop table if exists public.progression_rules;
commit;
```

Không xóa các bảng trước khi khôi phục `record_match_result`, nếu không việc ghi kết quả trận sẽ lỗi.
