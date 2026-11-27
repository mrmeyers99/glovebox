-- Tiles whose places are still being scored (Discovery, requirements §9).
--
-- The fill worker stores a tile's places unscored and marks the tile 'done';
-- the enrichment worker scores them over the next minutes (places with a
-- Wikidata item, usually the best ones, a few dozen a minute). Until then
-- suggestion_places leaves them out. The suggestions function reports such
-- tiles as `scoring` so the app asks for them again, instead of keeping the
-- partial answer for good.
--
-- A place counts while it has never been scored and isn't backed off for
-- long (a place whose own Wikimedia request failed waits a day; asking again
-- every few seconds until then would be pointless).

create function public.scoring_place_tiles(
  p_tile_keys text[],
  p_kind public.place_kind
)
returns table (tile_key text)
language sql stable security invoker
set search_path = ''
as $$
  select distinct p.tile_key
  from public.places p
  join public.place_tiles t on t.tile_key = p.tile_key and t.status = 'done'
  where p.tile_key = any (p_tile_keys)
    and p.kind = p_kind
    and p.score is null
    and (p.enrich_next_attempt_at is null
         or p.enrich_next_attempt_at < now() + interval '10 minutes')
$$;

revoke all on function public.scoring_place_tiles(text[], public.place_kind) from public, anon;
grant execute on function public.scoring_place_tiles(text[], public.place_kind)
  to authenticated, service_role;
