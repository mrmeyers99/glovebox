# Glovebox

A collaborative road-trip planner: plan a route, split it into days, track reservations and costs, and estimate driving time and gas together with the people you travel with.

See [docs/requirements.md](docs/requirements.md) for the requirements and plan.

## Stack

React + TypeScript (Vite) frontend, Supabase backend (Postgres, Auth, Realtime, Edge Functions).

## Getting started

1. Install Node 22+ and run `npm install` at the repo root (this also installs the git hooks).
2. Create a Supabase project and apply the schema: paste each file in `supabase/migrations/` (in order) into the SQL editor, or use the Supabase CLI (`supabase link` then `supabase db push`). Don't run anything from `supabase/tests/`; those files are only for local tests.
3. Copy `web/.env.example` to `web/.env.local` and fill in the project URL and anon key (Project Settings → API).
4. `npm run dev`

## Checks

- `npm run check`: format, lint, typecheck, unit tests
- `npm run test:db`: migrations and permission tests against a local Postgres

CI runs both on every pull request. Pull requests also get an automatic Claude Code review, and Renovate opens weekly dependency updates.
