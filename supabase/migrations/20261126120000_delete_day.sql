-- Deleting a day. The database refuses to delete a day that still has stops
-- (on delete restrict), so the app first moves them to a neighbouring day or
-- deletes them, as the user chose. This does all of it in one transaction,
-- so a failure leaves the trip as it was.
--
-- p_moves is applied with move_stops (same format). p_delete_stop_ids are the
-- stops the user chose to delete; only those still on the day are deleted, so
-- a stop someone else moved away meanwhile is kept. If someone added a stop
-- to the day meanwhile, deleting the day fails (foreign_key_violation) rather
-- than take it along. A trip always keeps at least one day. SECURITY INVOKER:
-- row-level security applies, so only owners and editors can delete days.
-- Returns the moved stops.

create function public.delete_day(
  p_day_id uuid,
  p_moves jsonb default '[]',
  p_delete_stop_ids uuid[] default '{}'
)
returns setof public.stops
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_trip uuid;
  v_count integer;
begin
  select trip_id into v_trip from public.days where id = p_day_id;
  if v_trip is null then
    raise exception 'Day % not found', p_day_id using errcode = 'P0002';
  end if;

  -- Lock the trip's days so two people can't delete its last two at once.
  perform 1 from public.days where trip_id = v_trip for update;
  if (select count(*) from public.days where trip_id = v_trip) <= 1 then
    raise exception 'A trip needs at least one day' using errcode = '23514';
  end if;

  return query select * from public.move_stops(p_moves);

  delete from public.stops
    where id = any(p_delete_stop_ids) and day_id = p_day_id;

  delete from public.days where id = p_day_id;
  get diagnostics v_count = row_count;
  if v_count = 0 then
    raise exception 'Day % not found', p_day_id using errcode = 'P0002';
  end if;
end;
$$;

revoke execute on function public.delete_day(uuid, jsonb, uuid[]) from public, anon;
grant execute on function public.delete_day(uuid, jsonb, uuid[]) to authenticated;
