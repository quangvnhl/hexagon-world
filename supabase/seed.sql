-- Seed XÁC ĐỊNH cho E2E và cho một database dev vừa dựng (doc 36 §R3, lát r3.2).
--
-- ┌─ LUẬT CỦA FILE NÀY ──────────────────────────────────────────────────────────────────────────┐
-- │ 1. IDEMPOTENT theo KHOÁ TỰ NHIÊN. Chạy lần thứ mười phải ra đúng trạng thái như lần thứ nhất. │
-- │    Không `delete` một dòng nào — AGENTS.md §1 cấm xoá dữ liệu người chơi, và một seed dọn dẹp │
-- │    bằng `delete` là seed sẽ có ngày xoá nhầm người thật.                                      │
-- │ 2. ID TÍNH ĐƯỢC, không ngẫu nhiên: `md5(<khoá tự nhiên>)::uuid`. Nhờ vậy mọi dòng seed đều    │
-- │    NHẬN RA ĐƯỢC — muốn biết một hàng có phải seed không thì băm lại khoá rồi so id, không cần │
-- │    thêm cột đánh dấu vào bảng thật.                                                           │
-- │ 3. Mọi câu chạm dữ liệu người chơi đều BỊ RÀNG vào đúng hai uuid seed. Không có câu nào tác   │
-- │    động lên người chơi thật, kể cả khi chạy nhầm database.                                    │
-- └──────────────────────────────────────────────────────────────────────────────────────────────┘
--
-- Chạy bằng `node scripts/db-seed.mjs`, KHÔNG chạy tay bằng psql — script mới có cổng chặn target
-- và mới đếm số hàng trước/sau để bạn thấy nó đã làm gì.

-- ================================================================================================
-- 1. NGƯỜI CHƠI THỬ
-- ================================================================================================
-- Tên chọn để khớp CHÍNH XÁC với đăng nhập dev: `POST /v1/auth/dev` đặt provider_user_id là
-- `dev:<tên viết thường>` (dev-auth.controller.ts:33) và cắt tên ở 16 ký tự. "seed-e2e-money" dài
-- 14 ký tự nên đi qua nguyên vẹn — tức bài E2E đăng nhập bằng đúng tên này là nhận đúng player
-- dưới đây, không cần đường tắt nào riêng cho test.
--
-- LƯU Ý cho người viết test: đăng nhập dev TẶNG 1000 coin mỗi lần gọi (dev-auth.controller.ts:44).
-- Nên số dư sau đăng nhập KHÔNG phải số seed. Mọi assert về tiền phải đo CHÊNH LỆCH, đừng so số
-- tuyệt đối — đây là lý do bài test đọc số dư trước rồi mới hành động.

insert into public.players (id, display_name, first_source, last_source, status)
values
  (md5('seed-e2e-money')::uuid, 'seed-e2e-money', 'dev', 'dev', 'active'),
  (md5('seed-e2e-empty')::uuid, 'seed-e2e-empty', 'dev', 'dev', 'active')
on conflict (id) do update set
  display_name = excluded.display_name,
  last_source  = excluded.last_source,
  -- Dựng lại trạng thái `active`: lát c4.2 cho phép tự xoá tài khoản, và một người chơi thử bị
  -- đánh dấu deleted sẽ làm E2E đỏ vì một lý do chẳng liên quan gì tới thứ đang kiểm.
  status       = 'active',
  deleted_at   = null,
  purged_at    = null;

insert into public.player_identities (id, player_id, platform, provider, provider_user_id, provider_username)
values
  (md5('id|seed-e2e-money')::uuid, md5('seed-e2e-money')::uuid, 'dev', 'dev', 'dev:seed-e2e-money', 'seed-e2e-money'),
  (md5('id|seed-e2e-empty')::uuid, md5('seed-e2e-empty')::uuid, 'dev', 'dev', 'dev:seed-e2e-empty', 'seed-e2e-empty')
on conflict (platform, provider, provider_user_id) do nothing;

-- Ví. `money` có sẵn tiền để mua được ngay; `empty` để KHÔNG có đồng nào — đó là người chơi kiểm
-- đường TỪ CHỐI, và đường từ chối là đường dễ hỏng âm thầm nhất trong một hệ thống tiền.
insert into public.player_wallets (player_id, currency_code, balance)
values
  (md5('seed-e2e-money')::uuid, 'coin', 5000),
  (md5('seed-e2e-empty')::uuid, 'coin', 0)
on conflict (player_id, currency_code) do update set
  balance    = excluded.balance,
  version    = public.player_wallets.version + 1,   -- giữ khoá lạc quan đúng nghĩa, đừng lùi version
  updated_at = now();

-- Năng lượng: `money` đầy bình để chơi được nhiều cấp liên tiếp, `empty` cạn.
insert into public.player_energy (player_id, energy_current, last_refill_at)
values
  (md5('seed-e2e-money')::uuid, 50, now()),
  (md5('seed-e2e-empty')::uuid,  0, now())
on conflict (player_id) do update set
  energy_current = excluded.energy_current,
  last_refill_at = excluded.last_refill_at,
  updated_at     = now();

-- ================================================================================================
-- 2. GÓI COIN
-- ================================================================================================
-- Giá trị dưới đây LẤY ĐÚNG từ database dev ngày 2026-09-09, không phải số bịa. Chủ dự án đã chốt
-- seed đầy đủ catalog dù các bảng này đã có dữ liệu thật; chép đúng giá trị đang chạy là cách để
-- "ghi đè" không thật sự đổi nền kinh tế của ai. Muốn đổi giá thì đổi qua app admin, rồi cập nhật
-- lại file này — đừng để hai nguồn nói khác nhau.
insert into public.coin_packages (id, sku, name, coin_amount, stars_amount, active, sort_order)
values
  (md5('pkg|minimum')::uuid, 'minimum', 'Minimum', 5000,   1, true,  5),
  (md5('pkg|starter')::uuid, 'starter', 'Starter',  100,  25, true, 10),
  (md5('pkg|popular')::uuid, 'popular', 'Popular',  500, 100, true, 20),
  (md5('pkg|mega')::uuid,    'mega',    'Mega',    1200, 200, true, 30)
on conflict (sku) do update set
  name         = excluded.name,
  coin_amount  = excluded.coin_amount,
  stars_amount = excluded.stars_amount,
  active       = excluded.active,
  sort_order   = excluded.sort_order,
  updated_at   = now();

-- ================================================================================================
-- 3. CATALOG COSMETIC
-- ================================================================================================
-- Cũng chép đúng từ database dev. `is_default_free` giữ nguyên: đó là ba món người chơi mới được
-- cấp sẵn (color:0 / shape:cube / trail:solid), đổi nó là đổi trải nghiệm lần đầu.
insert into public.shop_items (id, sku, type, asset_key, name, rarity, active, is_default_free)
values
  (md5('item|color-blue')::uuid,     'color-blue',     'color', 'color:0',        'Xanh lam',  'common', true, true),
  (md5('item|color-red')::uuid,      'color-red',      'color', 'color:1',        'Đỏ',        'common', true, false),
  (md5('item|color-green')::uuid,    'color-green',    'color', 'color:2',        'Xanh lục',  'common', true, false),
  (md5('item|color-orange')::uuid,   'color-orange',   'color', 'color:3',        'Cam',       'common', true, false),
  (md5('item|color-purple')::uuid,   'color-purple',   'color', 'color:4',        'Tím',       'common', true, false),
  (md5('item|color-cyan')::uuid,     'color-cyan',     'color', 'color:5',        'Ngọc',      'common', true, false),
  (md5('item|shape-cube')::uuid,     'shape-cube',     'shape', 'shape:cube',     'Cube',      'common', true, true),
  (md5('item|shape-sphere')::uuid,   'shape-sphere',   'shape', 'shape:sphere',   'Sphere',    'common', true, false),
  (md5('item|shape-cone')::uuid,     'shape-cone',     'shape', 'shape:cone',     'Cone',      'common', true, false),
  (md5('item|shape-cylinder')::uuid, 'shape-cylinder', 'shape', 'shape:cylinder', 'Cylinder',  'common', true, false),
  (md5('item|shape-bee')::uuid,      'shape-bee',      'shape', 'shape:bee',      'Bee',       'common', true, false),
  (md5('item|shape-fly')::uuid,      'shape-fly',      'shape', 'shape:fly',      'Fly',       'common', true, false),
  (md5('item|shape-ladybug')::uuid,  'shape-ladybug',  'shape', 'shape:ladybug',  'Ladybug',   'common', true, false),
  (md5('item|trail-solid')::uuid,    'trail-solid',    'trail', 'trail:solid',    'Solid',     'common', true, true),
  (md5('item|trail-dots')::uuid,     'trail-dots',     'trail', 'trail:dots',     'Dots',      'common', true, false),
  (md5('item|trail-stripes')::uuid,  'trail-stripes',  'trail', 'trail:stripes',  'Stripes',   'common', true, false),
  (md5('item|trail-chevrons')::uuid, 'trail-chevrons', 'trail', 'trail:chevrons', 'Chevrons',  'common', true, false)
on conflict (sku) do update set
  -- KHÔNG đụng `id`: các món này đã tồn tại với uuid ngẫu nhiên từ trước, và `player_inventory`
  -- cùng `shop_prices` trỏ vào uuid đó. Ghi đè id sẽ cắt đứt mọi thứ đang trỏ tới.
  type            = excluded.type,
  asset_key       = excluded.asset_key,
  name            = excluded.name,
  rarity          = excluded.rarity,
  active          = excluded.active,
  is_default_free = excluded.is_default_free,
  updated_at      = now();

-- ================================================================================================
-- 4. GIÁ COSMETIC
-- ================================================================================================
-- ┌─ PHẦN NÀY ĐẢO NGƯỢC MỘT QUYẾT ĐỊNH CŨ ───────────────────────────────────────────────────────┐
-- │ Bản seed.sql trước file này kết thúc bằng đúng một dòng:                                      │
-- │   "Prices are deliberately not seeded. Configure shop_prices from your admin workflow."       │
-- │ Tức đã từng có người CỐ Ý không seed giá, và giao việc đặt giá cho app admin.                 │
-- │                                                                                              │
-- │ Ngày 2026-09-09 chủ dự án chốt seed đầy đủ catalog kể cả giá, nên phần này thay quyết định    │
-- │ đó. Ghi lại ở đây để người sau không phải đào git log mới biết vì sao nó đổi — và để nếu muốn │
-- │ quay lại lối cũ thì biết chính xác phải xoá gì.                                               │
-- └──────────────────────────────────────────────────────────────────────────────────────────────┘
--
-- Bảng này đang RỖNG trên dev, mà `shop.controller.ts` join giá vào từng món và `ShopPanel` lọc
-- theo platform — nên không có giá thì cửa hàng hiện món mà không mua được. Đây là chỗ seed thật
-- sự lấp một lỗ hổng, chứ không phải chép lại thứ đã có.
--
-- SỐ TIỀN LÀ SỐ TÔI ĐẶT, không có tài liệu nào định giá cosmetic (doc 18 chỉ nói về gói Stars).
-- Chọn tròn và thấp để dev chơi một lúc là mua được: color 200, shape 400, trail 300. Đây là giá
-- SEED cho dev/E2E — đặt giá thật là việc của app admin.
--
-- `shop_prices` chỉ có PK `id`, KHÔNG có unique nào khác, nên `on conflict` không có khoá tự nhiên
-- để bám. Vì thế id được TÍNH từ (sku|platform|currency): cùng bộ ba thì cùng id, chạy lại là
-- update chứ không sinh hàng trùng.
insert into public.shop_prices (id, item_id, platform, currency_code, amount, active)
select
  md5(i.sku || '|' || p.platform || '|coin')::uuid,
  i.id,
  p.platform,
  'coin',
  case i.type when 'color' then 200 when 'shape' then 400 else 300 end,
  true
from public.shop_items i
cross join (values ('web'), ('telegram'), ('dev')) as p(platform)
where i.is_default_free = false      -- món tặng sẵn thì không cần giá
  and i.active = true
on conflict (id) do update set
  item_id       = excluded.item_id,
  amount        = excluded.amount,
  currency_code = excluded.currency_code,
  active        = excluded.active;
