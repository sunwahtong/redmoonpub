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
| `npm run tiles:upload` | One-off upload of the map tile pack to Supabase Storage (Cloudflare Pages is the better home, see Map tiles) |

## Deployment (Render + Supabase + Cloudinary, all free tiers)

The site runs as one long-lived Node process (`npm start` = `node
server/index.ts`): the API, the built site from `dist/`, `public/` and the map
tiles. `render.yaml` describes it as a Render Blueprint.

1. Push the repository to GitHub. In Render: New → Blueprint → pick the
   repository. Render reads `render.yaml` and asks for the secrets marked
   `sync: false`:
   - `DATABASE_URL`: Supabase → Project Settings → Database → connection
     string, *session pooler* (port 5432; the process keeps a small pool).
   - `SUPABASE_URL`, `SUPABASE_PUBLISHABLE_KEY`, `SUPABASE_SECRET_KEY`, and the
     same URL + publishable key as `VITE_SUPABASE_URL` /
     `VITE_SUPABASE_PUBLISHABLE_KEY` (instant updates; without them the site
     polls).
   - `CLOUDINARY_CLOUD_NAME`, `CLOUDINARY_API_KEY`, `CLOUDINARY_API_SECRET`
     (uploads), and `VITE_CLOUDINARY_CLOUD_NAME` so pictures and the music
     come from Cloudinary rather than from this service (run
     `npm run media:upload` once, locally, if not done yet).
   - `VITE_MAP_TILE_BASE`: the tile host (below), or empty to serve the tiles
     from this service.
   `VITE_*` values are baked in at build time: change one, redeploy.
2. Migrations apply themselves on the first request (`public.app_migrations`
   remembers which). `OWNER_*` are only needed on an empty database.
3. The free instance sleeps after 15 minutes without a request and wakes on
   the next one (about half a minute). To keep it awake, have a free
   monitor (cron-job.org, UptimeRobot) fetch `/api/health` every 10
   minutes; one always-on service fits in Render's 750 free hours a month.
4. Custom domain: Render → Settings → Custom Domains, then a CNAME at the
   registrar. TLS is automatic.

Vercel is no longer the target: its Hobby fair-use pool was exhausted by the
tile pack being deployed and served with the site, and by one function
invocation per poll. `vercel.json` and `api/index.ts` still work if ever
needed, with the tiles served from the static host.

### Map tiles

`map-tiles/` holds the GTA V atlas: 313 MB across 4098 small JPEG/PNG tiles
(`styleAtlas`, `styleGrid`, `styleSatelite`, `{z}/{x}/{y}`). It lives
outside `public/` on purpose: Vite copies `public/` into `dist/` on every
build, and the pack would make `dist/` 480 MB. The Node server serves the
folder at `/assets/map` (locally and on Render), so nothing else is needed
to run the map.

To spare the web service's bandwidth, publish the pack once to Cloudflare
Pages (free, unlimited bandwidth, no build) and point the site at it:

```bash
npx wrangler@latest login
npx wrangler@latest pages project create redmoon-tiles --production-branch main
npx wrangler@latest pages deploy map-tiles --project-name redmoon-tiles
```

Then set `VITE_MAP_TILE_BASE=https://redmoon-tiles.pages.dev` (or the custom
domain) and redeploy. `map-tiles/_headers` gives the files a year of caching
and the CORS header the map's tile probe needs. GitHub Pages works the same
way (a repository with the three folders at its root).

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
(`staff` < `manager` < `owner`); `jobs` is what the person does, one of the
four posts the house has: `bartender`, `biztonsag` (security), `dj`,
`uzletvezeto` (manager). Capabilities derive from both: the `dj` job opens
the booth, `biztonsag` may run supply orders, managers open the house, owners
can do everything. An owner creates accounts at `/staff/users`; every new or
reset account must change its temporary password on first login.

The first time an account opens the console it is walked through it: a
guided tour in Hungarian, one module per kind of work (the console for
everyone, the booth for whoever may open it, the manager's tools, the
owner's). Each module is a chain of steps that navigates to a page, lights
up one part of it and explains it; finishing or skipping (after a warning)
is recorded on the account (`staff_accounts.tours`), so a promotion or a
new job brings only the missing module up next time. Any module can be
replayed from the profile page.

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

Closing also writes a **closing report** for everyone who worked the shift
(and whoever closed it): what that person sold, and where to transfer it —
the house's account number and owner, and the exact memo to write
(`<shift id>, <closing day> - <first name + initials>`, e.g.
`M-014, szeptember 25. 2/2 - Yuanzhe G.`; the `2/2` only appears when the
day had several closings). The closer sees theirs the moment the shift
closes, as an animated full-screen card; everyone else sees theirs the
moment they are on the site — at once if they are signed in anywhere, on
their next visit if not — and a pulsing ZÁRÁS badge in the console plus a
banner on the dashboard keep pointing at it until they press MEGNÉZTEM.

### Reservations

A booking walks a visible pipeline: received → being looked at (or
wait-listed) → decided → the evening. The guest sees each step on their own
page and can write to the house on the booking; managers answer from the
console, with quick replies. Both sides get unread counters and live
updates. A House member books with their code (see below): the tier on the
booking comes from the card, never from the form.

A booking either leaves the table to the house or names one. The form's
ASZTAL step draws the room from the floor plan (`shared/floorPlan.ts`
describes it; the owner edits it as JSON at `/staff/showcase`, the built-in
room is test data): zones, the bar, the stage, walls and doors, and every
table with its seats; the room zooms (scroll after a tap, pinch, the buttons) and pans by dragging. For the chosen evening a table is free, already
promised (hatched — a confirmed or seated booking holds it for
`RESERVATION_SLOT_MINUTES`, 150 minutes, from its start; a request nobody
has looked at holds nothing), the wrong size for the party, or House-only.
Two guests may ask for the same table; the first confirmation wins and the
second cannot be confirmed until it is moved. The console's booking book
shows the table on each booking, lets a manager assign or move it from a
list that knows what is taken, and has an ALAPRAJZ panel that colours the
room for any moment with who holds what.

### The House

Membership is something the house grants and the site recognises. A member
has a code (`RM-H-XXXX`, said at the door, typed into a booking), a tier
(silver, gold, black, royal), the phone number that proves the code is
theirs, a visit count the door bumps, and a note only the house sees.
Managers grant Silver and Gold at `/staff/members`; Black and Royal are the
owner's to give, suspend and take back. On the public House page (`/vip`)
the tier counts are live, and a member opens their own card with code +
phone: tier, visits, what the tier gives, and a booking link that carries
the code. Lookups are rate limited and the card is remembered by the
browser.

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

### The film

The owner can pin a YouTube clip to the home page from the showcase
(`/staff/showcase`): a link or a video id, a title and a line. It sits high
on the page as a muted, cropped preview that plays by itself in view and
pauses out of it — the frame is only revealed once the player reports it is
playing and YouTube's own overlays have faded, so none of YouTube's chrome
shows. One tap opens the film large with sound and the real controls; the
house music steps aside meanwhile. Without a clip the section does not
exist.

### The map

`/location` is SeeCity's atlas (tiles under `map-tiles/`) with the
house's markers on it: thirteen kinds in three families (around the house,
the city, signals), searchable and filterable in the panel, grouped by the
group name a manager gave them. Selecting a marker or a row flies there and
opens a card with a shareable link (`/location?blip=<id>`) and the
coordinates. Managers place markers by clicking the map, edit them, move
them by dragging and remove them. Below the map the house's own marker is
spelled out as the way there, with what is nearest to it and a legend.
