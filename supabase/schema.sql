-- Red Moon Pub — Supabase / PostgreSQL schema
--
-- The application creates all of this by itself on first start, so running this
-- file is optional. It exists for two reasons:
--
--   1. so the schema can be reviewed before anything is deployed,
--   2. so it can be applied by hand if the deployment user is later restricted
--      to a role that may not create tables.
--
-- It is safe to run more than once.
--
-- Where to run it: Supabase dashboard -> SQL Editor -> New query -> paste -> Run.

-- ---------------------------------------------------------------------------
-- Application state
-- ---------------------------------------------------------------------------
-- The whole application state is one JSONB document in a single row.
--
-- This is deliberate and it is the existing shape, not a new decision: the
-- server was written against data/seed.json and every route reads and writes
-- that object as a whole. Splitting it into relational tables would be a
-- rewrite of every route, and the FiveM side already reads this same document.
--
-- `rev` is an optimistic-concurrency counter. On a single long-lived server it
-- only ever increments. On serverless it is what stops two concurrent
-- invocations from overwriting each other's sale: a write only succeeds if the
-- row is still the revision that invocation read.
CREATE TABLE IF NOT EXISTS red_moon_state (
    id         INTEGER PRIMARY KEY,
    data       JSONB       NOT NULL,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE red_moon_state
    ADD COLUMN IF NOT EXISTS rev BIGINT NOT NULL DEFAULT 0;

-- ---------------------------------------------------------------------------
-- Staff sessions
-- ---------------------------------------------------------------------------
-- Logged-in staff sessions, keyed by the value of the rm_session cookie.
--
-- On a single server these could stay in memory, and they do. On serverless
-- they cannot: the invocation that checks a session is almost never the one
-- that created it, so a memory-only session would log the user straight back
-- out. `data` holds the same object the in-memory map holds — user id, name,
-- role, portal, last seen timestamp, IP.
CREATE TABLE IF NOT EXISTS red_moon_sessions (
    sid       TEXT PRIMARY KEY,
    data      JSONB       NOT NULL,
    last_seen TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Expired sessions are swept by time, so this index is the one that matters.
CREATE INDEX IF NOT EXISTS red_moon_sessions_last_seen
    ON red_moon_sessions (last_seen);

-- ---------------------------------------------------------------------------
-- Row level security
-- ---------------------------------------------------------------------------
-- Both tables are reached only by the Node backend over the direct PostgreSQL
-- connection, which uses the database role and bypasses PostgREST entirely.
-- Nothing in the browser ever holds a Supabase key for these tables.
--
-- RLS is still enabled with no policy, so that if the anon or authenticated
-- PostgREST roles are ever pointed at this database, they read nothing rather
-- than reading every password hash in the building.
ALTER TABLE red_moon_state    ENABLE ROW LEVEL SECURITY;
ALTER TABLE red_moon_sessions ENABLE ROW LEVEL SECURITY;

-- ---------------------------------------------------------------------------
-- Housekeeping
-- ---------------------------------------------------------------------------
-- Optional. Sessions older than the 12 hour window are dead weight. Run it by
-- hand now and then, or schedule it with pg_cron if that extension is enabled.
--
--   DELETE FROM red_moon_sessions WHERE last_seen < NOW() - INTERVAL '12 hours';
