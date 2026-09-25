-- ---------------------------------------------------------------------------
-- 0009 · the House card remembers its climb
-- ---------------------------------------------------------------------------
-- A member's card shows not just the tier of today but when each step was
-- reached. Every grant and every tier change appends {tier, at, by}; the
-- rows that exist already start their history with the grant itself.

alter table public.members add column if not exists tier_history jsonb not null default '[]'::jsonb;

update public.members
   set tier_history = jsonb_build_array(jsonb_build_object('tier', tier, 'at', granted_at, 'by', granted_by_name))
 where tier_history = '[]'::jsonb;
