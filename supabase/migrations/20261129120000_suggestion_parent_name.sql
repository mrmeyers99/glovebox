-- Campground suggestions near each day's last stop (issue #65): each one is
-- listed with the park it is in, so suggestion_places now also returns the
-- parent place's name.

drop function public.suggestion_places(text[], public.place_kind);

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
  parent_place_id bigint,
  parent_score    double precision, -- null without a parent, or until it is scored
  parent_name     text              -- null without a parent
)
language sql stable security invoker
set search_path = ''
as $$
  select p.id, p.source, p.source_id, p.wikidata, p.name, p.kind, p.category,
    extensions.st_y(p.location::extensions.geometry),
    extensions.st_x(p.location::extensions.geometry),
    p.tile_key, p.tags, p.image_file, p.image_credit, p.image_license,
    p.score::double precision, p.parent_place_id, parent.score::double precision,
    parent.name
  from public.places p
  join public.place_tiles t on t.tile_key = p.tile_key and t.status = 'done'
  left join public.places parent on parent.id = p.parent_place_id
  where p.tile_key = any (p_tile_keys)
    and p.kind = p_kind
    and p.score is not null
  order by p.id
$$;

revoke all on function public.suggestion_places(text[], public.place_kind) from public, anon;
grant execute on function public.suggestion_places(text[], public.place_kind)
  to authenticated, service_role;
