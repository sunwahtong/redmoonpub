-- ---------------------------------------------------------------------------
-- 0003 · every picture lives in the media store
-- ---------------------------------------------------------------------------
-- Profile pictures and signatures used to be kept inline (data: URLs and SVG
-- text). They now live in the media store like everything else, referenced
-- by URL plus the store's public id so a replaced or deleted picture can be
-- removed from the store as well. Event covers and product pictures gain the
-- same public id. The old inline columns are emptied by the server on first
-- start once a store is configured (see server/mediaMigrate.ts).

alter table public.staff_accounts add column if not exists avatar_public_id     text not null default '';
alter table public.staff_accounts add column if not exists signature_url        text not null default '';
alter table public.staff_accounts add column if not exists signature_public_id  text not null default '';

alter table public.events   add column if not exists cover_public_id text not null default '';
alter table public.products add column if not exists image_public_id text not null default '';
