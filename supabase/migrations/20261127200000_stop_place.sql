-- A stop added from a suggestion (Discovery, requirements §9) remembers the
-- place it came from, so the map shows that place as "In your trip" instead
-- of suggesting it again. Places are a cache that the tile fill worker can
-- prune, so the link is dropped (not the stop) when the place goes.
-- RLS for stops is unchanged: whoever can edit a stop can set its place.

alter table public.stops
  add column place_id bigint references public.places (id) on delete set null;

-- For the cascade when the worker deletes places.
create index stops_place_id_idx on public.stops (place_id) where place_id is not null;
