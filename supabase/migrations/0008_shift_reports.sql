-- ---------------------------------------------------------------------------
-- 0008 · the closing report every member of a shift receives
-- ---------------------------------------------------------------------------
-- When a shift closes, each person who worked it (and whoever closed it)
-- gets one row: what they sold, so they know what to transfer to the
-- house. It stays unseen until they open it, which is how the site knows
-- to show it to them next time, wherever they are.

create table if not exists public.shift_reports (
  id             uuid primary key default gen_random_uuid(),
  shift_id       text not null references public.shifts (id) on delete cascade,
  user_id        uuid not null references public.staff_accounts (id) on delete cascade,
  user_name      text not null,
  amount         integer not null default 0,
  sales_count    integer not null default 0,
  items          integer not null default 0,
  closed_at      timestamptz not null,
  closed_by_name text not null default '',
  seen_at        timestamptz,
  created_at     timestamptz not null default now(),
  unique (shift_id, user_id)
);

-- "What is waiting for me" is the only hot question; the seen rows are history.
create index if not exists shift_reports_unseen on public.shift_reports (user_id) where seen_at is null;

alter table public.shift_reports enable row level security;
