# Red Moon Pub

The Red Moon Pub faction site: public pages, table reservations, recruitment,
the club and DJ booth, and the staff console (cash register, shifts, stock,
documents, reports).

React 19 + TypeScript + Vite on the front, one Node HTTP server on the back,
PostgreSQL for storage with a `data/seed.json` fallback for offline work.

---

## Running it locally

```bash
npm install
cp .env.example .env     # optional; the defaults work with no database
npm run server           # API + built frontend on http://localhost:3000
npm run dev              # Vite dev server on http://localhost:5173, proxies /api
```

With `DATABASE_URL` empty everything is read from and written to
`data/seed.json`, so there is nothing to install and nothing to configure.

Create the first account:

```bash
node scripts/create-user.cjs --username rm.owner --password "<a password>" --role owner --name "Owner"
```

## Scripts

| Command | What it does |
|---|---|
| `npm run dev` | Vite dev server with hot reload |
| `npm run build` | Typecheck and build into `dist/` |
| `npm start` | Production server: API plus the built frontend |
| `npm run verify` | Headless browser pass over the public routes, desktop and mobile; writes `.verify/` |
| `npm run verify:nav` | Fails if any public route is unreachable by clicking |
| `npm run tiles:upload` | One-off upload of the map tile pack to Supabase Storage |
| `node scripts/reset-data.cjs` | Dry-runs a wipe of every transactional collection; `--apply` performs it |

## Deployment

Three supported targets. Pick one and follow that file — each is written for
somebody deploying it without knowing the codebase.

| Target | Guide | Notes |
|---|---|---|
| Vercel + Supabase | [DEPLOY-VERCEL.md](DEPLOY-VERCEL.md) | Serverless. Nothing to keep running. |
| Render | [DEPLOY-RENDER.md](DEPLOY-RENDER.md) | One web service plus a managed database. |
| Plain Linux VPS | [DEPLOY-VPS.md](DEPLOY-VPS.md) | systemd + nginx + local PostgreSQL. |

The database schema is created automatically on first start. It is also written
out in [`supabase/schema.sql`](supabase/schema.sql) for review, and applies to
any PostgreSQL.

## Pages

| Route | What it is |
|---|---|
| `/` | Home — hero, tonight, signature drinks, membership teaser, reviews |
| `/menu` | The drinks list |
| `/events` | Upcoming and past evenings |
| `/vip` | The House — the four membership tiers |
| `/reservations` | Table booking, four steps, no account needed |
| `/careers` | Recruitment — open roles and the application form |
| `/gallery`, `/about`, `/location` | Stills, the family tree, the GTA V map |
| `/club`, `/dj` | Live club page and the DJ booth |
| `/staff/...` | The console: shifts, register, sales, reservations, applications, supply orders, stock, documents, reports, users, audit |

### Reservations

A guest books without registering. The booking is tied to a SHA-256 hash of the
client IP and a token the browser keeps, so they can find and cancel their own
bookings later while the site stores nothing that identifies them. Three open
bookings per visitor at a time, which is what stops the form being used as a
spam cannon.

Staff see every booking at `/staff/reservations`; manager and above can confirm,
decline, seat, or leave a note the guest sees on their own booking.

### Recruitment

Same anonymous model at `/careers`: seven roles, one open application per
visitor, and the candidate follows their own status without an account. The
free text they write is never echoed back to them — only managers read it, at
`/staff/applications`, where they can invite to interview, accept or reject and
leave a note the candidate sees.

The two features deliberately share the same fingerprint helper and the same
short-code generator, so there is one implementation of "anonymous but
identifiable" rather than two that drift.

## The console

Everything behind the login. `GET /api/analytics/me` drives what a person sees
of their own record; managers additionally get `/api/analytics/storage`, and
owners `/api/analytics/business`.

### Ranks and jobs

Two separate axes, deliberately:

- **`role`** is the permission ladder — `staff` < `manager` < `owner`, plus a
  separate `dj` portal. Every endpoint checks it.
- **`job`** is the post a person holds: bartender, kasszás, biztonság, hostess,
  felszolgáló, üzletvezető. A bartender and a doorman are both `staff`, but only
  the doorman runs supply orders.

The dashboard is built from both: own record first, then work you can pick up,
then the house, then the manager and owner sections if the rank allows.

### Supply orders

The house has no supplier — somebody walks to a shop, buys the stock and carries
it back. So an order is a job ticket with an audit trail:

1. A manager writes what is needed and what it *should* cost.
2. A doorman or manager claims it, then marks that they have set out.
3. On completion they enter what it *actually* cost.

Stock only moves on completion, so a claimed-but-abandoned run never inflates
the shelf. Both figures are kept forever and the gap between them appears on the
runner's profile, in the daily reports, and in the owner's dashboard — which is
the point of the whole flow.

### Documents

`/staff/documents`, manager and above. Five types: transaction listing, shift
close-out, payroll, supply-order audit, and stock listing. Each renders as a
print-ready A4 page with the house letterhead, the period, a summary block, and
two signature marks — the issuer's and the owner's.

The signature is drawn from the name with a seeded curve, so the same name
always produces the same mark. It is a visual mark on an internal document, not
a legal autograph, and the document footer says so.

No PDF library: a client-side one adds ~300 kB to an already large bundle, and a
server-side one needs a headless browser the Vercel deployment cannot have. The
document opens in its own window where "Save as PDF" is the default print
destination. The trade-off is that the visitor picks the destination — this is
"print or save as PDF", not a silent download. `renderDocument` returns a
standalone HTML string, so moving to a server-side renderer later needs no
change to any builder.

> The house's particulars in `src/lib/house.ts` are **placeholder data** for the
> proof of concept. Replace the values before anything is issued; the shapes do
> not change.

## Navigation

One definition in `src/lib/navigation.ts` feeds the header, the mobile sheet,
the footer sitemap, the 404 suggestions and the staff console rail. Adding a
page means adding it there once; it then appears everywhere it belongs.

The header row is deliberately short — four links plus a grouped dropdown. The
row previously carried every public page and had run out of width, and the fix
at the time was to push `/careers` into the footer, where nobody looked for it.

The staff console has its own sticky rail (`ConsoleNav`), mounted once inside
`RequireRole` and filtered by role. Before it, moving between two console tools
meant going back to `/staff` first.

`npm run verify:nav` crawls the links on `/` and fails if any public route is
not reachable by clicking. It exists because `/careers` once shipped reachable
only from the footer and nothing caught it.

## How it fits together

`server.cjs` is the whole backend. It runs in two shapes from the same code:

- **server** — one long-lived process. Holds state in memory between requests
  and pushes live club updates over Server-Sent Events. This is Render, a VPS,
  and local development.
- **function** — one short-lived serverless invocation per request. Reloads
  state and sessions from PostgreSQL per request, guards writes with a revision
  check, and tells the frontend to poll instead of streaming. This is Vercel,
  entered through `api/index.js`.

The mode is detected at startup; `GET /api/health` reports which one is active,
along with where the database and uploaded audio actually are. That endpoint is
the fastest way to tell a misconfigured deployment from a broken one.
