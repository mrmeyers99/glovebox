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

- **Edge Functions:** `.github/workflows/deploy-functions.yml` deploys every function in `supabase/functions/` when anything there changes on `main` (or when run by hand from the Actions tab). Function settings live in `supabase/config.jsonc`; if you change only those, run the workflow by hand. Removing a function from the repo doesn't delete it from Supabase; delete it in the dashboard.

Required GitHub secrets: `SUPABASE_ACCESS_TOKEN`, `SUPABASE_DB_PASSWORD`, `SUPABASE_PROJECT_ID`, and `CLAUDE_CODE_OAUTH_TOKEN` for reviews. Render needs `VITE_SUPABASE_URL` and `VITE_SUPABASE_PUBLISHABLE_KEY`.

The functions deploy uses the same `SUPABASE_ACCESS_TOKEN` and `SUPABASE_PROJECT_ID` (it doesn't need the database password). A personal access token already has every permission it needs. A scoped token needs `edge_functions_write` and `edge_functions_read`, plus `projects_read`, in addition to what the database deploy uses.

## Edge Functions

Server-side code that calls third-party APIs (routing, place search, gas prices) lives in `supabase/functions/`, one folder per function, so API keys never reach the browser. Shared code is in `supabase/functions/_shared/`:

- `auth.ts`: `requireUser(req)` verifies the caller's access token and returns the user plus a client that acts as them (row-level security applies). It throws a 401 otherwise.
- `admin.ts`: `adminClient()` uses the secret (service-role) key and bypasses row-level security. Use it only for server-owned data such as API caches.
- `http.ts` and `cors.ts`: `handle()` answers CORS preflight and turns thrown errors into JSON; `json()` adds CORS headers.

Functions are deployed with the gateway's JWT check turned off (`verify_jwt: false` in `supabase/config.jsonc`) and check the caller themselves, so every function that isn't deliberately public must call `requireUser` first. Add each new function to the `functions` section of `supabase/config.jsonc`.

The app calls a function with `supabase.functions.invoke('health')`; supabase-js sends the signed-in user's token.

### Secrets

Supabase provides `SUPABASE_URL` and the project's keys to functions automatically. Set third-party keys with the [Supabase CLI](https://supabase.com/docs/guides/cli) (after `supabase login`):

```bash
supabase secrets set ORS_API_KEY=your-key --remote=<project-id>
```

or in the dashboard under Edge Functions → Secrets. Functions read them with `Deno.env.get('ORS_API_KEY')`. Never put them in `web/`.

### Running locally

Install Docker and the Supabase CLI, then from the repo root:

```bash
supabase start
```

```bash
supabase functions serve
```

Functions are served at `http://127.0.0.1:54321/functions/v1/<name>` and reload on save. Local secrets go in `supabase/functions/.env` (git-ignored). To call them from the app, point `web/.env.local` at the local URL and publishable key that `supabase start` prints.

`supabase/functions` is Deno code, so `npm run check` doesn't type-check or lint it (Prettier still formats it). Check it with [Deno](https://deno.com) from `supabase/functions`; CI runs the same:

```bash
deno check . && deno lint && deno test --allow-env
```

## Checks

- `npm run check`: format, lint, typecheck, unit tests
- `npm run test:db`: migrations and permission tests against a local Postgres
- `deno check . && deno lint && deno test --allow-env` in `supabase/functions`: Edge Functions

CI runs all of these on every pull request. Pull requests also get an automatic Claude Code review, and Renovate opens weekly dependency updates.
