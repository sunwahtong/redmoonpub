-- ---------------------------------------------------------------------------
-- 0007 · the floor plan and tables on bookings
-- ---------------------------------------------------------------------------
-- A booking may ask for one table of the plan; the table's label is kept
-- with it so old bookings still read well after the plan changes. The plan
-- itself is one jsonb document the owner edits (the default lives in code).

alter table public.reservations add column if not exists table_id    text not null default '';
alter table public.reservations add column if not exists table_label text not null default '';

-- Availability asks "which confirmed bookings hold a table around this time";
-- only rows with a table matter, so the index is partial.
create index if not exists reservations_table_time on public.reservations (table_id, starts_at) where table_id <> '';

create table if not exists public.floor_plans (
  id              text primary key,
  plan            jsonb not null,
  updated_at      timestamptz not null default now(),
  updated_by_name text not null default ''
);

alter table public.floor_plans enable row level security;
