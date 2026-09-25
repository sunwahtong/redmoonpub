-- ---------------------------------------------------------------------------
-- 0010 · the House opens its inner rooms
-- ---------------------------------------------------------------------------
-- A member's card now opens more than a booking: invitations to closed
-- evenings (events with a minimum tier), a secret drink list (products with
-- a minimum tier, and a Royal's own named drink), a line to the house
-- (messages between a member and the console), a guest list on a Royal's
-- booking, and a crest next to their name in the club's chat and requests.
-- The card is presented once and then remembered by a session token, stored
-- hashed, a month long.

alter table public.events add column if not exists min_tier text not null default '';
alter table public.events drop constraint if exists events_min_tier_check;
alter table public.events add constraint events_min_tier_check check (min_tier in ('', 'silver', 'gold', 'black', 'royal'));

alter table public.products add column if not exists min_tier text not null default '';
alter table public.products drop constraint if exists products_min_tier_check;
alter table public.products add constraint products_min_tier_check check (min_tier in ('', 'silver', 'gold', 'black', 'royal'));
alter table public.products add column if not exists member_code text not null default '';

alter table public.reservations add column if not exists guest_list text not null default '';

alter table public.club_chat add column if not exists tier text not null default '';
alter table public.club_requests add column if not exists tier text not null default '';

create table if not exists public.member_sessions (
  token_hash  text primary key,
  member_id   uuid not null references public.members (id) on delete cascade,
  created_at  timestamptz not null default now(),
  expires_at  timestamptz not null
);
create index if not exists member_sessions_member on public.member_sessions (member_id, created_at desc);

create table if not exists public.member_messages (
  id         uuid primary key default gen_random_uuid(),
  member_id  uuid not null references public.members (id) on delete cascade,
  at         timestamptz not null default now(),
  from_house boolean not null default false,
  by_name    text not null default '',
  kind       text not null default 'uzenet',
  text       text not null,
  meta       jsonb not null default '{}'::jsonb,
  read_at    timestamptz
);
create index if not exists member_messages_member on public.member_messages (member_id, at desc);
create index if not exists member_messages_unread on public.member_messages (member_id) where read_at is null;

alter table public.member_sessions enable row level security;
alter table public.member_messages enable row level security;
