-- Database side of the suggestions Edge Function (requirements §9, Discovery).
--
-- suggestion_places: the ranked places of one kind in the given tiles, for
-- signed-in users. Only tiles marked 'done' answer, and only places with a
-- score. It runs as the caller (security invoker), so places' RLS applies.
-- Called with POST, so a long corridor's tile list doesn't hit URL limits,
-- and with lat/lng read out of the geography column.
--
-- queue_place_tiles: queues tiles that have never been asked for as
-- 'pending' and returns the status of every requested tile. Existing tiles
-- are left as they are, so a 'done' tile is never downgraded (the fill worker
-- refreshes old 'done' tiles itself) and concurrent requests queue a tile
-- once. A tile inserted by a concurrent request may be missing from the
-- result; the caller treats it as pending. Service role only.

create function public.suggestion_places(
  p_tile_keys text[],
  p_kind public.place_kind
)
returns table (
  id              bigint,
  source          public.place_source,
  source_id       text,
  wikidata        text,
  name            text,
  kind            public.place_kind,
  category        text,
  lat             double precision,
  lng             double precision,
  tile_key        text,
  tags            jsonb,
  image_file      text,
  image_credit    text,
  image_license   text,
  score           double precision,
  parent_place_id bigint
)
language sql stable security invoker
set search_path = ''
as $$
  select p.id, p.source, p.source_id, p.wikidata, p.name, p.kind, p.category,
    extensions.st_y(p.location::extensions.geometry),
    extensions.st_x(p.location::extensions.geometry),
    p.tile_key, p.tags, p.image_file, p.image_credit, p.image_license,
    p.score::double precision, p.parent_place_id
  from public.places p
  join public.place_tiles t on t.tile_key = p.tile_key and t.status = 'done'
  where p.tile_key = any (p_tile_keys)
    and p.kind = p_kind
    and p.score is not null
  order by p.id
$$;

revoke all on function public.suggestion_places(text[], public.place_kind) from public, anon;
grant execute on function public.suggestion_places(text[], public.place_kind)
  to authenticated, service_role;

create function public.queue_place_tiles(p_tile_keys text[])
returns table (tile_key text, status public.place_tile_status)
language sql volatile security invoker
set search_path = ''
as $$
  -- The outer select's snapshot doesn't see the CTE's inserts, so each tile
  -- comes back once: from `queued` if new, from the table if it existed.
  with queued as (
    insert into public.place_tiles (tile_key)
    select distinct k from unnest(p_tile_keys) as k
    on conflict on constraint place_tiles_pkey do nothing
    returning place_tiles.tile_key, place_tiles.status
  )
  select q.tile_key, q.status from queued q
  union all
  select t.tile_key, t.status from public.place_tiles t
  where t.tile_key = any (p_tile_keys)
$$;

revoke all on function public.queue_place_tiles(text[]) from public, anon, authenticated;
grant execute on function public.queue_place_tiles(text[]) to service_role;
