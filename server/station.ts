/**
 * The GoCast station, watched from the server.
 *
 * The DJ broadcasts to gocast.fm from their own software. GoCast publishes a
 * small public JSON for every station (on air or not, listener count, the
 * track the stream metadata names) and a plain Icecast MP3 mount that any
 * browser plays in an ordinary audio element. This module reads the JSON at
 * most every 20 seconds — whichever request comes first claims the check,
 * the rest read what is stored — and applies two transitions:
 *
 *   station starts → the club goes live by itself, the house music steps
 *                    aside in every open browser and the popup offers play;
 *   station stops  → a show that started this way ends by itself.
 *
 * A show the DJ started by hand in the booth is theirs to end.
 */
import {broadcast} from './realtime.ts';
import type {Queryable, Row} from './types.ts';

export const DEFAULT_STATION_URL = 'https://gocast.fm/station/red-moon-pub';
const FETCH_TIMEOUT_MS = 4000;

export interface StationStatus {
  live: boolean;
  listeners: number;
  title: string;
  artist: string;
}

/** The station's slug from its page (or embed) address. */
export function stationSlug(providerUrl: unknown): string {
  const match = String(providerUrl || '').match(/gocast\.fm\/(?:station|embed)\/([a-z0-9-]+)/i);
  return match ? match[1].toLowerCase() : '';
}

/** The Icecast mount: MP3, playable by a plain <audio> element everywhere. */
export const stationStreamUrl = (slug: string): string => (slug ? `https://icecast.gocast.fm/stream/${slug}` : '');

/** GoCast's own player, for an iframe fallback. */
export const stationEmbedUrl = (slug: string): string => (slug ? `https://gocast.fm/embed/${slug}` : '');

/** What the site plays: the DJ's own stream address if set, else the station's mount. */
export const effectiveStreamUrl = (state: Row): string =>
  String(state.stream_url || '').trim() || stationStreamUrl(stationSlug(state.provider_url));

const clean = (value: unknown): string => String(value || '').trim().slice(0, 200);

async function probe(slug: string): Promise<StationStatus | null> {
  const response = await fetch(`https://api.gocast.fm/api/public/stations/${slug}/listeners`, {
    headers: {Accept: 'application/json'},
    signal: AbortSignal.timeout(FETCH_TIMEOUT_MS)
  });
  if (response.status === 404) return {live: false, listeners: 0, title: '', artist: ''};
  if (!response.ok) return null;
  const json = (await response.json()) as {data?: Record<string, unknown>};
  const data = json?.data || {};
  const playing = (data.now_playing || null) as {title?: unknown; artist?: unknown} | null;
  const artist = clean(playing?.artist);
  return {
    live: !!(data.is_on_air ?? data.is_live),
    listeners: Math.max(0, Number(data.count) || 0),
    title: clean(playing?.title),
    artist: /^unknown$/i.test(artist) ? '' : artist
  };
}

async function houseLine(db: Queryable, text: string): Promise<void> {
  const {rows} = await db.query(`insert into public.club_chat (name, text, kind, color) values ('Red Moon', $1, 'system', '') returning *`, [text]);
  const row = rows[0];
  await broadcast('club', 'chat', {message: {id: row.id, at: new Date(row.at).toISOString(), name: row.name, text: row.text, kind: 'system', color: '', requestId: null}});
}

async function startAutoShow(db: Queryable): Promise<void> {
  await db.query(
    `update public.club_state set live = true, auto_live = true, dj_user_id = null, dj_name = '',
       title = case when title = '' then 'Red Moon Live' else title end,
       started_at = now(), current = null, peak_listeners = 0, updated_at = now() where id = 1`
  );
  await houseLine(db, 'Elindult az adás a Red Moon állomásán.');
  await broadcast('club', 'state');
  await broadcast('house', 'live', {live: true});
}

async function endAutoShow(db: Queryable): Promise<void> {
  await db.query(
    `update public.club_state set live = false, auto_live = false, dj_user_id = null, dj_name = '', title = '',
       started_at = null, current = null, updated_at = now() where id = 1`
  );
  await houseLine(db, 'Az adás véget ért. Köszönjük, hogy itt voltál.');
  await broadcast('club', 'state');
  await broadcast('house', 'live', {live: false});
}

/** The stream metadata names a new track: it joins tonight's setlist. */
async function noteStationTrack(db: Queryable, status: StationStatus): Promise<void> {
  if (!status.title) return;
  const last = (await db.query<{title: string; artist: string}>('select title, artist from public.club_setlist order by at desc limit 1')).rows[0];
  if (last && last.title.toLowerCase() === status.title.toLowerCase() && last.artist.toLowerCase() === status.artist.toLowerCase()) return;
  await db.query(`insert into public.club_setlist (title, artist, source, by_name) values ($1, $2, 'station', 'GoCast')`, [status.title, status.artist]);
  await broadcast('club', 'setlist');
}

/**
 * Refreshes the station snapshot when it is older than 20 seconds and applies
 * the transitions. Cheap enough to sit in front of every status read: one
 * small fetch per 20 seconds across all instances, nothing otherwise.
 */
export async function syncStation(db: Queryable): Promise<void> {
  const claimed = await db.query<Row>(
    `update public.club_state set station_checked_at = now()
      where id = 1 and (station_checked_at is null or station_checked_at < now() - interval '20 seconds') returning *`
  );
  const state = claimed.rows[0];
  if (!state) return;
  const slug = stationSlug(state.provider_url);
  if (!slug) return;

  let status: StationStatus | null = null;
  try {
    status = await probe(slug);
  } catch (error) {
    console.warn('[station] check failed:', (error as Error).message);
  }
  if (!status) return;

  const wasLive = !!state.station_live;
  await db.query('update public.club_state set station_live = $1, station_listeners = $2, station_title = $3, station_artist = $4 where id = 1', [
    status.live,
    status.listeners,
    status.title,
    status.artist
  ]);

  let live = !!state.live;
  if (status.live && !wasLive && !live) {
    await startAutoShow(db);
    live = true;
  } else if (!status.live && wasLive && live && state.auto_live) {
    await endAutoShow(db);
    live = false;
  }
  if (live && status.live) await noteStationTrack(db, status);
}
