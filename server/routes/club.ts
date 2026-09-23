/**
 * The Red Moon Club: the public live page (player, chat, requests, polls,
 * reactions, setlist, approved names) and the DJ booth (stream, library,
 * queue, playback, announcements, moderation).
 *
 * Listeners are anonymous. A name is approved by whoever runs the booth and
 * tied to a hash of the browser id, an IP and a secret token; the raw token
 * only ever lives in that browser. Every approved listener gets a colour so
 * the chat reads like a room full of people, and the DJ speaks under their
 * nickname in the house red. Reactions, request votes and poll votes need no
 * name: a hash of the network and the browser id is enough to count once.
 *
 * The station itself is watched by ../station.ts: when it starts streaming
 * the club goes live on its own. Changes are pushed to open pages over
 * Realtime (see ../realtime.ts); the pages also poll slowly as a safety net.
 */
import crypto from 'node:crypto';
import {z} from 'zod';
import {audit, capabilitiesOf, rateLimit, requireUser} from '../auth.ts';
import {bad, clientIp, conflict, created, forbidden, iso, notFound, parse, readJson, readRaw, sha256, tooMany, type Router} from '../http.ts';
import {AUDIO_TYPES, cloudinaryEnabled, extensionOf, firstFilePart, isOurCloudinaryUrl, destroyMedia, localStoreAllowed, sanitizeFilename, signUpload, storeLocal} from '../media.ts';
import {broadcast} from '../realtime.ts';
import {config} from '../config.ts';
import {effectiveStreamUrl, stationEmbedUrl, stationSlug, syncStation} from '../station.ts';
import type {Queryable, Row, SessionUser, UserCtx} from '../types.ts';

const NAME_TTL_MS = 3 * 24 * 60 * 60 * 1000;
const DECLINE_RETRY_MS = 5 * 60 * 1000;
const CHAT_KEEP = 250;
const SLOW_MODES = [0, 5, 15, 30, 60];
const REACTIONS = ['🔥', '❤️', '🍻', '🎉', '👏', '🙌'];
/** Reactions pushed to every open page per minute, across the whole room. Beyond it they still count, quietly. */
const REACTION_PUSHES_PER_MINUTE = 40;

/** Listener colours. Chosen so any two read apart on the dark page. */
export const PALETTE = ['#ff5c7a', '#ff9f43', '#ffd166', '#2ee6a6', '#4cc9f0', '#5b8cff', '#c77dff', '#f472b6', '#9ef01a', '#ff8fab', '#00e5ff', '#ffb347'];
const DJ_COLOR = '#ff2b4f';

const browserHashOf = (clientId: unknown): string => (clientId ? sha256(String(clientId).trim().slice(0, 160)) : '');
const tokenHashOf = (token: unknown): string => (token ? sha256(String(token).trim().slice(0, 160)) : '');
const djName = (user: Pick<SessionUser, 'name' | 'nickname'>): string => user.nickname || user.name;

/** Who is voting or reacting: this network plus this browser, hashed. */
const voterOf = (ip: string, clientId: unknown): string => sha256(`${ip}|${browserHashOf(clientId)}`);

const requireModerator = (ctx: UserCtx): SessionUser => {
  const user = requireUser(ctx);
  if (!capabilitiesOf(user).dj) throw forbidden('Ehhez DJ jogosultság kell.');
  return user;
};

const isHex = (value: string): boolean => /^#[0-9a-f]{6}$/i.test(value);

function pickColor(taken: string[]): string {
  const free = PALETTE.filter((color) => !taken.includes(color));
  const pool = free.length ? free : PALETTE;
  return pool[crypto.randomInt(pool.length)];
}

function cleanUrl(value: unknown, max = 400): string {
  const raw = String(value || '').trim().slice(0, max);
  if (!raw) return '';
  if (!/^https?:\/\/[^\s]+$/i.test(raw)) throw bad('Adj meg egy teljes http(s) címet.');
  return raw;
}

/* ------------------------------------------------------------------ */
/* State                                                               */
/* ------------------------------------------------------------------ */

async function housekeeping(db: Queryable): Promise<void> {
  await db.query(`delete from public.club_chat where at < now() - interval '12 hours'`);
  await db.query(`delete from public.club_chat where id in (select id from public.club_chat order by at desc offset ${CHAT_KEEP})`);
  await db.query(`delete from public.club_presence where last_seen < now() - interval '40 seconds'`);
  await db.query(`delete from public.club_listeners where expires_at < now()`);
  await db.query(`delete from public.club_bans where until is not null and until < now()`);
  await db.query(`delete from public.club_name_requests where status <> 'pending' and at < now() - interval '1 day'`);
  await db.query(`delete from public.club_requests where status <> 'pending' and at < now() - interval '1 day'`);
  await db.query(`delete from public.club_reactions where at < now() - interval '10 minutes'`);
  await db.query(`delete from public.club_setlist where at < now() - interval '3 days'`);
  await db.query(`delete from public.club_polls where created_at < now() - interval '3 days'`);
}

const chatPublic = (row: Row) => ({
  id: row.id,
  at: iso(row.at),
  name: row.name,
  text: row.text,
  kind: row.kind || 'chat',
  color: row.color || (row.kind === 'dj' ? DJ_COLOR : ''),
  requestId: row.request_id || null
});
const chatModerator = (row: Row) => ({...chatPublic(row), ip: row.ip || null, browserHash: row.browser_hash || null});

const setlistOf = (row: Row) => ({id: row.id, at: iso(row.at), title: row.title, artist: row.artist || '', source: row.source, byName: row.by_name || '', requestId: row.request_id || null});

const requestPublic = (row: Row) => ({
  id: row.id,
  at: iso(row.at),
  name: row.name,
  color: row.color || '',
  status: row.status,
  votes: Number(row.votes) || 0,
  item: row.item ? {id: row.item.id, name: row.item.name, requestOnly: !!row.item.requestOnly} : null
});

async function pollOf(db: Queryable, row: Row | null | undefined) {
  if (!row) return null;
  const counts = (await db.query<{option_id: string; n: number}>('select option_id, count(*)::int as n from public.club_poll_votes where poll_id = $1 group by option_id', [row.id])).rows;
  const tally = Object.fromEntries(counts.map((entry) => [entry.option_id, entry.n]));
  const options = ((row.options || []) as {id: string; label: string}[]).map((option) => ({...option, votes: tally[option.id] || 0}));
  const closesAt = row.closes_at ? new Date(row.closes_at).getTime() : null;
  return {
    id: row.id,
    question: row.question,
    options,
    total: options.reduce((sum, option) => sum + option.votes, 0),
    byName: row.by_name || '',
    createdAt: iso(row.created_at),
    closesAt: iso(row.closes_at),
    closedAt: iso(row.closed_at),
    open: !row.closed_at && (!closesAt || closesAt > Date.now())
  };
}

async function latestPoll(db: Queryable) {
  const row = (await db.query(`select * from public.club_polls where created_at > now() - interval '4 hours' order by created_at desc limit 1`)).rows[0];
  return pollOf(db, row);
}

async function activeBan(db: Queryable, ip: string, browserHash = ''): Promise<Row | null> {
  const {rows} = await db.query(
    `select * from public.club_bans where ip = $1 and (browser_hash = '' or $2 = '' or browser_hash = $2) and (until is null or until > now())
     order by at desc limit 1`,
    [ip, browserHash]
  );
  return rows[0] || null;
}

async function trackById(db: Queryable, id: string): Promise<Row | null> {
  const {rows} = await db.query('select * from public.club_tracks where id = $1', [id]);
  return rows[0] || null;
}

async function identityOf(db: Queryable, token: unknown, ip: string): Promise<Row | null> {
  const {rows} = await db.query('select * from public.club_listeners where token_hash = $1 and ip = $2 and expires_at > now() limit 1', [tokenHashOf(token), ip]);
  return rows[0] || null;
}

const trackOf = (row: Row) => ({id: row.id, name: row.name, url: row.url, size: row.size, addedBy: row.added_by_name || '', addedAt: iso(row.added_at)});

interface PlayItem {
  id: string;
  trackId?: string;
  name: string;
  url: string;
  addedBy?: string;
}

const vibeOf = async (db: Queryable): Promise<number> => (await db.query<{n: number}>(`select count(*)::int as n from public.club_reactions where at > now() - interval '60 seconds'`)).rows[0].n;

export async function clubState(db: Queryable, {moderator = false}: {moderator?: boolean} = {}) {
  await housekeeping(db);
  await syncStation(db);
  const state = (await db.query('select * from public.club_state where id = 1')).rows[0];
  const [listeners, chat, people, setlist, poll, board, vibe, dj] = await Promise.all([
    db.query<{n: number}>('select count(*)::int as n from public.club_presence'),
    db.query('select * from public.club_chat order by at desc limit 80'),
    db.query('select name, color from public.club_listeners where expires_at > now() order by approved_at desc limit 200'),
    db.query(`select * from public.club_setlist where at > now() - interval '12 hours' order by at desc limit ${moderator ? 40 : 12}`),
    latestPoll(db),
    db.query(
      `select * from public.club_requests where at > now() - interval '8 hours' and status <> 'declined'
        order by case status when 'pending' then 0 when 'accepted' then 1 else 2 end, votes desc, at asc limit 30`
    ),
    vibeOf(db),
    state.dj_user_id ? db.query<{avatar: string}>('select avatar from public.staff_accounts where id = $1', [state.dj_user_id]) : Promise.resolve({rows: [] as {avatar: string}[]})
  ]);
  const slug = stationSlug(state.provider_url);
  const out = {
    serverNow: Date.now(),
    live: !!state.live,
    autoLive: !!state.auto_live,
    dj: (state.dj_name || null) as string | null,
    djAvatar: (dj.rows[0]?.avatar || '') as string,
    title: (state.title || '') as string,
    provider: (state.provider || 'gocast') as string,
    providerUrl: (state.provider_url || '') as string,
    streamUrl: effectiveStreamUrl(state),
    embedUrl: stationEmbedUrl(slug),
    startedAt: iso(state.started_at),
    listenerCount: listeners.rows[0].n,
    peakListeners: Number(state.peak_listeners) || 0,
    station: {
      slug,
      live: !!state.station_live,
      listeners: Number(state.station_listeners) || 0,
      nowPlaying: state.station_title ? {title: state.station_title as string, artist: (state.station_artist || '') as string} : null,
      checkedAt: iso(state.station_checked_at)
    },
    notice: (state.notice || '') as string,
    slowMode: Number(state.slow_mode_seconds) || 0,
    requestsOpen: state.requests_open !== false,
    vibe,
    people: people.rows.map((row) => ({name: row.name, color: row.color || PALETTE[0]})),
    current: (moderator ? state.current : state.current ? {name: state.current.name, addedBy: state.current.addedBy || ''} : null) as Row | null,
    setlist: setlist.rows.map(setlistOf),
    poll,
    requests: board.rows.map(requestPublic) as Row[],
    queue: [] as Row[],
    library: [] as Row[],
    chat: chat.rows.map(moderator ? chatModerator : chatPublic),
    nameRequests: [] as Row[],
    registeredListeners: [] as Row[],
    customStreamUrl: undefined as string | undefined
  };
  if (!moderator) return out;

  const [queue, library, requests, names, approved] = await Promise.all([
    db.query('select * from public.club_queue order by position asc limit 50'),
    db.query('select * from public.club_tracks order by added_at desc limit 200'),
    db.query('select * from public.club_requests order by at desc limit 100'),
    db.query(`select * from public.club_name_requests where status = 'pending' order by at desc limit 80`),
    db.query('select * from public.club_listeners where expires_at > now() order by approved_at desc limit 300')
  ]);
  const bans = (await db.query('select * from public.club_bans where until is null or until > now()')).rows;
  out.customStreamUrl = (state.stream_url || '') as string;
  out.queue = queue.rows.map((row) => ({id: row.id, trackId: row.track_id, name: row.name, url: row.url, addedBy: row.added_by_name || '', requestId: row.request_id || null, addedAt: iso(row.added_at)}));
  out.library = library.rows.map(trackOf);
  out.requests = requests.rows.map((row) => ({
    ...requestPublic(row),
    item: row.item || null,
    ip: row.ip || null,
    browserHash: row.browser_hash || null,
    handledBy: row.handled_by_name || null
  }));
  out.nameRequests = names.rows.map((row) => ({id: row.id, clientId: row.client_id, name: row.name, at: iso(row.at), status: row.status, ip: row.ip}));
  out.registeredListeners = approved.rows.map((row) => {
    const ban = bans.find((entry) => entry.ip === row.ip && (!entry.browser_hash || entry.browser_hash === row.browser_hash));
    return {name: row.name, color: row.color || '', ip: row.ip, browserHash: row.browser_hash, approvedAt: iso(row.approved_at), expiresAt: new Date(row.expires_at).getTime(), banned: !!ban, banUntil: ban?.until ? new Date(ban.until).getTime() : null};
  });
  return out;
}

/* ------------------------------------------------------------------ */
/* Routes                                                              */
/* ------------------------------------------------------------------ */

const chatBody = z.object({
  name: z.string().trim().min(1).max(32).optional(),
  text: z.string().trim().min(1, 'Az üzenet nem lehet üres.').max(500),
  token: z.string().trim().max(160).optional()
});

const liveBody = z.object({
  live: z.boolean(),
  title: z.string().trim().max(80).optional(),
  streamUrl: z.string().trim().max(400).optional(),
  providerUrl: z.string().trim().max(400).optional()
});

const announceBody = z.object({
  title: z.string().trim().min(1, 'Add meg a szám címét.').max(160),
  artist: z.string().trim().max(120).default('')
});

const pollBody = z.object({
  question: z.string().trim().min(3, 'Írd be a kérdést.').max(160),
  options: z.array(z.string().trim().min(1).max(60)).min(2, 'Legalább két válasz kell.').max(5),
  minutes: z.coerce.number().int().min(0).max(240).default(0)
});

const chatModeBody = z.object({
  slowSeconds: z.coerce.number().int().optional(),
  requestsOpen: z.boolean().optional()
});

export function registerClubRoutes(router: Router): void {
  const moderatorState = (db: Queryable) => clubState(db, {moderator: true});
  const pushClub = (event: string, payload: Record<string, unknown> = {}) => broadcast('club', event, payload);

  const houseLine = async (db: Queryable, text: string, kind = 'system', extra: {requestId?: string | null} = {}) => {
    const {rows} = await db.query(`insert into public.club_chat (name, text, kind, color, request_id) values ('Red Moon', $1, $2, '', $3) returning *`, [text, kind, extra.requestId || null]);
    await pushClub('chat', {message: chatPublic(rows[0])});
    return rows[0];
  };

  router.get('/api/club/state', async ({db, user}) => {
    const moderator = !!user && capabilitiesOf(user).dj;
    return {state: await clubState(db, {moderator})};
  });

  /** Presence heartbeat; also keeps the show's peak. */
  router.post('/api/club/listener', async ({db, req}) => {
    const body = await readJson(req);
    const id = String(body.id || '').trim().slice(0, 80);
    if (!id) throw bad('Hiányzó listener azonosító');
    await db.query('insert into public.club_presence (client_id, last_seen) values ($1, now()) on conflict (client_id) do update set last_seen = now()', [id]);
    await db.query(
      `update public.club_state set peak_listeners = greatest(peak_listeners, (select count(*)::int from public.club_presence where last_seen > now() - interval '40 seconds')) where id = 1 and live`
    );
    return {ok: true};
  });

  router.get('/api/club/name-status', async ({db, req, query}) => {
    const clientId = String(query.get('clientId') || '').trim();
    if (!clientId) throw bad('Hiányzó kliens azonosító');
    await housekeeping(db);
    const ip = clientIp(req);
    const browserHash = browserHashOf(clientId);
    const ban = await activeBan(db, ip, browserHash);
    if (ban) return {status: 'banned', until: ban.until ? new Date(ban.until).getTime() : null, reason: ban.reason || ''};

    const here = (await db.query('select * from public.club_listeners where ip = $1 and browser_hash = $2 and expires_at > now() limit 1', [ip, browserHash])).rows[0];
    if (here) {
      // Restore the identity to the same browser with a fresh secret.
      const fresh = crypto.randomBytes(32).toString('hex');
      await db.query('update public.club_listeners set token_hash = $2 where id = $1', [here.id, tokenHashOf(fresh)]);
      return {status: 'accepted', name: here.name, color: here.color || '', token: fresh, expiresAt: new Date(here.expires_at).getTime()};
    }
    const onIp = (await db.query('select name, expires_at from public.club_listeners where ip = $1 and expires_at > now() limit 1', [ip])).rows[0];
    if (onIp) return {status: 'already_named', name: onIp.name, expiresAt: new Date(onIp.expires_at).getTime()};
    const pending = (await db.query(`select name from public.club_name_requests where ip = $1 and status = 'pending' limit 1`, [ip])).rows[0];
    if (pending) return {status: 'pending', name: pending.name};
    const declined = (await db.query(`select name, retry_at from public.club_name_requests where ip = $1 and status = 'declined' order by handled_at desc limit 1`, [ip])).rows[0];
    if (declined?.retry_at && new Date(declined.retry_at).getTime() > Date.now()) {
      return {status: 'declined', name: declined.name, retryAt: new Date(declined.retry_at).getTime()};
    }
    return {status: 'none'};
  });

  router.post('/api/club/name-request', async ({db, req}) => {
    const body = await readJson(req);
    const name = String(body.name || '').trim().slice(0, 32);
    const clientId = String(body.clientId || '').trim().slice(0, 80);
    if (!name || !clientId) throw bad('Megjelenési név szükséges');
    const ip = clientIp(req);
    const browserHash = browserHashOf(clientId);
    await rateLimit(db, `club-name:${ip}`, 10, 10 * 60 * 1000);
    const ban = await activeBan(db, ip, browserHash);
    if (ban) throw forbidden(`A chat tiltva van${ban.until ? ` ${new Date(ban.until).toLocaleString('hu-HU')}-ig` : ''}. Indok: ${ban.reason || 'nincs megadva'}`);

    const here = (await db.query('select * from public.club_listeners where ip = $1 and browser_hash = $2 and expires_at > now() limit 1', [ip, browserHash])).rows[0];
    if (here) {
      const fresh = crypto.randomBytes(32).toString('hex');
      await db.query('update public.club_listeners set token_hash = $2 where id = $1', [here.id, tokenHashOf(fresh)]);
      return {approved: true, alreadyNamed: true, token: fresh, name: here.name, color: here.color || ''};
    }
    const onIp = (await db.query('select 1 from public.club_listeners where ip = $1 and expires_at > now() limit 1', [ip])).rows[0];
    if (onIp) throw conflict('Erről a hálózatról már van aktív név.');
    const pending = (await db.query(`select 1 from public.club_name_requests where ip = $1 and status = 'pending' limit 1`, [ip])).rows[0];
    if (pending) throw conflict('Már küldtél be névkérelmet, a DJ hamarosan dönt.');
    const declined = (await db.query(`select retry_at from public.club_name_requests where ip = $1 and status = 'declined' order by handled_at desc limit 1`, [ip])).rows[0];
    if (declined?.retry_at && new Date(declined.retry_at).getTime() > Date.now()) {
      const seconds = Math.max(1, Math.ceil((new Date(declined.retry_at).getTime() - Date.now()) / 1000));
      throw tooMany('A neved elutasították. 5 perc múlva tudsz újat kérni.', {retryAt: new Date(declined.retry_at).getTime(), seconds});
    }
    const {rows} = await db.query<{id: string}>('insert into public.club_name_requests (client_id, browser_hash, name, ip) values ($1, $2, $3, $4) returning id', [clientId, browserHash, name, ip]);
    await pushClub('names');
    return created({pending: true, requestId: rows[0].id});
  });

  /** A listener picks their own colour. */
  router.post('/api/club/color', async ({db, req}) => {
    const body = await readJson(req);
    const ip = clientIp(req);
    const identity = await identityOf(db, body.token, ip);
    if (!identity) throw forbidden('Előbb kérd a megjelenési neved jóváhagyását.');
    const color = String(body.color || '').trim().toLowerCase();
    if (!isHex(color)) throw bad('Érvénytelen szín.');
    await db.query('update public.club_listeners set color = $2 where id = $1', [identity.id, color]);
    await pushClub('names');
    return {ok: true, color};
  });

  router.post('/api/club/chat', async ({db, req, user}) => {
    const body = parse(chatBody, await readJson(req));
    const ip = clientIp(req);
    const moderator = !!user && capabilitiesOf(user).dj;
    let name = moderator ? djName(user!) : '';
    let color = moderator ? DJ_COLOR : '';
    let browserHash: string | null = null;
    if (!moderator) {
      const identity = await identityOf(db, body.token, ip);
      if (!identity || (body.name && identity.name !== body.name)) throw forbidden('Előbb kérd a megjelenési neved jóváhagyását a DJ-től.');
      name = identity.name;
      color = identity.color || PALETTE[0];
      browserHash = identity.browser_hash;
      const ban = await activeBan(db, ip, identity.browser_hash);
      if (ban) throw forbidden(`Chat tiltás aktív. Indok: ${ban.reason || 'nincs megadva'}`);
      // Slow mode stretches the pause between two lines from one person.
      const slow = (await db.query<{slow_mode_seconds: number}>('select slow_mode_seconds from public.club_state where id = 1')).rows[0]?.slow_mode_seconds || 0;
      await rateLimit(db, `club-chat:${ip}`, 1, Math.max(2500, slow * 1000));
    }
    const {rows} = await db.query('insert into public.club_chat (name, text, kind, color, ip, browser_hash) values ($1, $2, $3, $4, $5, $6) returning *', [
      name,
      body.text,
      moderator ? 'dj' : 'chat',
      color,
      ip,
      browserHash
    ]);
    const message = chatPublic(rows[0]);
    await pushClub('chat', {message});
    return created({ok: true, message});
  });

  router.delete('/api/club/chat/:id', async ({db, user, params}) => {
    const me = requireModerator({user});
    const {rows} = await db.query('delete from public.club_chat where id = $1 returning *', [params.id]);
    if (!rows[0]) throw notFound('Üzenet nem található');
    await audit(db, me, 'DJ_CHAT_DELETE', `${rows[0].name}: ${rows[0].text}`);
    await pushClub('chat_deleted', {id: params.id});
    return {ok: true};
  });

  /**
   * A reaction: one emoji, from anyone in the room. Every open page sees it
   * float up (pushed with the current vibe), within a room-wide budget so a
   * busy night cannot flood the realtime channel. Beyond the budget the tap
   * still counts toward the vibe meter.
   */
  router.post('/api/club/react', async ({db, req}) => {
    const body = await readJson(req);
    const emoji = String(body.emoji || '').trim();
    if (!REACTIONS.includes(emoji)) throw bad('Ismeretlen reakció.');
    const ip = clientIp(req);
    const voter = voterOf(ip, body.clientId);
    await rateLimit(db, `club-react:${voter}`, 1, 2500);
    await db.query('insert into public.club_reactions (emoji, voter) values ($1, $2)', [emoji, voter]);
    const vibe = await vibeOf(db);
    let pushed = true;
    try {
      await rateLimit(db, 'club-react:room', REACTION_PUSHES_PER_MINUTE, 60_000);
    } catch {
      pushed = false;
    }
    if (pushed) {
      const identity = body.token ? await identityOf(db, body.token, ip) : null;
      await pushClub('reaction', {emoji, color: identity?.color || '', vibe});
    }
    return {ok: true, vibe, pushed};
  });

  /** A listener asks for a song: one from the library, or any title in words. */
  router.post('/api/club/request', async ({db, req}) => {
    const body = await readJson(req);
    const ip = clientIp(req);
    const identity = await identityOf(db, body.token, ip);
    if (!identity) throw forbidden('Érvényes névjóváhagyás szükséges');
    const ban = await activeBan(db, ip, identity.browser_hash);
    if (ban) throw forbidden(`Chat tiltás aktív. Indok: ${ban.reason || 'nincs megadva'}`);
    const open = (await db.query<{requests_open: boolean}>('select requests_open from public.club_state where id = 1')).rows[0]?.requests_open !== false;
    if (!open) throw conflict('A DJ most lezárta a kéréseket. Figyeld a chatet, mikor nyitja újra.');
    await rateLimit(db, `club-request:${ip}`, 1, 15000);
    let item: {id: string; name: string; url: string; requestOnly?: boolean} | null = null;
    if (body.trackId) {
      const track = await trackById(db, String(body.trackId));
      if (track) item = {id: track.id, name: track.name, url: track.url};
    }
    if (!item && body.title) {
      const title = String(body.title).trim().slice(0, 120);
      if (title) item = {id: `text_${crypto.randomUUID()}`, name: title, url: '', requestOnly: true};
    }
    if (!item) throw bad('Írd be, mit szeretnél hallani.');
    const {rows} = await db.query('insert into public.club_requests (name, color, ip, browser_hash, item) values ($1, $2, $3, $4, $5) returning *', [identity.name, identity.color || '', ip, identity.browser_hash, JSON.stringify(item)]);
    const chat = await db.query('insert into public.club_chat (name, text, kind, color, request_id, ip, browser_hash) values ($1, $2, $3, $4, $5, $6, $7) returning *', [
      identity.name,
      `Zenét kér: ${item.name}`,
      'request',
      identity.color || '',
      rows[0].id,
      ip,
      identity.browser_hash
    ]);
    await pushClub('chat', {message: chatPublic(chat.rows[0])});
    await pushClub('requests');
    return created({request: {id: rows[0].id, name: identity.name, item, status: 'pending', votes: 0}});
  });

  /** Anyone in the room can back a request; a second tap takes the vote back. */
  router.post('/api/club/request/:id/vote', async ({db, req, params}) => {
    const body = await readJson(req);
    const ip = clientIp(req);
    const voter = voterOf(ip, body.clientId);
    await rateLimit(db, `club-vote:${voter}`, 1, 1200);
    const request = (await db.query('select * from public.club_requests where id = $1', [params.id])).rows[0];
    if (!request) throw notFound('Kérés nem található');
    if (request.status === 'declined' || request.status === 'played') throw conflict('Erre a kérésre már nem lehet szavazni.');
    const existing = (await db.query('select 1 from public.club_request_votes where request_id = $1 and voter = $2', [request.id, voter])).rows[0];
    if (existing) await db.query('delete from public.club_request_votes where request_id = $1 and voter = $2', [request.id, voter]);
    else await db.query('insert into public.club_request_votes (request_id, voter) values ($1, $2)', [request.id, voter]);
    const {rows} = await db.query('update public.club_requests set votes = (select count(*)::int from public.club_request_votes where request_id = $1) where id = $1 returning votes', [request.id]);
    await pushClub('requests');
    return {ok: true, voted: !existing, votes: rows[0].votes};
  });

  /** One vote per network + browser; changing it is allowed while the poll is open. */
  router.post('/api/club/poll/:id/vote', async ({db, req, params}) => {
    const body = await readJson(req);
    const ip = clientIp(req);
    const voter = voterOf(ip, body.clientId);
    await rateLimit(db, `club-poll:${voter}`, 1, 1200);
    const row = (await db.query('select * from public.club_polls where id = $1', [params.id])).rows[0];
    const poll = await pollOf(db, row);
    if (!poll) throw notFound('Szavazás nem található');
    if (!poll.open) throw conflict('Ez a szavazás már lezárult.');
    const optionId = String(body.optionId || '');
    if (!poll.options.some((option) => option.id === optionId)) throw bad('Érvénytelen válasz.');
    await db.query(
      `insert into public.club_poll_votes (poll_id, voter, option_id) values ($1, $2, $3)
       on conflict (poll_id, voter) do update set option_id = excluded.option_id, at = now()`,
      [poll.id, voter, optionId]
    );
    const fresh = await pollOf(db, row);
    await pushClub('poll', {poll: fresh});
    return {ok: true, poll: fresh, optionId};
  });

  router.post('/api/club/name-decision', async ({db, req, user}) => {
    const me = requireModerator({user});
    const body = await readJson(req);
    const action = String(body.action || '').toLowerCase();
    if (!['accept', 'decline'].includes(action)) throw bad('Érvénytelen művelet');
    const request = (await db.query('select * from public.club_name_requests where id = $1', [String(body.id || '')])).rows[0];
    if (!request) throw notFound('Névkérelem nem található');
    const retryAt = action === 'decline' ? new Date(Date.now() + DECLINE_RETRY_MS) : null;
    await db.query(`update public.club_name_requests set status = $2, handled_by_name = $3, handled_at = now(), retry_at = $4 where id = $1`, [
      request.id,
      action === 'accept' ? 'accepted' : 'declined',
      djName(me),
      retryAt
    ]);
    if (action === 'accept') {
      const token = crypto.randomBytes(32).toString('hex');
      const taken = (await db.query<{color: string}>('select color from public.club_listeners where expires_at > now()')).rows.map((row) => row.color);
      await db.query('delete from public.club_listeners where ip = $1', [request.ip]);
      await db.query('insert into public.club_listeners (token_hash, name, color, ip, browser_hash, expires_at) values ($1, $2, $3, $4, $5, $6)', [
        tokenHashOf(token),
        request.name,
        pickColor(taken),
        request.ip,
        request.browser_hash,
        new Date(Date.now() + NAME_TTL_MS)
      ]);
      await houseLine(db, `${request.name} belépett a klubba.`);
    }
    await audit(db, me, action === 'accept' ? 'DJ_NAME_ACCEPT' : 'DJ_NAME_DECLINE', request.name);
    await pushClub('names', {name: request.name, action});
    return {ok: true, retryAt: retryAt ? retryAt.getTime() : null, state: await moderatorState(db)};
  });

  router.post('/api/club/listener-action', async ({db, req, user}) => {
    const me = requireModerator({user});
    const body = await readJson(req);
    const action = String(body.action || '').toLowerCase();
    const ip = String(body.ip || '').trim().replace(/^::ffff:/, '');
    const browserHash = String(body.browserHash || '').trim().slice(0, 128);
    const identity = (await db.query('select * from public.club_listeners where ip = $1 and browser_hash = $2 and expires_at > now() limit 1', [ip, browserHash])).rows[0];
    if (!identity) throw notFound('A regisztrált hallgató nem található.');
    if (action === 'delete' || action === 'remove') {
      await db.query('delete from public.club_listeners where id = $1', [identity.id]);
      await db.query('delete from public.club_name_requests where ip = $1 and browser_hash = $2', [ip, browserHash]);
      await db.query(`delete from public.club_bans where ip = $1 and (browser_hash = '' or browser_hash = $2)`, [ip, browserHash]);
      await audit(db, me, 'DJ_LISTENER_DELETE', identity.name);
      await pushClub('names');
      return {ok: true, state: await moderatorState(db)};
    }
    if (action === 'rename') {
      const name = String(body.name || '').trim().slice(0, 32);
      if (!name) throw bad('Az új név nem lehet üres.');
      const duplicate = (await db.query('select 1 from public.club_listeners where id <> $1 and lower(name) = lower($2) and expires_at > now()', [identity.id, name])).rows[0];
      if (duplicate) throw conflict('Ez a megjelenési név már használatban van.');
      await db.query('update public.club_listeners set name = $2 where id = $1', [identity.id, name]);
      await db.query('update public.club_name_requests set name = $3 where ip = $1 and browser_hash = $2', [ip, browserHash, name]);
      await audit(db, me, 'DJ_LISTENER_RENAME', `${identity.name} -> ${name}`);
      await pushClub('names');
      return {ok: true, state: await moderatorState(db)};
    }
    if (action === 'recolor') {
      const color = String(body.color || '').trim().toLowerCase();
      if (!isHex(color)) throw bad('Érvénytelen szín.');
      await db.query('update public.club_listeners set color = $2 where id = $1', [identity.id, color]);
      await pushClub('names');
      return {ok: true, state: await moderatorState(db)};
    }
    throw bad('Ismeretlen hallgató művelet.');
  });

  router.post('/api/club/ban', async ({db, req, user}) => {
    const me = requireModerator({user});
    const body = await readJson(req);
    const ip = String(body.ip || '').trim().replace(/^::ffff:/, '');
    const browserHash = String(body.browserHash || '').trim().slice(0, 128);
    const allowed = [5, 15, 30, 60, 1440];
    const requested = Number(body.minutes) || 60;
    const minutes = allowed.includes(requested) ? requested : 60;
    const reason = String(body.reason || '').trim().slice(0, 240);
    if (!ip || ip === 'unknown' || !browserHash || !reason) throw bad('Érvényes IP + böngésző azonosító és indok kötelező');
    const until = new Date(Date.now() + minutes * 60000);
    await db.query('delete from public.club_bans where ip = $1 and browser_hash = $2', [ip, browserHash]);
    await db.query('insert into public.club_bans (ip, browser_hash, until, minutes, reason, by_name) values ($1, $2, $3, $4, $5, $6)', [ip, browserHash, until, minutes, reason, djName(me)]);
    await audit(db, me, 'DJ_BAN', `${ip} · ${minutes} perc · ${reason}`);
    await pushClub('names');
    return {ok: true, ip, browserHash, until: until.getTime(), minutes, state: await moderatorState(db)};
  });

  /* ---------------- DJ booth ---------------- */

  router.get('/api/dj/state', async ({db, user}) => {
    const me = requireModerator({user});
    return {state: await moderatorState(db), me: {id: me.id, name: me.name, nickname: me.nickname, role: me.role}};
  });

  /**
   * Going live by hand, or taking over a show the station started by itself
   * (the booth then carries the DJ's name). Stopping by hand ends the show
   * even if the station keeps streaming; it only restarts itself the next
   * time the station goes from silent to on air.
   */
  router.post('/api/dj/live', async ({db, req, user}) => {
    const me = requireModerator({user});
    const body = parse(liveBody, await readJson(req));
    const on = body.live;
    const before = (await db.query('select live, auto_live from public.club_state where id = 1')).rows[0];
    const takeover = on && !!before?.live && !!before?.auto_live;
    const title = on ? (body.title || 'Red Moon Live').slice(0, 80) : '';
    const streamUrl = body.streamUrl === undefined ? null : cleanUrl(body.streamUrl);
    const providerUrl = body.providerUrl === undefined ? null : cleanUrl(body.providerUrl);
    await db.tx(async (tx) => {
      await tx.query(
        `update public.club_state set live = $1, auto_live = false, dj_user_id = $2, dj_name = $3, title = $4,
           started_at = case when $1 then coalesce(started_at, $5) else null end,
           peak_listeners = case when $1 and not live then 0 else peak_listeners end,
           current = case when $1 then current else null end,
           stream_url = coalesce($6, stream_url), provider_url = coalesce($7, provider_url), updated_at = now() where id = 1`,
        [on, on ? me.id : null, on ? djName(me) : '', title, on ? new Date() : null, streamUrl, providerUrl]
      );
      if (!on) await tx.query('delete from public.club_queue');
    });
    await audit(db, me, on ? (takeover ? 'DJ_LIVE_TAKEOVER' : 'DJ_LIVE_START') : 'DJ_LIVE_STOP', on ? title : 'Adás leállítva');
    await houseLine(db, on ? (takeover ? `${djName(me)} átvette a pultot: ${title}` : `${djName(me)} adásba lépett: ${title}`) : `${djName(me)} lezárta az adást.`);
    await pushClub('state');
    await broadcast('house', 'live', {live: on});
    return {state: await moderatorState(db)};
  });

  /** The stream the site plays while the booth is live (empty = the station's own mount), and the station page. */
  router.patch('/api/dj/stream', async ({db, req, user}) => {
    const me = requireModerator({user});
    const body = await readJson(req);
    const streamUrl = body.streamUrl === undefined ? null : cleanUrl(body.streamUrl);
    const providerUrl = body.providerUrl === undefined ? null : cleanUrl(body.providerUrl);
    if (providerUrl !== null && providerUrl && !stationSlug(providerUrl)) throw bad('Az állomás oldala gocast.fm/station/… alakú legyen.');
    await db.query(
      `update public.club_state set stream_url = coalesce($1, stream_url), provider_url = coalesce($2, provider_url),
         station_checked_at = null, updated_at = now() where id = 1`,
      [streamUrl, providerUrl]
    );
    await audit(db, me, 'DJ_STREAM_UPDATE', `${streamUrl ?? '(változatlan)'} · ${providerUrl ?? '(változatlan)'}`);
    await pushClub('state');
    await broadcast('house', 'live');
    return {state: await moderatorState(db)};
  });

  /** The DJ names what is playing; it heads the setlist and the room hears about it. */
  router.post('/api/dj/announce', async ({db, req, user}) => {
    const me = requireModerator({user});
    const body = parse(announceBody, await readJson(req));
    const {rows} = await db.query(`insert into public.club_setlist (title, artist, source, by_name) values ($1, $2, 'announce', $3) returning *`, [body.title, body.artist, djName(me)]);
    await houseLine(db, `Most szól: ${body.artist ? `${body.artist} – ` : ''}${body.title}`, 'now-playing');
    await pushClub('setlist');
    return created({entry: setlistOf(rows[0]), state: await moderatorState(db)});
  });

  router.delete('/api/dj/setlist/:id', async ({db, user, params}) => {
    requireModerator({user});
    await db.query('delete from public.club_setlist where id = $1', [params.id]);
    await pushClub('setlist');
    return {ok: true, state: await moderatorState(db)};
  });

  /** A pinned line above the chat. Empty clears it. */
  router.patch('/api/dj/notice', async ({db, req, user}) => {
    const me = requireModerator({user});
    const body = await readJson(req);
    const text = String(body.text || '').trim().slice(0, 200);
    await db.query('update public.club_state set notice = $1, updated_at = now() where id = 1', [text]);
    await audit(db, me, 'DJ_NOTICE', text || '(törölve)');
    if (text) await houseLine(db, `Közlemény: ${text}`, 'notice');
    await pushClub('state');
    return {ok: true, notice: text, state: await moderatorState(db)};
  });

  /** Slow mode for the chat and the request gate. */
  router.patch('/api/dj/chat-mode', async ({db, req, user}) => {
    const me = requireModerator({user});
    const body = parse(chatModeBody, await readJson(req));
    if (body.slowSeconds !== undefined) {
      if (!SLOW_MODES.includes(body.slowSeconds)) throw bad('A lassú mód 0, 5, 15, 30 vagy 60 másodperc lehet.');
      await db.query('update public.club_state set slow_mode_seconds = $1, updated_at = now() where id = 1', [body.slowSeconds]);
      await houseLine(db, body.slowSeconds ? `Lassú mód: ${body.slowSeconds} másodperc két üzenet között.` : 'A lassú mód kikapcsolt.');
    }
    if (body.requestsOpen !== undefined) {
      await db.query('update public.club_state set requests_open = $1, updated_at = now() where id = 1', [body.requestsOpen]);
      await houseLine(db, body.requestsOpen ? 'A kérések újra nyitva.' : 'A DJ lezárta a kéréseket.');
    }
    await audit(db, me, 'DJ_CHAT_MODE', `slow=${body.slowSeconds ?? '-'} requests=${body.requestsOpen ?? '-'}`);
    await pushClub('state');
    return {state: await moderatorState(db)};
  });

  /** Wipes the room's chat. */
  router.delete('/api/dj/chat', async ({db, user}) => {
    const me = requireModerator({user});
    await db.query('delete from public.club_chat');
    await audit(db, me, 'DJ_CHAT_CLEAR', '');
    await pushClub('chat_cleared');
    await houseLine(db, `${djName(me)} tiszta lappal indította a chatet.`);
    return {ok: true, state: await moderatorState(db)};
  });

  /* ---- polls ---- */

  router.post('/api/dj/poll', async ({db, req, user}) => {
    const me = requireModerator({user});
    const body = parse(pollBody, await readJson(req));
    const labels = [...new Set(body.options.map((option) => option.trim()))].filter(Boolean);
    if (labels.length < 2) throw bad('Legalább két különböző válasz kell.');
    const options = labels.map((label, index) => ({id: `o${index + 1}`, label}));
    await db.query('update public.club_polls set closed_at = now() where closed_at is null');
    const closesAt = body.minutes ? new Date(Date.now() + body.minutes * 60000) : null;
    const {rows} = await db.query('insert into public.club_polls (question, options, by_name, closes_at) values ($1, $2, $3, $4) returning *', [body.question, JSON.stringify(options), djName(me), closesAt]);
    await audit(db, me, 'DJ_POLL_OPEN', body.question);
    await houseLine(db, `Szavazás: ${body.question}`, 'poll');
    const poll = await pollOf(db, rows[0]);
    await pushClub('poll', {poll});
    return created({poll, state: await moderatorState(db)});
  });

  router.post('/api/dj/poll/:id/close', async ({db, user, params}) => {
    const me = requireModerator({user});
    const {rows} = await db.query('update public.club_polls set closed_at = coalesce(closed_at, now()) where id = $1 returning *', [params.id]);
    if (!rows[0]) throw notFound('Szavazás nem található');
    const poll = (await pollOf(db, rows[0]))!;
    const winner = [...poll.options].sort((a, b) => b.votes - a.votes)[0];
    await audit(db, me, 'DJ_POLL_CLOSE', poll.question);
    await houseLine(db, poll.total ? `Szavazás lezárva: ${winner.label} (${winner.votes} szavazat).` : 'Szavazás lezárva, szavazat nélkül.', 'poll');
    await pushClub('poll', {poll});
    return {poll, state: await moderatorState(db)};
  });

  router.delete('/api/dj/poll/:id', async ({db, user, params}) => {
    requireModerator({user});
    await db.query('delete from public.club_polls where id = $1', [params.id]);
    await pushClub('poll', {poll: null});
    return {ok: true, state: await moderatorState(db)};
  });

  /* ---- library & playback ---- */

  /**
   * Step 1 of an upload. With Cloudinary configured the browser gets a signed
   * upload it sends the audio to directly; otherwise it is told to post the
   * file to /api/dj/upload on this server.
   */
  router.post('/api/dj/upload-url', async ({req, user}) => {
    requireModerator({user});
    const body = await readJson(req);
    const filename = sanitizeFilename(body.filename);
    const ext = extensionOf(filename);
    if (!AUDIO_TYPES[ext]) throw bad('Csak MP3, WAV, OGG, M4A, AAC vagy WEBM hangfájl tölthető fel.');
    const size = Number(body.size) || 0;
    if (size < 1000) throw bad('A feltöltött fájl üres vagy hibás.');
    if (size > config.maxAudioBytes) throw bad('A zene maximum 80 MB lehet.');
    const trackId = `track_${crypto.randomBytes(8).toString('hex')}`;
    if (!cloudinaryEnabled()) {
      if (!localStoreAllowed()) throw bad('A médiatár (Cloudinary) nincs beállítva, ezért nem lehet feltölteni.');
      return {provider: 'local', trackId, contentType: AUDIO_TYPES[ext]};
    }
    const signed = signUpload('audio', 'dj-music', filename);
    return {...signed, trackId, contentType: AUDIO_TYPES[ext]};
  });

  /** Step 2: the browser reports the finished asset and it joins the library. */
  router.post('/api/dj/library/confirm', async ({db, req, user}) => {
    const me = requireModerator({user});
    if (!cloudinaryEnabled()) throw bad('A médiatár nincs beállítva.');
    const body = await readJson(req);
    const id = String(body.trackId || '').trim();
    const url = String(body.url || '').trim();
    const publicId = String(body.publicId || '').trim();
    if (!/^track_[a-f0-9]{16}$/.test(id) || !isOurCloudinaryUrl(url, 'audio') || !publicId.startsWith(`${config.cloudinaryFolder}/dj-music/`)) {
      throw bad('Érvénytelen feltöltés.');
    }
    const name = sanitizeFilename(body.name || publicId.split('/').pop() || 'track').replace(/\.[^.]+$/, '');
    const {rows} = await db.query(
      'insert into public.club_tracks (id, name, url, storage_key, size, added_by_name) values ($1, $2, $3, $4, $5, $6) on conflict (id) do nothing returning *',
      [id, name, url, publicId, Math.max(0, Number(body.size) || 0), djName(me)]
    );
    if (!rows[0]) throw conflict('Ez a zene már szerepel a tárban.');
    await audit(db, me, 'DJ_TRACK_UPLOAD', name);
    await pushClub('state');
    return created({track: trackOf(rows[0]), state: await moderatorState(db)});
  });

  /** Local fallback: multipart upload written next to the site. */
  router.post('/api/dj/upload', async ({db, req, user}) => {
    const me = requireModerator({user});
    if (cloudinaryEnabled() || !localStoreAllowed()) throw bad('Használd a közvetlen feltöltést.');
    const buffer = await readRaw(req, config.maxAudioBytes);
    const part = firstFilePart(String(req.headers['content-type'] || ''), buffer);
    if (!part) throw bad('Fájl nem található a feltöltésben');
    const ext = extensionOf(part.filename);
    if (!AUDIO_TYPES[ext]) throw bad('Csak MP3, WAV, OGG, M4A, AAC vagy WEBM hangfájl tölthető fel.');
    if (part.data.length < 1000) throw bad('A feltöltött fájl üres vagy hibás.');
    const id = `track_${crypto.randomBytes(8).toString('hex')}`;
    const stored = storeLocal('audio', 'dj-music', part.filename, part.data);
    const {rows} = await db.query('insert into public.club_tracks (id, name, url, storage_key, size, added_by_name) values ($1, $2, $3, $4, $5, $6) returning *', [
      id,
      part.filename.replace(/\.[^.]+$/, ''),
      stored.url,
      stored.publicId,
      part.data.length,
      djName(me)
    ]);
    await audit(db, me, 'DJ_TRACK_UPLOAD', rows[0].name);
    await pushClub('state');
    return created({track: trackOf(rows[0]), state: await moderatorState(db)});
  });

  router.delete('/api/dj/library/:id', async ({db, user, params}) => {
    const me = requireModerator({user});
    const track = await trackById(db, params.id);
    if (!track) throw notFound('A zene nem található');
    await destroyMedia(track.storage_key, 'audio');
    await db.tx(async (tx) => {
      await tx.query('delete from public.club_tracks where id = $1', [track.id]);
      await tx.query(`update public.club_state set current = case when current->>'trackId' = $1 then null else current end where id = 1`, [track.id]);
    });
    await audit(db, me, 'DJ_TRACK_DELETE', track.name);
    await pushClub('state');
    return {ok: true};
  });

  router.post('/api/dj/queue', async ({db, req, user}) => {
    const me = requireModerator({user});
    const body = await readJson(req);
    const track = await trackById(db, String(body.trackId || ''));
    if (!track) throw notFound('A feltöltött zene nem található');
    const {rows} = await db.query('insert into public.club_queue (track_id, name, url, added_by_name) values ($1, $2, $3, $4) returning *', [track.id, track.name, track.url, djName(me)]);
    await db.query(`delete from public.club_queue where id in (select id from public.club_queue order by position desc offset 50)`);
    await pushClub('state');
    return created({item: {id: rows[0].id, trackId: track.id, name: track.name, url: track.url, addedBy: djName(me)}, state: await moderatorState(db)});
  });

  router.delete('/api/dj/queue/:id', async ({db, user, params}) => {
    requireModerator({user});
    await db.query('delete from public.club_queue where id = $1', [params.id]);
    await pushClub('state');
    return {ok: true, state: await moderatorState(db)};
  });

  const playItem = async (db: Queryable, me: SessionUser, item: PlayItem) => {
    const current = {id: item.id, trackId: item.trackId || item.id, name: item.name, url: item.url, addedBy: item.addedBy || djName(me), playbackPosition: 0, playbackPlaying: true, playbackAt: Date.now()};
    await db.query(
      `update public.club_state set current = $1, live = true, auto_live = false, dj_user_id = $2, dj_name = $3, started_at = coalesce(started_at, now()), updated_at = now() where id = 1`,
      [JSON.stringify(current), me.id, djName(me)]
    );
    await db.query(`insert into public.club_setlist (title, artist, source, by_name) values ($1, '', 'library', $2)`, [item.name, item.addedBy || djName(me)]);
    await pushClub('setlist');
    return current;
  };

  router.post('/api/dj/play', async ({db, req, user}) => {
    const me = requireModerator({user});
    const body = await readJson(req);
    let item: PlayItem | null = null;
    if (body.queueId) {
      const row = (await db.query('select * from public.club_queue where id = $1', [String(body.queueId)])).rows[0];
      if (row) {
        item = {id: row.id, trackId: row.track_id, name: row.name, url: row.url, addedBy: row.added_by_name};
        await db.query('delete from public.club_queue where id = $1', [row.id]);
      }
    } else if (body.trackId) {
      const track = await trackById(db, String(body.trackId));
      if (track) item = {id: track.id, trackId: track.id, name: track.name, url: track.url, addedBy: djName(me)};
    }
    if (!item) throw notFound('A lejátszandó zene nem található');
    await playItem(db, me, item);
    await audit(db, me, 'DJ_TRACK_START', item.name);
    await pushClub('state');
    await broadcast('house', 'live');
    return {state: await moderatorState(db)};
  });

  router.post('/api/dj/control', async ({db, req, user}) => {
    const me = requireModerator({user});
    const body = await readJson(req);
    const state = (await db.query('select current from public.club_state where id = 1')).rows[0];
    const current: Row | null = state.current;
    if (!current) throw bad('Nincs lejátszott zene');
    const action = String(body.action || '');
    const position = Number.isFinite(Number(body.position)) ? Math.max(0, Number(body.position)) : Number(current.playbackPosition) || 0;
    if (action === 'play') Object.assign(current, {playbackPosition: position, playbackPlaying: true, playbackAt: Date.now()});
    else if (action === 'pause') Object.assign(current, {playbackPosition: position, playbackPlaying: false, playbackAt: null});
    else if (action === 'seek') Object.assign(current, {playbackPosition: position, playbackAt: current.playbackPlaying ? Date.now() : null});
    else if (action === 'next') {
      const next = (await db.query('select * from public.club_queue order by position asc limit 1')).rows[0];
      if (!next) {
        await db.query('update public.club_state set current = null, updated_at = now() where id = 1');
        await pushClub('state');
        return {state: await moderatorState(db)};
      }
      await db.query('delete from public.club_queue where id = $1', [next.id]);
      await playItem(db, me, {id: next.id, trackId: next.track_id, name: next.name, url: next.url, addedBy: next.added_by_name});
      await pushClub('state');
      return {state: await moderatorState(db)};
    } else throw bad('Ismeretlen lejátszó művelet');
    await db.query('update public.club_state set current = $1, updated_at = now() where id = 1', [JSON.stringify(current)]);
    await pushClub('state');
    return {state: await moderatorState(db)};
  });

  router.post('/api/dj/player-sync', async ({db, req, user}) => {
    requireModerator({user});
    const body = await readJson(req);
    const state = (await db.query('select current from public.club_state where id = 1')).rows[0];
    if (!state.current) return {ok: true};
    const current = {...state.current, playbackPosition: Math.max(0, Number(body.position) || 0), playbackPlaying: !!body.playing};
    current.playbackAt = current.playbackPlaying ? Date.now() : null;
    await db.query('update public.club_state set current = $1, updated_at = now() where id = 1', [JSON.stringify(current)]);
    return {ok: true};
  });

  router.post('/api/dj/chat', async ({db, req, user}) => {
    const me = requireModerator({user});
    const body = await readJson(req);
    const text = String(body.text || '').trim().slice(0, 500);
    if (!text) throw bad('Az üzenet nem lehet üres.');
    const {rows} = await db.query(`insert into public.club_chat (name, text, kind, color) values ($1, $2, 'dj', $3) returning *`, [djName(me), text, DJ_COLOR]);
    await pushClub('chat', {message: chatPublic(rows[0])});
    return created({ok: true, message: chatPublic(rows[0])});
  });

  /** Accept (queues a library track), decline, or mark a request played (it joins the setlist). */
  router.post('/api/dj/request', async ({db, req, user}) => {
    const me = requireModerator({user});
    const body = await readJson(req);
    const action = String(body.action || '').toLowerCase();
    if (!['accept', 'decline', 'played'].includes(action)) throw bad('Érvénytelen művelet');
    const request = (await db.query('select * from public.club_requests where id = $1', [String(body.id || '')])).rows[0];
    if (!request) throw notFound('Kérés nem található');
    const status = action === 'accept' ? 'accepted' : action === 'decline' ? 'declined' : 'played';
    await db.query(`update public.club_requests set status = $2, handled_by_name = $3, handled_at = now() where id = $1`, [request.id, status, djName(me)]);
    if (action === 'accept' && request.item?.id) {
      const track = await trackById(db, String(request.item.id));
      if (track) {
        await db.query('insert into public.club_queue (track_id, name, url, added_by_name, request_id) values ($1, $2, $3, $4, $5)', [track.id, track.name, track.url, request.name, request.id]);
      }
    }
    if (action === 'played') {
      await db.query(`insert into public.club_setlist (title, artist, source, request_id, by_name) values ($1, '', 'request', $2, $3)`, [request.item?.name || 'Kérés', request.id, request.name]);
      await pushClub('setlist');
    }
    const text =
      action === 'accept'
        ? `${djName(me)} elfogadta ${request.name} kérését: ${request.item?.name || ''}`
        : action === 'decline'
          ? `${djName(me)} most nem játssza: ${request.item?.name || ''}`
          : `Most szól: ${request.item?.name || ''} — ${request.name} kérésére`;
    const kind = action === 'accept' ? 'request-accepted' : action === 'decline' ? 'request-declined' : 'now-playing';
    await houseLine(db, text, kind, {requestId: request.id});
    await pushClub('requests');
    return {state: await moderatorState(db)};
  });

  router.delete('/api/dj/request/:id', async ({db, user, params}) => {
    const me = requireModerator({user});
    const {rows} = await db.query('delete from public.club_requests where id = $1 returning *', [params.id]);
    if (!rows[0]) throw notFound('Kérés nem található');
    await db.query('delete from public.club_chat where request_id = $1', [params.id]);
    await audit(db, me, 'DJ_REQUEST_DELETE', `${rows[0].name}: ${rows[0].item?.name || ''}`);
    await pushClub('requests');
    return {ok: true, state: await moderatorState(db)};
  });
}
