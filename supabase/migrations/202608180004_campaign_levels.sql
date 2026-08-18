begin;

-- Schema Level Campaign trên Supabase (doc 29 §L1) — thay hằng `CAMPAIGN_LEVELS` (shared/campaign.ts)
-- làm NGUỒN SỰ THẬT. `config` là JSONB = MatchConfigInput. Seed đúng 5 cấp hiện tại (id c1..c5,
-- published=true) ⇒ progress cũ (player_level_progress.level_id) giữ nguyên, trải nghiệm bất biến.

create table public.campaign_levels (
  id text primary key,
  sort_order integer not null unique,
  name text not null,
  config jsonb not null,                 -- MatchConfigInput (map/bots/rules/win)
  powerups text[] not null default '{}', -- PowerupKind[]
  unlock_requires text references public.campaign_levels(id),
  rewards jsonb not null,                -- {coin,xp,energy}
  published boolean not null default false,
  version integer not null default 1,
  updated_at timestamptz not null default now()
);
create index campaign_levels_published_idx on public.campaign_levels(published, sort_order);

-- Seed khớp CAMPAIGN_LEVELS (shared/campaign.ts, CAMPAIGN_LIVES=3). Thứ tự chèn theo unlock để FK hợp lệ.
insert into public.campaign_levels(id, sort_order, name, config, powerups, unlock_requires, rewards, published) values
  ('c1', 1, 'Khởi đầu',
    '{"bots":{"count":6},"rules":{"maxLives":3},"win":{"kind":"territory_pct","targetPct":0.3}}'::jsonb,
    '{head_start}', null, '{"coin":50,"xp":40,"energy":0}'::jsonb, true),
  ('c2', 2, 'Cầm cự',
    '{"bots":{"count":8},"rules":{"maxLives":3},"win":{"kind":"survive","durationSec":60}}'::jsonb,
    '{head_start,speed}', 'c1', '{"coin":60,"xp":55,"energy":0}'::jsonb, true),
  ('c3', 3, 'Săn totem',
    '{"bots":{"count":10},"rules":{"totemsEnabled":true,"maxLives":3},"win":{"kind":"capture_totems","totemGoal":3}}'::jsonb,
    '{speed,extra_life}', 'c2', '{"coin":80,"xp":70,"energy":1}'::jsonb, true),
  ('c4', 4, 'Mê cung',
    '{"bots":{"count":10},"map":{"obstacles":["2,-1","2,0","2,1"]},"rules":{"maxLives":3},"win":{"kind":"territory_pct","targetPct":0.35}}'::jsonb,
    '{head_start,speed,extra_life}', 'c3', '{"coin":100,"xp":90,"energy":1}'::jsonb, true),
  ('c5', 5, 'Chung kết',
    '{"bots":{"count":14},"map":{"obstacles":["-3,1","3,-1","0,3","0,-3"]},"rules":{"maxLives":3},"win":{"kind":"territory_pct","targetPct":0.45}}'::jsonb,
    '{head_start,speed,extra_life}', 'c4', '{"coin":150,"xp":140,"energy":2}'::jsonb, true);

alter table public.campaign_levels enable row level security;
revoke all on public.campaign_levels from anon, authenticated;

commit;
