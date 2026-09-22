-- ===========================================================================
-- Red Moon Pub — relational schema (PostgreSQL 15+ / Supabase / PGlite)
--
-- Idempotent: every statement is guarded, so the file can be applied more
-- than once. The Node backend applies it automatically on first start against
-- any PostgreSQL; on Supabase it is also recorded as a migration.
--
-- Access model: only the backend touches these tables, as the table owner
-- (postgres), which bypasses row level security. RLS is still enabled on
-- every table and the PostgREST roles (anon, authenticated) hold no
-- privileges, so the auto-generated REST/GraphQL API exposes nothing.
-- ===========================================================================

-- ---------------------------------------------------------------------------
-- helpers
-- ---------------------------------------------------------------------------
create or replace function public.set_updated_at() returns trigger
language plpgsql as $$
begin
  new.updated_at := now();
  return new;
end $$;

-- ---------------------------------------------------------------------------
-- staff accounts, sessions, login throttling
-- ---------------------------------------------------------------------------
create table if not exists public.staff_accounts (
  id                   uuid primary key default gen_random_uuid(),
  username             text not null,
  name                 text not null,
  nickname             text not null default '',
  title                text not null default '',
  role                 text not null default 'staff' check (role in ('staff','manager','owner')),
  jobs                 text[] not null default '{}',
  password_hash        text not null,
  must_change_password boolean not null default false,
  phone                text not null default '',
  id_number            text not null default '',
  avatar               text not null default '',
  signature_svg        text,
  signature_at         timestamptz,
  show_public          boolean not null default false,
  active               boolean not null default true,
  last_login_at        timestamptz,
  last_active_at       timestamptz,
  created_by           uuid,
  created_at           timestamptz not null default now(),
  updated_at           timestamptz not null default now()
);
create unique index if not exists staff_accounts_username_lower on public.staff_accounts (lower(username));
create index if not exists staff_accounts_role on public.staff_accounts (role);
drop trigger if exists staff_accounts_updated_at on public.staff_accounts;
create trigger staff_accounts_updated_at before update on public.staff_accounts
  for each row execute function public.set_updated_at();

create table if not exists public.sessions (
  id             uuid primary key default gen_random_uuid(),
  token_hash     text not null unique,
  user_id        uuid not null references public.staff_accounts (id) on delete cascade,
  created_at     timestamptz not null default now(),
  last_seen_at   timestamptz not null default now(),
  expires_at     timestamptz not null,
  ip             text not null default '',
  user_agent     text not null default '',
  revoked_at     timestamptz,
  revoked_reason text
);
create index if not exists sessions_user on public.sessions (user_id);
create index if not exists sessions_last_seen on public.sessions (last_seen_at);

create table if not exists public.login_attempts (
  id             bigserial primary key,
  username_lower text not null,
  ip             text not null,
  at             timestamptz not null default now(),
  success        boolean not null default false
);
create index if not exists login_attempts_user_at on public.login_attempts (username_lower, at desc);
create index if not exists login_attempts_ip_at on public.login_attempts (ip, at desc);

-- Fixed-window counters for anonymous endpoints (reviews, bookings, chat).
create table if not exists public.rate_limits (
  key          text primary key,
  window_start timestamptz not null,
  count        integer not null default 0
);

-- ---------------------------------------------------------------------------
-- the house itself
-- ---------------------------------------------------------------------------
create table if not exists public.house (
  id                 integer primary key check (id = 1),
  name               text not null default 'Red Moon Pub',
  address            text not null default '',
  phone              text not null default '',
  registration       text not null default '',
  owner_user_id      uuid references public.staff_accounts (id) on delete set null,
  hourly_wage        integer not null default 1800 check (hourly_wage >= 0),
  transfer_account   text not null default '',
  transfer_name      text not null default '',
  pub_open           boolean not null default false,
  pub_opened_at      timestamptz,
  pub_opened_by      uuid,
  pub_opened_by_name text not null default '',
  pub_note           text not null default '',
  pub_closed_at      timestamptz,
  revenue_reset_at   timestamptz,
  activity_reset_at  timestamptz,
  updated_at         timestamptz not null default now()
);
insert into public.house (id) values (1) on conflict (id) do nothing;
drop trigger if exists house_updated_at on public.house;
create trigger house_updated_at before update on public.house
  for each row execute function public.set_updated_at();

-- Public "family tree" shown on the about page and the home page.
create table if not exists public.house_people (
  id         uuid primary key default gen_random_uuid(),
  name       text not null,
  title      text not null default '',
  note       text not null default '',
  monogram   text not null default '',
  tier       text not null default 'manager' check (tier in ('owner','co-owner','manager','staff')),
  sort_order integer not null default 0,
  active     boolean not null default true,
  created_at timestamptz not null default now()
);

-- ---------------------------------------------------------------------------
-- catalogue
-- ---------------------------------------------------------------------------
create table if not exists public.products (
  id          text primary key,
  name        text not null,
  category    text not null default 'drink' check (category in ('drink','food')),
  section     text not null default 'other',
  price       integer not null default 0 check (price >= 0),
  stock       integer not null default 0 check (stock >= 0),
  min_stock   integer not null default 0 check (min_stock >= 0),
  image       text not null default '',
  subtitle    text not null default '',
  description text not null default '',
  active      boolean not null default true,
  sort_order  integer not null default 0,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);
create index if not exists products_active on public.products (active, section);
drop trigger if exists products_updated_at on public.products;
create trigger products_updated_at before update on public.products
  for each row execute function public.set_updated_at();

create table if not exists public.signature_drinks (
  slot        smallint primary key check (slot between 1 and 3),
  product_id  text not null references public.products (id) on delete cascade,
  description text not null default '',
  updated_at  timestamptz not null default now(),
  updated_by  uuid
);

-- ---------------------------------------------------------------------------
-- shifts and the register
-- ---------------------------------------------------------------------------
create table if not exists public.shifts (
  id               text primary key,
  status           text not null default 'open' check (status in ('open','closed')),
  started_at       timestamptz not null default now(),
  ended_at         timestamptz,
  started_by       uuid,
  started_by_name  text not null default '',
  closed_by        uuid,
  closed_by_name   text not null default '',
  opening_cash     integer not null default 0,
  closing_cash     integer,
  revenue          integer not null default 0,
  cash_revenue     integer not null default 0,
  transfer_revenue integer not null default 0,
  sales_count      integer not null default 0,
  items            integer not null default 0,
  notes            text not null default '',
  closure          jsonb,
  cart_counters    jsonb not null default '{}'::jsonb
);
create unique index if not exists shifts_single_open on public.shifts ((status)) where status = 'open';
create index if not exists shifts_started_at on public.shifts (started_at desc);

create table if not exists public.shift_members (
  id             uuid primary key default gen_random_uuid(),
  shift_id       text not null references public.shifts (id) on delete cascade,
  user_id        uuid references public.staff_accounts (id) on delete set null,
  name           text not null,
  joined_at      timestamptz not null default now(),
  joined_by      uuid,
  joined_by_name text not null default '',
  reason         text not null default '',
  left_at        timestamptz
);
create index if not exists shift_members_shift on public.shift_members (shift_id);
create unique index if not exists shift_members_unique on public.shift_members (shift_id, user_id) where user_id is not null;

create table if not exists public.sales (
  id             uuid primary key default gen_random_uuid(),
  transaction_id uuid not null,
  cart_id        text not null default '',
  at             timestamptz not null default now(),
  shift_id       text references public.shifts (id) on delete cascade,
  user_id        uuid,
  user_name      text not null default '',
  product_id     text not null,
  product_name   text not null,
  category       text not null default 'drink',
  qty            integer not null check (qty > 0),
  unit_price     integer not null default 0,
  total          integer not null default 0,
  payment_method text not null default 'cash' check (payment_method in ('cash','transfer')),
  receipt_id     text,
  invoice_id     text
);
create index if not exists sales_at on public.sales (at desc);
create index if not exists sales_shift on public.sales (shift_id);
create index if not exists sales_transaction on public.sales (transaction_id);
create index if not exists sales_user on public.sales (user_id);

create table if not exists public.documents (
  id              text primary key,
  type            text not null check (type in ('receipt','invoice')),
  created_at      timestamptz not null default now(),
  created_by      uuid,
  created_by_name text not null default '',
  sale_id         uuid,
  transaction_id  uuid,
  shift_id        text,
  customer        jsonb not null default '{}'::jsonb,
  seller          jsonb not null default '{}'::jsonb,
  items           jsonb not null default '[]'::jsonb,
  total           integer not null default 0,
  payment_method  text not null default 'cash'
);
create index if not exists documents_created on public.documents (created_at desc);
create index if not exists documents_transaction on public.documents (transaction_id);

-- ---------------------------------------------------------------------------
-- stock movements, supply runs, expenses
-- ---------------------------------------------------------------------------
create table if not exists public.restock_logs (
  id           uuid primary key default gen_random_uuid(),
  at           timestamptz not null default now(),
  user_id      uuid,
  user_name    text not null default '',
  product_id   text not null,
  product_name text not null,
  qty          integer not null,
  unit_cost    integer not null default 0,
  total_cost   integer not null default 0,
  source       text not null default '',
  note         text not null default '',
  order_id     uuid
);
create index if not exists restock_logs_at on public.restock_logs (at desc);

create table if not exists public.supply_orders (
  id                uuid primary key default gen_random_uuid(),
  code              text not null unique,
  at                timestamptz not null default now(),
  created_by        uuid,
  created_by_name   text not null default '',
  estimated_total   integer not null default 0,
  source            text not null default '',
  note              text not null default '',
  status            text not null default 'open' check (status in ('open','claimed','progress','completed','cancelled')),
  claimed_by        uuid,
  claimed_by_name   text,
  claimed_at        timestamptz,
  started_at        timestamptz,
  completed_by      uuid,
  completed_by_name text,
  completed_at      timestamptz,
  actual_total      integer,
  variance          integer,
  variance_note     text not null default ''
);
create index if not exists supply_orders_at on public.supply_orders (at desc);
create index if not exists supply_orders_status on public.supply_orders (status);

create table if not exists public.supply_order_items (
  id            uuid primary key default gen_random_uuid(),
  order_id      uuid not null references public.supply_orders (id) on delete cascade,
  product_id    text not null,
  product_name  text not null,
  qty           integer not null,
  unit_cost     integer not null default 0,
  line_estimate integer not null default 0
);
create index if not exists supply_order_items_order on public.supply_order_items (order_id);

create table if not exists public.expenses (
  id      uuid primary key default gen_random_uuid(),
  at      timestamptz not null default now(),
  kind    text not null default 'other',
  ref     text not null default '',
  amount  integer not null default 0,
  by_user uuid,
  by_name text not null default '',
  note    text not null default ''
);
create index if not exists expenses_at on public.expenses (at desc);

-- ---------------------------------------------------------------------------
-- guests: bookings, applications, reviews
-- ---------------------------------------------------------------------------
create table if not exists public.reservations (
  id              uuid primary key default gen_random_uuid(),
  code            text not null,
  at              timestamptz not null default now(),
  starts_at       timestamptz not null,
  name            text not null,
  phone           text not null default '',
  guests          integer not null default 1,
  occasion        text not null default 'este',
  tier            text not null default 'none',
  note            text not null default '',
  status          text not null default 'pending' check (status in ('pending','confirmed','declined','seated','cancelled','noshow')),
  handled_at      timestamptz,
  handled_by_name text,
  staff_note      text not null default '',
  visitor_hash    text not null
);
create index if not exists reservations_visitor on public.reservations (visitor_hash);
create index if not exists reservations_starts on public.reservations (starts_at);

create table if not exists public.applications (
  id              uuid primary key default gen_random_uuid(),
  code            text not null,
  at              timestamptz not null default now(),
  name            text not null,
  phone           text not null default '',
  age             integer not null default 18,
  radio           text not null default '',
  position        text not null,
  availability    text not null default '',
  experience      text not null default '',
  why             text not null default '',
  status          text not null default 'pending' check (status in ('pending','interview','accepted','rejected','withdrawn')),
  handled_at      timestamptz,
  handled_by_name text,
  staff_note      text not null default '',
  visitor_hash    text not null
);
create index if not exists applications_visitor on public.applications (visitor_hash);
create index if not exists applications_at on public.applications (at desc);

create table if not exists public.reviews (
  id           uuid primary key default gen_random_uuid(),
  name         text not null,
  rating       integer not null check (rating between 1 and 5),
  text         text not null,
  phone        text not null default '',
  at           timestamptz not null default now(),
  updated_at   timestamptz,
  status       text not null default 'published' check (status in ('published','hidden')),
  visitor_hash text not null
);
create unique index if not exists reviews_visitor on public.reviews (visitor_hash);
create index if not exists reviews_at on public.reviews (at desc);

-- ---------------------------------------------------------------------------
-- events, map
-- ---------------------------------------------------------------------------
create table if not exists public.events (
  id              uuid primary key default gen_random_uuid(),
  title           text not null,
  subtitle        text not null default '',
  description     text not null default '',
  place           text not null default 'Red Moon Pub',
  starts_at       timestamptz not null,
  ends_at         timestamptz,
  tag             text not null default '',
  cover_image     text not null default '',
  entry_fee       integer,
  dress_code      text not null default '',
  featured        boolean not null default false,
  active          boolean not null default true,
  created_by      uuid,
  created_by_name text not null default '',
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);
create index if not exists events_starts on public.events (starts_at);
drop trigger if exists events_updated_at on public.events;
create trigger events_updated_at before update on public.events
  for each row execute function public.set_updated_at();

create table if not exists public.map_blips (
  id              text primary key,
  x               double precision not null,
  y               double precision not null,
  kind            text not null default 'custom',
  icon            integer not null default 1,
  label           text not null,
  description     text not null default '',
  group_name      text not null default 'Red Moon',
  active          boolean not null default true,
  created_by      uuid,
  created_by_name text not null default '',
  created_at      timestamptz not null default now()
);

-- ---------------------------------------------------------------------------
-- notifications, audit
-- ---------------------------------------------------------------------------
create table if not exists public.notifications (
  id       uuid primary key default gen_random_uuid(),
  at       timestamptz not null default now(),
  audience text[] not null default '{owner}',
  title    text not null,
  message  text not null default '',
  meta     jsonb not null default '{}'::jsonb
);
create index if not exists notifications_at on public.notifications (at desc);

create table if not exists public.notification_reads (
  notification_id uuid not null references public.notifications (id) on delete cascade,
  user_id         uuid not null references public.staff_accounts (id) on delete cascade,
  read_at         timestamptz not null default now(),
  primary key (notification_id, user_id)
);

create table if not exists public.audit_log (
  id        uuid primary key default gen_random_uuid(),
  at        timestamptz not null default now(),
  user_id   uuid,
  user_name text not null default '',
  role      text not null default '',
  action    text not null,
  details   text not null default ''
);
create index if not exists audit_log_at on public.audit_log (at desc);

-- ---------------------------------------------------------------------------
-- the club (live page + DJ booth)
-- ---------------------------------------------------------------------------
create table if not exists public.club_state (
  id           integer primary key check (id = 1),
  live         boolean not null default false,
  dj_user_id   uuid,
  dj_name      text not null default '',
  title        text not null default '',
  started_at   timestamptz,
  current      jsonb,
  provider     text not null default 'gocast',
  provider_url text not null default 'https://gocast.fm/station/red-moon-pub',
  updated_at   timestamptz not null default now()
);
insert into public.club_state (id) values (1) on conflict (id) do nothing;

create table if not exists public.club_tracks (
  id            text primary key,
  name          text not null,
  url           text not null,
  storage_key   text,
  size          integer not null default 0,
  added_by_name text not null default '',
  added_at      timestamptz not null default now()
);

create table if not exists public.club_queue (
  id            uuid primary key default gen_random_uuid(),
  position      bigserial,
  track_id      text not null references public.club_tracks (id) on delete cascade,
  name          text not null,
  url           text not null,
  added_by_name text not null default '',
  request_id    uuid,
  added_at      timestamptz not null default now()
);

create table if not exists public.club_chat (
  id           uuid primary key default gen_random_uuid(),
  at           timestamptz not null default now(),
  name         text not null,
  text         text not null,
  kind         text not null default 'chat',
  request_id   uuid,
  ip           text,
  browser_hash text
);
create index if not exists club_chat_at on public.club_chat (at desc);

create table if not exists public.club_requests (
  id              uuid primary key default gen_random_uuid(),
  at              timestamptz not null default now(),
  name            text not null,
  ip              text,
  browser_hash    text,
  item            jsonb not null,
  status          text not null default 'pending' check (status in ('pending','accepted','declined')),
  handled_by_name text,
  handled_at      timestamptz
);

create table if not exists public.club_name_requests (
  id              uuid primary key default gen_random_uuid(),
  client_id       text not null,
  browser_hash    text not null,
  name            text not null,
  ip              text not null,
  at              timestamptz not null default now(),
  status          text not null default 'pending' check (status in ('pending','accepted','declined')),
  handled_by_name text,
  handled_at      timestamptz,
  retry_at        timestamptz
);
create index if not exists club_name_requests_ip on public.club_name_requests (ip, status);

create table if not exists public.club_listeners (
  id           uuid primary key default gen_random_uuid(),
  token_hash   text not null,
  name         text not null,
  ip           text not null,
  browser_hash text not null,
  approved_at  timestamptz not null default now(),
  expires_at   timestamptz not null
);
create index if not exists club_listeners_ip on public.club_listeners (ip, expires_at);

create table if not exists public.club_bans (
  id           uuid primary key default gen_random_uuid(),
  ip           text not null,
  browser_hash text not null default '',
  until        timestamptz,
  minutes      integer not null default 60,
  reason       text not null default '',
  by_name      text not null default '',
  at           timestamptz not null default now()
);

create table if not exists public.club_presence (
  client_id text primary key,
  last_seen timestamptz not null default now()
);

-- ---------------------------------------------------------------------------
-- row level security: on everywhere, no policies, no grants for API roles
-- ---------------------------------------------------------------------------
do $$
declare t text;
begin
  for t in
    select tablename from pg_tables where schemaname = 'public'
  loop
    execute format('alter table public.%I enable row level security', t);
  end loop;

  if exists (select 1 from pg_roles where rolname = 'anon') then
    execute 'revoke all on all tables in schema public from anon';
    execute 'revoke all on all sequences in schema public from anon';
    execute 'revoke all on all functions in schema public from anon';
    execute 'alter default privileges in schema public revoke all on tables from anon';
    execute 'alter default privileges in schema public revoke all on sequences from anon';
    execute 'alter default privileges in schema public revoke all on functions from anon';
  end if;
  if exists (select 1 from pg_roles where rolname = 'authenticated') then
    execute 'revoke all on all tables in schema public from authenticated';
    execute 'revoke all on all sequences in schema public from authenticated';
    execute 'revoke all on all functions in schema public from authenticated';
    execute 'alter default privileges in schema public revoke all on tables from authenticated';
    execute 'alter default privileges in schema public revoke all on sequences from authenticated';
    execute 'alter default privileges in schema public revoke all on functions from authenticated';
  end if;
  -- The RLS auto-enable helper Supabase installs must not be callable over the API.
  if exists (select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
             where n.nspname = 'public' and p.proname = 'rls_auto_enable') then
    execute 'revoke execute on function public.rls_auto_enable() from public, anon, authenticated';
  end if;
  execute 'revoke execute on function public.set_updated_at() from public';
end $$;
