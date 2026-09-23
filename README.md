# Red Moon Pub

The Red Moon Pub faction site: public pages, table reservations, recruitment,
the club and DJ booth, and the staff console (register, shifts, stock,
documents, reports, house settings).

React 19 + TypeScript + Vite on the front. A TypeScript Node backend
(`server/`) on PostgreSQL — Supabase in production, an embedded PostgreSQL
(PGlite) for local development with zero setup.

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
creates the first owner from `OWNER_USERNAME` / `OWNER_PASSWORD`.

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
| `npm run tiles:upload` | One-off upload of the map tile pack to Supabase Storage |

## Deployment (Vercel + Supabase)

1. Apply `supabase/migrations/0001_init.sql` to the project (already applied
   to `hrlgxkcawgumsaudlnma`). The backend also applies pending migrations on
   start, so later files only need to be committed.
2. Set the environment variables listed in `.env.example` in the Vercel
   project. Required: `DATABASE_URL` (Supabase *transaction pooler*, port
   6543), `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`. Optional:
   `VITE_MAP_TILE_BASE` after uploading the tiles, `OWNER_*` for a fresh
   database.
3. Node version: 24.x (Project → Settings → General). `vercel.json` routes
   every `/api/*` request into one function, `api/index.ts`.

Storage buckets `dj-music`, `media` and `map-tiles` exist and are public;
uploads go through signed URLs issued by the API, never through Vercel.

## How it fits together

```
api/index.ts            Vercel entry → server/index.ts
server/
  index.ts              router, request lifecycle, static site for a VPS
  db.ts                 pg (DATABASE_URL) or PGlite; migrations
  auth.ts               scrypt passwords, sessions, throttling, capabilities
  http.ts               responses, body parsing, cookies, CSRF check, router
  routes/*.ts           public, session, staff, shifts, sales, inventory, guests, house, club
shared/signature.ts     name-based signature generator, used by server and browser
supabase/migrations/    schema, one file per change
src/                    the React app
```

### Accounts and permissions

One login for everything. `role` is the permission ladder
(`staff` < `manager` < `owner`); `jobs` is what the person does (bartender,
security, DJ, …). Capabilities derive from both: the `dj` job opens the
booth, `biztonsag` may run supply orders, managers open the house, owners
can do everything. An owner creates accounts at `/staff/users`; every new or
reset account must change its temporary password on first login.

Passwords are Argon2id-hashed (64 MiB, 3 passes, via hash-wasm, so no native
build); legacy scrypt and PBKDF2 hashes still verify and are upgraded at login. Sessions are random tokens stored hashed, HttpOnly cookies,
one active session per account, idle and absolute expiry, login throttling per
user and per IP, same-origin checks on every mutation. All tables have RLS on
with no policies and no grants for the Supabase API roles: only the backend
reaches the data.

### The day

A manager opens a shift with at least one member (the opener need not be in
it), then opens the **house door**, which is what the public site shows as
open — in the header chip, the corner pill and the home hero. Closing the
shift closes the door. Sales require an open shift and membership. Every
shift keeps a per-member breakdown for payroll.

### Documents

`/staff/documents` builds transaction listings, shift reports, payroll,
supply audits, stock listings, and re-renders stored receipts and invoices.
Each is previewed in the console and saved as a PDF built in the browser
(pdfmake, loaded on demand) with printing disabled in the file's permissions.
The house letterhead, hourly wage, transfer account and signing owner come
from **Kirakat → A ház adatai**; signatures are generated from the person's
name when an account reaches manager rank and stored on the account.

### The club

The public `/club` page and the `/dj` booth poll the API; there is no
server-sent stream, which is what a serverless deployment needs. Audio goes
straight from the browser to the `dj-music` bucket via a signed upload URL.
