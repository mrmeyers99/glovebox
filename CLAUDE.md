# Glovebox

Collaborative road-trip planner. Requirements and data model: `docs/requirements.md`.

## Layout

- `web/` — React + TypeScript single-page app (Vite). Talks directly to Supabase.
  - `src/lib/tripMath.ts` — pure trip calculations (legs, day totals, gas). Unit-tested.
  - `src/lib/database.types.ts` — types matching the database schema. Update with every migration.
- `supabase/migrations/` — database schema, row-level security, triggers.
- `supabase/functions/` — Edge Functions (Deno). `_shared/` has `requireUser`, `adminClient`, CORS
  and response helpers. Each function is listed in `supabase/config.jsonc` with `verify_jwt: false`.
- `supabase/tests/` — permission tests run against plain Postgres (`auth_stub.sql` fakes Supabase auth; test-only).
- `docs/` — requirements.
- `render.yaml` — Render static-site deploy. `.github/workflows/deploy-db.yml` — applies migrations to Supabase on merge to `main`. `.github/workflows/deploy-functions.yml` — deploys Edge Functions on merge to `main`.

## Commands (run from the repo root)

- `npm run dev` — start the web app (needs `web/.env.local`, see `web/.env.example`)
- `npm run check` — format check, lint, typecheck, unit tests (what CI runs, minus build and DB)
- `npm run format` — format everything with Prettier
- `npm run test:db` — apply migrations and run permission tests (needs Postgres via `PG*` env vars)
- `deno check . && deno lint && deno test --allow-env --allow-read` — from `supabase/functions` (not covered by `npm run check`)

A pre-commit hook (husky + lint-staged) formats staged files and lints TypeScript.

## Conventions

- Every table has row-level security. Access follows trip membership: members read;
  owners and editors write; only owners delete trips and manage members/invites.
  Add or update tests in `supabase/tests/permissions_test.sql` for any policy change.
- Never edit a merged migration; add a new timestamped file in `supabase/migrations/`.
- Ordering uses fractional-indexing keys in `position` columns (`COLLATE "C"`); compare them
  byte-wise (`comparePositions`), never with `localeCompare`.
- Derived values (legs, day/trip totals, dates) are computed in `tripMath.ts`, not stored.
- A leg counts toward the day of the stop it arrives at. Skipped stops are excluded from the
  route and all totals. Start/end stops can't be skipped.
- Third-party API keys (routing, gas prices) live only in Supabase Edge Functions, never in `web/`.
- Every Edge Function calls `requireUser(req)` before doing anything, unless it is deliberately public
  (the gateway JWT check is off). `adminClient()` bypasses RLS; use it only for caches, never trip data.
- Code style: Prettier (no semicolons, single quotes) and oxlint; don't hand-format.
