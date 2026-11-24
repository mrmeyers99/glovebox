-- TEST ONLY. Minimal stand-in for the parts of Supabase the migrations rely on
-- (auth schema, auth.uid(), auth.jwt(), API roles), so migrations and
-- permission tests can run against plain Postgres. Never apply to Supabase.

-- Roles are cluster-wide, so only create them if a previous run hasn't.
do $$ begin
  if not exists (select 1 from pg_roles where rolname = 'anon') then
    create role anon nologin;
    create role authenticated nologin;
    create role service_role nologin bypassrls;
  end if;
end $$;

create schema auth;

create table auth.users (
  id                 uuid primary key,
  email              text,
  raw_user_meta_data jsonb not null default '{}'
);

create function auth.jwt() returns jsonb
language sql stable
as $$ select coalesce(nullif(current_setting('request.jwt.claims', true), ''), '{}')::jsonb $$;

create function auth.uid() returns uuid
language sql stable
as $$ select nullif(auth.jwt() ->> 'sub', '')::uuid $$;

grant usage on schema auth, public to anon, authenticated;
grant execute on all functions in schema auth to anon, authenticated;
