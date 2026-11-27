-- Enrichment worker (Discovery, requirements §9). The places-enrich Edge
-- Function gives each place its ranking signals (Wikidata sitelinks, English
-- Wikipedia pageviews, Commons photo count), a Commons photo with its credit,
-- and a score. pg_cron calls it every minute through pg_net, like
-- places-worker (see the places_worker migration for the Vault secrets).
--
-- A place is due when it has never been enriched or was enriched more than
-- 90 days ago, and it isn't claimed or backed off (enrich_next_attempt_at).
-- Wikimedia rate-limits aggressively: when it answers 429 / 503 the worker
-- pauses (worker_pauses) and claims no place with a Wikidata item until then.
-- Places without one need no requests and are scored meanwhile.

comment on column public.places.pageviews_month is
  'English Wikipedia user pageviews per month, averaged over the last 12 full months';

-- When a claimed place's lease expires, or when a place whose enrichment
-- failed may be retried. Null when neither.
alter table public.places add column enrich_next_attempt_at timestamptz;

-- The queue, oldest first (never enriched before any).
drop index public.places_unenriched_idx;
create index places_enrich_queue_idx on public.places (enriched_at nulls first, id);

-- Background workers that a rate limit has paused, until when and why.
create table public.worker_pauses (
  worker       text primary key,
  paused_until timestamptz not null,
  reason       text
);
alter table public.worker_pauses enable row level security;
revoke all on public.worker_pauses from anon, authenticated;
grant select, insert, update, delete on public.worker_pauses to service_role;

create function public.place_needs_enrichment(p public.places)
returns boolean
language sql stable
set search_path = ''
as $$
  select (p.enriched_at is null or p.enriched_at < now() - interval '90 days')
    and (p.enrich_next_attempt_at is null or p.enrich_next_attempt_at <= now())
$$;

create function public.places_enrich_paused()
returns boolean
language sql stable
set search_path = ''
as $$
  select exists (select 1 from public.worker_pauses
                  where worker = 'places-enrich' and paused_until > now())
$$;

-- Claims up to p_linked_limit due places with a Wikidata item (none while the
-- worker is paused) and up to p_plain_limit without, oldest first, and holds
-- them for a lease. Concurrent workers never claim the same place.
create function public.claim_places_to_enrich(
  p_linked_limit integer default 20,
  p_plain_limit integer default 1000,
  p_lease interval default '5 minutes'
)
returns table (id bigint, wikidata text, category text)
language sql volatile
set search_path = ''
as $$
  with linked as (
    select q.id from public.places q
     where q.wikidata is not null and public.place_needs_enrichment(q)
       and not public.places_enrich_paused()
     order by q.enriched_at nulls first, q.id
     limit greatest(p_linked_limit, 0)
       for update skip locked
  ), plain as (
    select q.id from public.places q
     where q.wikidata is null and public.place_needs_enrichment(q)
     order by q.enriched_at nulls first, q.id
     limit greatest(p_plain_limit, 0)
       for update skip locked
  )
  update public.places p
     set enrich_next_attempt_at = now() + p_lease
   where p.id in (select linked.id from linked union all select plain.id from plain)
  returning p.id, p.wikidata, p.category
$$;

-- Stores enrichment results and marks the places enriched. p_places is a JSON
-- array of
--   { id, wikidata, sitelinks, pageviews_month, commons_files, image_file,
--     image_credit, image_license, score }
-- A place whose Wikidata item changed since it was claimed (a tile refetch)
-- is skipped: it is due again with its new item. Returns the number stored.
create function public.store_place_enrichment(p_places jsonb)
returns integer
language plpgsql volatile
set search_path = ''
as $$
declare
  v_count integer;
begin
  update public.places p
     set sitelinks = e.sitelinks,
         pageviews_month = e.pageviews_month,
         commons_files = e.commons_files,
         image_file = e.image_file,
         image_credit = e.image_credit,
         image_license = e.image_license,
         score = e.score,
         enriched_at = now(),
         enrich_next_attempt_at = null
    from jsonb_to_recordset(coalesce(p_places, '[]')) as e(
      id bigint, wikidata text, sitelinks integer, pageviews_month integer,
      commons_files integer, image_file text, image_credit text, image_license text,
      score numeric)
   where p.id = e.id and p.wikidata is not distinct from e.wikidata;
  get diagnostics v_count = row_count;
  return v_count;
end
$$;

-- Called by pg_cron every minute. Does nothing while the Vault secrets are
-- unset or no place is due (counting places with a Wikidata item only while
-- the worker isn't paused). Returns the pg_net request id, or null.
create function public.invoke_places_enrich()
returns bigint
language plpgsql volatile
set search_path = ''
as $$
declare
  v_paused boolean := public.places_enrich_paused();
  v_url text;
  v_key text;
begin
  if not exists (select 1 from public.places p
                  where public.place_needs_enrichment(p)
                    and (p.wikidata is null or not v_paused)) then
    return null;
  end if;
  select decrypted_secret into v_url from vault.decrypted_secrets where name = 'project_url';
  select decrypted_secret into v_key from vault.decrypted_secrets where name = 'service_role_key';
  if coalesce(v_url, '') = '' or coalesce(v_key, '') = '' then
    raise warning 'places-enrich: set the project_url and service_role_key Vault secrets';
    return null;
  end if;
  return net.http_post(
    url := rtrim(v_url, '/') || '/functions/v1/places-enrich',
    headers := jsonb_build_object('content-type', 'application/json', 'apikey', v_key),
    body := '{}'::jsonb,
    timeout_milliseconds := 150000
  );
end
$$;

revoke all on function public.place_needs_enrichment(public.places) from public, anon, authenticated;
revoke all on function public.places_enrich_paused() from public, anon, authenticated;
revoke all on function public.claim_places_to_enrich(integer, integer, interval) from public, anon, authenticated;
revoke all on function public.store_place_enrichment(jsonb) from public, anon, authenticated;
revoke all on function public.invoke_places_enrich() from public, anon, authenticated;
grant execute on function public.place_needs_enrichment(public.places) to service_role;
grant execute on function public.places_enrich_paused() to service_role;
grant execute on function public.claim_places_to_enrich(integer, integer, interval) to service_role;
grant execute on function public.store_place_enrichment(jsonb) to service_role;

-- The schedule. The places_worker migration already enabled pg_cron and
-- pg_net and created the Vault secrets; plain Postgres (the permission tests)
-- has none of these, so it's skipped there.
do $$
begin
  if not exists (select 1 from pg_extension where extname = 'pg_cron')
     or not exists (select 1 from pg_extension where extname = 'pg_net') then
    raise notice 'pg_cron or pg_net missing: places-enrich is not scheduled';
    return;
  end if;
  perform cron.schedule('places-enrich', '* * * * *', 'select public.invoke_places_enrich()');
end
$$;
