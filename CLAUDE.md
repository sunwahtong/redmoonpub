# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

Red Moon Pub: a Hungarian-language faction site (public pages, reservations, careers, the live club + DJ booth) and a staff console (register, shifts, stock, documents, reports, gallery, house settings). React 19 + Vite frontend in `src/`, a TypeScript Node backend in `server/`, PostgreSQL (Supabase in production, embedded PGlite locally). Deployed on Vercel free tier; Supabase and Cloudinary free tiers. Keep egress and request volume low — see "Free tiers" below.

## Commands

```bash
npm install                 # Node >=22.18 <25 (.nvmrc); the backend needs Node's type stripping
npm run dev                 # Vite on :5173, proxies /api and /assets to :3000
npm run server              # API + built site on :3000 (embedded DB when DATABASE_URL is empty)
npm run build               # tsc -b && tsc -p tsconfig.server.json && vite build → dist/
npm run typecheck           # both tsconfigs, no emit
```

There is no lint config and no unit-test framework. Verification is end to end:

```bash
# API smoke run (the regression test — extend it when adding endpoints).
# Needs a running server; use a scratch embedded DB on its own port so
# production data is never touched:
DATABASE_URL= PORT=3100 node server/index.ts
SMOKE_PASS=<local OWNER_PASSWORD> npm run smoke      # SMOKE_BASE/SMOKE_USER default to :3100 / rm.owner

npm run verify                                       # Playwright over public routes → .verify/ (VERIFY_BASE, default :5173)
node scripts/verify.mjs /location                    # one route; VERIFY_VIEWPORT=mobile for phones
npm run verify:nav                                   # every public route reachable by clicking
node scripts/verify-console.mjs                      # signs in, screenshots console pages (VERIFY_USER/PASS)

npm run user:create -- --username x --password y --role owner   # or --reset; --jobs dj,bartender
npm run data:reset -- --apply                        # wipe transactional data (dry run without --apply)
npm run media:upload -- --dry                        # mirror public/assets to Cloudinary (map/uploads/dj-music skipped)
```

`npm run server` serves `dist/`, so run `npm run build` first if you need the site, not just the API. `vite preview` does not work here (the dev proxy sends `/assets/*` to :3000, which is also where the hashed bundle lives); use `npm run server`.

The smoke run must stay repeatable against the same database: it cleans up what it creates, logs in with `force: true`, and accepts `[201, 429]` where rate limits can hit on a re-run.

## Backend rules (server/, shared/, api/, scripts/*.ts)

- Plain TypeScript executed by Node directly: **explicit `.ts` import specifiers, erasable syntax only** (`erasableSyntaxOnly`, `verbatimModuleSyntax` — no enums, namespaces or parameter properties; `import type` for types). No build step, no JS files in the backend.
- `server/config.ts` is the only place that reads `process.env`. Everything else imports `config`.
- One router (`createRouter` in `server/http.ts`), all routes registered in `server/index.ts`. A handler is `(ctx: Ctx) => Promise<unknown>` with `ctx.{req,res,db,user,params,query}`. Return a plain object → 200 JSON; `created(body)` / `reply(status, body)` otherwise; throw `bad / unauthorized / forbidden / notFound / conflict / tooMany` for errors. Validate bodies with `parse(zodSchema, await readJson(req))`. Guards: `requireUser / requireRole(ctx, 'manager') / requireCapability`.
- First matching route wins, and a path registered twice silently shadows the second. Merge handlers that share a path (guest + staff logic in one handler) rather than registering it twice.
- Mutating methods get the same-origin check automatically; `ctx.user` is `null` for guests. Guest identity for reservations/reviews is a visitor token; club listeners use a per-browser id + IP hash + secret token.
- The same `handleApiRequest` runs as a Vercel function (`api/index.ts`, one function for all of `/api/*`) and as a long-lived process that also serves `dist/` + `public/`. `config.serverless` gates disk writes, pool sizes and anything that needs a persistent process. There are no background timers: periodic work (the station check) piggybacks on requests with a DB-claimed timestamp.
- Database: `server/db.ts` gives `query / exec / tx` over `pg` (when `DATABASE_URL` is set) or PGlite under `data/pglite/`. Integers and numerics arrive as numbers. Migrations in `supabase/migrations/000N_*.sql` are applied in name order on first use and recorded in `public.app_migrations` — never edit an applied file, add the next number, write idempotent SQL (`if not exists`, `drop constraint if exists`), and `enable row level security` on every new table (RLS on, no policies: only the backend's role reads). Seed and one-off data moves run once per process through `ready()`.
- After any write another browser might be looking at, call `broadcast(topic, event, {ids})` (`server/realtime.ts`; topics `house | club | reservations | events | content | staff`). Payloads carry ids or small deltas, never content lists.
- Auth: Argon2id (hash-wasm), hashed session tokens, one active session per account (login with `force: true` takes over), idle + absolute expiry. `role` is the ladder `staff < manager < owner`; `jobs` (bartender, dj, biztonsag, …) add capabilities via `capabilitiesOf`. The `dj` capability opens the booth regardless of role.
- Media: browsers upload straight to Cloudinary with a server signature (`/api/media/sign` → `uploadMedia()` in `src/lib/media.ts`); the feature endpoint then stores `url` + `public_id` after `acceptImage` / `ownsMedia`. Replacing or deleting anything with a `public_id` must call `destroyMedia`. Signatures are stored by the server with `storeSignature`. Disk fallback (`public/assets/uploads/`) exists only for the embedded DB (`localStoreAllowed`); a hosted DB without Cloudinary gets a clear error instead.
- The live club follows the GoCast station: `server/station.ts` `syncStation` (called from `houseStatus()` and `clubState()`) reads GoCast's public JSON at most every 20 s (claimed via `club_state.station_checked_at`) and flips `live`/`auto_live`; a hand-started show ends after 10 min of station silence (`station_offline_since`) unless it has its own `stream_url`, and any show ends after 12 h. `onAir(state)` (booth live AND station streaming or own stream) is what the frontend uses to duck music and show the popup — never raw `live`. The site plays the station's Icecast MP3 mount in a plain `<audio>`; `effectiveStreamUrl` derives it from `provider_url` when `stream_url` is empty.
- `server/routes/members.ts`: the House. `members` table (code `RM-H-XXXX`, tier silver|gold|black|royal, phone, visits, active). `mayGrant`: managers grant silver/gold, owner all. `memberForBooking` resolves a reservation's `memberCode` (active member whose phone matches) and settles the booking's `tier`; the form never sets a tier. Public `POST /api/public/member-lookup {code, phone}` (rate limited) returns the card. `/api/public/house` carries `video` (the featured YouTube clip, parsed by `youtubeId` in house.ts) and `members` stats.
- `POST /api/profile/tour {module, status: done|skipped|reset}` records the guided tour on `staff_accounts.tours` (jsonb) and returns the refreshed `user`. `JOBS` is exactly `bartender, biztonsag, dj, uzletvezeto` (migration 0006 stripped anything else).
- `houseStatus()` returns `realtime: {url, key}` (publishable key only) so a browser bundle built without `VITE_SUPABASE_URL` can still connect (`configureRealtime`). Club state carries `recentReactions` (last 20 s, with ids) as the polling fallback for pushes.
- Floor plan and tables: `shared/floorPlan.ts` (types, `normalizeFloorPlan` validation used by both sides, seat geometry, `tableState`, `RESERVATION_SLOT_MINUTES` = 150, `DEFAULT_FLOOR_PLAN` test room). `server/routes/floor.ts`: `loadFloorPlan` (saved `floor_plans` row or the default), `heldTables` (confirmed/seated bookings with a `table_id` overlapping a window), `checkTable` (exists, fits, tier, no clash → else `bad/forbidden/conflict`). `GET /api/public/floor-plan?at=` returns the plan + `taken` windows a day either way (staff also get code/name). `PUT/DELETE /api/house/floor-plan` (owner). Bookings carry `table_id` + `table_label`; `POST /api/reservations` takes `tableId` (empty = house picks); staff `PATCH` takes `tableId` and re-checks the clash whenever the booking holds a table (tier gate skipped for staff).
- Closing reports: `server/routes/shiftReports.ts`. `createShiftReports` runs inside `POST /api/shifts/close` (one `shift_reports` row per member with an account, plus the closer), then `broadcast('staff', 'shift-closed', {shiftId, userIds})`. `reportView` builds the transfer memo at read time (`shortName`: first word + initials; `closingLabel`: hu-HU month + day in Europe/Budapest, plus `n/N` when the day had several closings). `GET /api/shift-reports/pending`, `GET /api/shift-reports`, `POST /api/shift-reports/:id/seen`; the presence heartbeat returns `shiftReports` (unseen count). Account number and owner are constants there.
- `server/routes/community.ts`: owner news posts (`/api/posts`, public `/api/public/posts`, media purpose `post`), event RSVP (`POST /api/public-events/:id/rsvp`, counted by `visitorFingerprint`), and the staff notice board (`/api/staff/notes`, manager+ write, owner pins). `/api/dashboard` carries a `counts` object the dashboard renders as badges.

## Frontend structure (src/)

- Routes in `src/App.tsx`; console pages are lazy and wrapped in `RequireRole`. `STAFF_NAV` in `src/lib/navigation.ts` repeats each route's `need` on purpose (guard enforces, nav only hides). Public routes must be reachable by clicking — `verify:nav` fails otherwise.
- Data: `useLiveData(url, {intervalMs, topics, skipEvents, refetchOnMutation})` = fetch + poll + refetch on realtime push + `mutate` for optimistic updates. Polling relaxes ×4 while the socket is up; without Supabase env it just polls. `useLiveEvent(topic, handler)` for pushes that carry their own payload (chat lines, reactions, poll counts) — list those in `skipEvents` so they do not trigger a full refetch. `apiSend` emits a `mutation` event on `liveBus` so every live list refreshes; add observe-only endpoints (heartbeats, votes) to its `QUIET` list.
- Guided tour: `src/lib/tour.ts` (modules `staff|dj|manager|owner`, steps `{path, target, title, text}`; `requiredModules(user)` / `pendingModules(user)`), `useTourStore` (`startTour(modules)` for replays), `TourHost` in `src/components/staff/Tour.tsx` mounted once in `App.tsx`: auto-starts on a console path for pending modules (once per session, waits for dialogs), navigates, finds `[data-tour=…]` (falls back to `main h1` for `page`), spotlights it. Tag targets with `data-tour` (`PageHeader` sets `page`; `Panel` takes a `tour` prop). Skipping records the remaining modules as skipped after a `dialog.confirm`.
- The House: `MembersPage` at `/staff/members` (manager+), `HouseLookup` (member card, remembers code+phone in localStorage `rm-house-card`) on `VipPage`, the booking form takes `memberCode` (prefilled from `?member=` or the stored card). Reservation `tier` is read-only on the client.
- Map: `LocationPage` fetches `/api/public-map-blips` once and passes `blips/refresh/focusId` to `GtaMap`; blip kinds and families live in `src/lib/blips.ts` (mirror `BLIP_KINDS` on the server). Marker CSS is `src/styles/blips.css`, injected into the map's shadow root; keep `.leaflet-top.leaflet-left` margin wider than the panel.
- `FeaturedVideo` (home): cropped muted YouTube preview, revealed only after the player reports `playing` plus a delay (so no YouTube chrome shows), modal with real controls. `isConsolePath()` in `navigation.ts` decides console chrome (the login page is public chrome).
- Closing report UI: `useShiftReportStore` (queue of unseen reports, `snoozed`, `check/push/done`), `ShiftReportHost` mounted once in `App.tsx` (checks on sign-in, on the `staff` push, on tab wake and when the heartbeat count differs; shows the front of the queue as the `.rm-closing` card), `ShiftPage` pushes the closer's report from the close reply, `ConsoleNav` shows the `.rm-console-alert` badge and the dashboard a `.rm-closing-banner` while anything is unseen.
- Floor plan UI: `FloorMap` + `FloorLegend` in `src/components/floor/FloorMap.tsx` (pure SVG from the plan; feature kinds `wall|sofa|bar|stage|speaker|dance|door|stairs|pillar|plant|seat|stool|restroom|area|text`, a bar may be a polygon with explicit `stool` features; tables take `seatCounts` per side, `seatStyle` chair|armchair and `bench: false`; classes `is-free|taken|unfit|locked|selected|own`; `onSelect(table, state)` leaves the decision to the parent). `FloorMap` zooms and pans on its own (wheel after a tap, pinch, drag when zoomed, +/−/reset buttons; the inner `<g>` carries `translate scale`, pointer maths goes through `getScreenCTM`). `DEFAULT_FLOOR_PLAN` is the house's room laid out from the blueprint in `temporary/tervrajz.png` (1000×1500 plan units) with the lounges as crescent `sofa` features around seat-less booths (`drawSeats: false`, capacity 10); path bars carry their stools at `w/2 + 13` from the counter's edge, `useFloorPlan(at)` (keyed by day, topics reservations+content), styles in `src/styles/floor.css`. The booking form's ASZTAL step, the staff booking book (assign select + ALAPRAJZ panel, clashes computed from the list itself) and the showcase JSON editor all use it.
- Feature hooks: `useHouseStatus` (door + booth + next event, one feed shared by navbar, pill, popup, footer), `useClub` (club state + identity + vote memory), `useRsvp` (per-event "ott leszek", remembered in localStorage), `useFavorites` in `src/lib/favorites.ts` (menu hearts, browser-only).
- Console chrome: `ConsoleNav` is two rows (overview + four area tabs, then the active area's tools); `DashboardPage` is now-tiles, role-aware quick actions with badges from `/api/dashboard.counts`, tonight's numbers and `StaffBoard`. Public pages: `/hirek` (`NewsPage`), owner editor at `/staff/posts` (`PostsPage`). New public routes must be added to `NAV_GROUP` in `navigation.ts` and to `PUBLIC_ROUTES` in `scripts/verify-nav.mjs`. Stores: `useAuthStore`, `useAudioStore` (one music element, one stream element; `setLive` ducks the music and auto-starts the stream if music was on), `useChromeStore`, `useDialogStore` (`dialog.confirm/prompt/alert`), `useToastStore`.
- Documents (`src/lib/documents.ts`, `documentPdf.ts`, `documentBuilders.ts`): a layout-free payload rendered to an HTML preview and a pdfmake PDF (pdfmake loads on demand). Signatures are fetched from the media store with `resolveSignatures` before rendering; the first issued PDF locks a signature server-side.
- `shared/signature.ts` is imported by both sides; keep it dependency-free.
- Gallery wall: `src/lib/galleryLayout.ts` packs tiles (shape rhythm + skyline + hole filling); the page sets grid placement inline.
- CSS: Tailwind first, then `src/styles/*.css` in the order listed in `main.tsx`, so `.rm-*` classes win over utilities. `.rm-input` sets the padding shorthand, so Tailwind padding utilities on inputs lose — add a modifier class (e.g. `.rm-search`) instead. Club/live/booth styles live in `club.css`; console in `console.css`.
- UI copy is Hungarian; code, comments and commit messages are English.

## Free tiers — design constraints

Vercel Hobby, Supabase Free, Cloudinary Free. Consequences that shape changes here:
- No new polling loops; prefer a realtime push + refetch, and keep state endpoints small (chat capped at 80 lines, setlist 12 public).
- Realtime message volume is budgeted (reactions: 40 pushes/min room-wide, `REACTION_PUSHES_PER_MINUTE`). Anything pushed per user action needs a similar cap.
- Pictures are served from Cloudinary with `f_auto,q_auto` via `assetUrl()`; map tiles (`public/assets/map`, 436 MB) stay on Vercel, never Cloudinary (10 MB file limit, and Vercel's transfer pool is bigger). `public/assets/gtav-map-hires.png` is unused and excluded from both.
- Locally, leave `VITE_CLOUDINARY_CLOUD_NAME` empty so development does not spend Cloudinary bandwidth.

## Local pitfalls

- Never point a local run at the production `DATABASE_URL` for testing; the smoke run creates and deletes accounts, and uploads would be validated against a store the local process may not have. Use `DATABASE_URL= PORT=3100 node server/index.ts`.
- PGlite corrupts if the process is force-killed while writing (`RuntimeError: Aborted()`, stale `postmaster.pid`). Stop it gracefully; recovery is deleting `data/pglite/` (local test data only).
- Supabase keys are the new formats: `SUPABASE_PUBLISHABLE_KEY` / `VITE_SUPABASE_PUBLISHABLE_KEY` (`sb_publishable_…`, safe in the browser) and optional server-only `SUPABASE_SECRET_KEY`. Never put a secret in a `VITE_` variable; never print `.env` values.
