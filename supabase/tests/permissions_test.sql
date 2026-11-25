-- Permission (row-level security) tests. Run with: npm run test:db
-- Each block raises an exception if an expectation fails.
\set ON_ERROR_STOP 1

insert into auth.users (id, email) values
  ('11111111-1111-1111-1111-111111111111', 'alice@example.com'),
  ('22222222-2222-2222-2222-222222222222', 'bob@example.com'),
  ('33333333-3333-3333-3333-333333333333', 'carol@example.com'),
  ('44444444-4444-4444-4444-444444444444', 'dave@example.com');

create function pg_temp.act_as(p_user text) returns void language plpgsql as $$
declare v_id uuid; v_email text;
begin
  select id, email into v_id, v_email from auth.users where email = p_user || '@example.com';
  perform set_config('request.jwt.claims',
    json_build_object('sub', v_id, 'email', v_email)::text, false);
  set role authenticated;
end $$;

-- Profiles are created on sign-up.
do $$ begin
  assert (select count(*) from public.profiles) = 4, 'profiles created for each user';
end $$;

-- Alice creates a trip with a day, a start stop, and two invites.
do $$ begin perform pg_temp.act_as('alice'); end $$;
do $$
declare v_trip uuid; v_day uuid;
begin
  insert into public.trips (name) values ('Cross country') returning id into v_trip;
  assert (select role from public.trip_members where trip_id = v_trip) = 'owner',
    'creator becomes owner';
  insert into public.days (trip_id, position) values (v_trip, 'a0') returning id into v_day;
  insert into public.stops (trip_id, day_id, position, kind, name, lat, lng)
    values (v_trip, v_day, 'a0', 'start', 'Home', 40, -75);
  insert into public.trip_invites (trip_id, email, role) values
    (v_trip, 'bob@example.com', 'editor'),
    (v_trip, 'carol@example.com', 'viewer');
end $$;
reset role;

-- Bob (invited editor) sees nothing until he accepts, then can edit.
do $$ begin perform pg_temp.act_as('bob'); end $$;
do $$ begin
  assert (select count(*) from public.trips) = 0, 'invitee cannot see trip before accepting';
  assert public.accept_my_invites() = 1, 'bob joins one trip';
  assert (select count(*) from public.trips) = 1, 'member can see trip';
  update public.stops set notes = 'Reservation #123';
  assert (select updated_by from public.stops) = auth.uid(), 'updated_by tracks editor';
  delete from public.trips;
  assert (select count(*) from public.trips) = 1, 'editor cannot delete trip';
  begin
    insert into public.trip_invites (trip_id, email, role)
      select id, 'eve@example.com', 'editor' from public.trips;
    assert false, 'editor cannot invite';
  exception when insufficient_privilege then null;
  end;
end $$;
reset role;

-- Carol (viewer) can read but not change anything.
do $$ begin perform pg_temp.act_as('carol'); end $$;
do $$ begin
  assert public.accept_my_invites() = 1, 'carol joins one trip';
  assert (select notes from public.stops) = 'Reservation #123', 'viewer can read stops';
  update public.stops set notes = 'changed';
  assert (select notes from public.stops) = 'Reservation #123', 'viewer cannot edit stops';
  update public.trip_members set role = 'editor' where user_id = auth.uid();
  assert (select role from public.trip_members where user_id = auth.uid()) = 'viewer',
    'viewer cannot promote themself';
end $$;
reset role;

-- Dave (not invited) sees nothing.
do $$ begin perform pg_temp.act_as('dave'); end $$;
do $$ begin
  assert public.accept_my_invites() = 0, 'no invites for dave';
  assert (select count(*) from public.trips) = 0, 'non-member sees no trips';
  assert (select count(*) from public.stops) = 0, 'non-member sees no stops';
  assert (select count(*) from public.trip_invites) = 0, 'non-member sees no invites';
end $$;
reset role;

-- Alice: data-integrity rules.
do $$ begin perform pg_temp.act_as('alice'); end $$;
do $$ begin
  begin
    update public.stops set skipped = true where kind = 'start';
    assert false, 'start cannot be skipped';
  exception when check_violation then null;
  end;
  begin
    delete from public.days;
    assert false, 'day with stops cannot be deleted';
  exception when foreign_key_violation then null;
  end;
  delete from public.trip_members where role = 'owner';
  assert (select count(*) from public.trip_members where role = 'owner') = 1,
    'owner membership cannot be removed';
end $$;
reset role;

-- Route cache: shared by everyone, written only by the route Edge Function
-- (service role). Signed-in users can read it but not change it.
set role service_role;
insert into public.route_cache
  (from_lat, from_lng, to_lat, to_lng, distance_m, duration_s, geometry)
  values (40, -75, 40.1, -75.1, 15000, 900, '_ixrFvk~gM');
insert into public.route_cache
  (from_lat, from_lng, to_lat, to_lng, distance_m, duration_s, geometry)
  values (40, -75, 40.1, -75.1, 16000, 950, '_ixrFvk~gM')
  on conflict (from_lat, from_lng, to_lat, to_lng)
  do update set distance_m = excluded.distance_m, fetched_at = now();
reset role;

do $$ begin perform pg_temp.act_as('dave'); end $$;
do $$ begin
  assert (select distance_m from public.route_cache) = 16000,
    'service role can refresh a cache entry; any signed-in user can read it';
  begin
    insert into public.route_cache
      (from_lat, from_lng, to_lat, to_lng, distance_m, duration_s, geometry)
      values (1, 1, 2, 2, 1, 1, 'x');
    assert false, 'signed-in user cannot write route_cache';
  exception when insufficient_privilege then null;
  end;
  begin
    update public.route_cache set distance_m = 0;
    assert false, 'signed-in user cannot update route_cache';
  exception when insufficient_privilege then null;
  end;
end $$;
reset role;

set role anon;
do $$ begin
  perform 1 from public.route_cache;
  assert false, 'anon cannot read route_cache';
exception when insufficient_privilege then null;
end $$;
reset role;

-- Anonymous users have no access.
set role anon;
do $$ begin
  perform 1 from public.trips;
  assert false, 'anon cannot read trips';
exception when insufficient_privilege then null;
end $$;
reset role;

\echo 'All permission tests passed.'
