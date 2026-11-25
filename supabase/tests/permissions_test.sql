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

-- Managing members. Dave has a trip of his own, to check that memberships
-- can't be moved between trips.
do $$ begin perform pg_temp.act_as('dave'); end $$;
insert into public.trips (name) values ('Dave trip');
reset role;
do $$ begin
  perform set_config('test.dave_trip', id::text, false)
    from public.trips where name = 'Dave trip';
end $$;

-- Members other than the owner can't change roles, remove others or revoke invites.
do $$ begin perform pg_temp.act_as('bob'); end $$;
do $$ begin
  update public.trip_members set role = 'editor'
    where user_id = '33333333-3333-3333-3333-333333333333';
  delete from public.trip_members where user_id = '33333333-3333-3333-3333-333333333333';
  assert (select role from public.trip_members
    where user_id = '33333333-3333-3333-3333-333333333333') = 'viewer',
    'editor cannot change or remove another member';
end $$;
reset role;

-- The owner changes roles, revokes invites and removes members.
do $$ begin perform pg_temp.act_as('alice'); end $$;
do $$
declare v_trip uuid := (select id from public.trips where name = 'Cross country');
begin
  update public.trip_members set role = 'viewer'
    where user_id = '22222222-2222-2222-2222-222222222222';
  assert (select role from public.trip_members
    where user_id = '22222222-2222-2222-2222-222222222222') = 'viewer',
    'owner can demote an editor';
  update public.trip_members set role = 'editor'
    where user_id = '22222222-2222-2222-2222-222222222222';
  assert (select role from public.trip_members
    where user_id = '22222222-2222-2222-2222-222222222222') = 'editor',
    'owner can promote a viewer';

  begin
    update public.trip_members set role = 'owner'
      where user_id = '22222222-2222-2222-2222-222222222222';
    assert false, 'owner cannot make another member owner';
  exception when insufficient_privilege or unique_violation then null;
  end;
  update public.trip_members set role = 'editor' where user_id = auth.uid();
  assert (select role from public.trip_members where user_id = auth.uid()) = 'owner',
    'owner cannot change their own role';
  begin
    update public.trip_members set trip_id = current_setting('test.dave_trip')::uuid
      where user_id = '22222222-2222-2222-2222-222222222222';
    assert false, 'owner cannot move a membership to another trip';
  exception when insufficient_privilege then null;
  end;
  begin
    update public.trip_members set user_id = '44444444-4444-4444-4444-444444444444'
      where user_id = '22222222-2222-2222-2222-222222222222';
    assert false, 'owner cannot reassign a membership to another user';
  exception when insufficient_privilege then null;
  end;

  insert into public.trip_invites (trip_id, email, role)
    values (v_trip, 'erin@example.com', 'viewer');
  delete from public.trip_invites where email = 'erin@example.com';
  assert not exists (select 1 from public.trip_invites where email = 'erin@example.com'),
    'owner can revoke a pending invite';

  delete from public.trip_members where user_id = '33333333-3333-3333-3333-333333333333';
  assert not exists (select 1 from public.trip_members
    where user_id = '33333333-3333-3333-3333-333333333333'), 'owner can remove a member';
  assert not exists (select 1 from public.trip_invites where email = 'carol@example.com'),
    'removing a member drops the invite they accepted';
end $$;
reset role;

do $$ begin perform pg_temp.act_as('carol'); end $$;
do $$ begin
  assert (select count(*) from public.trips) = 0, 'removed member loses access to the trip';
  assert (select count(*) from public.stops) = 0, 'removed member loses access to stops';
  assert (select count(*) from public.trip_members) = 0, 'removed member sees no members';
end $$;
reset role;

-- A removed member can be invited again.
do $$ begin perform pg_temp.act_as('alice'); end $$;
insert into public.trip_invites (trip_id, email, role)
  select id, 'carol@example.com', 'viewer' from public.trips where name = 'Cross country';
reset role;
do $$ begin perform pg_temp.act_as('carol'); end $$;
do $$ begin
  assert public.accept_my_invites() = 1, 'removed member can rejoin with a new invite';
  assert (select count(*) from public.trips) = 1, 'rejoined member sees the trip';
end $$;
reset role;

-- A member can leave; afterwards they have no access.
do $$ begin perform pg_temp.act_as('bob'); end $$;
do $$ begin
  delete from public.trip_members where user_id = auth.uid();
  assert (select count(*) from public.trips) = 0, 'member who left loses access';
  assert (select count(*) from public.trip_invites) = 0, 'member who left sees no invites';
  assert public.accept_my_invites() = 0, 'leaving does not re-accept an old invite';
end $$;
reset role;

do $$ begin perform pg_temp.act_as('alice'); end $$;
do $$ begin
  assert (select array_agg(user_id order by user_id) from public.trip_members
      where trip_id = (select id from public.trips where name = 'Cross country'))
    = array['11111111-1111-1111-1111-111111111111',
            '33333333-3333-3333-3333-333333333333']::uuid[],
    'owner sees the updated member list';
end $$;
reset role;

-- Moving stops can hand the start role to another stop, atomically.
do $$ begin perform pg_temp.act_as('alice'); end $$;
do $$
declare
  v_trip uuid := (select id from public.trips where name = 'Cross country');
  v_day uuid := (select id from public.days where trip_id = v_trip);
  v_home uuid := (select id from public.stops where trip_id = v_trip and kind = 'start');
  v_cafe uuid;
begin
  insert into public.stops (trip_id, day_id, position, name, lat, lng, skipped)
    values (v_trip, v_day, 'a1', 'Cafe', 40.1, -75.1, true) returning id into v_cafe;

  perform public.move_stops(jsonb_build_array(
    jsonb_build_object('id', v_cafe, 'position', 'Zz', 'kind', 'start'),
    jsonb_build_object('id', v_home, 'kind', 'waypoint')));
  assert (select kind from public.stops where id = v_cafe) = 'start', 'waypoint becomes the start';
  assert not (select skipped from public.stops where id = v_cafe), 'new start is un-skipped';
  assert (select kind from public.stops where id = v_home) = 'waypoint', 'old start becomes a waypoint';

  begin
    perform public.move_stops(jsonb_build_array(
      jsonb_build_object('id', v_home, 'kind', 'start'),
      jsonb_build_object('id', v_cafe, 'kind', 'waypoint'),
      jsonb_build_object('id', gen_random_uuid(), 'position', 'a5')));
    assert false, 'moving a missing stop fails';
  exception when no_data_found then null;
  end;
  assert (select kind from public.stops where id = v_cafe) = 'start',
    'a failed batch changes nothing';

  -- Put things back for the tests below.
  perform public.move_stops(jsonb_build_array(
    jsonb_build_object('id', v_home, 'kind', 'start'),
    jsonb_build_object('id', v_cafe, 'kind', 'waypoint')));
  delete from public.stops where id = v_cafe;
end $$;
reset role;

-- A viewer can't move stops.
do $$ begin perform pg_temp.act_as('carol'); end $$;
do $$ begin
  begin
    perform public.move_stops(jsonb_build_array(jsonb_build_object(
      'id', (select id from public.stops where kind = 'start'), 'position', 'b0')));
    assert false, 'viewer cannot move stops';
  exception when no_data_found then null;
  end;
end $$;
reset role;

set role anon;
do $$ begin
  perform public.move_stops('[]');
  assert false, 'anon cannot call move_stops';
exception when insufficient_privilege then null;
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

-- Gas price cache: the national average, written only by the gas-price Edge
-- Function (service role). Signed-in users can read it but not change it.
set role service_role;
insert into public.gas_price_cache (region, price_per_gallon, as_of)
  values ('US', 3.1, '2026-11-16');
insert into public.gas_price_cache (region, price_per_gallon, as_of)
  values ('US', 3.061, '2026-11-23')
  on conflict (region) do update set
    price_per_gallon = excluded.price_per_gallon,
    as_of = excluded.as_of,
    fetched_at = now();
reset role;

do $$ begin perform pg_temp.act_as('dave'); end $$;
do $$ begin
  assert (select price_per_gallon from public.gas_price_cache where region = 'US') = 3.061,
    'service role can refresh the gas price; any signed-in user can read it';
  begin
    insert into public.gas_price_cache (region, price_per_gallon, as_of)
      values ('CA', 5, '2026-11-23');
    assert false, 'signed-in user cannot write gas_price_cache';
  exception when insufficient_privilege then null;
  end;
  begin
    update public.gas_price_cache set price_per_gallon = 0.01;
    assert false, 'signed-in user cannot update gas_price_cache';
  exception when insufficient_privilege then null;
  end;
  begin
    delete from public.gas_price_cache;
    assert false, 'signed-in user cannot delete from gas_price_cache';
  exception when insufficient_privilege then null;
  end;
end $$;
reset role;

set role anon;
do $$ begin
  perform 1 from public.gas_price_cache;
  assert false, 'anon cannot read gas_price_cache';
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
