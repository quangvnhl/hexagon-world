begin;

-- Admin CRUD cấp Campaign (doc 29 §L4). VALIDATE cấu hình (resolveMatchConfig, unlock…) làm ở
-- CONTROLLER (TS, có shared); RPC ở đây chỉ upsert/publish (service_role tin controller đã kiểm).

-- Upsert 1 cấp từ jsonb. Bump version mỗi lần sửa. Trả về id.
create or replace function public.upsert_campaign_level(p_level jsonb)
returns text language plpgsql security definer set search_path = public
as $$
declare
  v_id text := p_level->>'id';
  v_powerups text[];
begin
  if v_id is null or length(trim(v_id)) = 0 then raise exception 'level_id_required'; end if;
  select coalesce(array_agg(value), '{}') into v_powerups
    from jsonb_array_elements_text(coalesce(p_level->'powerups', '[]'::jsonb)) as value;

  insert into campaign_levels(id, sort_order, name, config, powerups, unlock_requires, rewards, published, version, updated_at)
  values (
    v_id,
    (p_level->>'sortOrder')::int,
    coalesce(p_level->>'name', v_id),
    coalesce(p_level->'config', '{}'::jsonb),
    v_powerups,
    nullif(p_level->>'unlockRequires', ''),
    coalesce(p_level->'rewards', '{"coin":0,"xp":0,"energy":0}'::jsonb),
    coalesce((p_level->>'published')::boolean, false),
    1, now()
  )
  on conflict (id) do update set
    sort_order = excluded.sort_order,
    name = excluded.name,
    config = excluded.config,
    powerups = excluded.powerups,
    unlock_requires = excluded.unlock_requires,
    rewards = excluded.rewards,
    published = excluded.published,
    version = campaign_levels.version + 1,
    updated_at = now();
  return v_id;
end;
$$;

-- Bật/tắt publish 1 cấp.
create or replace function public.publish_campaign_level(p_id text, p_published boolean)
returns boolean language plpgsql security definer set search_path = public
as $$
begin
  update campaign_levels set published = p_published, updated_at = now() where id = p_id;
  if not found then raise exception 'level_not_found'; end if;
  return p_published;
end;
$$;

revoke all on function public.upsert_campaign_level(jsonb) from public, anon, authenticated;
revoke all on function public.publish_campaign_level(text, boolean) from public, anon, authenticated;
grant execute on function public.upsert_campaign_level(jsonb) to service_role;
grant execute on function public.publish_campaign_level(text, boolean) to service_role;

commit;
