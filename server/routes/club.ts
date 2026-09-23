/**
 * The Red Moon Club: the public live page (chat, requests, approved names)
 * and the DJ booth (library, queue, playback, moderation).
 *
 * Listeners are anonymous. A name is approved by whoever runs the booth and
 * tied to a hash of the browser id, an IP and a secret token; the raw token
 * only ever lives in that browser. Everything is polled: state is small and
 * a few-second delay is invisible on a chat that expires after a minute.
 */
import crypto from 'node:crypto';
import path from 'node:path';
import fs from 'node:fs';
import {z} from 'zod';
import {audit, capabilitiesOf, rateLimit, requireUser} from '../auth.ts';
import {bad, clientIp, conflict, created, forbidden, HttpError, iso, notFound, parse, readJson, readRaw, sha256, tooMany, type Router} from '../http.ts';
import {AUDIO_TYPES, createSignedUpload, deleteObject, keyFromUrl, publicUrl, sanitizeFilename, statObject, storageEnabled} from '../storage.ts';
import {config} from '../config.ts';
import type {Queryable, Row, SessionUser, UserCtx} from '../types.ts';

const NAME_TTL_MS = 3 * 24 * 60 * 60 * 1000;
const DECLINE_RETRY_MS = 5 * 60 * 1000;

const browserHashOf = (clientId: unknown): string => (clientId ? sha256(String(clientId).trim().slice(0, 160)) : '');
const tokenHashOf = (token: unknown): string => (token ? sha256(String(token).trim().slice(0, 160)) : '');

const requireModerator = (ctx: UserCtx): SessionUser => {
  const user = requireUser(ctx);
  if (!capabilitiesOf(user).dj) throw forbidden('Ehhez DJ jogosultság kell.');
  return user;
};

/* ------------------------------------------------------------------ */
/* State                                                               */
/* ------------------------------------------------------------------ */

async function housekeeping(db: Queryable): Promise<void> {
  await db.query(`delete from public.club_chat where at < now() - interval '60 seconds'`);
  await db.query(`delete from public.club_presence where last_seen < now() - interval '30 seconds'`);
  await db.query(`delete from public.club_listeners where expires_at < now()`);
  await db.query(`delete from public.club_bans where until is not null and until < now()`);
  await db.query(`delete from public.club_name_requests where status <> 'pending' and at < now() - interval '1 day'`);
  await db.query(`delete from public.club_requests where status <> 'pending' and at < now() - interval '1 day'`);
}

const chatPublic = (row: Row) => ({id: row.id, at: iso(row.at), name: row.name, text: row.text, kind: row.kind || 'chat', requestId: row.request_id || null});
const chatModerator = (row: Row) => ({...chatPublic(row), ip: row.ip || null, browserHash: row.browser_hash || null});

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

const trackOf = (row: Row) => ({id: row.id, name: row.name, url: row.url, size: row.size, addedBy: row.added_by_name || '', addedAt: iso(row.added_at)});

interface PlayItem {
  id: string;
  trackId?: string;
  name: string;
  url: string;
  addedBy?: string;
}

export async function clubState(db: Queryable, {moderator = false}: {moderator?: boolean} = {}) {
  await housekeeping(db);
  const state = (await db.query('select * from public.club_state where id = 1')).rows[0];
  const listeners = (await db.query<{n: number}>('select count(*)::int as n from public.club_presence')).rows[0].n;
  const chat = (await db.query('select * from public.club_chat order by at desc limit 12')).rows;
  const out = {
    serverNow: Date.now(),
    live: !!state.live,
    dj: (state.dj_name || null) as string | null,
    title: (state.title || '') as string,
    provider: (state.provider || 'gocast') as string,
    providerUrl: (state.provider_url || '') as string,
    startedAt: iso(state.started_at),
    listenerCount: listeners,
    current: null as Row | null,
    queue: [] as Row[],
    library: [] as Row[],
    chat: chat.map(moderator ? chatModerator : chatPublic),
    requests: [] as Row[],
    nameRequests: [] as Row[],
    registeredListeners: [] as Row[]
  };
  if (!moderator) return out;

  const [queue, library, requests, names, approved] = await Promise.all([
    db.query('select * from public.club_queue order by position asc limit 50'),
    db.query('select * from public.club_tracks order by added_at desc limit 200'),
    db.query('select * from public.club_requests order by at desc limit 100'),
    db.query(`select * from public.club_name_requests where status = 'pending' order by at desc limit 80`),
    db.query('select * from public.club_listeners order by approved_at desc limit 300')
  ]);
  const bans = (await db.query('select * from public.club_bans where until is null or until > now()')).rows;
  out.current = state.current || null;
  out.queue = queue.rows.map((row) => ({id: row.id, trackId: row.track_id, name: row.name, url: row.url, addedBy: row.added_by_name || '', requestId: row.request_id || null, addedAt: iso(row.added_at)}));
  out.library = library.rows.map(trackOf);
  out.requests = requests.rows.map((row) => ({id: row.id, at: iso(row.at), name: row.name, status: row.status, item: row.item || null, ip: row.ip || null, browserHash: row.browser_hash || null, handledBy: row.handled_by_name || null}));
  out.nameRequests = names.rows.map((row) => ({id: row.id, clientId: row.client_id, name: row.name, at: iso(row.at), status: row.status, ip: row.ip}));
  out.registeredListeners = approved.rows.map((row) => {
    const ban = bans.find((entry) => entry.ip === row.ip && (!entry.browser_hash || entry.browser_hash === row.browser_hash));
    return {name: row.name, ip: row.ip, browserHash: row.browser_hash, approvedAt: iso(row.approved_at), expiresAt: new Date(row.expires_at).getTime(), banned: !!ban, banUntil: ban?.until ? new Date(ban.until).getTime() : null};
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

export function registerClubRoutes(router: Router): void {
  const moderatorState = (db: Queryable) => clubState(db, {moderator: true});

  router.get('/api/club/state', async ({db, user}) => {
    const moderator = !!user && capabilitiesOf(user).dj;
    return {state: await clubState(db, {moderator})};
  });

  router.post('/api/club/listener', async ({db, req}) => {
    const body = await readJson(req);
    const id = String(body.id || '').trim().slice(0, 80);
    if (!id) throw bad('Hiányzó listener azonosító');
    await db.query('insert into public.club_presence (client_id, last_seen) values ($1, now()) on conflict (client_id) do update set last_seen = now()', [id]);
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
      return {status: 'accepted', name: here.name, token: fresh, expiresAt: new Date(here.expires_at).getTime()};
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
      return {approved: true, alreadyNamed: true, token: fresh, name: here.name};
    }
    const onIp = (await db.query('select 1 from public.club_listeners where ip = $1 and expires_at > now() limit 1', [ip])).rows[0];
    if (onIp) throw conflict('Már van neved!');
    const pending = (await db.query(`select 1 from public.club_name_requests where ip = $1 and status = 'pending' limit 1`, [ip])).rows[0];
    if (pending) throw conflict('Te már küldtél be név kérelmet!');
    const declined = (await db.query(`select retry_at from public.club_name_requests where ip = $1 and status = 'declined' order by handled_at desc limit 1`, [ip])).rows[0];
    if (declined?.retry_at && new Date(declined.retry_at).getTime() > Date.now()) {
      const seconds = Math.max(1, Math.ceil((new Date(declined.retry_at).getTime() - Date.now()) / 1000));
      throw tooMany('A neved elutasították. 5 perc múlva tudsz újat kérni!', {retryAt: new Date(declined.retry_at).getTime(), seconds});
    }
    const {rows} = await db.query<{id: string}>('insert into public.club_name_requests (client_id, browser_hash, name, ip) values ($1, $2, $3, $4) returning id', [clientId, browserHash, name, ip]);
    return created({pending: true, requestId: rows[0].id});
  });

  router.post('/api/club/chat', async ({db, req, user}) => {
    const body = parse(chatBody, await readJson(req));
    const ip = clientIp(req);
    const moderator = !!user && capabilitiesOf(user).dj;
    let name = moderator ? user!.name : '';
    let browserHash: string | null = null;
    if (!moderator) {
      const identity = (await db.query('select * from public.club_listeners where token_hash = $1 and ip = $2 and expires_at > now() limit 1', [tokenHashOf(body.token), ip])).rows[0];
      if (!identity || (body.name && identity.name !== body.name)) throw forbidden('Előbb kérd a megjelenési neved jóváhagyását a DJ-től.');
      name = identity.name;
      browserHash = identity.browser_hash;
      const ban = await activeBan(db, ip, identity.browser_hash);
      if (ban) throw forbidden(`Chat tiltás aktív. Indok: ${ban.reason || 'nincs megadva'}`);
      await rateLimit(db, `club-chat:${ip}`, 1, 5000);
    }
    const {rows} = await db.query('insert into public.club_chat (name, text, kind, ip, browser_hash) values ($1, $2, $3, $4, $5) returning *', [
      name,
      body.text,
      moderator ? 'dj' : 'chat',
      ip,
      browserHash
    ]);
    return created({ok: true, message: chatPublic(rows[0])});
  });

  router.delete('/api/club/chat/:id', async ({db, user, params}) => {
    const me = requireModerator({user});
    const {rows} = await db.query('delete from public.club_chat where id = $1 returning *', [params.id]);
    if (!rows[0]) throw notFound('Üzenet nem található');
    await audit(db, me, 'DJ_CHAT_DELETE', `${rows[0].name}: ${rows[0].text}`);
    return {ok: true};
  });

  router.post('/api/club/request', async ({db, req}) => {
    const body = await readJson(req);
    const ip = clientIp(req);
    const identity = (await db.query('select * from public.club_listeners where token_hash = $1 and ip = $2 and expires_at > now() limit 1', [tokenHashOf(body.token), ip])).rows[0];
    if (!identity) throw forbidden('Érvényes névjóváhagyás szükséges');
    const ban = await activeBan(db, ip, identity.browser_hash);
    if (ban) throw forbidden(`Chat tiltás aktív. Indok: ${ban.reason || 'nincs megadva'}`);
    await rateLimit(db, `club-request:${ip}`, 1, 5000);
    let item: {id: string; name: string; url: string; requestOnly?: boolean} | null = null;
    if (body.trackId) {
      const track = await trackById(db, String(body.trackId));
      if (track) item = {id: track.id, name: track.name, url: track.url};
    }
    if (!item && body.title) {
      const title = String(body.title).trim().slice(0, 120);
      if (title) item = {id: `text_${crypto.randomUUID()}`, name: title, url: '', requestOnly: true};
    }
    if (!item) throw bad('Válassz egy feltöltött zenét, vagy írd be a címét.');
    const {rows} = await db.query('insert into public.club_requests (name, ip, browser_hash, item) values ($1, $2, $3, $4) returning *', [identity.name, ip, identity.browser_hash, JSON.stringify(item)]);
    await db.query('insert into public.club_chat (name, text, kind, request_id, ip, browser_hash) values ($1, $2, $3, $4, $5, $6)', [
      identity.name,
      `Zenei kérés: ${item.name}`,
      'request',
      rows[0].id,
      ip,
      identity.browser_hash
    ]);
    return created({request: {id: rows[0].id, name: identity.name, item, status: 'pending'}});
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
      me.name,
      retryAt
    ]);
    if (action === 'accept') {
      const token = crypto.randomBytes(32).toString('hex');
      await db.query('delete from public.club_listeners where ip = $1', [request.ip]);
      await db.query('insert into public.club_listeners (token_hash, name, ip, browser_hash, expires_at) values ($1, $2, $3, $4, $5)', [
        tokenHashOf(token),
        request.name,
        request.ip,
        request.browser_hash,
        new Date(Date.now() + NAME_TTL_MS)
      ]);
    }
    await audit(db, me, action === 'accept' ? 'DJ_NAME_ACCEPT' : 'DJ_NAME_DECLINE', request.name);
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
    await db.query('insert into public.club_bans (ip, browser_hash, until, minutes, reason, by_name) values ($1, $2, $3, $4, $5, $6)', [ip, browserHash, until, minutes, reason, me.name]);
    await audit(db, me, 'DJ_BAN', `${ip} · ${minutes} perc · ${reason}`);
    return {ok: true, ip, browserHash, until: until.getTime(), minutes, state: await moderatorState(db)};
  });

  /* ---------------- DJ booth ---------------- */

  router.get('/api/dj/state', async ({db, user}) => {
    const me = requireModerator({user});
    return {state: await moderatorState(db), me: {id: me.id, name: me.name, role: me.role}};
  });

  router.post('/api/dj/live', async ({db, req, user}) => {
    const me = requireModerator({user});
    const body = await readJson(req);
    const on = !!body.live;
    const title = on ? String(body.title || 'Red Moon Live').trim().slice(0, 80) : '';
    await db.tx(async (tx) => {
      await tx.query(
        `update public.club_state set live = $1, dj_user_id = $2, dj_name = $3, title = $4, started_at = $5,
           current = case when $1 then current else null end, updated_at = now() where id = 1`,
        [on, on ? me.id : null, on ? me.name : '', title, on ? new Date() : null]
      );
      if (!on) await tx.query('delete from public.club_queue');
    });
    await audit(db, me, on ? 'DJ_LIVE_START' : 'DJ_LIVE_STOP', on ? title : 'Live leállítva');
    return {state: await moderatorState(db)};
  });

  /** Step 1 of an upload: a signed URL the browser sends the audio to directly. */
  router.post('/api/dj/upload-url', async ({req, user}) => {
    requireModerator({user});
    if (!storageEnabled()) throw new HttpError(503, 'A tárhely nincs beállítva; a fájl a szerveren keresztül megy.', {fallback: 'multipart'});
    const body = await readJson(req);
    const filename = sanitizeFilename(body.filename);
    const ext = path.extname(filename).toLowerCase();
    if (!AUDIO_TYPES[ext]) throw bad('Csak MP3, WAV, OGG, M4A, AAC vagy WEBM hangfájl tölthető fel.');
    const size = Number(body.size) || 0;
    if (size < 1000) throw bad('A feltöltött fájl üres vagy hibás.');
    if (size > config.maxAudioBytes) throw bad('A zene maximum 80 MB lehet.');
    const id = `track_${crypto.randomBytes(8).toString('hex')}`;
    const key = `${id}_${filename}`;
    const signed = await createSignedUpload(config.musicBucket, key);
    return {trackId: id, key, uploadUrl: signed.url, token: signed.token, publicUrl: signed.publicUrl, contentType: AUDIO_TYPES[ext]};
  });

  /** Step 2: the browser reports the finished object and it joins the library. */
  router.post('/api/dj/library/confirm', async ({db, req, user}) => {
    const me = requireModerator({user});
    if (!storageEnabled()) throw bad('A tárhely nincs beállítva.');
    const body = await readJson(req);
    const key = String(body.key || '').trim();
    const id = String(body.trackId || '').trim();
    if (!/^track_[a-f0-9]{16}_/.test(key) || !id || !key.startsWith(`${id}_`)) throw bad('Érvénytelen feltöltés.');
    const info = await statObject(config.musicBucket, key);
    if (!info) throw bad('A feltöltött fájl nem található a tárhelyen.');
    const name = sanitizeFilename(body.name || key.slice(id.length + 1)).replace(/\.[^.]+$/, '');
    const {rows} = await db.query(
      'insert into public.club_tracks (id, name, url, storage_key, size, added_by_name) values ($1, $2, $3, $4, $5, $6) on conflict (id) do nothing returning *',
      [id, name, publicUrl(config.musicBucket, key), key, info.size || Number(body.size) || 0, me.name]
    );
    if (!rows[0]) throw conflict('Ez a zene már szerepel a tárban.');
    await audit(db, me, 'DJ_TRACK_UPLOAD', name);
    return created({track: trackOf(rows[0]), state: await moderatorState(db)});
  });

  /** Local / VPS fallback: multipart upload written next to the site. */
  router.post('/api/dj/upload', async ({db, req, user}) => {
    const me = requireModerator({user});
    if (storageEnabled() || config.serverless) throw bad('Használd a közvetlen feltöltést.');
    const contentType = String(req.headers['content-type'] || '');
    const match = contentType.match(/boundary=(?:"([^"]+)"|([^;]+))/i);
    if (!match) throw bad('Multipart feltöltés szükséges');
    const buffer = await readRaw(req, config.maxAudioBytes);
    const boundary = Buffer.from(`--${match[1] || match[2]}`);
    const start = buffer.indexOf(Buffer.from('Content-Disposition:'));
    if (start < 0) throw bad('Fájl nem található a feltöltésben');
    const headerEnd = buffer.indexOf(Buffer.from('\r\n\r\n'), start);
    if (headerEnd < 0) throw bad('Érvénytelen feltöltés');
    const header = buffer.subarray(start, headerEnd).toString('utf8');
    const filename = sanitizeFilename(header.match(/filename="([^"]*)"/i)?.[1] || '');
    const dataStart = headerEnd + 4;
    const end = buffer.indexOf(Buffer.concat([Buffer.from('\r\n'), boundary]), dataStart);
    if (end < 0) throw bad('Érvénytelen fájlhatár');
    const data = buffer.subarray(dataStart, end);
    const ext = path.extname(filename).toLowerCase();
    if (!AUDIO_TYPES[ext]) throw bad('Csak MP3, WAV, OGG, M4A, AAC vagy WEBM hangfájl tölthető fel.');
    if (data.length < 1000) throw bad('A feltöltött fájl üres vagy hibás.');
    const id = `track_${crypto.randomBytes(8).toString('hex')}`;
    const safe = `${id}_${filename}`;
    const dir = path.join(config.publicDir, 'assets', 'dj-music');
    fs.mkdirSync(dir, {recursive: true});
    fs.writeFileSync(path.join(dir, safe), data);
    const {rows} = await db.query('insert into public.club_tracks (id, name, url, storage_key, size, added_by_name) values ($1, $2, $3, null, $4, $5) returning *', [
      id,
      filename.replace(/\.[^.]+$/, ''),
      `assets/dj-music/${safe}`,
      data.length,
      me.name
    ]);
    await audit(db, me, 'DJ_TRACK_UPLOAD', rows[0].name);
    return created({track: trackOf(rows[0]), state: await moderatorState(db)});
  });

  router.delete('/api/dj/library/:id', async ({db, user, params}) => {
    const me = requireModerator({user});
    const track = await trackById(db, params.id);
    if (!track) throw notFound('A zene nem található');
    const key = track.storage_key || keyFromUrl(config.musicBucket, track.url);
    if (key) await deleteObject(config.musicBucket, key);
    else {
      try {
        fs.unlinkSync(path.join(config.publicDir, track.url));
      } catch {
        /* already gone */
      }
    }
    await db.tx(async (tx) => {
      await tx.query('delete from public.club_tracks where id = $1', [track.id]);
      await tx.query(`update public.club_state set current = case when current->>'trackId' = $1 then null else current end where id = 1`, [track.id]);
    });
    await audit(db, me, 'DJ_TRACK_DELETE', track.name);
    return {ok: true};
  });

  router.post('/api/dj/queue', async ({db, req, user}) => {
    const me = requireModerator({user});
    const body = await readJson(req);
    const track = await trackById(db, String(body.trackId || ''));
    if (!track) throw notFound('A feltöltött zene nem található');
    const {rows} = await db.query('insert into public.club_queue (track_id, name, url, added_by_name) values ($1, $2, $3, $4) returning *', [track.id, track.name, track.url, me.name]);
    await db.query(`delete from public.club_queue where id in (select id from public.club_queue order by position desc offset 50)`);
    return created({item: {id: rows[0].id, trackId: track.id, name: track.name, url: track.url, addedBy: me.name}, state: await moderatorState(db)});
  });

  router.delete('/api/dj/queue/:id', async ({db, user, params}) => {
    requireModerator({user});
    await db.query('delete from public.club_queue where id = $1', [params.id]);
    return {ok: true, state: await moderatorState(db)};
  });

  const playItem = async (db: Queryable, me: SessionUser, item: PlayItem) => {
    const current = {id: item.id, trackId: item.trackId || item.id, name: item.name, url: item.url, addedBy: item.addedBy || me.name, playbackPosition: 0, playbackPlaying: true, playbackAt: Date.now()};
    await db.query(
      `update public.club_state set current = $1, live = true, dj_user_id = $2, dj_name = $3, started_at = coalesce(started_at, now()), updated_at = now() where id = 1`,
      [JSON.stringify(current), me.id, me.name]
    );
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
      if (track) item = {id: track.id, trackId: track.id, name: track.name, url: track.url, addedBy: me.name};
    }
    if (!item) throw notFound('A lejátszandó zene nem található');
    await playItem(db, me, item);
    await audit(db, me, 'DJ_TRACK_START', item.name);
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
        return {state: await moderatorState(db)};
      }
      await db.query('delete from public.club_queue where id = $1', [next.id]);
      await playItem(db, me, {id: next.id, trackId: next.track_id, name: next.name, url: next.url, addedBy: next.added_by_name});
      return {state: await moderatorState(db)};
    } else throw bad('Ismeretlen lejátszó művelet');
    await db.query('update public.club_state set current = $1, updated_at = now() where id = 1', [JSON.stringify(current)]);
    return {state: await moderatorState(db)};
  });

  router.post('/api/dj/player-sync', async ({db, req, user}) => {
    requireModerator({user});
    const body = await readJson(req);
    const state = (await db.query('select current from public.club_state where id = 1')).rows[0];
    if (!state.current) return {state: await moderatorState(db)};
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
    await db.query(`insert into public.club_chat (name, text, kind) values ($1, $2, 'dj')`, [me.name, text]);
    return created({ok: true, state: await moderatorState(db)});
  });

  router.post('/api/dj/request', async ({db, req, user}) => {
    const me = requireModerator({user});
    const body = await readJson(req);
    const action = String(body.action || '').toLowerCase();
    if (!['accept', 'decline'].includes(action)) throw bad('Érvénytelen művelet');
    const request = (await db.query('select * from public.club_requests where id = $1', [String(body.id || '')])).rows[0];
    if (!request) throw notFound('Kérés nem található');
    await db.query(`update public.club_requests set status = $2, handled_by_name = $3, handled_at = now() where id = $1`, [request.id, action === 'accept' ? 'accepted' : 'declined', me.name]);
    if (action === 'accept' && request.item?.id) {
      const track = await trackById(db, String(request.item.id));
      if (track) {
        await db.query('insert into public.club_queue (track_id, name, url, added_by_name, request_id) values ($1, $2, $3, $4, $5)', [track.id, track.name, track.url, request.name, request.id]);
      }
    }
    await db.query('insert into public.club_chat (name, text, kind, request_id, ip, browser_hash) values ($1, $2, $3, $4, $5, $6)', [
      'Red Moon',
      action === 'accept' ? `${me.name} elfogadta a kérést: ${request.item?.name || ''}` : `${me.name} elutasította a kérést: ${request.item?.name || ''}`,
      action === 'accept' ? 'request-accepted' : 'request-declined',
      request.id,
      request.ip,
      request.browser_hash
    ]);
    return {state: await moderatorState(db)};
  });

  router.delete('/api/dj/request/:id', async ({db, user, params}) => {
    const me = requireModerator({user});
    const {rows} = await db.query('delete from public.club_requests where id = $1 returning *', [params.id]);
    if (!rows[0]) throw notFound('Kérés nem található');
    await db.query('delete from public.club_chat where request_id = $1', [params.id]);
    await audit(db, me, 'DJ_REQUEST_DELETE', `${rows[0].name}: ${rows[0].item?.name || ''}`);
    return {ok: true, state: await moderatorState(db)};
  });
}
