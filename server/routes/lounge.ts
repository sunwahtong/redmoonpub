/**
 * The House's inner rooms: what a member's card opens once it has been shown.
 *
 * The card is presented once (code + phone, the public lookup) and answered
 * with a session token the browser keeps; every request here carries that
 * token. What the rooms hold depends on the tier: invitations to closed
 * evenings from Silver, the secret drink list from Gold, a line to the house
 * and requests for a private corner or an event from Black, and for Royal a
 * guest list on their bookings, their own named drink and the owner's line.
 * The console answers the line from the member's row.
 */
import {z} from 'zod';
import {audit, rateLimit, requireRole} from '../auth.ts';
import {bad, created, forbidden, formatPhone, iso, notFound, parse, readJson, unauthorized, type Router} from '../http.ts';
import {broadcast} from '../realtime.ts';
import {cardOf, memberByToken, tierRankOf, type MemberTier} from './members.ts';
import {eventFromRow, publicProduct} from './public.ts';
import type {Queryable, Row} from '../types.ts';

const MESSAGE_KINDS = ['uzenet', 'privat-sarok', 'rendezveny', 'a-haz-egy-estere'] as const;
export type LoungeMessageKind = (typeof MESSAGE_KINDS)[number];

/** SQL for a tier column's rank, so "open to Gold and above" is one comparison. */
const rankSql = (column: string): string => `case ${column} when 'silver' then 1 when 'gold' then 2 when 'black' then 3 when 'royal' then 4 else 9 end`;

/** Which rooms a tier opens. */
export function roomsOf(tier: MemberTier) {
  const rank = tierRankOf(tier);
  return {
    invitations: rank >= 1,
    secretMenu: rank >= 2,
    djPriority: rank >= 2,
    line: rank >= 3,
    requests: rank >= 3,
    buyout: rank >= 4,
    guestList: rank >= 4,
    ownDrink: rank >= 4
  };
}

const messageOf = (row: Row) => ({
  id: row.id,
  at: iso(row.at),
  fromHouse: !!row.from_house,
  byName: row.by_name || '',
  kind: (row.kind || 'uzenet') as LoungeMessageKind,
  text: row.text,
  meta: (row.meta && typeof row.meta === 'object' ? row.meta : {}) as {date?: string; guests?: number},
  readAt: iso(row.read_at)
});

const bookingOf = (row: Row) => ({
  id: row.id,
  code: row.code,
  when: iso(row.starts_at),
  guests: Number(row.guests) || 0,
  occasion: row.occasion,
  status: row.status,
  tableLabel: row.table_label || '',
  guestList: String(row.guest_list || '')
    .split('\n')
    .map((line: string) => line.trim())
    .filter(Boolean)
});

/** The person a member may turn to: the owner for Royal, otherwise whoever granted the card, or the owner. */
async function contactOf(db: Queryable, member: Row): Promise<{name: string; title: string; phone: string} | null> {
  const rank = tierRankOf(member.tier);
  if (rank < 3) return null;
  const house = (await db.query('select owner_user_id, phone from public.house where id = 1')).rows[0];
  const pick = async (id: string | null) => (id ? (await db.query('select name, nickname, title, phone, role from public.staff_accounts where id = $1 and active', [id])).rows[0] : null);
  let person = rank >= 4 ? await pick(house?.owner_user_id || null) : await pick(member.granted_by || null);
  if (!person && rank < 4) person = await pick(house?.owner_user_id || null);
  if (!person) {
    person = (await db.query(`select name, nickname, title, phone, role from public.staff_accounts where role = 'owner' and active order by created_at asc limit 1`)).rows[0] || null;
  }
  if (!person) return null;
  return {name: person.nickname || person.name, title: person.title || (person.role === 'owner' ? 'Tulajdonos' : 'Manager'), phone: formatPhone(person.phone || house?.phone || '')};
}

async function memberOrThrow(db: Queryable, token: unknown): Promise<Row> {
  const member = await memberByToken(db, token);
  if (!member) throw unauthorized('A kártyád nem nyitja a belső szobát. Mutasd be újra a House oldalon.');
  return member;
}

const messageBody = z.object({
  token: z.string().min(1),
  text: z.string().trim().min(1, 'Írj valamit.').max(600),
  kind: z.enum(MESSAGE_KINDS).default('uzenet'),
  meta: z.object({date: z.string().trim().max(40).optional(), guests: z.coerce.number().int().min(1).max(500).optional()}).default({})
});

const guestListBody = z.object({
  token: z.string().min(1),
  reservationId: z.string().min(1),
  names: z.array(z.string().trim().max(60)).max(60)
});

export function registerLoungeRoutes(router: Router): void {
  /* ---------------- the member's side ---------------- */

  router.get('/api/lounge', async ({db, query}) => {
    const member = await memberOrThrow(db, query.get('token'));
    const rank = tierRankOf(member.tier);
    const rooms = roomsOf(member.tier);
    const none = Promise.resolve({rows: [] as Row[]});
    const [events, drinks, own, messages, bookings, contact, house] = await Promise.all([
      db.query(
        `select e.*, (select count(*)::int from public.event_rsvps r where r.event_id = e.id) as going from public.events e
          where e.active and e.min_tier <> '' and coalesce(e.ends_at, e.starts_at + interval '4 hours') > now() and ${rankSql('e.min_tier')} <= $1
          order by e.starts_at asc limit 20`,
        [rank]
      ),
      rooms.secretMenu ? db.query(`select * from public.products where active and min_tier <> '' and member_code = '' and ${rankSql('min_tier')} <= $1 order by sort_order, name limit 40`, [rank]) : none,
      rooms.ownDrink ? db.query('select * from public.products where active and member_code = $1 order by sort_order, name limit 3', [member.code]) : none,
      rooms.line ? db.query('select * from public.member_messages where member_id = $1 order by at desc limit 60', [member.id]) : none,
      db.query(
        `select * from public.reservations where member_code = $1 and starts_at > now() - interval '6 hours' and status in ('pending', 'confirmed', 'seated')
          order by starts_at asc limit 6`,
        [member.code]
      ),
      contactOf(db, member),
      db.query('select name, address, phone from public.house where id = 1')
    ]);
    const thread = messages.rows.map(messageOf).reverse();
    return {
      member: cardOf(member),
      rooms,
      invitations: events.rows.map(eventFromRow),
      secretMenu: drinks.rows.map(publicProduct),
      ownDrinks: own.rows.map(publicProduct),
      messages: thread,
      unread: thread.filter((message) => message.fromHouse && !message.readAt).length,
      bookings: bookings.rows.map(bookingOf),
      contact,
      house: {name: house.rows[0]?.name || 'Red Moon Pub', address: house.rows[0]?.address || '', phone: house.rows[0]?.phone || ''}
    };
  });

  /** A word to the house — or a request for a corner, an event, or the whole house for a night. */
  router.post('/api/lounge/message', async ({db, req}) => {
    const body = parse(messageBody, await readJson(req));
    const member = await memberOrThrow(db, body.token);
    const rooms = roomsOf(member.tier);
    if (!rooms.line) throw forbidden('A ház vonala a Black szinttől nyílik.');
    if (body.kind === 'a-haz-egy-estere' && !rooms.buyout) throw forbidden('A házat egy estére csak a Royal kör kérheti.');
    if (body.kind !== 'uzenet' && !body.meta.date) throw bad('Add meg, melyik estére gondolsz.');
    await rateLimit(db, `lounge-message:${member.id}`, 20, 60 * 60 * 1000);
    const {rows} = await db.query('insert into public.member_messages (member_id, kind, text, meta) values ($1, $2, $3, $4::jsonb) returning *', [member.id, body.kind, body.text, JSON.stringify(body.meta)]);
    await broadcast('content', 'member-message', {memberId: member.id});
    return created({message: messageOf(rows[0])});
  });

  /** The member has read what the house wrote. */
  router.post('/api/lounge/read', async ({db, req}) => {
    const body = await readJson(req);
    const member = await memberOrThrow(db, body.token);
    await db.query('update public.member_messages set read_at = now() where member_id = $1 and from_house and read_at is null', [member.id]);
    return {ok: true};
  });

  /** A Royal names who comes with them; the door reads it off the booking. */
  router.post('/api/lounge/guest-list', async ({db, req}) => {
    const body = parse(guestListBody, await readJson(req));
    const member = await memberOrThrow(db, body.token);
    if (!roomsOf(member.tier).guestList) throw forbidden('A vendéglista a Royal kör kiváltsága.');
    const names = body.names.map((name) => name.replace(/\s+/g, ' ')).filter(Boolean);
    const {rows} = await db.query(
      `update public.reservations set guest_list = $3, updated_at = now()
        where id = $1 and member_code = $2 and starts_at > now() - interval '6 hours' and status in ('pending', 'confirmed', 'seated') returning *`,
      [body.reservationId, member.code, names.join('\n')]
    );
    if (!rows[0]) throw notFound('Ez a foglalás nem a tiéd, vagy már lezajlott.');
    await broadcast('reservations', 'change', {id: rows[0].id});
    return {booking: bookingOf(rows[0])};
  });

  /* ---------------- the console's side ---------------- */

  /** Reading the thread from the console counts as reading what the member wrote. */
  router.get('/api/members/:id/messages', async ({db, user, params}) => {
    requireRole({user}, 'manager');
    const member = (await db.query('select id from public.members where id = $1', [params.id])).rows[0];
    if (!member) throw notFound('A tag nem található');
    await db.query('update public.member_messages set read_at = now() where member_id = $1 and not from_house and read_at is null', [member.id]);
    const {rows} = await db.query('select * from public.member_messages where member_id = $1 order by at desc limit 80', [member.id]);
    return {messages: rows.map(messageOf).reverse()};
  });

  router.post('/api/members/:id/messages', async ({db, req, user, params}) => {
    const me = requireRole({user}, 'manager');
    const body = await readJson(req);
    const text = String(body.text || '').trim().slice(0, 600);
    if (!text) throw bad('Írj valamit.');
    const member = (await db.query('select * from public.members where id = $1', [params.id])).rows[0];
    if (!member) throw notFound('A tag nem található');
    const {rows} = await db.query('insert into public.member_messages (member_id, from_house, by_name, text) values ($1, true, $2, $3) returning *', [member.id, me.nickname || me.name, text]);
    await audit(db, me, 'MEMBER_MESSAGE', `${member.name} · ${member.code}`);
    await broadcast('content', 'member-message', {memberId: member.id});
    return created({message: messageOf(rows[0])});
  });
}
