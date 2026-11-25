-- Dragging stops can hand the start or end role to another stop: whichever
-- stop lands first on Day 1 becomes the start, and last on the last day the
-- end. That changes several rows at once, and the one-start/one-end indexes
-- are checked after every statement, so the old holder must be demoted before
-- the new one is promoted. This applies a batch of stop moves in that order,
-- in one transaction, so a failure leaves nothing half-done.
--
-- p_moves is a JSON array of {id, day_id?, position?, kind?}; omitted fields
-- are left as they are. A stop that becomes a start or end is un-skipped
-- (start and end can't be skipped). SECURITY INVOKER: row-level security
-- applies, so only owners and editors can move stops, and a stop the caller
-- can't update fails the whole batch.

create function public.move_stops(p_moves jsonb)
returns setof public.stops
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_move jsonb;
  v_count integer;
begin
  if jsonb_typeof(p_moves) is distinct from 'array' then
    raise exception 'p_moves must be a JSON array' using errcode = '22023';
  end if;

  -- Demotions to waypoint first, then everything else.
  for v_move in
    select value from jsonb_array_elements(p_moves)
    order by coalesce(value ->> 'kind', '') = 'waypoint' desc
  loop
    update public.stops set
      day_id   = coalesce((v_move ->> 'day_id')::uuid, day_id),
      position = coalesce(v_move ->> 'position', position),
      kind     = coalesce((v_move ->> 'kind')::public.stop_kind, kind),
      skipped  = skipped
        and coalesce((v_move ->> 'kind')::public.stop_kind, kind) = 'waypoint'
    where id = (v_move ->> 'id')::uuid;

    get diagnostics v_count = row_count;
    if v_count = 0 then
      raise exception 'Stop % not found', v_move ->> 'id' using errcode = 'P0002';
    end if;
  end loop;

  return query
    select s.* from public.stops s
    where s.id in (select (value ->> 'id')::uuid from jsonb_array_elements(p_moves));
end;
$$;

revoke execute on function public.move_stops(jsonb) from public, anon;
grant execute on function public.move_stops(jsonb) to authenticated;
