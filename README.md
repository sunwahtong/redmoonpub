# Red Moon Pub

The Red Moon Pub faction site: public pages, table reservations with a
message line to the house, recruitment, the live club and DJ booth, and the
staff console (register, shifts, stock, documents, reports, gallery, house
settings).

React 19 + TypeScript + Vite on the front. A TypeScript Node backend
(`server/`) on PostgreSQL — Supabase in production, an embedded PostgreSQL
(PGlite) for local development with zero setup. Supabase Realtime pushes
changes to open browsers; Cloudinary holds every uploaded picture and track.

---

## Running it locally

```bash
npm install
cp .env.example .env     # optional: the defaults use the embedded database
npm run server           # API + built site on http://localhost:3000
npm run dev              # Vite dev server on http://localhost:5173, proxies /api
```

With `DATABASE_URL` empty the backend runs PGlite under `data/pglite/`
(gitignored), applies `supabase/migrations/*.sql`, seeds the catalogue and
creates the first owner from `OWNER_USERNAME` / `OWNER_PASSWORD`. Without
Cloudinary credentials, uploads are written under `public/assets/uploads/`.

Node 22.18+ or 24 is required: the backend is plain TypeScript run through
Node's built-in type stripping, so there is no build step for it.

## Scripts

| Command | What it does |
|---|---|
| `npm run dev` | Vite dev server with hot reload (API from `npm run server`) |
| `npm run build` | Typecheck front and back, build into `dist/` |
| `npm start` | Production server: API plus the built site |
| `npm run typecheck` | `tsc` for `src/` and for `server/` |
| `npm run smoke` | End-to-end API run against a live server (`SMOKE_BASE`, `SMOKE_USER`, `SMOKE_PASS`) |
| `npm run verify` | Headless browser pass over the public routes; writes `.verify/` |
| `npm run verify:nav` | Fails if any public route is unreachable by clicking |
| `node scripts/verify-console.mjs` | Signs in and screenshots every console page |
| `npm run user:create -- --username x --password y --role owner` | Create or `--reset` an account from the CLI |
| `npm run data:reset -- --apply` | Wipe transactional data (dry run without `--apply`) |
| `npm run media:upload` | Mirror `public/assets` (pictures, background music) to Cloudinary, once |
| `npm run tiles:upload` | One-off upload of the map tile pack to Supabase Storage (only if you serve tiles from there) |

## Deployment (Vercel + Supabase + Cloudinary)

1. Migrations `supabase/migrations/0001_init.sql` and `0002_…sql` are applied
   to project `hrlgxkcawgumsaudlnma`. The backend also applies pending files
   on start, so later migrations only need to be committed.
2. Set the environment variables listed in `.env.example` in the Vercel
   project. Required: `DATABASE_URL` (Supabase *transaction pooler*, port
   6543) and the three `CLOUDINARY_*` credentials. Recommended: the Supabase
   URL + publishable key pairs (server and `VITE_`) for instant updates;
   `SUPABASE_SECRET_KEY` is optional. Optional:
   `VITE_CLOUDINARY_CLOUD_NAME` after `npm run media:upload`, `OWNER_*` for a
   fresh database.
3. Node version: 24.x (Project → Settings → General). `vercel.json` routes
   every `/api/*` request into one function, `api/index.ts`.

### Map tiles

`public/assets/map` is 436 MB across 4102 files. `.vercelignore` currently
excludes it from the deployment; either remove those lines (Vercel dedups
unchanged files between deploys, and its bandwidth pool is far larger than
Supabase's) or upload the pack once with `npm run tiles:upload` and set
`VITE_MAP_TILE_BASE`.

## How it fits together

```
api/index.ts            Vercel entry → server/index.ts
server/
  index.ts              router, request lifecycle, static site for a VPS
  db.ts                 pg (DATABASE_URL) or PGlite; migrations
  auth.ts               Argon2id passwords, sessions, throttling, capabilities
  http.ts               responses, body parsing, cookies, CSRF check, router
  realtime.ts           one broadcast per change, over Supabase Realtime's REST endpoint
  media.ts              signed Cloudinary uploads, local fallback, deletions
  routes/*.ts           public, session, staff, shifts, sales, inventory, guests, house, club, media
shared/signature.ts     name-based signature generator and the drawn/uploaded wrappers
supabase/migrations/    schema, one file per change
src/
  lib/realtime.ts       browser side of Realtime; lib/live.ts is the in-page bus
  hooks/useLiveData.ts  fetch + poll + push + optimistic `mutate`, used by every live view
  lib/media.ts          browser side of uploads; assetUrl() switches pictures to Cloudinary
```

### Live updates

Every write that somebody else might be looking at ends with a small
broadcast on one of six topics (`house`, `club`, `reservations`, `events`,
`content`, `staff`). Payloads carry ids, never content. Browsers subscribe
through `useLiveData(url, {topics})`, refetch on a push, and relax their
polling to a safety net while the socket is up. Without Realtime configured
(local development) the same hooks simply poll. Lists also update
optimistically: a deleted event, cart or picture leaves the screen at once
and comes back with an error toast if the server disagrees.

### Accounts and permissions

One login for everything. `role` is the permission ladder
(`staff` < `manager` < `owner`); `jobs` is what the person does (bartender,
security, DJ, …). Capabilities derive from both: the `dj` job opens the
booth, `biztonsag` may run supply orders, managers open the house, owners
can do everything. An owner creates accounts at `/staff/users`; every new or
reset account must change its temporary password on first login.

Passwords are Argon2id-hashed (64 MiB, 3 passes, via hash-wasm, so no native
build); legacy scrypt and PBKDF2 hashes still verify and are upgraded at
login. Sessions are random tokens stored hashed, HttpOnly cookies, one active
session per account, idle and absolute expiry, login throttling per user and
per IP, same-origin checks on every mutation. All tables have RLS on with no
policies and no grants for the Supabase API roles: only the backend reaches
the data.

### The console

`/staff` opens on a dashboard built for the evening, not for the org chart:
what is happening now (the door, the shift with its clock, the booth, who is
online), the handful of things you would do next as big buttons with badges
(pending bookings, open supply runs, low stock, new applications), tonight in
numbers, and the staff notice board — short lines from managers and the
owner, pinnable, taken down by the author or the owner. The navigation is
two rows: the overview and the four areas (MŰSZAK, VENDÉG, KÉSZLET, HÁZ),
then the tools of the area you are in or just tapped. Personal history (the
activity calendar, past shifts) lives on the profile page.

### The day

A manager opens a shift with at least one member (the opener need not be in
it), then opens the **house door**, which is what the public site shows as
open — in the header chip, the corner pill and the home hero, within a
second. Closing the shift closes the door. Sales require an open shift and
membership. Every shift keeps a per-member breakdown for the hours report.

### Reservations

A booking walks a visible pipeline: received → being looked at (or
wait-listed) → decided → the evening. The guest sees each step on their own
page and can write to the house on the booking; managers answer from the
console, with quick replies. Both sides get unread counters and live
updates.

### The club and the booth

The show is the GoCast station (`club_state.provider_url`, a
`gocast.fm/station/<slug>` page). The server watches it (`server/station.ts`):
one small JSON read at most every 20 seconds, riding on the status feed every
page polls. When the station comes on air the club goes live by itself, the
house music steps aside in every open browser (and if it was on, the stream
takes its place), and a popup offers play, volume and mute. When the station
goes quiet, a show that started that way ends by itself; one started by hand
in the booth ends after ten minutes of silence (unless it plays a stream of
its own), and no show outlives twelve hours. Whatever the booth's flag says,
the house music only steps aside while there is something to hear
(`onAir`: the station on air, or the DJ's own stream) — a booth "live" over a
silent station never mutes anyone. The site plays the station's Icecast MP3
mount (`icecast.gocast.fm/stream/<slug>`) in an ordinary audio element; the
DJ can point it elsewhere from the booth, and GoCast's own player is one tap
away as an iframe fallback.

The public `/club` page: the stage (who is in the booth, what the stream's
metadata says is playing, the player, listener counts, the show clock), emoji
reactions floating over it with a "vibe" meter, the chat (colour per approved
name, the DJ's lines set apart, @mentions, a pinned notice, slow mode), the
request board where anyone backs a request with a vote, the DJ's poll,
tonight's setlist, and the evening in the house (next event with countdown,
signature drinks, a table). Reactions, request votes and poll votes need no
name — a hash of the network and the browser counts once. Reaction pushes
are budgeted at 40 a minute for the whole room so a busy night cannot flood
the realtime channel; beyond that they still count toward the vibe.

The booth (`/dj`, for the DJ job, managers and owners): the station's state
and listener count, the title, "go live" by hand or "take over" a show the
station started (so the DJ's name is on it), the stream address (empty = the
station's mount), a monitor player, announcements that head the setlist,
requests with their votes (accept, decline, mark played), polls, the pinned
notice, slow mode, the request gate, a clean slate for the chat, quick lines,
the library and queue with the local player, and the room's names. Audio
uploads go straight to Cloudinary through a signed upload.

### Documents and signatures

`/staff/documents` builds transaction listings, shift reports, the hours
report, supply audits, stock listings, and re-renders stored receipts and
invoices as PDFs built in the browser (pdfmake, loaded on demand) with
printing disabled in the file's permissions. Managers and owners choose
their signature on their profile — drawn on a pad, uploaded (background
removed) or one of the variants generated from their name — and are asked
to at their next visit after a promotion. The first PDF that carries a
signature locks it; the house keeps a register of issued documents.
Signatures and profile pictures live in the media store like every other
picture (an uploaded signature as PNG, a drawn or generated one as SVG); a
replaced or removed picture is deleted from the store, and deleting an
account removes both. Pictures older versions kept inline in the database
move to the store on the first start with Cloudinary configured.

### Gallery and pictures

The owner curates the gallery at `/staff/gallery` (drop pictures in, order
them by drag, hide or remove). The public wall lays itself out from the
count and proportions of the pictures. Once `npm run media:upload` mirrored
`public/assets` and `VITE_CLOUDINARY_CLOUD_NAME` is set, the site's own
pictures and the background music are served from Cloudinary as well.

### News, "ott leszek" and favourites

The owner writes the house's news at `/staff/posts` (title, plain text with
blank-line paragraphs, an optional picture, pinned or hidden, published now
or later); the public reads them at `/hirek` and as a strip on the home
page. On an upcoming or running event a guest taps "OTT LESZEK" once — one
count per network and browser, taken back with a second tap — and the count
shows to everyone. On the menu a heart marks a drink as a favourite and a
"KEDVENCEIM" chip filters to them; that list lives in the browser only.
