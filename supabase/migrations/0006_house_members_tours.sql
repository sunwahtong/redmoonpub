-- ---------------------------------------------------------------------------
-- 0006 · four jobs, the House membership, the featured film, the tour
-- ---------------------------------------------------------------------------
-- The staff vocabulary shrinks to the four posts the house actually has
-- (bartender, DJ, security, manager); anything else is stripped from every
-- account. The House becomes real: members with a code and a tier, granted
-- by the house, recognised at booking. The owner can pin a film to the home
-- page. Each account remembers which parts of the guided tour it has seen.

update public.staff_accounts
   set jobs = array(select j from unnest(jobs) as j where j = any (array['bartender', 'biztonsag', 'dj', 'uzletvezeto']))
 where exists (select 1 from unnest(jobs) as j where j <> all (array['bartender', 'biztonsag', 'dj', 'uzletvezeto']));

alter table public.staff_accounts add column if not exists tours jsonb not null default '{}'::jsonb;

alter table public.house add column if not exists featured_video         text not null default '';
alter table public.house add column if not exists featured_video_title   text not null default '';
alter table public.house add column if not exists featured_video_caption text not null default '';

create table if not exists public.members (
  id              uuid primary key default gen_random_uuid(),
  code            text not null unique,
  name            text not null,
  phone           text not null default '',
  tier            text not null default 'silver' check (tier in ('silver','gold','black','royal')),
  note            text not null default '',
  active          boolean not null default true,
  visits          integer not null default 0,
  last_visit_at   timestamptz,
  granted_by      uuid,
  granted_by_name text not null default '',
  granted_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);
create index if not exists members_tier on public.members (tier, active);
create index if not exists members_phone on public.members (phone);

alter table public.reservations add column if not exists member_code text not null default '';
alter table public.reservations add column if not exists member_name text not null default '';

alter table public.club_reactions add column if not exists color text not null default '';

alter table public.members enable row level security;
