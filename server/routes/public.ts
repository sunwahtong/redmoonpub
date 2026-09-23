/**
 * Everything a visitor can reach without signing in: the house status, the
 * menu, events, the map, reviews, bookings and job applications.
 *
 * Guests are anonymous. A booking or an application is tied to a hash of the
 * visitor's IP and a browser token, never to an account, so a guest can find
 * and cancel their own record without the site storing anything that
 * identifies them.
 */
import {z} from 'zod';
import {audit, notifyManagers, rateLimit, roleAtLeast} from '../auth.ts';
import {
  bad,
  clientIp,
  conflict,
  created,
  forbidden,
  formatPhone,
  iso,
  normalizePhone,
  notFound,
  parse,
  readJson,
  sha256,
  shortCode,
  tooMany,
  visitorFingerprint,
  type Router
} from '../http.ts';
import {dbKind} from '../db.ts';
import {storageEnabled} from '../storage.ts';
import {config} from '../config.ts';
import type {Queryable, Request, Row} from '../types.ts';

export const RESERVATION_OCCASIONS = ['este', 'szuletesnap', 'uzleti', 'randi', 'csapat', 'vip', 'egyeb'] as const;
export const RESERVATION_TIERS = ['none', 'silver', 'gold', 'black', 'royal'] as const;
export const RESERVATION_MAX_DAYS = 60;
export const RESERVATION_MAX_OPEN = 3;
export const CAREER_POSITIONS = ['bartender', 'pultos', 'felszolgalo', 'dj', 'biztonsag', 'hostess', 'uzletvezeto'] as const;
export const CAREER_MAX_OPEN = 1;

/* ------------------------------------------------------------------ */
/* Mappers                                                             */
/* ------------------------------------------------------------------ */

export const publicProduct = (row: Row) => ({
  id: row.id,
  name: row.name,
  price: row.price,
  image: row.image || '',
  subtitle: row.subtitle || '',
  description: row.description || '',
  section: row.section || 'other'
});

export const eventFromRow = (row: Row) => ({
  id: row.id,
  title: row.title,
  subtitle: row.subtitle || '',
  description: row.description || '',
  place: row.place || 'Red Moon Pub',
  startsAt: iso(row.starts_at),
  endsAt: iso(row.ends_at),
  tag: row.tag || '',
  coverImage: row.cover_image || '',
  entryFee: row.entry_fee ?? null,
  dressCode: row.dress_code || '',
  featured: !!row.featured,
  active: row.active !== false,
  createdByName: row.created_by_name || '',
  createdAt: iso(row.created_at),
  updatedAt: iso(row.updated_at)
});

export const blipFromRow = (row: Row) => ({
  id: row.id,
  x: row.x,
  y: row.y,
  kind: row.kind || 'custom',
  icon: row.icon,
  label: row.label,
  description: row.description || '',
  group: row.group_name || 'Red Moon'
});

export const reservationPublic = (row: Row) => ({
  id: row.id,
  code: row.code,
  at: iso(row.at),
  when: iso(row.starts_at),
  name: row.name,
  guests: row.guests,
  occasion: row.occasion,
  tier: row.tier,
  note: row.note || '',
  status: row.status,
  staffNote: row.staff_note || '',
  handledAt: iso(row.handled_at),
  phone: formatPhone(row.phone || '')
});

export const reservationStaff = (row: Row) => ({...reservationPublic(row), handledByName: row.handled_by_name || null});

export const applicationPublic = (row: Row) => ({
  id: row.id,
  code: row.code,
  at: iso(row.at),
  name: row.name,
  position: row.position,
  age: row.age,
  status: row.status,
  staffNote: row.staff_note || '',
  handledAt: iso(row.handled_at),
  phone: formatPhone(row.phone || '')
});

export const applicationStaff = (row: Row) => ({
  ...applicationPublic(row),
  radio: row.radio || '',
  availability: row.availability || '',
  experience: row.experience || '',
  why: row.why || '',
  handledByName: row.handled_by_name || null
});

/* ------------------------------------------------------------------ */
/* Schemas                                                             */
/* ------------------------------------------------------------------ */

const reservationCreate = z.object({
  name: z.string().trim().min(2, 'Add meg a neved.').max(80),
  phone: z.string().trim().min(1, 'Telefonszám kötelező.').max(40),
  guests: z.coerce.number().int().min(1, 'Legalább egy vendég.').max(20, 'Húsz főnél nagyobb társaságot írj meg üzenetben.'),
  at: z.string().trim().min(1, 'Válassz időpontot.'),
  occasion: z.enum(RESERVATION_OCCASIONS, {message: 'Ismeretlen alkalom.'}).default('este'),
  tier: z.enum(RESERVATION_TIERS, {message: 'Ismeretlen tagsági szint.'}).default('none'),
  note: z.string().trim().max(400).default(''),
  visitorToken: z.string().trim().min(1, 'A böngészőazonosító hiányzik. Frissítsd az oldalt.').max(200)
});

const careerCreate = z.object({
  name: z.string().trim().min(2, 'Add meg a karaktered nevét.').max(80),
  phone: z.string().trim().min(1, 'Telefonszám kötelező.').max(40),
  age: z.coerce.number().int().min(18, 'A Red Moon csak nagykorúakat vesz fel.').max(99),
  radio: z.string().trim().max(24).default(''),
  position: z.enum(CAREER_POSITIONS, {message: 'Ismeretlen pozíció.'}),
  availability: z.string().trim().min(3, 'Írd le, mikor érsz rá.').max(200),
  experience: z.string().trim().max(600).default(''),
  why: z.string().trim().min(20, 'Legalább pár mondatot írj arról, miért minket választanál.').max(900),
  visitorToken: z.string().trim().min(1, 'A böngészőazonosító hiányzik. Frissítsd az oldalt.').max(200)
});

const reviewBody = z.object({
  name: z.string().trim().min(1, 'Név kötelező.').max(80),
  rating: z.coerce.number().int().min(1).max(5),
  text: z.string().trim().min(1, 'Írj pár szót.').max(140),
  phone: z.string().trim().max(40).default(''),
  visitorToken: z.string().trim().max(200).default('')
});

/* ------------------------------------------------------------------ */
/* Shared queries                                                      */
/* ------------------------------------------------------------------ */

export async function houseStatus(db: Queryable) {
  const [house, shift, club, event] = await Promise.all([
    db.query('select pub_open, pub_opened_at, pub_opened_by_name, pub_note, pub_closed_at from public.house where id = 1'),
    db.query(`select id, started_at, started_by_name from public.shifts where status = 'open' limit 1`),
    db.query('select live, dj_name, title from public.club_state where id = 1'),
    db.query(
      `select * from public.events where active and (ends_at is null and starts_at > now() - interval '4 hours' or ends_at > now())
       order by featured desc, starts_at asc limit 1`
    )
  ]);
  const listeners = await db.query<{n: number}>(`select count(*)::int as n from public.club_presence where last_seen > now() - interval '30 seconds'`);
  const h = house.rows[0] || {};
  return {
    open: !!h.pub_open,
    since: iso(h.pub_opened_at),
    openedBy: h.pub_opened_by_name || '',
    note: h.pub_note || '',
    closedAt: iso(h.pub_closed_at),
    shiftOpen: shift.rows.length > 0,
    live: !!club.rows[0]?.live,
    dj: club.rows[0]?.dj_name || null,
    title: club.rows[0]?.title || '',
    listenerCount: listeners.rows[0]?.n || 0,
    nextEvent: event.rows[0] ? eventFromRow(event.rows[0]) : null,
    serverNow: new Date().toISOString()
  };
}

/* ------------------------------------------------------------------ */
/* Routes                                                              */
/* ------------------------------------------------------------------ */

export function registerPublicRoutes(router: Router): void {
  router.get('/api/health', async () => ({
    ok: true,
    service: 'red-moon',
    version: '21.0',
    time: new Date().toISOString(),
    runtime: config.serverless ? 'function' : 'server',
    realtime: 'poll',
    storage: storageEnabled() ? 'bucket' : 'disk',
    database: dbKind()
  }));

  router.get('/api/public/status', async ({db}) => houseStatus(db));

  router.get('/api/public/house', async ({db}) => {
    const [house, people] = await Promise.all([
      db.query('select name, address, phone, registration from public.house where id = 1'),
      db.query('select id, name, title, note, monogram, tier, sort_order from public.house_people where active order by sort_order, name')
    ]);
    return {
      house: house.rows[0] || {name: 'Red Moon Pub', address: '', phone: '', registration: ''},
      people: people.rows.map((row) => ({
        id: row.id,
        name: row.name,
        title: row.title,
        note: row.note,
        monogram: row.monogram || String(row.name).slice(0, 2).toUpperCase(),
        tier: row.tier
      }))
    };
  });

  router.get('/api/public-products', async ({db}) => {
    const {rows} = await db.query(`select * from public.products where active and category = 'drink' order by sort_order, name`);
    return {products: rows.map(publicProduct)};
  });

  router.get('/api/public-signature-drinks', async ({db}) => {
    const {rows} = await db.query(
      `select s.slot, s.description, p.* from public.signature_drinks s
       join public.products p on p.id = s.product_id where p.active order by s.slot`
    );
    return {
      drinks: rows.map((row) => ({
        id: row.id,
        name: row.name,
        image: row.image || '',
        description: String(row.description || row.subtitle || '').trim(),
        slot: row.slot
      }))
    };
  });

  router.get('/api/public-events', async ({db}) => {
    const {rows} = await db.query('select * from public.events where active order by starts_at asc limit 60');
    return {events: rows.map(eventFromRow)};
  });

  router.get('/api/public-map-blips', async ({db}) => {
    const {rows} = await db.query('select * from public.map_blips where active order by created_at desc');
    return {blips: rows.map(blipFromRow)};
  });

  /* ---------------- reviews ---------------- */

  const reviewOf = (row: Row, fingerprint: string) => ({
    id: row.id,
    name: row.name,
    rating: row.rating,
    text: row.text,
    phone: formatPhone(row.phone || ''),
    at: iso(row.at),
    status: row.status,
    isOwn: !!fingerprint && row.visitor_hash === fingerprint
  });

  const reviewFingerprint = (req: Request, token?: unknown): string => {
    const value = String(token || req.headers['x-review-token'] || '').trim().slice(0, 200);
    return value ? sha256(`${clientIp(req)}|${value}`) : '';
  };

  router.get('/api/reviews', async ({db, req}) => {
    const fingerprint = reviewFingerprint(req);
    const {rows} = await db.query(`select * from public.reviews where status = 'published' order by at desc limit 100`);
    const total = rows.reduce((sum, row) => sum + Number(row.rating || 0), 0);
    return {
      reviews: rows.map((row) => reviewOf(row, fingerprint)),
      average: rows.length ? Math.round((total / rows.length) * 10) / 10 : 0,
      count: rows.length,
      hasOwnReview: !!fingerprint && rows.some((row) => row.visitor_hash === fingerprint)
    };
  });

  router.post('/api/reviews', async ({db, req}) => {
    const body = parse(reviewBody, await readJson(req));
    const fingerprint = reviewFingerprint(req, body.visitorToken);
    if (!fingerprint) throw bad('A böngészőazonosító hiányzik. Frissítsd az oldalt és próbáld újra.');
    await rateLimit(db, `review:${clientIp(req)}`, 5, 60 * 60 * 1000);
    const digits = body.phone.replace(/\D/g, '');
    const phone = digits && digits !== '3876' ? normalizePhone(body.phone) : '';
    if (digits && digits !== '3876' && !phone) throw bad('Az opcionális telefonszámhoz 7 számjegyet adj meg.');
    const existing = await db.query('select 1 from public.reviews where visitor_hash = $1', [fingerprint]);
    if (existing.rows.length) throw conflict('Tőled már érkezett vélemény!');
    const {rows} = await db.query(`insert into public.reviews (name, rating, text, phone, visitor_hash) values ($1, $2, $3, $4, $5) returning *`, [
      body.name,
      body.rating,
      [...body.text].slice(0, 140).join(''),
      phone,
      fingerprint
    ]);
    return created({review: reviewOf(rows[0], fingerprint)});
  });

  router.patch('/api/reviews/:id', async ({db, req, params, user}) => {
    if (user && roleAtLeast(user.role, 'owner')) throw forbidden('Az Owner a vendégvéleményeket nem szerkesztheti.');
    const body = parse(reviewBody, await readJson(req));
    const fingerprint = reviewFingerprint(req, body.visitorToken);
    const {rows} = await db.query('select * from public.reviews where id = $1', [params.id]);
    if (!rows[0]) throw notFound('A vélemény nem található');
    if (!fingerprint || rows[0].visitor_hash !== fingerprint) throw forbidden('Csak a saját véleményedet szerkesztheted.');
    const digits = body.phone.replace(/\D/g, '');
    const phone = digits && digits !== '3876' ? normalizePhone(body.phone) : '';
    if (digits && digits !== '3876' && !phone) throw bad('Az opcionális telefonszámhoz 7 számjegyet adj meg.');
    const updated = await db.query(`update public.reviews set name = $2, rating = $3, text = $4, phone = $5, updated_at = now() where id = $1 returning *`, [
      params.id,
      body.name,
      body.rating,
      [...body.text].slice(0, 140).join(''),
      phone
    ]);
    return {review: reviewOf(updated.rows[0], fingerprint)};
  });

  router.delete('/api/reviews/:id', async ({db, req, params, user}) => {
    const {rows} = await db.query('select * from public.reviews where id = $1', [params.id]);
    if (!rows[0]) throw notFound('A vélemény nem található');
    const owner = user && roleAtLeast(user.role, 'owner') ? user : null;
    if (!owner) {
      const body = await readJson(req).catch(() => ({}) as Record<string, unknown>);
      const fingerprint = reviewFingerprint(req, body.visitorToken);
      if (!fingerprint || rows[0].visitor_hash !== fingerprint) throw forbidden('Csak a saját véleményedet törölheted.');
    }
    await db.query('delete from public.reviews where id = $1', [params.id]);
    if (owner) await audit(db, owner, 'REVIEW_DELETE', `${rows[0].name} · ${rows[0].rating}/5 · ${rows[0].text}`);
    return {ok: true, deletedReviewId: params.id};
  });

  /* ---------------- reservations (guest side) ---------------- */

  router.get('/api/public-reservation-info', async () => ({
    occasions: RESERVATION_OCCASIONS,
    tiers: RESERVATION_TIERS,
    maxGuests: 20,
    maxDaysAhead: RESERVATION_MAX_DAYS,
    maxOpen: RESERVATION_MAX_OPEN,
    serverNow: new Date().toISOString()
  }));

  router.get('/api/reservations/mine', async ({db, req, query}) => {
    const token = String(query.get('token') || '').trim().slice(0, 200);
    if (!token) return {reservations: []};
    const {rows} = await db.query('select * from public.reservations where visitor_hash = $1 order by at desc limit 20', [visitorFingerprint(req, token)]);
    return {reservations: rows.map(reservationPublic)};
  });

  router.post('/api/reservations', async ({db, req}) => {
    const body = parse(reservationCreate, await readJson(req));
    await rateLimit(db, `reservation:${clientIp(req)}`, 10, 60 * 60 * 1000);
    const when = new Date(body.at);
    if (Number.isNaN(when.getTime())) throw bad('Érvénytelen időpont.');
    if (when.getTime() < Date.now() + 30 * 60000) throw bad('Legalább fél órával előbbre foglalj.');
    if (when.getTime() > Date.now() + RESERVATION_MAX_DAYS * 86400000) throw bad(`Legfeljebb ${RESERVATION_MAX_DAYS} nappal előre lehet foglalni.`);
    const phone = normalizePhone(body.phone);
    if (!phone) throw bad('A telefonszám 7 számjegyű legyen.');
    const fingerprint = visitorFingerprint(req, body.visitorToken);
    const open = await db.query<{n: number}>(`select count(*)::int as n from public.reservations where visitor_hash = $1 and status in ('pending','confirmed')`, [fingerprint]);
    if (open.rows[0].n >= RESERVATION_MAX_OPEN) {
      throw tooMany(`Egyszerre legfeljebb ${RESERVATION_MAX_OPEN} élő foglalásod lehet. Mondj le egyet, mielőtt újat kérsz.`);
    }
    const {rows} = await db.query(
      `insert into public.reservations (code, starts_at, name, phone, guests, occasion, tier, note, visitor_hash)
       values ($1, $2, $3, $4, $5, $6, $7, $8, $9) returning *`,
      [shortCode(), when, body.name, phone, body.guests, body.occasion, body.tier, body.note, fingerprint]
    );
    const reservation = rows[0];
    await notifyManagers(
      db,
      'Új asztalfoglalás',
      `${reservation.name} · ${reservation.guests} fő · ${new Date(reservation.starts_at).toLocaleString('hu-HU')} · ${reservation.code}`,
      {reservationId: reservation.id}
    );
    return created({reservation: reservationPublic(reservation)});
  });

  router.delete('/api/reservations/:id', async ({db, req, params, user}) => {
    const {rows} = await db.query('select * from public.reservations where id = $1', [params.id]);
    const reservation = rows[0];
    if (!reservation) throw notFound('A foglalás nem található.');
    const manager = user && roleAtLeast(user.role, 'manager') ? user : null;
    if (!manager) {
      const body = await readJson(req).catch(() => ({}) as Record<string, unknown>);
      const token = String(body.visitorToken || '').trim().slice(0, 200);
      if (!token || reservation.visitor_hash !== visitorFingerprint(req, token)) throw forbidden('Csak a saját foglalásodat mondhatod le.');
    }
    const updated = await db.query(`update public.reservations set status = 'cancelled', handled_at = now(), handled_by_name = $2 where id = $1 returning *`, [
      params.id,
      manager ? manager.name : 'Vendég'
    ]);
    if (manager) await audit(db, manager, 'RESERVATION_CANCEL', `${reservation.code} · ${reservation.name}`);
    return {ok: true, reservation: reservationPublic(updated.rows[0])};
  });

  /* ---------------- recruitment (guest side) ---------------- */

  router.get('/api/public-positions', async () => ({positions: CAREER_POSITIONS, maxOpen: CAREER_MAX_OPEN}));

  router.get('/api/careers/mine', async ({db, req, query}) => {
    const token = String(query.get('token') || '').trim().slice(0, 200);
    if (!token) return {applications: []};
    const {rows} = await db.query('select * from public.applications where visitor_hash = $1 order by at desc limit 10', [visitorFingerprint(req, token)]);
    return {applications: rows.map(applicationPublic)};
  });

  router.post('/api/careers', async ({db, req}) => {
    const body = parse(careerCreate, await readJson(req));
    await rateLimit(db, `career:${clientIp(req)}`, 5, 60 * 60 * 1000);
    const phone = normalizePhone(body.phone);
    if (!phone) throw bad('A telefonszám 7 számjegyű legyen.');
    const fingerprint = visitorFingerprint(req, body.visitorToken);
    const open = await db.query<{n: number}>(`select count(*)::int as n from public.applications where visitor_hash = $1 and status in ('pending','interview')`, [fingerprint]);
    if (open.rows[0].n >= CAREER_MAX_OPEN) throw tooMany('Már van folyamatban lévő jelentkezésed. Várd meg a választ, vagy vond vissza.');
    const {rows} = await db.query(
      `insert into public.applications (code, name, phone, age, radio, position, availability, experience, why, visitor_hash)
       values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10) returning *`,
      [shortCode('RM-A'), body.name, phone, body.age, body.radio, body.position, body.availability, body.experience, body.why, fingerprint]
    );
    const application = rows[0];
    await notifyManagers(db, 'Új jelentkezés', `${application.name} · ${application.position} · ${application.code}`, {applicationId: application.id});
    return created({application: applicationPublic(application)});
  });

  router.delete('/api/careers/:id', async ({db, req, params}) => {
    const {rows} = await db.query('select * from public.applications where id = $1', [params.id]);
    const application = rows[0];
    if (!application) throw notFound('A jelentkezés nem található.');
    const body = await readJson(req).catch(() => ({}) as Record<string, unknown>);
    const token = String(body.visitorToken || '').trim().slice(0, 200);
    if (!token || application.visitor_hash !== visitorFingerprint(req, token)) throw forbidden('Csak a saját jelentkezésedet vonhatod vissza.');
    const updated = await db.query(`update public.applications set status = 'withdrawn', handled_at = now(), handled_by_name = 'Jelentkező' where id = $1 returning *`, [
      params.id
    ]);
    return {ok: true, application: applicationPublic(updated.rows[0])};
  });
}
