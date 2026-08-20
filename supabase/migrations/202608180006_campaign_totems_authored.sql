-- doc 32: Campaign KHÔNG sinh totem ngẫu nhiên nữa — chỉ dùng totem admin tự vẽ (map.totems).
-- Tắt totemsEnabled ở các cấp seed; cấp "Săn totem" (c3, capture_totems) được đặt totem tường
-- minh (đủ ≥ totemGoal) để vẫn qua được. Idempotent (jsonb_set) — chạy lại vô hại.

-- c1,c2,c4,c5: tắt sinh ngẫu nhiên (giữ nguyên map/obstacles nếu có).
update public.campaign_levels
  set config = jsonb_set(config, '{rules,totemsEnabled}', 'false'::jsonb, true)
  where id in ('c1', 'c2', 'c4', 'c5');

-- c3: tắt ngẫu nhiên + totem tường minh (khớp catalog fallback CAMPAIGN_LEVELS).
update public.campaign_levels
  set config = jsonb_set(
        jsonb_set(config, '{rules,totemsEnabled}', 'false'::jsonb, true),
        '{map}',
        '{"totems":[{"kind":"speed","q":4,"r":0},{"kind":"slow","q":-4,"r":0},{"kind":"radar","q":0,"r":4},{"kind":"speed","q":0,"r":-4}]}'::jsonb,
        true)
  where id = 'c3';
