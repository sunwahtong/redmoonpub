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
import {mediaProvider} from '../media.ts';
import {broadcast, realtimeEnabled} from '../realtime.ts';
import {config} from '../config.ts';
import type {Queryable, Request, Row} from '../types.ts';
import {effectiveStreamUrl, onAir, stationEmbedUrl, stationSlug, syncStation} from '../station.ts';
import {memberForBooking, memberStats} from './members.ts';
import {checkTable, loadFloorPlan} from './floor.ts';

export const RESERVATION_OCCASIONS = ['este', 'szuletesnap', 'uzleti', 'randi', 'csapat', 'vip', 'egyeb'] as const;
export const RESERVATION_TIERS = ['none', 'silver', 'gold', 'black', 'royal'] as const;
export const RESERVATION_MAX_DAYS = 60;
export const RESERVATION_MAX_OPEN = 3;
export const CAREER_POSITIONS = ['bartender', 'dj', 'biztonsag'] as const;
/** A booking's life: asked → looked at → decided → the evening itself. */
export const RESERVATION_STATUSES = ['pending', 'reviewing', 'waitlist', 'confirmed', 'declined', 'seated', 'cancelled', 'noshow'] as const;
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
  section: row.section || 'other',
  /** Empty on the open list; a tier on the House's secret list. */
  minTier: row.min_tier || ''
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
  coverPublicId: row.cover_public_id || '',
  /** How many guests said they will be there. */
  going: Number(row.going) || 0,
  entryFee: row.entry_fee ?? null,
  dressCode: row.dress_code || '',
  featured: !!row.featured,
  active: row.active !== false,
  /** Empty for an open evening; the lowest House tier invited otherwise. */
  minTier: row.min_tier || '',
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
  memberCode: row.member_code || '',
  memberName: row.member_name || '',
  tableId: row.table_id || '',
  tableLabel: row.table_label || '',
  note: row.note || '',
  /** Names a Royal member listed for the door, one per line. */
  guestList: String(row.guest_list || '')
    .split('\n')
    .map((line: string) => line.trim())
    .filter(Boolean),
  status: row.status,
  staffNote: row.staff_note || '',
  handledAt: iso(row.handled_at),
  updatedAt: iso(row.updated_at),
  phone: formatPhone(row.phone || '')
});

export const messageOf = (row: Row) => ({
  id: row.id,
  at: iso(row.at),
  author: row.author as 'guest' | 'staff',
  authorName: row.author_name || '',
  text: row.text,
  readByGuest: !!row.read_by_guest,
  readByStaff: !!row.read_by_staff
});

export const reservationStaff = (row: Row) => ({...reservationPublic(row), handledByName: row.handled_by_name || null});

export const galleryPublic = (row: Row) => ({
  id: row.id,
  title: row.title || '',
  caption: row.caption || '',
  tag: row.tag || 'este',
  src: row.image_url,
  width: row.width || 0,
  height: row.height || 0,
  sortOrder: row.sort_order || 0,
  active: row.active !== false,
  createdAt: iso(row.created_at)
});

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
  /** A House membership code; the tier comes from the card, not from the form. */
  memberCode: z.string().trim().max(20).default(''),
  /** A table of the floor plan; empty means "any table", the house picks. */
  tableId: z.string().trim().max(40).default(''),
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
  // The station check rides on the status feed: every open page polls it.
  await syncStation(db);
  const [house, shift, club, event] = await Promise.all([
    db.query('select pub_open, pub_opened_at, pub_opened_by_name, pub_note, pub_closed_at from public.house where id = 1'),
    db.query(`select id, started_at, started_by_name from public.shifts where status = 'open' limit 1`),
    db.query('select live, auto_live, dj_name, title, stream_url, provider_url, started_at, station_live, station_listeners, station_title, station_artist, notice from public.club_state where id = 1'),
    db.query(
      `select e.*, (select count(*)::int from public.event_rsvps r where r.event_id = e.id) as going
         from public.events e where e.active and (e.ends_at is null and e.starts_at > now() - interval '4 hours' or e.ends_at > now())
        order by e.featured desc, e.starts_at asc limit 1`
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
    /** Something to hear: the station streams, or the DJ plays their own stream. Only then does the music step aside. */
    onAir: club.rows[0] ? onAir(club.rows[0]) : false,
    autoLive: !!club.rows[0]?.auto_live,
    dj: club.rows[0]?.dj_name || null,
    title: club.rows[0]?.title || '',
    streamUrl: club.rows[0] ? effectiveStreamUrl(club.rows[0]) : '',
    providerUrl: club.rows[0]?.provider_url || '',
    embedUrl: stationEmbedUrl(stationSlug(club.rows[0]?.provider_url)),
    liveSince: iso(club.rows[0]?.started_at),
    listenerCount: listeners.rows[0]?.n || 0,
    stationLive: !!club.rows[0]?.station_live,
    stationListeners: Number(club.rows[0]?.station_listeners) || 0,
    nowPlaying: club.rows[0]?.station_title ? {title: club.rows[0].station_title as string, artist: (club.rows[0].station_artist || '') as string} : null,
    notice: club.rows[0]?.notice || '',
    nextEvent: event.rows[0] ? eventFromRow(event.rows[0]) : null,
    /** Where the browser subscribes for pushes. The publishable key is public by design. */
    realtime: realtimeEnabled() && config.supabasePublishableKey ? {url: config.supabaseUrl, key: config.supabasePublishableKey} : null,
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
    realtime: realtimeEnabled() ? 'push' : 'poll',
    storage: mediaProvider(),
    database: dbKind()
  }));

  router.get('/api/public/status', async ({db}) => houseStatus(db));

  router.get('/api/public/house', async ({db}) => {
    const [house, people] = await Promise.all([
      db.query('select name, address, phone, registration, featured_video, featured_video_title, featured_video_caption from public.house where id = 1'),
      db.query('select id, name, title, note, monogram, tier, sort_order from public.house_people where active order by sort_order, name')
    ]);
    const row = house.rows[0] || {};
    return {
      house: {name: row.name || 'Red Moon Pub', address: row.address || '', phone: row.phone || '', registration: row.registration || ''},
      video: row.featured_video ? {id: row.featured_video, title: row.featured_video_title || '', caption: row.featured_video_caption || ''} : null,
      members: await memberStats(db),
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
    const {rows} = await db.query(`select * from public.products where active and category = 'drink' and min_tier = '' and member_code = '' order by sort_order, name`);
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
    const {rows} = await db.query(
      `select e.*, (select count(*)::int from public.event_rsvps r where r.event_id = e.id) as going from public.events e where e.active and e.min_tier = '' order by e.starts_at asc limit 60`
    );
    return {events: rows.map(eventFromRow)};
  });

  router.get('/api/public-map-blips', async ({db}) => {
    const {rows} = await db.query('select * from public.map_blips where active order by created_at desc');
    return {blips: rows.map(blipFromRow)};
  });

  router.get('/api/public/gallery', async ({db}) => {
    const {rows} = await db.query('select * from public.gallery_items where active order by sort_order, created_at limit 120');
    return {items: rows.map(galleryPublic)};
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
    const ids = rows.map((row) => row.id);
    const messages = ids.length ? (await db.query('select * from public.reservation_messages where reservation_id = any($1) order by at asc', [ids])).rows : [];
    return {
      reservations: rows.map((row) => {
        const thread = messages.filter((message) => message.reservation_id === row.id);
        return {
          ...reservationPublic(row),
          messages: thread.map(messageOf),
          unread: thread.filter((message) => message.author === 'staff' && !message.read_by_guest).length
        };
      })
    };
  });

  /**
   * The thread on a booking. The guest writes with their visitor token; a
   * manager or owner who is signed in answers for the house. One route, so
   * neither side can shadow the other.
   */
  router.post('/api/reservations/:id/messages', async ({db, req, params, user}) => {
    const body = await readJson(req);
    const text = String(body.text || '').trim().slice(0, 600);
    if (!text) throw bad('Az üzenet nem lehet üres.');
    const reservation = (await db.query('select * from public.reservations where id = $1', [params.id])).rows[0];
    if (!reservation) throw notFound('A foglalás nem található.');
    if (user && roleAtLeast(user.role, 'manager')) {
      const {rows} = await db.query(
        `insert into public.reservation_messages (reservation_id, author, author_name, text, read_by_staff) values ($1, 'staff', $2, $3, true) returning *`,
        [params.id, user.nickname || user.name, text]
      );
      await db.query('update public.reservations set updated_at = now() where id = $1', [params.id]);
      await audit(db, user, 'RESERVATION_MESSAGE', `${reservation.code} · ${text.slice(0, 120)}`);
      await broadcast('reservations', 'message', {reservationId: params.id});
      return created({message: messageOf(rows[0])});
    }
    const token = String(body.visitorToken || '').trim().slice(0, 200);
    if (!token || reservation.visitor_hash !== visitorFingerprint(req, token)) throw forbidden('Csak a saját foglalásodhoz írhatsz.');
    if (['cancelled', 'noshow', 'declined'].includes(reservation.status)) throw conflict('Ez a foglalás már lezárult.');
    await rateLimit(db, `reservation-message:${clientIp(req)}`, 20, 60 * 60 * 1000);
    const {rows} = await db.query(
      `insert into public.reservation_messages (reservation_id, author, author_name, text, read_by_guest) values ($1, 'guest', $2, $3, true) returning *`,
      [params.id, reservation.name, text]
    );
    await db.query('update public.reservations set updated_at = now() where id = $1', [params.id]);
    await notifyManagers(db, 'Üzenet egy foglaláshoz', `${reservation.name} · ${reservation.code}: ${text.slice(0, 100)}`, {reservationId: reservation.id});
    await broadcast('reservations', 'message', {reservationId: params.id});
    return created({message: messageOf(rows[0])});
  });

  /** Marks the other side's lines as read: the guest's for staff, the house's for the guest. */
  router.post('/api/reservations/:id/read', async ({db, req, params, user}) => {
    const reservation = (await db.query('select visitor_hash from public.reservations where id = $1', [params.id])).rows[0];
    if (!reservation) throw notFound('A foglalás nem található.');
    if (user) {
      await db.query(`update public.reservation_messages set read_by_staff = true where reservation_id = $1 and author = 'guest' and not read_by_staff`, [params.id]);
      return {ok: true};
    }
    const body = await readJson(req).catch(() => ({}) as Record<string, unknown>);
    const token = String(body.visitorToken || '').trim().slice(0, 200);
    if (!token || reservation.visitor_hash !== visitorFingerprint(req, token)) throw forbidden('Csak a saját foglalásodat láthatod.');
    await db.query(`update public.reservation_messages set read_by_guest = true where reservation_id = $1 and author = 'staff' and not read_by_guest`, [params.id]);
    return {ok: true};
  });

  router.post('/api/reservations', async ({db, req}) => {
    const body = parse(reservationCreate, await readJson(req));
    await rateLimit(db, `reservation:${clientIp(req)}`, 20, 60 * 60 * 1000);
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
    // A member's code settles the tier; without one the booking carries no tier at all.
    const member = await memberForBooking(db, body.memberCode, phone);
    const tier = member ? member.tier : 'none';
    // A named table must be on the plan, fit the party, be open to their tier and be free at that time.
    const table = body.tableId ? await checkTable(db, await loadFloorPlan(db), body.tableId, body.guests, tier, when) : null;
    const {rows} = await db.query(
      `insert into public.reservations (code, starts_at, name, phone, guests, occasion, tier, note, visitor_hash, member_code, member_name, table_id, table_label)
       values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13) returning *`,
      [shortCode(), when, body.name, phone, body.guests, body.occasion, tier, body.note, fingerprint, member ? member.code : '', member ? member.name : '', table ? table.id : '', table ? table.label : '']
    );
    const reservation = rows[0];
    await notifyManagers(
      db,
      'Új asztalfoglalás',
      `${reservation.name} · ${reservation.guests} fő · ${new Date(reservation.starts_at).toLocaleString('hu-HU')}${reservation.table_label ? ` · ${reservation.table_label}. asztal` : ''} · ${reservation.code}`,
      {reservationId: reservation.id}
    );
    await broadcast('reservations', 'new', {reservationId: reservation.id});
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
    await broadcast('reservations', 'update', {reservationId: params.id});
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
