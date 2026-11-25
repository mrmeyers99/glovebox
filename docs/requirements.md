# Glovebox — Requirements

Glovebox is a collaborative road-trip planner: plan a route, split it into days,
track reservations and costs, and estimate driving time and gas, together with the
people you're traveling with.

Status: draft, first version (v1) scope agreed. Built for family and friends first, designed so it can
scale to public use later.

---

## 1. Technology

| Area          | Choice                                                     | Notes                                                                                   |
| ------------- | ---------------------------------------------------------- | --------------------------------------------------------------------------------------- |
| Frontend      | React + TypeScript, built with Vite                        | Web-first single-page app. Responsive, so it works in phone browsers from day one.      |
| Maps          | MapLibre GL via `react-map-gl` + OpenStreetMap-based tiles | Tile provider with a free tier (e.g. MapTiler or Stadia).                               |
| Drag-and-drop | dnd-kit                                                    | Reordering and moving stops between days; supports mouse and touch.                     |
| Hosting       | Static hosting (Netlify, Vercel, or Cloudflare Pages)      | Free tier; no app server needed since Supabase is the backend.                          |
| Backend       | Supabase                                                   | Postgres, Auth, Realtime, Edge Functions. PostGIS can be added for discovery (phase 3). |
| Login         | Supabase Auth                                              | Email magic link, Google, Apple. No passwords stored by us.                             |
| Authorization | Postgres row-level security (RLS)                          | Trip access enforced in the database, based on trip membership.                         |
| Server logic  | Supabase Edge Functions (TypeScript)                       | Proxy and cache third-party APIs so keys never ship in the app.                         |
| Routing       | OpenRouteService                                           | Free tier ~2,000 requests/day. Results cached (see `route_cache`).                      |
| Gas price     | U.S. EIA API                                               | Weekly national average retail gasoline price, fetched and cached.                      |

### Scaling considerations

- Nothing in the design assumes a small user base. All access goes through RLS and trip membership.
- Routing is the first expected bottleneck. Mitigations: cache by coordinate pair
  across all trips, and only recompute legs that changed. Later: paid plan or self-hosted
  routing (OpenRouteService/OSRM/Valhalla).

---

## 2. Users & sharing

- Sign in with email magic link, Google, or Apple.
- A user profile has a display name and a default mpg.
- A user can create, rename, copy, and delete trips they own.
- Trips can be shared with other users by email invite, with a role:
  - **Owner**: full control, including deleting the trip and managing members.
  - **Editor**: can edit days, stops, notes, costs, and trip settings.
  - **Viewer**: read-only.
- Invites to people without an account are held until they sign up with that email.
- _Later:_ read-only public share link.

## 3. Simultaneous editing

- Multiple people can edit the same trip at the same time (v1).
- Changes sync live to everyone viewing the trip via Supabase Realtime (target: ~1 second).
- Stop ordering uses fractional ordering keys so concurrent drags don't clobber each other.
- Concurrent edits to the same field: last write wins.
- Each stop records who last edited it and when.
- _Later:_ presence indicators: who is viewing, and what they're editing (e.g. "Sarah is editing Day 3").

## 4. Trips

- Fields: name, start date, start point, end point, average mpg, gas price per gallon.
- **mpg**: a single average mpg per trip, defaulting to the user's profile mpg.
  Multiple vehicles are not modeled; users can adjust mpg (e.g. halve it for two cars).
- **Gas price**: defaults to the current U.S. national average (EIA, weekly); the user can
  override it per trip.

## 5. Days

- A trip is a list of **days**. Days are first-class and ordered.
- Each day's date is derived from the trip start date + its position. Inserting or removing a
  day shifts all later dates.
- An empty **"+ Day N+1"** drop zone is always shown after the last day. Dropping a stop there
  creates the new day.
- **Empty days persist** and act as rest days (e.g. two nights in the same town).
- Each day can have its own notes.
- The last active stop of a day is assumed to be that night's overnight location.
- Days can be deleted; stops on a deleted day must be moved or deleted (confirm with the user).

## 6. Stops (waypoints)

- Each stop belongs to exactly one day and has an order within that day.
- Kinds: **start**, **waypoint**, **end**.
  - Start is pinned to the top of Day 1; end is pinned to the bottom of the last day.
- Fields:
  - Name
  - Location (picked by place search or tapping the map), address
  - Notes (free text, e.g. reservation details, confirmation numbers)
  - Cost: amount + category (lodging, food, activity, other)
  - Planned arrival time (optional)
  - Stay duration (optional)
  - Skipped (on/off)
- Interactions:
  - Drag to reorder within a day, or drag to another day (including the "+ Day N+1" zone).
  - Context menu: right-click on desktop, long-press on mobile. Available from both the
    day list and the map. Actions:
    - **Move to day…**
    - **Skip / Unskip**
    - Edit, Delete
- _Later:_ multiple cost line items per stop.

### Skip

- Skipping is **shared**: it changes the plan for everyone on the trip, and syncs live.
- A skipped stop:
  - is removed from the map (a **Show skipped** toggle shows faded markers so they can be found again),
  - is removed from the route: the route goes from the previous active stop directly to the next,
  - is excluded from all totals (distance, time, gas, costs),
  - stays in its day's list, greyed out with a "Skipped" label, keeping its notes and details.
- Start and end stops cannot be skipped.
- A day whose stops are all skipped shows zero driving, like a rest day.

## 7. Calculations

All derived values are computed from stops and cached routes, not stored, so they can't drift
out of sync.

- **Legs** connect consecutive _active_ (non-skipped) stops across the whole trip, in day order.
- Per leg: driving distance, driving time, gas cost.
  - Gas cost = distance (miles) ÷ trip mpg × gas price per gallon.
- **Day attribution**: a leg counts toward the day of the stop it _arrives at_. So the drive
  from last night's stop to this morning's first stop counts toward today, and an empty day
  has zero driving.
- Per day: driving distance, driving time, gas cost, other costs (by category), total cost.
  - Optional: an estimated on-the-road window using arrival times and stay durations.
- Per trip: the same totals across all days.
- When stops change, only affected legs are re-requested from the routing service.

## 8. Data model (first pass)

| Table             | Key fields                                                                                                                                                                                                                               |
| ----------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `profiles`        | `id` (= auth user), `display_name`, `default_mpg`                                                                                                                                                                                        |
| `trips`           | `id`, `owner_id`, `name`, `start_date`, `mpg`, `gas_price_per_gallon`, timestamps                                                                                                                                                        |
| `trip_members`    | `trip_id`, `user_id`, `role` (owner / editor / viewer)                                                                                                                                                                                   |
| `trip_invites`    | `trip_id`, `email`, `role`, `invited_by`, `accepted_at`                                                                                                                                                                                  |
| `days`            | `id`, `trip_id`, `position`, `notes`                                                                                                                                                                                                     |
| `stops`           | `id`, `trip_id`, `day_id`, `position` (fractional key), `kind` (start / waypoint / end), `name`, `lat`, `lng`, `address`, `notes`, `cost_amount`, `cost_category`, `arrival_time`, `stay_minutes`, `skipped`, `updated_by`, `updated_at` |
| `route_cache`     | `from_point`, `to_point`, `distance_m`, `duration_s`, `geometry`, `fetched_at`                                                                                                                                                           |
| `gas_price_cache` | `region` (v1: `US`), `price_per_gallon`, `as_of`, `fetched_at`                                                                                                                                                                           |

Notes:

- Days have an explicit `position`; dates are derived, not stored.
- `route_cache` is keyed by rounded coordinates so identical legs are shared across trips.
  Entries older than 90 days are refetched; only the `route` Edge Function writes it.
- RLS: a user can read a trip and its days/stops if they are a member; write if owner or editor.

## 9. Roadmap

1. **Core (v1)**: login; trips; days and stops with drag-and-drop between days and the
   "+ Day N+1" zone; context menu (move to day, skip); notes and costs; map with route;
   leg/day/trip totals; national-average gas price; live sync between simultaneous editors.
2. **Sharing**: email invites with roles; presence ("who's here", what they're editing).
3. **Discovery**: suggested stops along the route (OpenStreetMap via Overpass, OpenTripMap,
   Wikipedia/Wikidata, NPS, Recreation.gov), filtered by category and detour time.
4. **Later**: mobile: first an installable web app (PWA) with offline access, then a native
   app via React Native (Expo) if needed, reusing the data and calculation code; regional gas prices (EIA by region); export to
   Google Maps / GPX; multiple cost items per stop; read-only public links.

## 10. Out of scope for now

- Offline access (planned later).
- Multiple vehicles per trip (use an adjusted mpg).
- Local, station-level gas prices.
- Currencies other than USD.
