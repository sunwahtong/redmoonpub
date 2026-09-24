/**
 * The owner's side of the house: events, the signature drink slots, the house
 * particulars and family tree, map markers, and every analytics view the
 * dashboards and reports read.
 */
import crypto from 'node:crypto';
import {z} from 'zod';
import {audit, requireRole, requireUser} from '../auth.ts';
import {bad, created, dayKey, iso, notFound, parse, readJson, type Router} from '../http.ts';
import {acceptImage, destroyMedia} from '../media.ts';
import {broadcast} from '../realtime.ts';
import {blipFromRow, eventFromRow, galleryPublic} from './public.ts';
import type {Ctx, Queryable, Row, SessionUser} from '../types.ts';

const BLIP_KINDS = ['hq', 'bar', 'food', 'shop', 'garage', 'parking', 'meeting', 'hospital', 'police', 'danger', 'info', 'event', 'custom'] as const;

const eventBody = z.object({
  title: z.string().trim().min(2, 'Cím kötelező.').max(120),
  subtitle: z.string().trim().max(160).default(''),
  description: z.string().trim().max(1200).default(''),
  place: z.string().trim().max(120).default('Red Moon Pub'),
  startsAt: z.string().trim().min(1, 'Kezdési idő kötelező.'),
  endsAt: z.string().trim().nullable().optional(),
  tag: z.string().trim().max(40).default(''),
  coverImage: z.string().trim().max(600).default(''),
  coverPublicId: z.string().trim().max(200).default(''),
  entryFee: z.coerce.number().int().min(0).max(10_000_000).nullable().optional(),
  dressCode: z.string().trim().max(120).default(''),
  featured: z.boolean().default(false),
  active: z.boolean().default(true)
});
type EventInput = z.infer<typeof eventBody>;

const houseBody = z.object({
  name: z.string().trim().min(2).max(80).optional(),
  address: z.string().trim().max(160).optional(),
  phone: z.string().trim().max(40).optional(),
  registration: z.string().trim().max(40).optional(),
  ownerUserId: z.string().nullable().optional(),
  transferAccount: z.string().trim().max(60).optional(),
  transferName: z.string().trim().max(80).optional(),
  /** A YouTube link or id; empty removes the film from the home page. */
  featuredVideo: z.string().trim().max(200).optional(),
  featuredVideoTitle: z.string().trim().max(120).optional(),
  featuredVideoCaption: z.string().trim().max(240).optional()
});

/** The 11-character id out of any YouTube address (watch, youtu.be, shorts, embed) or a bare id. */
export function youtubeId(value: unknown): string | null {
  const raw = String(value || '').trim();
  if (!raw) return '';
  if (/^[A-Za-z0-9_-]{11}$/.test(raw)) return raw;
  const match = raw.match(/(?:youtu\.be\/|youtube(?:-nocookie)?\.com\/(?:watch\?(?:.*&)?v=|embed\/|shorts\/|live\/|v\/))([A-Za-z0-9_-]{11})/);
  return match ? match[1] : null;
}

const personBody = z.object({
  name: z.string().trim().min(2).max(80),
  title: z.string().trim().max(80).default(''),
  note: z.string().trim().max(120).default(''),
  monogram: z.string().trim().max(6).default(''),
  tier: z.enum(['owner', 'co-owner', 'manager', 'staff']).default('manager'),
  sortOrder: z.coerce.number().int().min(0).max(1000).default(0),
  active: z.boolean().default(true)
});

const galleryBody = z.object({
  title: z.string().trim().max(80).default(''),
  caption: z.string().trim().max(200).default(''),
  tag: z.enum(['ter', 'este', 'jel']).default('este'),
  imageUrl: z.string().trim().min(1, 'Kép kötelező.').max(600),
  publicId: z.string().trim().max(200).default(''),
  width: z.coerce.number().int().min(0).max(20000).default(0),
  height: z.coerce.number().int().min(0).max(20000).default(0),
  active: z.boolean().default(true)
});

const galleryPatch = galleryBody.partial();

const orderBody = z.array(z.object({id: z.string().min(1), sortOrder: z.coerce.number().int().min(0).max(10000), tier: z.enum(['owner', 'co-owner', 'manager', 'staff']).optional()})).max(200);

const blipCreate = z.object({
  x: z.coerce.number().finite(),
  y: z.coerce.number().finite(),
  kind: z.enum(BLIP_KINDS, {message: 'Ismeretlen jelölő típus.'}).default('custom'),
  icon: z.coerce.number().int().min(1).max(999).default(1),
  label: z.string().trim().min(1, 'A jelölő neve kötelező.').max(80),
  description: z.string().trim().max(400).default(''),
  group: z.string().trim().max(60).default('Red Moon')
});

const blipUpdate = blipCreate.partial().extend({active: z.boolean().optional()});

const parseDate = (value: string, label: string): Date => {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) throw bad(`Érvénytelen ${label}.`);
  return date;
};

const BURN_WINDOW_DAYS = 14;

export function registerHouseRoutes(router: Router): void {
  /* ---------------- events ---------------- */

  router.get('/api/events', async ({db, user}) => {
    requireRole({user}, 'owner');
    const {rows} = await db.query('select * from public.events order by starts_at desc limit 200');
    return {events: rows.map(eventFromRow)};
  });

  const upsertEvent = async (db: Queryable, user: SessionUser, body: EventInput, id: string | null = null): Promise<Row> => {
    const startsAt = parseDate(body.startsAt, 'kezdési idő');
    const endsAt = body.endsAt ? parseDate(body.endsAt, 'befejezési idő') : null;
    if (endsAt && endsAt <= startsAt) throw bad('A befejezés a kezdés után legyen.');
    acceptImage(body.coverImage, body.coverPublicId, 'event');
    const coverPublicId = body.coverImage ? body.coverPublicId : '';
    if (body.featured) await db.query('update public.events set featured = false where featured');
    const values = [body.title, body.subtitle, body.description, body.place || 'Red Moon Pub', startsAt, endsAt, body.tag, body.coverImage, coverPublicId, body.entryFee ?? null, body.dressCode, body.featured, body.active];
    if (id) {
      const {rows} = await db.query(
        `update public.events set title = $2, subtitle = $3, description = $4, place = $5, starts_at = $6, ends_at = $7, tag = $8,
           cover_image = $9, cover_public_id = $10, entry_fee = $11, dress_code = $12, featured = $13, active = $14 where id = $1 returning *`,
        [id, ...values]
      );
      return rows[0];
    }
    const {rows} = await db.query(
      `insert into public.events (title, subtitle, description, place, starts_at, ends_at, tag, cover_image, cover_public_id, entry_fee, dress_code, featured, active, created_by, created_by_name)
       values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15) returning *`,
      [...values, user.id, user.name]
    );
    return rows[0];
  };

  const createEvent = async ({db, req, user}: Ctx) => {
    const me = requireRole({user}, 'owner');
    const body = parse(eventBody, await readJson(req));
    const row = await upsertEvent(db, me, body);
    await audit(db, me, 'EVENT_CREATE', `${row.title} · ${row.place} · ${new Date(row.starts_at).toLocaleString('hu-HU')}`);
    await broadcast('events', 'change', {eventId: row.id});
    return created({event: eventFromRow(row)});
  };
  router.post('/api/events', createEvent);
  router.post('/api/events/create', createEvent);

  router.patch('/api/events/:id', async ({db, req, user, params}) => {
    const me = requireRole({user}, 'owner');
    const existing = (await db.query('select * from public.events where id = $1', [params.id])).rows[0];
    if (!existing) throw notFound('Rendezvény nem található');
    const raw = await readJson(req);
    const merged = parse(eventBody, {
      ...eventFromRow(existing),
      ...raw,
      // A new picture brings its own id; a typed /assets path has none.
      coverPublicId: raw.coverImage !== undefined ? raw.coverPublicId || '' : existing.cover_public_id || '',
      startsAt: raw.startsAt ?? iso(existing.starts_at),
      endsAt: raw.endsAt === undefined ? iso(existing.ends_at) : raw.endsAt
    });
    const row = await upsertEvent(db, me, merged, params.id);
    // The replaced cover leaves the store with the reference.
    if (existing.cover_public_id && existing.cover_public_id !== row.cover_public_id) await destroyMedia(existing.cover_public_id, 'image');
    await audit(db, me, 'EVENT_UPDATE', row.title);
    await broadcast('events', 'change', {eventId: row.id});
    return {event: eventFromRow(row)};
  });

  router.delete('/api/events/:id', async ({db, user, params}) => {
    const me = requireRole({user}, 'owner');
    const {rows} = await db.query<{title: string; cover_public_id: string}>('delete from public.events where id = $1 returning title, cover_public_id', [params.id]);
    if (!rows[0]) throw notFound('Rendezvény nem található');
    await destroyMedia(rows[0].cover_public_id, 'image');
    await audit(db, me, 'EVENT_DELETE', rows[0].title);
    await broadcast('events', 'change', {eventId: params.id});
    return {ok: true};
  });

  /* ---------------- signature drinks ---------------- */

  const signatureDrinks = async (db: Queryable) => {
    const {rows} = await db.query(
      `select s.slot, s.description, p.id, p.name, p.image, p.active from public.signature_drinks s
       join public.products p on p.id = s.product_id order by s.slot`
    );
    return rows.map((row) => ({productId: row.id, name: row.name, image: row.image || '', description: row.description || '', slot: row.slot, active: row.active}));
  };

  router.get('/api/signature-drinks', async ({db, user}) => {
    requireRole({user}, 'owner');
    return {drinks: await signatureDrinks(db)};
  });

  router.put('/api/signature-drinks', async ({db, req, user}) => {
    const me = requireRole({user}, 'owner');
    const body = await readJson(req);
    const raw: Row[] = Array.isArray(body.drinks) ? body.drinks.slice(0, 3) : [];
    const seen = new Set<string>();
    const cleaned: {productId: string; name: string; description: string}[] = [];
    for (const item of raw) {
      const productId = String(item?.productId || '').trim();
      if (!productId || seen.has(productId)) continue;
      const product = (await db.query(`select id, name from public.products where id = $1 and active and category = 'drink'`, [productId])).rows[0];
      if (!product) throw bad('A kiválasztott ital nem található az aktív italok között.');
      seen.add(productId);
      cleaned.push({productId, name: product.name, description: String(item?.description || '').trim().slice(0, 260)});
    }
    await db.tx(async (tx) => {
      await tx.query('delete from public.signature_drinks');
      for (const [index, item] of cleaned.entries()) {
        await tx.query('insert into public.signature_drinks (slot, product_id, description, updated_by) values ($1, $2, $3, $4)', [index + 1, item.productId, item.description, me.id]);
      }
    });
    await audit(db, me, 'SIGNATURE_DRINKS_UPDATE', cleaned.length ? cleaned.map((item, index) => `${index + 1}. ${item.name}${item.description ? ' · ' + item.description : ''}`).join(' | ') : 'A Signature Drinks lista kiürítve');
    await broadcast('content', 'drinks');
    return {drinks: await signatureDrinks(db)};
  });

  /* ---------------- house particulars & people ---------------- */

  const houseOf = (row: Row) => ({
    name: row.name,
    address: row.address,
    phone: row.phone,
    registration: row.registration,
    ownerUserId: row.owner_user_id,
    transferAccount: row.transfer_account,
    transferName: row.transfer_name,
    pubOpen: !!row.pub_open,
    pubOpenedAt: iso(row.pub_opened_at),
    pubOpenedByName: row.pub_opened_by_name || '',
    pubNote: row.pub_note || '',
    revenueResetAt: iso(row.revenue_reset_at),
    activityResetAt: iso(row.activity_reset_at),
    featuredVideo: row.featured_video || '',
    featuredVideoTitle: row.featured_video_title || '',
    featuredVideoCaption: row.featured_video_caption || ''
  });

  const personOf = (row: Row) => ({id: row.id, name: row.name, title: row.title, note: row.note, monogram: row.monogram, tier: row.tier, sortOrder: row.sort_order, active: row.active});

  router.get('/api/house', async ({db, user}) => {
    requireRole({user}, 'owner');
    const house = (await db.query('select * from public.house where id = 1')).rows[0];
    const people = (await db.query('select * from public.house_people order by sort_order, name')).rows;
    return {house: houseOf(house), people: people.map(personOf)};
  });

  router.patch('/api/house', async ({db, req, user}) => {
    const me = requireRole({user}, 'owner');
    const body = parse(houseBody, await readJson(req));
    if (body.ownerUserId) {
      const owner = (await db.query(`select 1 from public.staff_accounts where id = $1 and role = 'owner'`, [body.ownerUserId])).rows[0];
      if (!owner) throw bad('Az aláíró tulajdonosnak OWNER fióknak kell lennie.');
    }
    const fields: string[] = [];
    const values: unknown[] = [];
    const set = (column: string, value: unknown) => {
      values.push(value);
      fields.push(`${column} = $${values.length}`);
    };
    if (body.name !== undefined) set('name', body.name);
    if (body.address !== undefined) set('address', body.address);
    if (body.phone !== undefined) set('phone', body.phone);
    if (body.registration !== undefined) set('registration', body.registration);
    if (body.ownerUserId !== undefined) set('owner_user_id', body.ownerUserId || null);
    if (body.transferAccount !== undefined) set('transfer_account', body.transferAccount);
    if (body.transferName !== undefined) set('transfer_name', body.transferName);
    if (body.featuredVideo !== undefined) {
      const id = youtubeId(body.featuredVideo);
      if (id === null) throw bad('Ez nem YouTube cím. Illeszd be a videó linkjét (youtube.com/watch?v=… vagy youtu.be/…).');
      set('featured_video', id);
    }
    if (body.featuredVideoTitle !== undefined) set('featured_video_title', body.featuredVideoTitle);
    if (body.featuredVideoCaption !== undefined) set('featured_video_caption', body.featuredVideoCaption);
    if (fields.length) await db.query(`update public.house set ${fields.join(', ')} where id = 1`, values);
    await audit(db, me, 'HOUSE_UPDATE', Object.keys(body).join(', '));
    await broadcast('content', 'house');
    const house = (await db.query('select * from public.house where id = 1')).rows[0];
    return {house: houseOf(house)};
  });

  router.post('/api/house/people', async ({db, req, user}) => {
    const me = requireRole({user}, 'owner');
    const body = parse(personBody, await readJson(req));
    const {rows} = await db.query('insert into public.house_people (name, title, note, monogram, tier, sort_order, active) values ($1, $2, $3, $4, $5, $6, $7) returning *', [
      body.name,
      body.title,
      body.note,
      body.monogram || body.name.slice(0, 2).toUpperCase(),
      body.tier,
      body.sortOrder,
      body.active
    ]);
    await audit(db, me, 'HOUSE_PERSON_CREATE', body.name);
    await broadcast('content', 'people');
    return created({person: personOf(rows[0])});
  });

  router.patch('/api/house/people/:id', async ({db, req, user, params}) => {
    const me = requireRole({user}, 'owner');
    const existing = (await db.query('select * from public.house_people where id = $1', [params.id])).rows[0];
    if (!existing) throw notFound('A személy nem található');
    const raw = await readJson(req);
    const body = parse(personBody, {name: existing.name, title: existing.title, note: existing.note, monogram: existing.monogram, tier: existing.tier, sortOrder: existing.sort_order, active: existing.active, ...raw});
    const {rows} = await db.query('update public.house_people set name = $2, title = $3, note = $4, monogram = $5, tier = $6, sort_order = $7, active = $8 where id = $1 returning *', [
      params.id,
      body.name,
      body.title,
      body.note,
      body.monogram || body.name.slice(0, 2).toUpperCase(),
      body.tier,
      body.sortOrder,
      body.active
    ]);
    await audit(db, me, 'HOUSE_PERSON_UPDATE', body.name);
    await broadcast('content', 'people');
    return {person: personOf(rows[0])};
  });

  router.delete('/api/house/people/:id', async ({db, user, params}) => {
    const me = requireRole({user}, 'owner');
    const {rows} = await db.query<{name: string}>('delete from public.house_people where id = $1 returning name', [params.id]);
    if (!rows[0]) throw notFound('A személy nem található');
    await audit(db, me, 'HOUSE_PERSON_DELETE', rows[0].name);
    await broadcast('content', 'people');
    return {ok: true};
  });

  /** Drag-and-drop result: every person's tier and position in one go. */
  router.put('/api/house/people/order', async ({db, req, user}) => {
    const me = requireRole({user}, 'owner');
    const body = parse(orderBody, await readJson(req));
    await db.tx(async (tx) => {
      for (const entry of body) {
        await tx.query('update public.house_people set sort_order = $2, tier = coalesce($3, tier) where id = $1', [entry.id, entry.sortOrder, entry.tier || null]);
      }
    });
    await audit(db, me, 'HOUSE_PEOPLE_REORDER', `${body.length} személy`);
    await broadcast('content', 'people');
    const people = (await db.query('select * from public.house_people order by sort_order, name')).rows;
    return {people: people.map(personOf)};
  });

  /* ---------------- gallery ---------------- */

  router.get('/api/gallery', async ({db, user}) => {
    requireRole({user}, 'owner');
    const {rows} = await db.query('select * from public.gallery_items order by sort_order, created_at');
    return {items: rows.map(galleryPublic)};
  });

  router.post('/api/gallery', async ({db, req, user}) => {
    const me = requireRole({user}, 'owner');
    const body = parse(galleryBody, await readJson(req));
    acceptImage(body.imageUrl, body.publicId, 'gallery');
    const order = (await db.query<{n: number}>('select coalesce(max(sort_order), -1)::int + 1 as n from public.gallery_items')).rows[0].n;
    const {rows} = await db.query(
      `insert into public.gallery_items (title, caption, tag, image_url, public_id, width, height, sort_order, active, created_by, created_by_name)
       values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11) returning *`,
      [body.title, body.caption, body.tag, body.imageUrl, body.publicId, body.width, body.height, order, body.active, me.id, me.name]
    );
    await audit(db, me, 'GALLERY_ADD', body.title || body.imageUrl);
    await broadcast('content', 'gallery');
    return created({item: galleryPublic(rows[0])});
  });

  router.patch('/api/gallery/:id', async ({db, req, user, params}) => {
    const me = requireRole({user}, 'owner');
    const existing = (await db.query('select * from public.gallery_items where id = $1', [params.id])).rows[0];
    if (!existing) throw notFound('A kép nem található');
    const body = parse(galleryPatch, await readJson(req));
    if (body.imageUrl) acceptImage(body.imageUrl, body.publicId ?? existing.public_id, 'gallery');
    const {rows} = await db.query(
      `update public.gallery_items set title = $2, caption = $3, tag = $4, image_url = $5, public_id = $6, width = $7, height = $8, active = $9 where id = $1 returning *`,
      [
        params.id,
        body.title ?? existing.title,
        body.caption ?? existing.caption,
        body.tag ?? existing.tag,
        body.imageUrl ?? existing.image_url,
        body.publicId ?? existing.public_id,
        body.width ?? existing.width,
        body.height ?? existing.height,
        body.active ?? existing.active
      ]
    );
    if (body.imageUrl && body.imageUrl !== existing.image_url) await destroyMedia(existing.public_id, 'image');
    await audit(db, me, 'GALLERY_UPDATE', rows[0].title || rows[0].id);
    await broadcast('content', 'gallery');
    return {item: galleryPublic(rows[0])};
  });

  router.delete('/api/gallery/:id', async ({db, user, params}) => {
    const me = requireRole({user}, 'owner');
    const {rows} = await db.query('delete from public.gallery_items where id = $1 returning *', [params.id]);
    if (!rows[0]) throw notFound('A kép nem található');
    await destroyMedia(rows[0].public_id, 'image');
    await audit(db, me, 'GALLERY_DELETE', rows[0].title || rows[0].id);
    await broadcast('content', 'gallery');
    return {ok: true};
  });

  router.put('/api/gallery/order', async ({db, req, user}) => {
    const me = requireRole({user}, 'owner');
    const body = parse(orderBody, await readJson(req));
    await db.tx(async (tx) => {
      for (const entry of body) await tx.query('update public.gallery_items set sort_order = $2 where id = $1', [entry.id, entry.sortOrder]);
    });
    await audit(db, me, 'GALLERY_REORDER', `${body.length} kép`);
    await broadcast('content', 'gallery');
    const {rows} = await db.query('select * from public.gallery_items order by sort_order, created_at');
    return {items: rows.map(galleryPublic)};
  });

  /* ---------------- map markers ---------------- */

  router.get('/api/map-blips', async ({db, user}) => {
    requireUser({user});
    const {rows} = await db.query('select * from public.map_blips order by created_at desc');
    return {blips: rows.map((row) => ({...blipFromRow(row), active: row.active !== false, createdByName: row.created_by_name || '', createdAt: iso(row.created_at)}))};
  });

  router.post('/api/map-blips', async ({db, req, user}) => {
    const me = requireRole({user}, 'manager');
    const body = parse(blipCreate, await readJson(req));
    const id = `blip_${crypto.randomBytes(6).toString('hex')}`;
    const {rows} = await db.query(
      `insert into public.map_blips (id, x, y, kind, icon, label, description, group_name, created_by, created_by_name)
       values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10) returning *`,
      [id, body.x, body.y, body.kind, body.icon, body.label, body.description, body.group || 'Red Moon', me.id, me.name]
    );
    await audit(db, me, 'MAP_BLIP_CREATE', `${body.label} · ${Math.round(body.x)}, ${Math.round(body.y)}`);
    return created({blip: blipFromRow(rows[0])});
  });

  router.patch('/api/map-blips/:id', async ({db, req, user, params}) => {
    const me = requireRole({user}, 'manager');
    const existing = (await db.query('select * from public.map_blips where id = $1', [params.id])).rows[0];
    if (!existing) throw notFound('A jelölő nem található');
    const body = parse(blipUpdate, await readJson(req));
    const {rows} = await db.query(
      `update public.map_blips set x = $2, y = $3, kind = $4, icon = $5, label = $6, description = $7, group_name = $8, active = $9 where id = $1 returning *`,
      [params.id, body.x ?? existing.x, body.y ?? existing.y, body.kind ?? existing.kind, body.icon ?? existing.icon, body.label ?? existing.label, body.description ?? existing.description, body.group || existing.group_name || 'Red Moon', body.active ?? existing.active]
    );
    await audit(db, me, 'MAP_BLIP_UPDATE', rows[0].label);
    return {blip: blipFromRow(rows[0])};
  });

  router.delete('/api/map-blips/:id', async ({db, user, params}) => {
    const me = requireRole({user}, 'manager');
    const {rows} = await db.query<{label: string}>('delete from public.map_blips where id = $1 returning label', [params.id]);
    if (!rows[0]) throw notFound('A jelölő nem található');
    await audit(db, me, 'MAP_BLIP_DELETE', rows[0].label);
    return {ok: true};
  });

  /* ---------------- analytics ---------------- */

  router.get('/api/analytics/me', async ({db, user}) => {
    const me = requireUser({user});
    return personalAnalytics(db, me.id);
  });

  router.get('/api/analytics/staff/:id', async ({db, user, params}) => {
    requireRole({user}, 'manager');
    const target = (await db.query('select id, name, role, jobs from public.staff_accounts where id = $1', [params.id])).rows[0];
    if (!target) throw notFound('A dolgozó nem található.');
    return {user: {id: target.id, name: target.name, role: target.role, jobs: target.jobs || []}, ...(await personalAnalytics(db, target.id))};
  });

  router.get('/api/analytics/storage', async ({db, user}) => {
    requireRole({user}, 'manager');
    return storageAnalytics(db);
  });

  router.get('/api/analytics/business', async ({db, user}) => {
    requireRole({user}, 'owner');
    return businessAnalytics(db);
  });

  /* ---------------- reports & finance ---------------- */

  router.get('/api/finance/overall', async ({db, user}) => {
    requireUser({user});
    const {rows} = await db.query<{raw: number; current: number}>(
      `select coalesce(sum(s.total),0)::int as raw,
              coalesce(sum(s.total) filter (where h.revenue_reset_at is null or s.at > h.revenue_reset_at),0)::int as current
       from public.house h left join public.sales s on true where h.id = 1`
    );
    const row = rows[0] || {raw: 0, current: 0};
    return {overallRevenue: row.current, rawRevenue: row.raw, offset: row.raw - row.current};
  });

  router.post('/api/finance/reset', async ({db, user}) => {
    const me = requireRole({user}, 'owner');
    await db.query('update public.house set revenue_reset_at = now() where id = 1');
    await audit(db, me, 'OVERALL_REVENUE_RESET', 'Az overall bevétel számláló nullázva');
    return {overallRevenue: 0};
  });

  router.get('/api/owner/activity', async ({db, user}) => {
    requireRole({user}, 'owner');
    const house = (await db.query('select activity_reset_at from public.house where id = 1')).rows[0];
    const resetAt = house.activity_reset_at ? new Date(house.activity_reset_at).getTime() : 0;
    const now = Date.now();
    const users = (await db.query('select id, name, role, jobs from public.staff_accounts where active order by name')).rows;
    const members = (
      await db.query(
        `select m.user_id, m.joined_at, m.left_at, s.status, s.started_at, s.ended_at from public.shift_members m
         join public.shifts s on s.id = m.shift_id where m.user_id is not null`
      )
    ).rows;
    const sales = (await db.query('select user_id, transaction_id, qty, total, at from public.sales where at > $1', [new Date(resetAt)])).rows;
    const staff = users
      .map((account) => {
        let workedMs = 0;
        let shifts = 0;
        let active = false;
        for (const member of members.filter((entry) => entry.user_id === account.id)) {
          const end = member.status === 'open' ? now : new Date(member.left_at || member.ended_at || member.joined_at).getTime();
          if (member.status === 'open') active = true;
          if (!end || end <= resetAt) continue;
          const start = Math.max(new Date(member.joined_at).getTime(), resetAt);
          if (end > start) {
            workedMs += end - start;
            shifts += 1;
          }
        }
        const own = sales.filter((sale) => sale.user_id === account.id);
        const transactions = new Set(own.map((sale) => sale.transaction_id));
        return {
          id: account.id,
          name: account.name,
          role: account.role,
          jobs: account.jobs || [],
          workedMs,
          workedHours: Math.round((workedMs / 3600000) * 10) / 10,
          active,
          shifts,
          sales: transactions.size,
          items: own.reduce((sum, sale) => sum + Number(sale.qty || 0), 0),
          revenue: own.reduce((sum, sale) => sum + Number(sale.total || 0), 0)
        };
      })
      .sort((a, b) => b.workedMs - a.workedMs || b.revenue - a.revenue || a.name.localeCompare(b.name, 'hu'));
    return {resetAt: iso(house.activity_reset_at), generatedAt: new Date().toISOString(), staff};
  });

  router.post('/api/owner/activity/reset', async ({db, user}) => {
    const me = requireRole({user}, 'owner');
    await db.query('update public.house set activity_reset_at = now() where id = 1');
    await audit(db, me, 'STAFF_ACTIVITY_RESET', 'Dolgozói aktivitás nullázva');
    return {ok: true, resetAt: new Date().toISOString()};
  });

  router.get('/api/owner/performance', async ({db, user}) => {
    requireRole({user}, 'owner');
    const shifts = (await db.query(`select * from public.shifts where status = 'closed' order by started_at desc limit 100`)).rows;
    const ids = shifts.map((shift) => shift.id);
    const sales = ids.length ? (await db.query('select * from public.sales where shift_id = any($1)', [ids])).rows : [];
    const people = new Map<string, {name: string; shifts: number; revenue: number; sales: number; items: number; hours: number}>();
    const shiftBreakdown = shifts.map((shift) => {
      const own = sales.filter((sale) => sale.shift_id === shift.id);
      const breakdown: Row[] = Array.isArray(shift.closure?.employeeBreakdown) ? shift.closure.employeeBreakdown : [];
      for (const entry of breakdown) {
        const person = people.get(entry.name) || {name: entry.name, shifts: 0, revenue: 0, sales: 0, items: 0, hours: 0};
        person.shifts += 1;
        person.revenue += Number(entry.revenue) || 0;
        person.sales += Number(entry.sales) || 0;
        person.items += Number(entry.items) || 0;
        person.hours += (Number(entry.workedMs) || 0) / 3600000;
        people.set(entry.name, person);
      }
      const byUser: Record<string, {name: string; revenue: number; sales: number; items: number}> = {};
      for (const sale of own) {
        byUser[sale.user_name] ||= {name: sale.user_name, revenue: 0, sales: 0, items: 0};
        byUser[sale.user_name].revenue += sale.total;
        byUser[sale.user_name].sales += 1;
        byUser[sale.user_name].items += sale.qty;
      }
      return {id: shift.id, startedAt: iso(shift.started_at), endedAt: iso(shift.ended_at), revenue: shift.revenue, employees: Object.values(byUser)};
    });
    const products = (await db.query('select product_name as product, sum(qty)::int as qty from public.sales group by product_name order by qty desc limit 12')).rows;
    return {
      staff: [...people.values()].map((person) => ({...person, hours: Math.round(person.hours * 10) / 10, revenuePerHour: person.hours ? Math.round(person.revenue / person.hours) : 0})),
      shifts: shifts.map((shift) => ({id: shift.id, startedAt: iso(shift.started_at), endedAt: iso(shift.ended_at), revenue: shift.revenue, salesCount: shift.sales_count, items: shift.items})),
      shiftBreakdown,
      topProducts: products,
      generatedAt: new Date().toISOString()
    };
  });
}

/* ------------------------------------------------------------------ */
/* Analytics                                                           */
/* ------------------------------------------------------------------ */

const hoursBetween = (start: string, end: string | null): number => {
  const a = new Date(start).getTime();
  const b = end ? new Date(end).getTime() : Date.now();
  if (!Number.isFinite(a) || !Number.isFinite(b) || b < a) return 0;
  return (b - a) / 3600000;
};

interface DayBucket {
  date: string;
  shifts: number;
  hours: number;
  sales: number;
  revenue: number;
  orders: number;
  spend: number;
}

export async function personalAnalytics(db: Queryable, userId: string) {
  const shifts = (
    await db.query(
      `select s.*, m.joined_at, m.left_at from public.shift_members m join public.shifts s on s.id = m.shift_id
       where m.user_id = $1 order by s.started_at desc`,
      [userId]
    )
  ).rows;
  const sales = (await db.query('select * from public.sales where user_id = $1 order by at desc', [userId])).rows;
  const orders = (await db.query(`select * from public.supply_orders where completed_by = $1 and status = 'completed'`, [userId])).rows;
  const claimed = (
    await db.query(
      `select o.*, (select count(*)::int from public.supply_order_items i where i.order_id = o.id) as item_count
       from public.supply_orders o where o.claimed_by = $1 and o.status in ('claimed','progress')`,
      [userId]
    )
  ).rows;

  const days: Record<string, DayBucket> = {};
  const bump = (at: string, field: keyof Omit<DayBucket, 'date'>, value: number) => {
    const key = dayKey(at);
    if (!key) return;
    days[key] ||= {date: key, shifts: 0, hours: 0, sales: 0, revenue: 0, orders: 0, spend: 0};
    days[key][field] += value;
  };
  for (const shift of shifts) {
    bump(shift.started_at, 'shifts', 1);
    bump(shift.started_at, 'hours', hoursBetween(shift.joined_at, shift.left_at || shift.ended_at));
  }
  for (const sale of sales) {
    bump(sale.at, 'sales', 1);
    bump(sale.at, 'revenue', Number(sale.total) || 0);
  }
  for (const order of orders) {
    bump(order.completed_at, 'orders', 1);
    bump(order.completed_at, 'spend', Number(order.actual_total) || 0);
  }
  const hours = shifts.reduce((sum, shift) => sum + hoursBetween(shift.joined_at, shift.left_at || shift.ended_at), 0);
  const revenue = sales.reduce((sum, sale) => sum + (Number(sale.total) || 0), 0);
  const estimated = orders.reduce((sum, order) => sum + (Number(order.estimated_total) || 0), 0);
  const actual = orders.reduce((sum, order) => sum + (Number(order.actual_total) || 0), 0);
  const open = shifts.find((shift) => shift.status === 'open');
  return {
    totals: {
      shifts: shifts.length,
      hours: Math.round(hours * 10) / 10,
      sales: new Set(sales.map((sale) => sale.transaction_id)).size,
      items: sales.reduce((sum, sale) => sum + (Number(sale.qty) || 0), 0),
      revenue,
      orders: orders.length,
      orderEstimated: estimated,
      orderActual: actual,
      orderVariance: actual - estimated
    },
    openShift: open ? {id: open.id, startedAt: iso(open.started_at)} : null,
    claimedOrders: claimed.map((order) => ({id: order.id, code: order.code, status: order.status, estimatedTotal: order.estimated_total, items: order.item_count})),
    recentShifts: shifts.slice(0, 12).map((shift) => ({
      id: shift.id,
      startedAt: iso(shift.started_at),
      endedAt: iso(shift.ended_at),
      status: shift.status,
      hours: Math.round(hoursBetween(shift.joined_at, shift.left_at || shift.ended_at) * 10) / 10,
      revenue: Number(shift.revenue) || 0
    })),
    days: Object.values(days).sort((a, b) => (a.date < b.date ? -1 : 1))
  };
}

export async function storageAnalytics(db: Queryable) {
  const since = new Date(Date.now() - BURN_WINDOW_DAYS * 86400000);
  const products = (await db.query('select * from public.products where active order by name')).rows;
  const sold = (await db.query<{product_id: string; qty: number}>('select product_id, sum(qty)::int as qty from public.sales where at >= $1 group by product_id', [since])).rows;
  const restocked = (
    await db.query<{product_id: string; qty: number; cost: number}>('select product_id, sum(qty)::int as qty, sum(total_cost)::int as cost from public.restock_logs where at >= $1 group by product_id', [since])
  ).rows;
  const rows = products
    .map((product) => {
      const soldQty = sold.find((entry) => entry.product_id === product.id)?.qty || 0;
      const restock = restocked.find((entry) => entry.product_id === product.id);
      const perDay = soldQty / BURN_WINDOW_DAYS;
      const daysLeft = perDay > 0 ? Math.round((product.stock / perDay) * 10) / 10 : null;
      return {
        id: product.id as string,
        name: product.name as string,
        section: (product.section || 'other') as string,
        stock: product.stock as number,
        minStock: product.min_stock as number,
        price: product.price as number,
        sold: soldQty,
        perDay: Math.round(perDay * 100) / 100,
        daysLeft,
        restocked: restock?.qty || 0,
        restockCost: restock?.cost || 0,
        avgUnitCost: restock?.qty ? Math.round(restock.cost / restock.qty) : null,
        below: product.stock <= product.min_stock
      };
    })
    .sort((a, b) => {
      if (a.daysLeft === null && b.daysLeft === null) return b.sold - a.sold;
      if (a.daysLeft === null) return 1;
      if (b.daysLeft === null) return -1;
      return a.daysLeft - b.daysLeft;
    });
  return {
    windowDays: BURN_WINDOW_DAYS,
    generatedAt: new Date().toISOString(),
    products: rows,
    stockValue: rows.reduce((sum, product) => sum + product.stock * (product.avgUnitCost ?? 0), 0),
    retailValue: rows.reduce((sum, product) => sum + product.stock * product.price, 0)
  };
}

export async function businessAnalytics(db: Queryable) {
  const DAYS = 30;
  const since = new Date(Date.now() - DAYS * 86400000);
  const trend: Record<string, {date: string; revenue: number; expense: number; sales: number}> = {};
  for (let i = DAYS - 1; i >= 0; i -= 1) {
    const key = dayKey(Date.now() - i * 86400000);
    trend[key] = {date: key, revenue: 0, expense: 0, sales: 0};
  }
  const sales = (await db.query('select at, total, qty, product_name, transaction_id from public.sales where at >= $1', [since])).rows;
  const expenses = (await db.query('select at, amount from public.expenses where at >= $1', [since])).rows;
  for (const sale of sales) {
    const key = dayKey(sale.at);
    if (trend[key]) {
      trend[key].revenue += Number(sale.total) || 0;
      trend[key].sales += 1;
    }
  }
  for (const expense of expenses) {
    const key = dayKey(expense.at);
    if (trend[key]) trend[key].expense += Number(expense.amount) || 0;
  }
  const byProduct: Record<string, {product: string; qty: number; revenue: number}> = {};
  for (const sale of sales) {
    byProduct[sale.product_name] ||= {product: sale.product_name, qty: 0, revenue: 0};
    byProduct[sale.product_name].qty += Number(sale.qty) || 0;
    byProduct[sale.product_name].revenue += Number(sale.total) || 0;
  }
  const lifetime = (
    await db.query<{revenue: number; expense: number}>(
      `select (select coalesce(sum(total),0)::int from public.sales) as revenue,
              (select coalesce(sum(amount),0)::int from public.expenses) as expense`
    )
  ).rows[0];
  const orders = (
    await db.query(
      `select count(*) filter (where status = 'open')::int as open,
              count(*) filter (where status in ('claimed','progress'))::int as running,
              count(*) filter (where status = 'completed')::int as completed,
              coalesce(sum(variance) filter (where status = 'completed'),0)::int as variance
       from public.supply_orders`
    )
  ).rows[0];
  const staff = (await db.query<{n: number}>('select count(*)::int as n from public.staff_accounts where active')).rows[0];
  return {
    generatedAt: new Date().toISOString(),
    windowDays: DAYS,
    lifetime: {revenue: lifetime.revenue, expense: lifetime.expense, profit: lifetime.revenue - lifetime.expense},
    window: {
      revenue: sales.reduce((sum, sale) => sum + (Number(sale.total) || 0), 0),
      expense: expenses.reduce((sum, expense) => sum + (Number(expense.amount) || 0), 0),
      sales: new Set(sales.map((sale) => sale.transaction_id)).size
    },
    trend: Object.values(trend),
    topProducts: Object.values(byProduct).sort((a, b) => b.revenue - a.revenue).slice(0, 8),
    orders,
    staffCount: staff.n
  };
}
