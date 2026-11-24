-- Glovebox initial schema: profiles, trips, sharing, days, stops, caches.
-- See docs/requirements.md (section 8) for the data model.

-- ---------------------------------------------------------------------------
-- Types
-- ---------------------------------------------------------------------------

create type public.trip_role as enum ('owner', 'editor', 'viewer');
create type public.stop_kind as enum ('start', 'waypoint', 'end');
create type public.cost_category as enum ('lodging', 'food', 'activity', 'other');

-- ---------------------------------------------------------------------------
-- Generic helpers
-- ---------------------------------------------------------------------------

create function public.set_updated_at()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

-- ---------------------------------------------------------------------------
-- Profiles (one per auth user)
-- ---------------------------------------------------------------------------

create table public.profiles (
  id           uuid primary key references auth.users (id) on delete cascade,
  display_name text check (char_length(display_name) <= 100),
  default_mpg  numeric(5, 1) not null default 25 check (default_mpg > 0),
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);

create trigger profiles_updated_at
  before update on public.profiles
  for each row execute function public.set_updated_at();

-- Create a profile automatically when someone signs up.
create function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.profiles (id, display_name)
  values (
    new.id,
    coalesce(new.raw_user_meta_data ->> 'full_name', split_part(new.email, '@', 1))
  );
  return new;
end;
$$;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- ---------------------------------------------------------------------------
-- Trips and membership
-- ---------------------------------------------------------------------------

create table public.trips (
  id                   uuid primary key default gen_random_uuid(),
  owner_id             uuid not null default auth.uid() references auth.users (id) on delete cascade,
  name                 text not null check (char_length(name) between 1 and 200),
  start_date           date,
  mpg                  numeric(5, 1) not null default 25 check (mpg > 0),
  -- null means "use the current national average" (gas_price_cache).
  gas_price_per_gallon numeric(6, 3) check (gas_price_per_gallon > 0),
  created_at           timestamptz not null default now(),
  updated_at           timestamptz not null default now()
);

create trigger trips_updated_at
  before update on public.trips
  for each row execute function public.set_updated_at();

create table public.trip_members (
  trip_id    uuid not null references public.trips (id) on delete cascade,
  user_id    uuid not null references auth.users (id) on delete cascade,
  role       public.trip_role not null,
  created_at timestamptz not null default now(),
  primary key (trip_id, user_id)
);

create index trip_members_user_id_idx on public.trip_members (user_id);

-- Exactly one owner row per trip.
create unique index trip_members_one_owner_idx
  on public.trip_members (trip_id) where role = 'owner';

-- The creator of a trip becomes its owner member.
create function public.handle_new_trip()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.trip_members (trip_id, user_id, role)
  values (new.id, new.owner_id, 'owner');
  return new;
end;
$$;

create trigger on_trip_created
  after insert on public.trips
  for each row execute function public.handle_new_trip();

-- Role helpers used by row-level security. SECURITY DEFINER so policies on
-- trip_members can use them without recursing into their own policies.
create function public.trip_role_of(p_trip_id uuid)
returns public.trip_role
language sql
stable
security definer
set search_path = ''
as $$
  select role
  from public.trip_members
  where trip_id = p_trip_id and user_id = auth.uid();
$$;

create function public.is_trip_member(p_trip_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select public.trip_role_of(p_trip_id) is not null;
$$;

create function public.can_edit_trip(p_trip_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(public.trip_role_of(p_trip_id) in ('owner', 'editor'), false);
$$;

create function public.is_trip_owner(p_trip_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(public.trip_role_of(p_trip_id) = 'owner', false);
$$;

-- ---------------------------------------------------------------------------
-- Invites (held until the invitee signs in with that email)
-- ---------------------------------------------------------------------------

create table public.trip_invites (
  id          uuid primary key default gen_random_uuid(),
  trip_id     uuid not null references public.trips (id) on delete cascade,
  email       text not null check (email = lower(email) and position('@' in email) > 1),
  role        public.trip_role not null check (role <> 'owner'),
  invited_by  uuid not null default auth.uid() references auth.users (id) on delete cascade,
  created_at  timestamptz not null default now(),
  accepted_at timestamptz
);

create unique index trip_invites_trip_email_idx on public.trip_invites (trip_id, email);
create index trip_invites_email_idx on public.trip_invites (email) where accepted_at is null;

-- Called by the app after sign-in: turns pending invites for the signed-in
-- user's email into memberships. Returns the number of trips joined.
create function public.accept_my_invites()
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_email text := lower(auth.jwt() ->> 'email');
  v_count integer;
begin
  if auth.uid() is null or v_email is null then
    return 0;
  end if;

  with pending as (
    update public.trip_invites
    set accepted_at = now()
    where email = v_email and accepted_at is null
    returning trip_id, role
  )
  insert into public.trip_members (trip_id, user_id, role)
  select trip_id, auth.uid(), role from pending
  on conflict (trip_id, user_id) do nothing;

  get diagnostics v_count = row_count;
  return v_count;
end;
$$;

-- ---------------------------------------------------------------------------
-- Days and stops
-- ---------------------------------------------------------------------------
-- `position` columns hold fractional-indexing keys (base62 strings) so that
-- concurrent reorders don't collide. They must sort byte-wise, hence COLLATE "C".

create table public.days (
  id         uuid primary key default gen_random_uuid(),
  trip_id    uuid not null references public.trips (id) on delete cascade,
  position   text collate "C" not null,
  notes      text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (id, trip_id)
);

create index days_trip_position_idx on public.days (trip_id, position);

create trigger days_updated_at
  before update on public.days
  for each row execute function public.set_updated_at();

create table public.stops (
  id            uuid primary key default gen_random_uuid(),
  trip_id       uuid not null references public.trips (id) on delete cascade,
  day_id        uuid not null,
  position      text collate "C" not null,
  kind          public.stop_kind not null default 'waypoint',
  name          text not null check (char_length(name) between 1 and 200),
  lat           double precision not null check (lat between -90 and 90),
  lng           double precision not null check (lng between -180 and 180),
  address       text,
  notes         text,
  cost_amount   numeric(10, 2) check (cost_amount >= 0),
  cost_category public.cost_category,
  arrival_time  time,
  stay_minutes  integer check (stay_minutes >= 0),
  skipped       boolean not null default false,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  updated_by    uuid default auth.uid() references auth.users (id) on delete set null,
  -- A stop's day must belong to the same trip. Deleting a day that still has
  -- stops is refused; the app asks the user to move or delete them first.
  foreign key (day_id, trip_id) references public.days (id, trip_id) on delete restrict,
  -- Start and end can't be skipped.
  check (not skipped or kind = 'waypoint')
);

create index stops_trip_idx on public.stops (trip_id);
create index stops_day_position_idx on public.stops (day_id, position);

-- At most one start and one end per trip.
create unique index stops_one_start_idx on public.stops (trip_id) where kind = 'start';
create unique index stops_one_end_idx on public.stops (trip_id) where kind = 'end';

create function public.stops_touch()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.updated_at := now();
  new.updated_by := coalesce(auth.uid(), new.updated_by);
  return new;
end;
$$;

create trigger stops_touch
  before update on public.stops
  for each row execute function public.stops_touch();

-- ---------------------------------------------------------------------------
-- Caches (written only by Edge Functions using the service role)
-- ---------------------------------------------------------------------------

-- Driving routes between two points, shared across all trips. Coordinates are
-- rounded to 5 decimals (~1 m) so the same leg is only fetched once.
create table public.route_cache (
  from_lat   numeric(8, 5) not null,
  from_lng   numeric(8, 5) not null,
  to_lat     numeric(8, 5) not null,
  to_lng     numeric(8, 5) not null,
  distance_m double precision not null check (distance_m >= 0),
  duration_s double precision not null check (duration_s >= 0),
  geometry   text not null, -- encoded polyline
  fetched_at timestamptz not null default now(),
  primary key (from_lat, from_lng, to_lat, to_lng)
);

create table public.gas_price_cache (
  region           text primary key, -- v1: 'US' national average
  price_per_gallon numeric(6, 3) not null check (price_per_gallon > 0),
  as_of            date not null,
  fetched_at       timestamptz not null default now()
);

-- ---------------------------------------------------------------------------
-- Row-level security
-- ---------------------------------------------------------------------------

alter table public.profiles        enable row level security;
alter table public.trips           enable row level security;
alter table public.trip_members    enable row level security;
alter table public.trip_invites    enable row level security;
alter table public.days            enable row level security;
alter table public.stops           enable row level security;
alter table public.route_cache     enable row level security;
alter table public.gas_price_cache enable row level security;

-- Profiles: anyone signed in can read names (to show trip members); you can
-- only edit your own.
create policy profiles_select on public.profiles
  for select to authenticated using (true);
create policy profiles_update on public.profiles
  for update to authenticated using (id = auth.uid()) with check (id = auth.uid());

-- Trips. The owner_id check in SELECT lets INSERT ... RETURNING work before
-- the membership trigger's row is visible.
create policy trips_select on public.trips
  for select to authenticated
  using (owner_id = auth.uid() or public.is_trip_member(id));
create policy trips_insert on public.trips
  for insert to authenticated with check (owner_id = auth.uid());
create policy trips_update on public.trips
  for update to authenticated
  using (public.can_edit_trip(id))
  with check (public.can_edit_trip(id));
create policy trips_delete on public.trips
  for delete to authenticated using (public.is_trip_owner(id));

-- Owner can't be changed through updates (owner_id is fixed).
create function public.trips_keep_owner()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.owner_id <> old.owner_id then
    raise exception 'trip owner cannot be changed';
  end if;
  return new;
end;
$$;

create trigger trips_keep_owner
  before update on public.trips
  for each row execute function public.trips_keep_owner();

-- Members: members see each other; the owner manages non-owner members;
-- anyone can leave a trip they don't own.
create policy trip_members_select on public.trip_members
  for select to authenticated using (public.is_trip_member(trip_id));
create policy trip_members_insert on public.trip_members
  for insert to authenticated
  with check (public.is_trip_owner(trip_id) and role <> 'owner');
create policy trip_members_update on public.trip_members
  for update to authenticated
  using (public.is_trip_owner(trip_id) and role <> 'owner')
  with check (role <> 'owner');
create policy trip_members_delete on public.trip_members
  for delete to authenticated
  using (role <> 'owner' and (public.is_trip_owner(trip_id) or user_id = auth.uid()));

-- Invites: trip members can see them; the invitee can see their own; the
-- owner creates and revokes them.
create policy trip_invites_select on public.trip_invites
  for select to authenticated
  using (public.is_trip_member(trip_id) or email = lower(auth.jwt() ->> 'email'));
create policy trip_invites_insert on public.trip_invites
  for insert to authenticated
  with check (public.is_trip_owner(trip_id) and invited_by = auth.uid());
create policy trip_invites_delete on public.trip_invites
  for delete to authenticated using (public.is_trip_owner(trip_id));

-- Days and stops: members read; owners and editors write.
create policy days_select on public.days
  for select to authenticated using (public.is_trip_member(trip_id));
create policy days_insert on public.days
  for insert to authenticated with check (public.can_edit_trip(trip_id));
create policy days_update on public.days
  for update to authenticated
  using (public.can_edit_trip(trip_id)) with check (public.can_edit_trip(trip_id));
create policy days_delete on public.days
  for delete to authenticated using (public.can_edit_trip(trip_id));

create policy stops_select on public.stops
  for select to authenticated using (public.is_trip_member(trip_id));
create policy stops_insert on public.stops
  for insert to authenticated with check (public.can_edit_trip(trip_id));
create policy stops_update on public.stops
  for update to authenticated
  using (public.can_edit_trip(trip_id)) with check (public.can_edit_trip(trip_id));
create policy stops_delete on public.stops
  for delete to authenticated using (public.can_edit_trip(trip_id));

-- Caches: readable by signed-in users; written only with the service role
-- (which bypasses RLS).
create policy route_cache_select on public.route_cache
  for select to authenticated using (true);
create policy gas_price_cache_select on public.gas_price_cache
  for select to authenticated using (true);

-- ---------------------------------------------------------------------------
-- Grants (explicit, rather than relying on project defaults)
-- ---------------------------------------------------------------------------

revoke all on public.profiles, public.trips, public.trip_members, public.trip_invites,
  public.days, public.stops, public.route_cache, public.gas_price_cache from anon;

grant select, update on public.profiles to authenticated;
grant select, insert, update, delete on public.trips, public.trip_members,
  public.days, public.stops to authenticated;
grant select, insert, delete on public.trip_invites to authenticated;
grant select on public.route_cache, public.gas_price_cache to authenticated;

revoke execute on function public.accept_my_invites() from public, anon;
grant execute on function public.accept_my_invites() to authenticated;

-- ---------------------------------------------------------------------------
-- Realtime: broadcast changes so simultaneous editors stay in sync.
-- ---------------------------------------------------------------------------

alter table public.days  replica identity full;
alter table public.stops replica identity full;
alter table public.trips replica identity full;

do $$
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    alter publication supabase_realtime add table public.trips, public.days, public.stops;
  end if;
end;
$$;
