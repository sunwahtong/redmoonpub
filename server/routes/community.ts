/**
 * The house's voice and the guests' answer: news posts the owner writes for
 * the public site, the "ott leszek" count on an event, and the notice board
 * the console's dashboard carries for the staff.
 */
import {z} from 'zod';
import {audit, rateLimit, requireRole, requireUser, roleAtLeast} from '../auth.ts';
import {bad, clientIp, created, forbidden, iso, notFound, parse, readJson, visitorFingerprint, type Router} from '../http.ts';
import {acceptImage, destroyMedia} from '../media.ts';
import {broadcast} from '../realtime.ts';
import type {Row} from '../types.ts';

const postBody = z.object({
  title: z.string().trim().min(2, 'Cím kötelező.').max(140),
  body: z.string().trim().max(4000).default(''),
  imageUrl: z.string().trim().max(600).default(''),
  imagePublicId: z.string().trim().max(200).default(''),
  pinned: z.boolean().default(false),
  active: z.boolean().default(true),
  publishedAt: z.string().trim().optional()
});
const postPatch = postBody.partial();

const noteBody = z.object({
  text: z.string().trim().min(1, 'Írj valamit a táblára.').max(600),
  pinned: z.boolean().default(false)
});

export const postOf = (row: Row) => ({
  id: row.id,
  title: row.title,
  body: row.body || '',
  imageUrl: row.image_url || '',
  imagePublicId: row.image_public_id || '',
  pinned: !!row.pinned,
  active: row.active !== false,
  publishedAt: iso(row.published_at),
  createdByName: row.created_by_name || '',
  updatedAt: iso(row.updated_at)
});

const noteOf = (row: Row) => ({id: row.id, at: iso(row.at), text: row.text, byId: row.by_id || null, byName: row.by_name || '', pinned: !!row.pinned});

const parseDate = (value: string | undefined): Date | null => {
  if (!value) return null;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) throw bad('Érvénytelen dátum.');
  return date;
};

export function registerCommunityRoutes(router: Router): void {
  /* ---------------- news ---------------- */

  router.get('/api/public/posts', async ({db}) => {
    const {rows} = await db.query('select * from public.posts where active and published_at <= now() order by pinned desc, published_at desc limit 40');
    return {posts: rows.map(postOf)};
  });

  router.get('/api/posts', async ({db, user}) => {
    requireRole({user}, 'owner');
    const {rows} = await db.query('select * from public.posts order by pinned desc, published_at desc limit 200');
    return {posts: rows.map(postOf)};
  });

  router.post('/api/posts', async ({db, req, user}) => {
    const me = requireRole({user}, 'owner');
    const body = parse(postBody, await readJson(req));
    acceptImage(body.imageUrl, body.imagePublicId, 'post');
    const {rows} = await db.query(
      `insert into public.posts (title, body, image_url, image_public_id, pinned, active, published_at, created_by, created_by_name)
       values ($1, $2, $3, $4, $5, $6, coalesce($7, now()), $8, $9) returning *`,
      [body.title, body.body, body.imageUrl, body.imageUrl ? body.imagePublicId : '', body.pinned, body.active, parseDate(body.publishedAt), me.id, me.name]
    );
    await audit(db, me, 'POST_CREATE', body.title);
    await broadcast('content', 'posts', {postId: rows[0].id});
    return created({post: postOf(rows[0])});
  });

  router.patch('/api/posts/:id', async ({db, req, user, params}) => {
    const me = requireRole({user}, 'owner');
    const existing = (await db.query('select * from public.posts where id = $1', [params.id])).rows[0];
    if (!existing) throw notFound('A hír nem található');
    const body = parse(postPatch, await readJson(req));
    const imageUrl = body.imageUrl ?? existing.image_url;
    const imagePublicId = body.imageUrl !== undefined ? (body.imageUrl ? body.imagePublicId || '' : '') : existing.image_public_id;
    if (body.imageUrl !== undefined) acceptImage(imageUrl, imagePublicId, 'post');
    const {rows} = await db.query(
      `update public.posts set title = $2, body = $3, image_url = $4, image_public_id = $5, pinned = $6, active = $7,
         published_at = coalesce($8, published_at), updated_at = now() where id = $1 returning *`,
      [
        existing.id,
        body.title ?? existing.title,
        body.body ?? existing.body,
        imageUrl,
        imagePublicId,
        body.pinned ?? existing.pinned,
        body.active ?? existing.active,
        parseDate(body.publishedAt)
      ]
    );
    // The replaced picture leaves the store with the reference.
    if (existing.image_public_id && existing.image_public_id !== imagePublicId) await destroyMedia(existing.image_public_id, 'image');
    await audit(db, me, 'POST_UPDATE', rows[0].title);
    await broadcast('content', 'posts', {postId: existing.id});
    return {post: postOf(rows[0])};
  });

  router.delete('/api/posts/:id', async ({db, user, params}) => {
    const me = requireRole({user}, 'owner');
    const {rows} = await db.query('delete from public.posts where id = $1 returning *', [params.id]);
    if (!rows[0]) throw notFound('A hír nem található');
    await destroyMedia(rows[0].image_public_id, 'image');
    await audit(db, me, 'POST_DELETE', rows[0].title);
    await broadcast('content', 'posts', {postId: params.id});
    return {ok: true};
  });

  /* ---------------- "ott leszek" ---------------- */

  /** One tap says "I'll be there"; a second takes it back. Counted per network + browser. */
  router.post('/api/public-events/:id/rsvp', async ({db, req, params}) => {
    const body = await readJson(req);
    const visitor = visitorFingerprint(req, body.visitorToken);
    if (!body.visitorToken) throw bad('A böngészőazonosító hiányzik. Frissítsd az oldalt és próbáld újra.');
    await rateLimit(db, `rsvp:${clientIp(req)}`, 30, 10 * 60 * 1000);
    const event = (await db.query('select id, starts_at, ends_at from public.events where id = $1 and active', [params.id])).rows[0];
    if (!event) throw notFound('Rendezvény nem található');
    const over = event.ends_at ? new Date(event.ends_at).getTime() < Date.now() : new Date(event.starts_at).getTime() < Date.now() - 4 * 3600000;
    if (over) throw bad('Ez az este már lezajlott.');
    const existing = (await db.query('select 1 from public.event_rsvps where event_id = $1 and visitor = $2', [event.id, visitor])).rows[0];
    if (existing) await db.query('delete from public.event_rsvps where event_id = $1 and visitor = $2', [event.id, visitor]);
    else await db.query('insert into public.event_rsvps (event_id, visitor) values ($1, $2)', [event.id, visitor]);
    const count = (await db.query<{n: number}>('select count(*)::int as n from public.event_rsvps where event_id = $1', [event.id])).rows[0].n;
    await broadcast('events', 'rsvp', {eventId: event.id, going: count});
    return {going: !existing, count};
  });

  /* ---------------- the staff board ---------------- */

  router.get('/api/staff/notes', async ({db, user}) => {
    requireUser({user});
    const {rows} = await db.query('select * from public.staff_notes order by pinned desc, at desc limit 40');
    return {notes: rows.map(noteOf)};
  });

  router.post('/api/staff/notes', async ({db, req, user}) => {
    const me = requireRole({user}, 'manager');
    const body = parse(noteBody, await readJson(req));
    const {rows} = await db.query('insert into public.staff_notes (text, by_id, by_name, pinned) values ($1, $2, $3, $4) returning *', [body.text, me.id, me.nickname || me.name, body.pinned && roleAtLeast(me.role, 'owner')]);
    await db.query(`delete from public.staff_notes where id in (select id from public.staff_notes where not pinned order by at desc offset 60)`);
    await audit(db, me, 'BOARD_POST', body.text.slice(0, 80));
    await broadcast('staff', 'notes', {noteId: rows[0].id});
    return created({note: noteOf(rows[0])});
  });

  router.patch('/api/staff/notes/:id', async ({db, req, user, params}) => {
    const me = requireRole({user}, 'owner');
    const body = await readJson(req);
    const {rows} = await db.query('update public.staff_notes set pinned = $2 where id = $1 returning *', [params.id, !!body.pinned]);
    if (!rows[0]) throw notFound('A bejegyzés nem található');
    await audit(db, me, body.pinned ? 'BOARD_PIN' : 'BOARD_UNPIN', rows[0].text.slice(0, 80));
    await broadcast('staff', 'notes', {noteId: rows[0].id});
    return {note: noteOf(rows[0])};
  });

  /** The author or an owner takes a note down. */
  router.delete('/api/staff/notes/:id', async ({db, user, params}) => {
    const me = requireUser({user});
    const note = (await db.query('select * from public.staff_notes where id = $1', [params.id])).rows[0];
    if (!note) throw notFound('A bejegyzés nem található');
    if (note.by_id !== me.id && !roleAtLeast(me.role, 'owner')) throw forbidden('Csak a szerző vagy a tulajdonos veheti le.');
    await db.query('delete from public.staff_notes where id = $1', [note.id]);
    await audit(db, me, 'BOARD_DELETE', String(note.text).slice(0, 80));
    await broadcast('staff', 'notes', {noteId: note.id});
    return {ok: true};
  });
}
