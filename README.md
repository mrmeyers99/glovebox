# Glovebox

A collaborative road-trip planner: plan a route, split it into days, track reservations and costs, and estimate driving time and gas together with the people you travel with.

See [docs/requirements.md](docs/requirements.md) for the requirements and plan.

## Stack

React + TypeScript (Vite) frontend, Supabase backend (Postgres, Auth, Realtime, Edge Functions).

## Getting started

1. Install Node 22+ and run `npm install` at the repo root (this also installs the git hooks).
2. Create a Supabase project and apply the schema: let the Deploy database workflow do it (see Deployment), or paste each file in `supabase/migrations/` (in order) into the SQL editor. Don't run anything from `supabase/tests/`; those files are only for local tests.
3. Copy `web/.env.example` to `web/.env.local` and fill in the project URL and publishable key (`sb_publishable_…`; from the **Connect** button or Project Settings → API Keys).
4. `npm run dev`

## Deployment

- **Web app:** [Render](https://render.com) static site, defined in `render.yaml`. Pushes to `main` deploy to production once GitHub checks pass; pull requests get preview URLs.
- **Database:** `.github/workflows/deploy-db.yml` applies new files in `supabase/migrations/` to Supabase when they reach `main`. It can also be run by hand from the Actions tab, with an option to mark migrations that were applied manually.

Required GitHub secrets: `SUPABASE_ACCESS_TOKEN`, `SUPABASE_DB_PASSWORD`, `SUPABASE_PROJECT_ID`, and `CLAUDE_CODE_OAUTH_TOKEN` for reviews. Render needs `VITE_SUPABASE_URL` and `VITE_SUPABASE_PUBLISHABLE_KEY`.

## Checks

- `npm run check`: format, lint, typecheck, unit tests
- `npm run test:db`: migrations and permission tests against a local Postgres

CI runs both on every pull request. Pull requests also get an automatic Claude Code review, and Renovate opens weekly dependency updates.
