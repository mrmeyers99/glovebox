-- Places cache for Discovery (requirements §9): attractions and campgrounds
-- along a trip's route. Like route_cache, this is a shared cache, not trip
-- data: the same for every user, readable by anyone signed in, written only by
-- Edge Functions with the service role.
--
-- To stay within the free plan's 500 MB, places are fetched on demand, one map
-- tile at a time, only where trips actually go.
--
-- Tile scheme: a fixed grid of 0.5° × 0.5° cells. A tile is keyed by its
-- south-west corner as '<lat>_<lng>', each rounded down to a multiple of 0.5
-- and written with one decimal: (42.7, -96.2) is in tile '42.5_-96.5', and
-- (42.2, -97.0) in '42.0_-97.0'. A point on a grid line belongs to the tile to
-- its north / east. public.place_tile_key() computes it; the web app's
-- corridor helper (web/src/lib/corridor.ts) must match it.

create schema if not exists extensions;
create extension if not exists postgis with schema extensions;
-- Supabase already grants this; plain Postgres (the permission tests) doesn't.
grant usage on schema extensions to anon, authenticated, service_role;

create type public.place_tile_status as enum ('pending', 'fetching', 'done', 'failed');
create type public.place_source as enum ('osm', 'ridb');
create type public.place_kind as enum ('attraction', 'campground');

create function public.place_tile_key(lat double precision, lng double precision)
returns text
language sql immutable strict parallel safe
set search_path = ''
as $$
  select (floor(lat::numeric * 2) / 2)::numeric(4, 1)::text
    || '_' || (floor(lng::numeric * 2) / 2)::numeric(4, 1)::text
$$;

-- One row per tile that has been asked for. Rows double as the fill queue:
-- the app (via an Edge Function) inserts 'pending' tiles, and a worker claims
-- them ('fetching'), then marks them 'done' or 'failed' (with the error, and
-- retries up to a limit using attempts).
create table public.place_tiles (
  tile_key     text primary key
    check (tile_key ~ '^-?[0-9]{1,2}\.[05]_-?[0-9]{1,3}\.[05]$'),
  status       public.place_tile_status not null default 'pending',
  requested_at timestamptz not null default now(),
  fetched_at   timestamptz,
  error        text,
  attempts     integer not null default 0 check (attempts >= 0)
);

-- The worker's queue: only the few tiles waiting to be fetched.
create index place_tiles_queue_idx on public.place_tiles (requested_at)
  where status in ('pending', 'failed');

create table public.places (
  id              bigint generated always as identity primary key,
  source          public.place_source not null,
  -- OSM: 'node/123', 'way/456', 'relation/789'. RIDB: the facility id.
  source_id       text not null,
  wikidata        text check (wikidata ~ '^Q[0-9]+$'), -- QID, e.g. 'Q1048837'
  name            text not null,
  kind            public.place_kind not null,
  category        text not null, -- the OSM tag that made it a candidate, e.g. 'tourism=museum'
  location        extensions.geography(point, 4326) not null,
  -- The tile the place is in, from its location (not the tile whose fetch
  -- found it: an OSM way can reach into a neighbouring tile).
  tile_key        text not null generated always as (public.place_tile_key(
                    extensions.st_y(location::extensions.geometry),
                    extensions.st_x(location::extensions.geometry))) stored,
  -- The raw OSM tags we use (website, opening hours, campground amenities...).
  tags            jsonb not null default '{}',
  -- Ranking signals, filled by the enrichment worker. Null until enriched.
  pageviews_month integer check (pageviews_month >= 0), -- English Wikipedia, last 30 days
  sitelinks       integer check (sitelinks >= 0),       -- Wikipedia language editions
  commons_files   integer check (commons_files >= 0),   -- photos in the Commons category
  enriched_at     timestamptz,
  -- Photo from Wikimedia Commons, shown with its credit and licence.
  image_file      text, -- Commons file name, e.g. 'Corn Palace.jpg'
  image_credit    text,
  image_license   text,
  score           numeric, -- null until enriched
  -- The larger place this one is inside: a campground in a state park, a ride
  -- in a theme park.
  parent_place_id bigint references public.places (id) on delete set null
    check (parent_place_id <> id),
  fetched_at      timestamptz not null default now(),
  unique (source, source_id)
);

create index places_location_idx on public.places using gist (location);
create index places_tile_key_idx on public.places (tile_key);
create index places_wikidata_idx on public.places (wikidata) where wikidata is not null;
create index places_parent_idx on public.places (parent_place_id) where parent_place_id is not null;
-- The enrichment worker's queue.
create index places_unenriched_idx on public.places (id) where enriched_at is null;

-- Row-level security: readable by signed-in users; written only with the
-- service role (which bypasses RLS).
alter table public.place_tiles enable row level security;
alter table public.places      enable row level security;

create policy place_tiles_select on public.place_tiles
  for select to authenticated using (true);
create policy places_select on public.places
  for select to authenticated using (true);

revoke all on public.place_tiles, public.places from anon, authenticated;
grant select on public.place_tiles, public.places to authenticated;
grant select, insert, update, delete on public.place_tiles, public.places to service_role;
