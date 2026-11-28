-- Tile fill worker pause (Discovery, requirements §9). When no Overpass
-- server answers a tile (all busy, timing out or refusing), the places-worker
-- function pauses itself in worker_pauses for a few minutes, instead of
-- failing tile after tile while the public servers are overloaded. pg_cron
-- doesn't call it until the pause is over.

create function public.places_worker_paused()
returns boolean
language sql stable
set search_path = ''
as $$
  select exists (select 1 from public.worker_pauses
                  where worker = 'places-worker' and paused_until > now())
$$;

revoke all on function public.places_worker_paused() from public, anon, authenticated;
grant execute on function public.places_worker_paused() to service_role;

-- As in the places_worker migration, plus: does nothing while paused.
create or replace function public.invoke_places_worker()
returns bigint
language plpgsql volatile
set search_path = ''
as $$
declare
  v_url text;
  v_key text;
begin
  if public.places_worker_paused() then
    return null;
  end if;
  if not exists (select 1 from public.place_tiles t where public.place_tile_is_due(t)) then
    return null;
  end if;
  select decrypted_secret into v_url from vault.decrypted_secrets where name = 'project_url';
  select decrypted_secret into v_key from vault.decrypted_secrets where name = 'service_role_key';
  if coalesce(v_url, '') = '' or coalesce(v_key, '') = '' then
    raise warning 'places-worker: set the project_url and service_role_key Vault secrets';
    return null;
  end if;
  return net.http_post(
    url := rtrim(v_url, '/') || '/functions/v1/places-worker',
    headers := jsonb_build_object('content-type', 'application/json', 'apikey', v_key),
    body := '{}'::jsonb,
    timeout_milliseconds := 150000
  );
end
$$;
