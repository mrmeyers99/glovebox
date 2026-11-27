-- Tile fill worker (Discovery, requirements §9). The places-worker Edge
-- Function fetches each queued place_tiles row's places from OpenStreetMap
-- (Overpass). pg_cron calls it every minute through pg_net, with the project
-- URL and secret key read from Vault.
--
-- A tile is due when it is
--   - 'pending' (newly asked for),
--   - 'failed' and its back-off has passed (next_attempt_at),
--   - 'fetching' and its claim has expired (the worker stopped mid-way), or
--   - 'done' more than 90 days ago (OSM changes, so tiles are refreshed).
-- Claiming a tile marks it 'fetching', counts the attempt and holds it for a
-- lease; the worker then stores its places or marks it 'failed' with a
-- back-off (attempts counts failures in a row and resets on success).

-- When a 'failed' tile may be retried, or when a 'fetching' tile's claim
-- expires. Null for 'pending' and 'done'.
alter table public.place_tiles add column next_attempt_at timestamptz;

-- Rows from before this column: retry them now.
update public.place_tiles set next_attempt_at = now()
  where status in ('failed', 'fetching');

drop index public.place_tiles_queue_idx;
create index place_tiles_queue_idx on public.place_tiles (requested_at)
  where status <> 'done';

create function public.place_tile_is_due(t public.place_tiles)
returns boolean
language sql stable
set search_path = ''
as $$
  select t.status = 'pending'
    or (t.status in ('failed', 'fetching') and t.next_attempt_at <= now())
    or (t.status = 'done' and t.fetched_at < now() - interval '90 days')
$$;

-- Claims up to p_limit due tiles, new ones first, then oldest requested.
-- Concurrent workers never claim the same tile (skip locked).
create function public.claim_place_tiles(
  p_limit integer default 1,
  p_lease interval default '5 minutes'
)
returns table (tile_key text, attempts integer)
language sql volatile
set search_path = ''
as $$
  update public.place_tiles t
     set status = 'fetching',
         attempts = t.attempts + 1,
         next_attempt_at = now() + p_lease
    from (
      select q.tile_key
        from public.place_tiles q
       where public.place_tile_is_due(q)
       order by q.status <> 'pending', q.requested_at
       limit greatest(p_limit, 0)
         for update skip locked
    ) picked
   where t.tile_key = picked.tile_key
  returning t.tile_key, t.attempts
$$;

-- Stores one tile's OSM places and marks the tile 'done', in one transaction.
-- p_places is a JSON array of
--   { source_id, name, kind, category, lat, lng, wikidata?, tags?, parent_source_id? }
-- Places outside the tile are ignored (each place belongs to the tile its
-- location is in). OSM places of this tile that are no longer returned are
-- deleted. A place's enrichment is reset when its Wikidata item changes.
-- Returns the number of places stored.
create function public.store_place_tile(p_tile_key text, p_places jsonb)
returns integer
language plpgsql volatile
set search_path = ''
as $$
declare
  v_count integer;
begin
  perform 1 from public.place_tiles where tile_key = p_tile_key for update;
  if not found then
    raise exception 'unknown tile %', p_tile_key using errcode = 'no_data_found';
  end if;

  create temporary table tile_places on commit drop as
  select e.*
    from jsonb_to_recordset(coalesce(p_places, '[]')) as e(
      source_id text, name text, kind public.place_kind, category text,
      lat double precision, lng double precision, wikidata text, tags jsonb,
      parent_source_id text)
   where public.place_tile_key(e.lat, e.lng) = p_tile_key;

  insert into public.places as p
    (source, source_id, wikidata, name, kind, category, location, tags, fetched_at)
  select 'osm', e.source_id, e.wikidata, e.name, e.kind, e.category,
         extensions.st_setsrid(extensions.st_makepoint(e.lng, e.lat), 4326)::extensions.geography,
         coalesce(e.tags, '{}'), now()
    from tile_places e
  on conflict (source, source_id) do update
     set wikidata = excluded.wikidata,
         name = excluded.name,
         kind = excluded.kind,
         category = excluded.category,
         location = excluded.location,
         tags = excluded.tags,
         fetched_at = excluded.fetched_at,
         enriched_at = case when p.wikidata is distinct from excluded.wikidata
                            then null else p.enriched_at end;
  get diagnostics v_count = row_count;

  -- Parents: found by OSM id, in this tile or an already-stored neighbour.
  update public.places c
     set parent_place_id = par.id
    from tile_places e
    left join public.places par
      on par.source = 'osm' and par.source_id = e.parent_source_id
   where c.source = 'osm' and c.source_id = e.source_id
     and c.parent_place_id is distinct from par.id;

  delete from public.places p
   where p.source = 'osm' and p.tile_key = p_tile_key
     and not exists (select 1 from tile_places e where e.source_id = p.source_id);

  update public.place_tiles
     set status = 'done', fetched_at = now(), error = null, attempts = 0,
         next_attempt_at = null
   where tile_key = p_tile_key;

  drop table tile_places;
  return v_count;
end
$$;

-- Called by pg_cron every minute. Does nothing while the Vault secrets are
-- unset or no tile is due, so an idle queue costs no function invocations.
-- Returns the pg_net request id, or null when it didn't call.
create function public.invoke_places_worker()
returns bigint
language plpgsql volatile
set search_path = ''
as $$
declare
  v_url text;
  v_key text;
begin
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

revoke all on function public.place_tile_is_due(public.place_tiles) from public, anon, authenticated;
revoke all on function public.claim_place_tiles(integer, interval) from public, anon, authenticated;
revoke all on function public.store_place_tile(text, jsonb) from public, anon, authenticated;
revoke all on function public.invoke_places_worker() from public, anon, authenticated;
grant execute on function public.place_tile_is_due(public.place_tiles) to service_role;
grant execute on function public.claim_place_tiles(integer, interval) to service_role;
grant execute on function public.store_place_tile(text, jsonb) to service_role;

-- The schedule. On Supabase this enables pg_cron and pg_net, adds empty Vault
-- secrets to fill in (see the PR / docs), and runs the worker every minute.
-- Plain Postgres (the permission tests) has none of these, so it's skipped.
do $$
begin
  if not exists (select 1 from pg_available_extensions where name = 'pg_cron')
     or not exists (select 1 from pg_available_extensions where name = 'pg_net')
     or not exists (select 1 from pg_namespace where nspname = 'vault') then
    raise notice 'pg_cron, pg_net or Vault missing: places-worker is not scheduled';
    return;
  end if;

  create extension if not exists pg_cron with schema pg_catalog;
  create extension if not exists pg_net with schema extensions;

  if not exists (select 1 from vault.secrets where name = 'project_url') then
    perform vault.create_secret('', 'project_url',
      'https://<project-ref>.supabase.co, for pg_cron jobs that call Edge Functions');
  end if;
  if not exists (select 1 from vault.secrets where name = 'service_role_key') then
    perform vault.create_secret('', 'service_role_key',
      'A secret API key (sb_secret_...), for pg_cron jobs that call Edge Functions');
  end if;

  perform cron.schedule('places-worker', '* * * * *', 'select public.invoke_places_worker()');
end
$$;
