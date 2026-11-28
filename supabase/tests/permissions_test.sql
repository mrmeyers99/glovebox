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

-- Deleting a day moves or deletes its stops first, in one transaction.
do $$ begin perform pg_temp.act_as('alice'); end $$;
do $$
declare
  v_trip uuid := (select id from public.trips where name = 'Cross country');
  v_day1 uuid := (select id from public.days where trip_id = v_trip);
  v_day2 uuid;
  v_kept uuid;
  v_gone uuid;
  v_other uuid;
begin
  begin
    perform public.delete_day(v_day1);
    assert false, 'the only day cannot be deleted';
  exception when check_violation then null;
  end;

  insert into public.days (trip_id, position) values (v_trip, 'a5') returning id into v_day2;
  insert into public.stops (trip_id, day_id, position, name, lat, lng) values
    (v_trip, v_day2, 'a0', 'Kept', 40, -75) returning id into v_kept;
  insert into public.stops (trip_id, day_id, position, name, lat, lng) values
    (v_trip, v_day2, 'a1', 'Gone', 40, -75) returning id into v_gone;
  insert into public.stops (trip_id, day_id, position, name, lat, lng) values
    (v_trip, v_day2, 'a2', 'Other', 40, -75) returning id into v_other;

  begin
    perform public.delete_day(v_day2,
      jsonb_build_array(jsonb_build_object('id', v_kept, 'day_id', v_day1, 'position', 'b0')),
      array[v_gone]);
    assert false, 'a day with stops left on it cannot be deleted';
  exception when foreign_key_violation then null;
  end;
  assert (select day_id from public.stops where id = v_kept) = v_day2,
    'a failed delete moves nothing';
  assert exists (select 1 from public.stops where id = v_gone),
    'a failed delete deletes no stops';

  assert (select count(*) from public.delete_day(v_day2,
      jsonb_build_array(jsonb_build_object('id', v_kept, 'day_id', v_day1, 'position', 'b0')),
      array[v_gone, v_other])) = 1, 'returns the moved stops';
  assert not exists (select 1 from public.days where id = v_day2), 'day is deleted';
  assert (select day_id from public.stops where id = v_kept) = v_day1, 'stop is moved';
  assert not exists (select 1 from public.stops where id in (v_gone, v_other)),
    'chosen stops are deleted';

  delete from public.stops where id = v_kept;
  insert into public.days (trip_id, position) values (v_trip, 'a5');
end $$;
reset role;

-- A viewer can't delete days.
do $$ begin perform pg_temp.act_as('carol'); end $$;
do $$ begin
  begin
    perform public.delete_day((select id from public.days where position = 'a5'));
    assert false, 'viewer cannot delete a day';
  exception when no_data_found then null;
  end;
  assert (select count(*) from public.days) = 2, 'the day is still there';
end $$;
reset role;

do $$ begin perform pg_temp.act_as('alice'); end $$;
do $$ begin
  perform public.delete_day((select id from public.days where position = 'a5'));
  assert (select count(*) from public.days) = 1, 'an empty day is deleted';
end $$;
reset role;

set role anon;
do $$ begin
  perform public.delete_day(gen_random_uuid());
  assert false, 'anon cannot call delete_day';
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

-- Places cache (Discovery): shared by everyone, written only by the place
-- workers (service role). Signed-in users can read it but not change it.
do $$ begin
  assert public.place_tile_key(42.7, -96.2) = '42.5_-96.5', 'tile key rounds down to 0.5°';
  assert public.place_tile_key(42.2, -97) = '42.0_-97.0', 'a point on a grid line is in the tile to its north / east';
  assert public.place_tile_key(-0.2, 0.2) = '-0.5_0.0', 'tile keys work around 0°';
end $$;

set role service_role;
insert into public.place_tiles (tile_key) values ('43.5_-98.5');
update public.place_tiles set status = 'done', fetched_at = now(), attempts = 1
  where tile_key = '43.5_-98.5';
insert into public.places (source, source_id, wikidata, name, kind, category, location, tags)
  values
    ('osm', 'way/1', 'Q1048837', 'Corn Palace', 'attraction', 'tourism=attraction',
      extensions.st_point(-98.0298, 43.7140, 4326)::extensions.geography, '{"website": "https://cornpalace.com"}'),
    ('osm', 'node/2', null, 'Lost Island Theme Park', 'attraction', 'tourism=theme_park',
      extensions.st_point(-92.4067, 42.4415, 4326)::extensions.geography, '{}');
insert into public.places (source, source_id, name, kind, category, location, parent_place_id)
  select 'osm', 'node/3', 'Matugani', 'attraction', 'attraction=roller_coaster',
    extensions.st_point(-92.4070, 42.4420, 4326)::extensions.geography, id
  from public.places where source_id = 'node/2';
update public.places set pageviews_month = 9000, sitelinks = 12, commons_files = 80,
  score = 5.1, enriched_at = now() where source_id = 'way/1';
do $$ begin
  begin
    insert into public.places (source, source_id, name, kind, category, location)
      values ('osm', 'way/1', 'Corn Palace again', 'attraction', 'tourism=attraction',
        extensions.st_point(-98, 43.7, 4326)::extensions.geography);
    assert false, 'a source id is stored once';
  exception when unique_violation then null;
  end;
  begin
    insert into public.place_tiles (tile_key) values ('43.7_-98.5');
    assert false, 'tile keys are on the 0.5° grid';
  exception when check_violation then null;
  end;
end $$;
reset role;

do $$ begin perform pg_temp.act_as('dave'); end $$;
do $$ begin
  assert (select tile_key from public.places where source_id = 'way/1') = '43.5_-98.5',
    'a place''s tile comes from its location; any signed-in user can read places';
  assert (select status from public.place_tiles where tile_key = '43.5_-98.5') = 'done',
    'any signed-in user can read tiles';
  assert (select p.name from public.places c join public.places p on p.id = c.parent_place_id
    where c.name = 'Matugani') = 'Lost Island Theme Park', 'a place can sit inside another';
  assert (select count(*) from public.places
    where extensions.st_dwithin(location,
      extensions.st_point(-98.03, 43.71, 4326)::extensions.geography, 1000)) = 1,
    'places can be found by distance';
  begin
    insert into public.place_tiles (tile_key) values ('40.0_-75.0');
    assert false, 'signed-in user cannot queue tiles directly';
  exception when insufficient_privilege then null;
  end;
  begin
    update public.place_tiles set status = 'pending';
    assert false, 'signed-in user cannot update place_tiles';
  exception when insufficient_privilege then null;
  end;
  begin
    delete from public.place_tiles;
    assert false, 'signed-in user cannot delete from place_tiles';
  exception when insufficient_privilege then null;
  end;
  begin
    insert into public.places (source, source_id, name, kind, category, location)
      values ('osm', 'node/9', 'Fake', 'attraction', 'tourism=museum',
        extensions.st_point(-75, 40, 4326)::extensions.geography);
    assert false, 'signed-in user cannot write places';
  exception when insufficient_privilege then null;
  end;
  begin
    update public.places set score = 100;
    assert false, 'signed-in user cannot update places';
  exception when insufficient_privilege then null;
  end;
  begin
    delete from public.places;
    assert false, 'signed-in user cannot delete from places';
  exception when insufficient_privilege then null;
  end;
end $$;
reset role;

set role anon;
do $$ begin
  begin
    perform 1 from public.places;
    assert false, 'anon cannot read places';
  exception when insufficient_privilege then null;
  end;
  begin
    perform 1 from public.place_tiles;
    assert false, 'anon cannot read place_tiles';
  exception when insufficient_privilege then null;
  end;
end $$;
reset role;

-- Suggestions: the service role queues missing tiles without touching
-- existing ones; signed-in users read scored places in 'done' tiles.
set role service_role;
do $$
declare v_count bigint;
begin
  select count(*) into v_count from public.place_tiles;
  assert (select array_agg(tile_key || '=' || status order by tile_key)
      from public.queue_place_tiles(array['43.5_-98.5', '42.0_-92.5', '42.0_-92.5'])) =
    array['42.0_-92.5=pending', '43.5_-98.5=done'],
    'queue_place_tiles queues a missing tile once and returns every status';
  assert (select count(*) from public.place_tiles) = v_count + 1, 'one tile queued';
  assert (select array_agg(tile_key || '=' || status order by tile_key)
      from public.queue_place_tiles(array['43.5_-98.5', '42.0_-92.5'])) =
    array['42.0_-92.5=pending', '43.5_-98.5=done'],
    'queueing again changes nothing; a done tile is never downgraded';
  assert (select count(*) from public.place_tiles) = v_count + 1, 'no tile queued twice';
end $$;
-- A scored place in a tile that isn't done yet isn't suggested.
update public.places set score = 1 where source_id = 'node/2';
-- A campground comes with its parent's score (campgrounds are ranked by their park).
insert into public.places (source, source_id, name, kind, category, location, tags, score, parent_place_id)
  select 'osm', 'node/4', 'Campground at Corn Palace', 'campground', 'tourism=camp_site',
    extensions.st_point(-98.03, 43.715, 4326)::extensions.geography,
    '{"amenities": {"tents": true}}', 0.1, id
  from public.places where source_id = 'way/1';
reset role;

do $$ begin perform pg_temp.act_as('dave'); end $$;
do $$
declare v_row record;
begin
  select * into strict v_row
    from public.suggestion_places(array['43.5_-98.5', '42.0_-92.5'], 'attraction');
  assert v_row.name = 'Corn Palace' and v_row.score = 5.1
      and abs(v_row.lat - 43.714) < 1e-9 and abs(v_row.lng - -98.0298) < 1e-9
      and v_row.tile_key = '43.5_-98.5' and v_row.tags ->> 'website' = 'https://cornpalace.com',
    'suggestion_places returns scored places in done tiles, with lat/lng';
  assert v_row.parent_score is null and v_row.parent_name is null,
    'a place without a parent has no parent_score or parent_name';
  select * into strict v_row
    from public.suggestion_places(array['43.5_-98.5'], 'campground');
  assert v_row.name = 'Campground at Corn Palace' and v_row.score = 0.1
      and v_row.parent_score = 5.1 and v_row.parent_name = 'Corn Palace'
      and (v_row.tags -> 'amenities' ->> 'tents')::boolean,
    'suggestion_places filters by kind and returns the parent''s score and name';
  assert not exists (select 1
      from public.scoring_place_tiles(array['43.5_-98.5', '42.0_-92.5'], 'attraction')),
    'scoring_place_tiles: a done tile with every place scored, and a tile not done, are not scoring';
  begin
    perform public.queue_place_tiles(array['40.0_-75.0']);
    assert false, 'signed-in user cannot call queue_place_tiles';
  exception when insufficient_privilege then null;
  end;
end $$;
reset role;

-- A done tile with an unscored place is still scoring, unless that place is
-- backed off for long.
set role service_role;
update public.place_tiles set status = 'done', fetched_at = now()
  where tile_key = '42.0_-92.5';
reset role;
do $$ begin perform pg_temp.act_as('dave'); end $$;
do $$ begin
  assert (select array_agg(tile_key)
      from public.scoring_place_tiles(array['43.5_-98.5', '42.0_-92.5'], 'attraction')) =
    array['42.0_-92.5'], 'scoring_place_tiles returns done tiles with unscored places, once';
  assert not exists (select 1
      from public.scoring_place_tiles(array['42.0_-92.5'], 'campground')),
    'scoring_place_tiles filters by kind';
end $$;
reset role;
set role service_role;
update public.places set enrich_next_attempt_at = now() + interval '1 day'
  where source_id = 'node/3';
do $$ begin
  assert not exists (select 1
      from public.scoring_place_tiles(array['42.0_-92.5'], 'attraction')),
    'a place backed off for long does not keep its tile scoring';
end $$;
update public.places set enrich_next_attempt_at = null where source_id = 'node/3';
update public.place_tiles set status = 'pending', fetched_at = null
  where tile_key = '42.0_-92.5';
reset role;

set role anon;
do $$ begin
  perform public.suggestion_places(array['43.5_-98.5'], 'attraction');
  assert false, 'anon cannot call suggestion_places';
exception when insufficient_privilege then null;
end $$;
do $$ begin
  perform public.scoring_place_tiles(array['43.5_-98.5'], 'attraction');
  assert false, 'anon cannot call scoring_place_tiles';
exception when insufficient_privilege then null;
end $$;
reset role;

-- Deleting a park keeps the places inside it, unattached.
set role service_role;
delete from public.places where source_id = 'node/2';
do $$ begin
  assert (select parent_place_id from public.places where source_id = 'node/3') is null,
    'deleting a parent place detaches its children';
end $$;
reset role;

-- Tile fill worker: claiming due tiles, storing a tile's places, and the
-- pg_cron entry point. Service role only.
set role service_role;
-- Tiles queued by earlier tests are taken out of the way first.
update public.place_tiles set status = 'done', fetched_at = now(), next_attempt_at = null;
insert into public.place_tiles (tile_key, status, requested_at, fetched_at, attempts, next_attempt_at) values
  ('10.0_10.0', 'pending',  now() - interval '1 minute', null, 0, null),
  ('10.0_10.5', 'pending',  now() - interval '2 minutes', null, 0, null),
  ('10.0_11.0', 'failed',   now() - interval '1 hour', null, 2, now() - interval '1 second'),
  ('10.0_11.5', 'failed',   now() - interval '2 hours', null, 2, now() + interval '1 hour'),
  ('10.0_12.0', 'fetching', now() - interval '3 hours', null, 1, now() - interval '1 second'),
  ('10.0_12.5', 'fetching', now() - interval '4 hours', null, 1, now() + interval '4 minutes'),
  ('10.0_13.0', 'done',     now() - interval '1 year', now() - interval '91 days', 0, null),
  ('10.0_13.5', 'done',     now() - interval '1 year', now() - interval '89 days', 0, null);
do $$
declare
  v_claimed text[];
begin
  select array_agg(tile_key order by tile_key) into v_claimed
    from public.claim_place_tiles(2);
  assert v_claimed = array['10.0_10.0', '10.0_10.5'],
    'claim takes pending tiles first, oldest requested first: ' || v_claimed::text;
  select array_agg(tile_key order by tile_key) into v_claimed
    from public.claim_place_tiles(10);
  assert v_claimed = array['10.0_11.0', '10.0_12.0', '10.0_13.0'],
    'claim takes failed tiles past back-off, expired claims and done tiles older than 90 days: '
    || coalesce(v_claimed::text, 'none');
  assert not exists (select 1 from public.claim_place_tiles(10)),
    'claimed tiles are not claimed again during their lease';
  assert (select attempts from public.place_tiles where tile_key = '10.0_11.0') = 3,
    'claiming counts the attempt';
  assert (select status from public.place_tiles where tile_key = '10.0_13.0') = 'fetching'
    and (select next_attempt_at from public.place_tiles where tile_key = '10.0_13.0')
      between now() + interval '4 minutes' and now() + interval '6 minutes',
    'a claimed tile is fetching, with a 5-minute lease';
  assert not exists (select 1 from public.claim_place_tiles(0)), 'claim of 0 takes nothing';
end $$;

-- Storing a tile: places outside it are ignored, parents are linked by OSM
-- id, and places it no longer returns are deleted.
do $$
declare
  v_count integer;
begin
  v_count := public.store_place_tile('10.0_10.0', '[
    {"source_id": "way/10", "name": "Big Park", "kind": "attraction", "category": "leisure=park",
     "lat": 10.2, "lng": 10.2, "wikidata": "Q10", "tags": {"leisure": "park"}},
    {"source_id": "node/11", "name": "Park Camp", "kind": "campground", "category": "tourism=camp_site",
     "lat": 10.21, "lng": 10.21, "parent_source_id": "way/10"},
    {"source_id": "node/12", "name": "Old Fort", "kind": "attraction", "category": "historic=fort",
     "lat": 10.3, "lng": 10.3},
    {"source_id": "node/13", "name": "Next Door", "kind": "attraction", "category": "historic=fort",
     "lat": 10.3, "lng": 10.6}
  ]');
  assert v_count = 3, 'stores the places in the tile, not ones in a neighbour: ' || v_count;
  assert not exists (select 1 from public.places where source_id = 'node/13'),
    'a place in another tile is left to that tile';
  assert (select p.source_id from public.places c join public.places p on p.id = c.parent_place_id
    where c.source_id = 'node/11') = 'way/10', 'a place is linked to its parent';
  assert (select status from public.place_tiles where tile_key = '10.0_10.0') = 'done'
    and (select attempts from public.place_tiles where tile_key = '10.0_10.0') = 0
    and (select next_attempt_at from public.place_tiles where tile_key = '10.0_10.0') is null,
    'storing marks the tile done and resets attempts';

  update public.places set enriched_at = now(), sitelinks = 5 where source_id in ('way/10', 'node/12');
  insert into public.places (source, source_id, name, kind, category, location)
    values ('ridb', '999', 'Federal Camp', 'campground', 'ridb',
            extensions.st_point(10.4, 10.4, 4326)::extensions.geography);
  v_count := public.store_place_tile('10.0_10.0', '[
    {"source_id": "way/10", "name": "Big State Park", "kind": "attraction", "category": "leisure=park",
     "lat": 10.2, "lng": 10.2, "wikidata": "Q11"},
    {"source_id": "node/12", "name": "Old Fort", "kind": "attraction", "category": "historic=fort",
     "lat": 10.3, "lng": 10.3}
  ]');
  assert v_count = 2, 'refetch stores 2';
  assert not exists (select 1 from public.places where source_id = 'node/11'),
    'a place the tile no longer returns is deleted';
  assert exists (select 1 from public.places where source = 'ridb' and source_id = '999'),
    'places from other sources are kept';
  assert (select name from public.places where source_id = 'way/10') = 'Big State Park'
    and (select tags from public.places where source_id = 'way/10') = '{}',
    'refetch updates a place';
  assert (select enriched_at from public.places where source_id = 'way/10') is null
    and (select sitelinks from public.places where source_id = 'way/10') = 5,
    'a new Wikidata item resets enrichment but keeps the old signals until then';
  assert (select enriched_at from public.places where source_id = 'node/12') is not null,
    'an unchanged place keeps its enrichment';

  assert public.store_place_tile('10.0_10.0', '[]') = 0, 'an empty tile stores nothing';
  assert not exists (select 1 from public.places where source = 'osm' and tile_key = '10.0_10.0'),
    'an empty tile removes its OSM places';
  begin
    perform public.store_place_tile('20.0_20.0', '[]');
    assert false, 'storing an unknown tile fails';
  exception when no_data_found then null;
  end;
end $$;
reset role;

do $$ begin perform pg_temp.act_as('alice'); end $$;
do $$ begin
  begin
    perform public.claim_place_tiles(1);
    assert false, 'signed-in user cannot claim tiles';
  exception when insufficient_privilege then null;
  end;
  begin
    perform public.store_place_tile('10.0_10.0', '[]');
    assert false, 'signed-in user cannot store tiles';
  exception when insufficient_privilege then null;
  end;
  begin
    perform public.invoke_places_worker();
    assert false, 'signed-in user cannot start the worker';
  exception when insufficient_privilege then null;
  end;
end $$;
reset role;
set role service_role;
do $$ begin
  perform public.invoke_places_worker();
  assert false, 'only the database owner (pg_cron) starts the worker';
exception when insufficient_privilege then null;
end $$;
reset role;

-- The pg_cron entry point, with stand-ins for Supabase's Vault and pg_net.
create schema vault;
create table vault.decrypted_secrets (name text primary key, decrypted_secret text);
create schema net;
create table net.calls (url text, headers jsonb, body jsonb, timeout_milliseconds integer);
create function net.http_post(url text, body jsonb, params jsonb default '{}', headers jsonb default '{}',
  timeout_milliseconds integer default 5000) returns bigint
language sql as $$
  insert into net.calls values (url, headers, body, timeout_milliseconds);
  select 42::bigint
$$;
do $$ begin
  update public.place_tiles set status = 'done', fetched_at = now(), next_attempt_at = null;
  assert public.invoke_places_worker() is null, 'no call while no tile is due';
  insert into public.place_tiles (tile_key) values ('11.0_11.0');
  assert public.invoke_places_worker() is null, 'no call while the Vault secrets are missing';
  insert into vault.decrypted_secrets values ('project_url', 'https://ref.supabase.co/'),
    ('service_role_key', '');
  assert public.invoke_places_worker() is null, 'no call while a Vault secret is empty';
  update vault.decrypted_secrets set decrypted_secret = 'sb_secret_x' where name = 'service_role_key';
  assert public.invoke_places_worker() = 42, 'calls the worker when a tile is due';
  assert (select url from net.calls) = 'https://ref.supabase.co/functions/v1/places-worker'
    and (select headers ->> 'apikey' from net.calls) = 'sb_secret_x',
    'calls places-worker with the secret key';

  insert into public.worker_pauses values ('places-worker', now() + interval '5 minutes', 'busy');
  assert public.invoke_places_worker() is null, 'no call while the worker is paused';
  update public.worker_pauses set paused_until = now() - interval '1 second'
    where worker = 'places-worker';
  assert public.invoke_places_worker() = 42, 'calls the worker again once the pause is over';
  delete from public.worker_pauses where worker = 'places-worker';
end $$;

-- Enrichment worker: claiming due places, pausing, storing results, and the
-- pg_cron entry point (run here as the database owner, like pg_cron).
update public.places set enriched_at = now(), enrich_next_attempt_at = null;
insert into public.place_tiles (tile_key) values ('30.0_30.0') on conflict do nothing;
insert into public.places (source, source_id, wikidata, name, kind, category, location,
    enriched_at, enrich_next_attempt_at) values
  ('osm', 'node/30', 'Q30', 'New Linked',   'attraction', 'tourism=museum', extensions.st_point(30.1, 30.1, 4326)::extensions.geography, null, null),
  ('osm', 'node/31', 'Q31', 'Stale Linked', 'attraction', 'tourism=museum', extensions.st_point(30.1, 30.1, 4326)::extensions.geography, now() - interval '91 days', null),
  ('osm', 'node/32', 'Q32', 'Fresh Linked', 'attraction', 'tourism=museum', extensions.st_point(30.1, 30.1, 4326)::extensions.geography, now() - interval '89 days', null),
  ('osm', 'node/33', 'Q33', 'Backed off',   'attraction', 'tourism=museum', extensions.st_point(30.1, 30.1, 4326)::extensions.geography, null, now() + interval '1 hour'),
  ('osm', 'node/34', 'Q34', 'Lease expired', 'attraction', 'tourism=museum', extensions.st_point(30.1, 30.1, 4326)::extensions.geography, null, now() - interval '1 second'),
  ('osm', 'node/35', null,  'Plain',        'attraction', 'historic=fort',  extensions.st_point(30.1, 30.1, 4326)::extensions.geography, null, null);
do $$
declare
  v_claimed text[];
begin
  assert public.invoke_places_enrich() = 42, 'calls the enrichment worker when places are due';
  assert (select url from net.calls order by ctid desc limit 1)
    = 'https://ref.supabase.co/functions/v1/places-enrich', 'calls places-enrich';

  insert into public.worker_pauses values ('places-enrich', now() + interval '1 minute', 'HTTP 429');
  select array_agg(source_id order by source_id) into v_claimed
    from public.places p where p.id in (select id from public.claim_places_to_enrich(10, 10));
  assert v_claimed = array['node/35'],
    'while paused, only places without a Wikidata item are claimed: ' || coalesce(v_claimed::text, 'none');
  assert public.invoke_places_enrich() is null, 'no call while paused and only linked places are due';

  update public.worker_pauses set paused_until = now() - interval '1 second';
  select array_agg(source_id order by source_id) into v_claimed
    from public.places p where p.id in (select id from public.claim_places_to_enrich(2, 10));
  assert v_claimed = array['node/30', 'node/34'],
    'claims never-enriched places first, up to the limit: ' || coalesce(v_claimed::text, 'none');
  select array_agg(source_id order by source_id) into v_claimed
    from public.places p where p.id in (select id from public.claim_places_to_enrich(10, 10));
  assert v_claimed = array['node/31'],
    'then places enriched over 90 days ago; not fresh, backed-off or claimed ones: '
    || coalesce(v_claimed::text, 'none');
  assert (select enrich_next_attempt_at from public.places where source_id = 'node/31')
    between now() + interval '4 minutes' and now() + interval '6 minutes',
    'a claimed place is held for a 5-minute lease';
  assert not exists (select 1 from public.claim_places_to_enrich(0, 0)), 'claim of 0 takes nothing';
  assert public.invoke_places_enrich() is null, 'no call while nothing is due';

  update public.places set wikidata = 'Q300' where source_id = 'node/30';
  assert public.store_place_enrichment((select jsonb_agg(e) from (values
    (jsonb_build_object('id', (select id from public.places where source_id = 'node/30'),
      'wikidata', 'Q30', 'sitelinks', 3, 'score', 1)),
    (jsonb_build_object('id', (select id from public.places where source_id = 'node/31'),
      'wikidata', 'Q31', 'sitelinks', 12, 'pageviews_month', 9000, 'commons_files', 80,
      'image_file', 'Corn Palace.jpg', 'image_credit', 'Jane', 'image_license', 'CC BY-SA 4.0',
      'score', 5.5)),
    (jsonb_build_object('id', (select id from public.places where source_id = 'node/35'),
      'wikidata', null, 'score', 0.3))
  ) as t(e))) = 2, 'stores two places';
  assert (select score from public.places where source_id = 'node/31') = 5.5
    and (select image_license from public.places where source_id = 'node/31') = 'CC BY-SA 4.0'
    and (select pageviews_month from public.places where source_id = 'node/31') = 9000
    and (select enriched_at from public.places where source_id = 'node/31') is not null
    and (select enrich_next_attempt_at from public.places where source_id = 'node/31') is null,
    'storing saves the signals and score and marks the place enriched';
  assert (select score from public.places where source_id = 'node/35') = 0.3
    and (select sitelinks from public.places where source_id = 'node/35') is null,
    'a place without Wikidata is scored';
  assert (select enriched_at from public.places where source_id = 'node/30') is null,
    'a place whose Wikidata item changed while it was enriched is not stored';
  assert public.store_place_enrichment('[]') = 0, 'storing nothing stores nothing';
end $$;

do $$ begin perform pg_temp.act_as('alice'); end $$;
do $$ begin
  begin
    perform public.claim_places_to_enrich(1, 1);
    assert false, 'signed-in user cannot claim places to enrich';
  exception when insufficient_privilege then null;
  end;
  begin
    perform public.store_place_enrichment('[]');
    assert false, 'signed-in user cannot store enrichment';
  exception when insufficient_privilege then null;
  end;
  begin
    perform public.invoke_places_enrich();
    assert false, 'signed-in user cannot start the enrichment worker';
  exception when insufficient_privilege then null;
  end;
  begin
    perform 1 from public.worker_pauses;
    assert false, 'signed-in user cannot read worker_pauses';
  exception when insufficient_privilege then null;
  end;
end $$;
reset role;
set role service_role;
do $$ begin
  perform public.invoke_places_enrich();
  assert false, 'only the database owner (pg_cron) starts the enrichment worker';
exception when insufficient_privilege then null;
end $$;
reset role;

drop schema vault cascade;
drop schema net cascade;

-- A stop added from a suggestion remembers its place; the link goes if the
-- place is pruned from the cache, the stop stays.
set role service_role;
insert into public.places (source, source_id, name, kind, category, location)
  values ('osm', 'node/67', 'Liberty Bell', 'attraction', 'tourism=attraction',
    extensions.st_point(-75.15, 39.95, 4326)::extensions.geography);
reset role;
do $$ begin perform pg_temp.act_as('alice'); end $$;
insert into public.trip_invites (trip_id, email, role)
  select id, 'dave@example.com', 'editor' from public.trips where name = 'Cross country';
reset role;
do $$ begin perform pg_temp.act_as('dave'); end $$;
do $$
declare
  v_trip uuid;
  v_place bigint := (select id from public.places where source_id = 'node/67');
  v_stop uuid;
begin
  perform public.accept_my_invites();
  v_trip := (select id from public.trips where name = 'Cross country');
  insert into public.stops (trip_id, day_id, position, name, lat, lng, place_id)
    select v_trip, day_id, 'a5', 'Liberty Bell', 39.95, -75.15, v_place
      from public.stops where trip_id = v_trip and kind = 'start'
    returning id into v_stop;
  assert (select place_id from public.stops where id = v_stop) = v_place,
    'editor can add a stop with its place';
  update public.stops set place_id = null where id = v_stop;
  update public.stops set place_id = v_place where id = v_stop;
  assert (select place_id from public.stops where id = v_stop) = v_place,
    'editor can set a stop''s place';
end $$;
reset role;
do $$ begin perform pg_temp.act_as('carol'); end $$;
do $$ begin
  update public.stops set place_id = null where name = 'Liberty Bell';
  assert (select place_id from public.stops where name = 'Liberty Bell') is not null,
    'viewer cannot change a stop''s place';
end $$;
reset role;
set role service_role;
delete from public.places where source_id = 'node/67';
reset role;
do $$ begin perform pg_temp.act_as('dave'); end $$;
do $$ begin
  assert (select place_id from public.stops where name = 'Liberty Bell') is null,
    'deleting a place unlinks its stops but keeps them';
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
