# Glovebox

Collaborative road-trip planner. Requirements and data model: `docs/requirements.md`.

## Layout

- `web/` — React + TypeScript single-page app (Vite). Talks directly to Supabase.
  - `src/lib/tripMath.ts` — pure trip calculations (legs, day totals, gas). Unit-tested.
  - `src/lib/database.types.ts` — types matching the database schema. Update with every migration.
- `supabase/migrations/` — database schema, row-level security, triggers.
- `supabase/tests/` — permission tests run against plain Postgres (`auth_stub.sql` fakes Supabase auth; test-only).
- `docs/` — requirements.

## Commands (run from the repo root)

- `npm run dev` — start the web app (needs `web/.env.local`, see `web/.env.example`)
- `npm run check` — format check, lint, typecheck, unit tests (what CI runs, minus build and DB)
- `npm run format` — format everything with Prettier
- `npm run test:db` — apply migrations and run permission tests (needs Postgres via `PG*` env vars)

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
- Code style: Prettier (no semicolons, single quotes) and oxlint; don't hand-format.
