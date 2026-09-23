-- ===========================================================================
-- Red Moon Pub — 0002
--
-- Club colours and the live stream, reservation progress and messaging, the
-- editable gallery, manual signatures with locking, issued document records,
-- and the retirement of the hourly wage. Idempotent, like 0001.
-- ===========================================================================

-- --------------------------------------------------------------------------
-- Club: a stream the site can play, and a colour per listener
-- --------------------------------------------------------------------------
alter table public.club_state add column if not exists stream_url text not null default '';
alter table public.club_listeners add column if not exists color text not null default '';
alter table public.club_chat add column if not exists color text not null default '';
alter table public.club_requests add column if not exists color text not null default '';

-- --------------------------------------------------------------------------
-- Reservations: two more stages, and a message thread per booking
-- --------------------------------------------------------------------------
alter table public.reservations drop constraint if exists reservations_status_check;
alter table public.reservations add constraint reservations_status_check
  check (status in ('pending','reviewing','waitlist','confirmed','declined','seated','cancelled','noshow'));
alter table public.reservations add column if not exists updated_at timestamptz not null default now();

create table if not exists public.reservation_messages (
  id             uuid primary key default gen_random_uuid(),
  reservation_id uuid not null references public.reservations (id) on delete cascade,
  at             timestamptz not null default now(),
  author         text not null check (author in ('guest','staff')),
  author_name    text not null default '',
  text           text not null,
  read_by_guest  boolean not null default false,
  read_by_staff  boolean not null default false
);
create index if not exists reservation_messages_reservation on public.reservation_messages (reservation_id, at);

-- --------------------------------------------------------------------------
-- Gallery, edited by the owner
-- --------------------------------------------------------------------------
create table if not exists public.gallery_items (
  id              uuid primary key default gen_random_uuid(),
  title           text not null default '',
  caption         text not null default '',
  tag             text not null default 'este' check (tag in ('ter','este','jel')),
  image_url       text not null,
  public_id       text not null default '',
  width           integer not null default 0,
  height          integer not null default 0,
  sort_order      integer not null default 0,
  active          boolean not null default true,
  created_by      uuid,
  created_by_name text not null default '',
  created_at      timestamptz not null default now()
);
create index if not exists gallery_items_order on public.gallery_items (active, sort_order);

-- --------------------------------------------------------------------------
-- Signatures: chosen by the person, locked once a document carries them
-- --------------------------------------------------------------------------
alter table public.staff_accounts add column if not exists signature_kind text not null default 'generated';
alter table public.staff_accounts add column if not exists signature_locked_at timestamptz;
alter table public.staff_accounts add column if not exists signature_decided boolean not null default false;

create table if not exists public.issued_documents (
  id                 uuid primary key default gen_random_uuid(),
  at                 timestamptz not null default now(),
  kind               text not null,
  reference          text not null,
  issuer_id          uuid references public.staff_accounts (id) on delete set null,
  issuer_name        text not null default '',
  countersigner_id   uuid references public.staff_accounts (id) on delete set null,
  countersigner_name text not null default '',
  stored_document_id text
);
create index if not exists issued_documents_at on public.issued_documents (at desc);

-- --------------------------------------------------------------------------
-- The hourly wage is retired
-- --------------------------------------------------------------------------
alter table public.house drop column if exists hourly_wage;

-- --------------------------------------------------------------------------
-- Vocabulary: "üzletvezető" is "manager" now
-- --------------------------------------------------------------------------
update public.house_people
   set title = replace(replace(title, 'Üzletvezető', 'Manager'), 'üzletvezető', 'manager'),
       note  = replace(replace(note,  'Üzletvezető', 'Manager'), 'üzletvezető', 'manager')
 where title like '%zletvezet%' or note like '%zletvezet%';
update public.staff_accounts
   set title = replace(replace(title, 'Üzletvezető', 'Manager'), 'üzletvezető', 'manager')
 where title like '%zletvezet%';

-- --------------------------------------------------------------------------
-- Security posture for the new tables: RLS on, API roles hold nothing
-- --------------------------------------------------------------------------
do $$
declare t text;
begin
  for t in
    select tablename from pg_tables where schemaname = 'public'
      and tablename in ('reservation_messages', 'gallery_items', 'issued_documents')
  loop
    execute format('alter table public.%I enable row level security', t);
  end loop;
  if exists (select 1 from pg_roles where rolname = 'anon') then
    execute 'revoke all on all tables in schema public from anon';
    execute 'revoke all on all sequences in schema public from anon';
  end if;
  if exists (select 1 from pg_roles where rolname = 'authenticated') then
    execute 'revoke all on all tables in schema public from authenticated';
    execute 'revoke all on all sequences in schema public from authenticated';
  end if;
end $$;
