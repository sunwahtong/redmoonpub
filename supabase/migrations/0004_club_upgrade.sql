-- ---------------------------------------------------------------------------
-- 0004 · the club, upgraded
-- ---------------------------------------------------------------------------
-- The server now watches the GoCast station itself, so the site goes live the
-- moment the DJ starts streaming (and the house music steps aside), with the
-- station's listener count and "now playing" alongside. The room gains a
-- setlist, song-request votes and a public request board, polls, a pinned
-- notice, slow mode, emoji reactions and show statistics.

alter table public.club_state add column if not exists auto_live          boolean not null default false;
alter table public.club_state add column if not exists station_live       boolean not null default false;
alter table public.club_state add column if not exists station_checked_at timestamptz;
alter table public.club_state add column if not exists station_listeners  integer not null default 0;
alter table public.club_state add column if not exists station_title      text not null default '';
alter table public.club_state add column if not exists station_artist     text not null default '';
alter table public.club_state add column if not exists notice             text not null default '';
alter table public.club_state add column if not exists slow_mode_seconds  integer not null default 0;
alter table public.club_state add column if not exists requests_open      boolean not null default true;
alter table public.club_state add column if not exists peak_listeners     integer not null default 0;

-- A request can now also be "played".
alter table public.club_requests drop constraint if exists club_requests_status_check;
alter table public.club_requests add constraint club_requests_status_check check (status in ('pending','accepted','declined','played'));
alter table public.club_requests add column if not exists votes integer not null default 0;

create table if not exists public.club_request_votes (
  request_id uuid not null references public.club_requests (id) on delete cascade,
  voter      text not null,
  at         timestamptz not null default now(),
  primary key (request_id, voter)
);

create table if not exists public.club_polls (
  id         uuid primary key default gen_random_uuid(),
  question   text not null,
  options    jsonb not null,
  by_name    text not null default '',
  created_at timestamptz not null default now(),
  closes_at  timestamptz,
  closed_at  timestamptz
);
create index if not exists club_polls_created on public.club_polls (created_at desc);

create table if not exists public.club_poll_votes (
  poll_id   uuid not null references public.club_polls (id) on delete cascade,
  voter     text not null,
  option_id text not null,
  at        timestamptz not null default now(),
  primary key (poll_id, voter)
);

-- What was played tonight: announced by the DJ, started from the library,
-- a request marked played, or read from the station's stream metadata.
create table if not exists public.club_setlist (
  id         uuid primary key default gen_random_uuid(),
  at         timestamptz not null default now(),
  title      text not null,
  artist     text not null default '',
  source     text not null default 'announce' check (source in ('announce','library','request','station')),
  request_id uuid,
  by_name    text not null default ''
);
create index if not exists club_setlist_at on public.club_setlist (at desc);

create table if not exists public.club_reactions (
  id    bigserial primary key,
  at    timestamptz not null default now(),
  emoji text not null,
  voter text not null
);
create index if not exists club_reactions_at on public.club_reactions (at desc);

-- RLS on, no policies: only the API's own role reads these.
alter table public.club_request_votes enable row level security;
alter table public.club_polls enable row level security;
alter table public.club_poll_votes enable row level security;
alter table public.club_setlist enable row level security;
alter table public.club_reactions enable row level security;
