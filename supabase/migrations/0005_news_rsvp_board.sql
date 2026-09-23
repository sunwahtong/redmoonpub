-- ---------------------------------------------------------------------------
-- 0005 · news, "I'll be there", the staff board, and a silent station
-- ---------------------------------------------------------------------------
-- A show started by hand used to stay "live" forever if nobody pressed stop,
-- muting every visitor's music for a station that was not even streaming.
-- The server now remembers since when the station has been silent and ends
-- such a show after a grace period. Alongside: owner-written news posts for
-- the public site, a per-event "ott leszek" count, and an internal notice
-- board on the console dashboard.

alter table public.club_state add column if not exists station_offline_since timestamptz;

create table if not exists public.posts (
  id              uuid primary key default gen_random_uuid(),
  title           text not null,
  body            text not null default '',
  image_url       text not null default '',
  image_public_id text not null default '',
  pinned          boolean not null default false,
  active          boolean not null default true,
  published_at    timestamptz not null default now(),
  created_by      uuid,
  created_by_name text not null default '',
  updated_at      timestamptz not null default now()
);
create index if not exists posts_published on public.posts (pinned desc, published_at desc);

create table if not exists public.event_rsvps (
  event_id uuid not null references public.events (id) on delete cascade,
  visitor  text not null,
  at       timestamptz not null default now(),
  primary key (event_id, visitor)
);

create table if not exists public.staff_notes (
  id      uuid primary key default gen_random_uuid(),
  at      timestamptz not null default now(),
  text    text not null,
  by_id   uuid,
  by_name text not null default '',
  pinned  boolean not null default false
);
create index if not exists staff_notes_at on public.staff_notes (pinned desc, at desc);

alter table public.posts enable row level security;
alter table public.event_rsvps enable row level security;
alter table public.staff_notes enable row level security;
