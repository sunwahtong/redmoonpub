/**
 * Staff side of the guest features: the booking book with its progress
 * stages and message threads, and the recruitment inbox.
 */
import {z} from 'zod';
import {audit, notifyManagers, requireRole, requireUser} from '../auth.ts';
import {bad, notFound, parse, readJson, type Router} from '../http.ts';
import {broadcast} from '../realtime.ts';
import {applicationStaff, messageOf, RESERVATION_STATUSES, reservationStaff} from './public.ts';
import type {Queryable, Row} from '../types.ts';

const reservationUpdate = z.object({
  status: z.enum(RESERVATION_STATUSES, {message: 'Ismeretlen állapot.'}).optional(),
  staffNote: z.string().trim().max(300).optional()
});

const applicationUpdate = z.object({
  status: z.enum(['pending', 'interview', 'accepted', 'rejected', 'withdrawn'], {message: 'Ismeretlen állapot.'}),
  staffNote: z.string().trim().max(400).default('')
});

/** Bookings with their unread counter and the last line of the thread. */
async function listReservations(db: Queryable): Promise<Row[]> {
  const {rows} = await db.query(
    `select r.*,
            (select count(*)::int from public.reservation_messages m where m.reservation_id = r.id and m.author = 'guest' and not m.read_by_staff) as unread_staff,
            (select count(*)::int from public.reservation_messages m where m.reservation_id = r.id) as message_count,
            (select m.text from public.reservation_messages m where m.reservation_id = r.id order by m.at desc limit 1) as last_message,
            (select m.author from public.reservation_messages m where m.reservation_id = r.id order by m.at desc limit 1) as last_author
     from public.reservations r order by r.starts_at desc limit 300`
  );
  return rows;
}

export function registerGuestRoutes(router: Router): void {
  router.get('/api/reservations', async ({db, user}) => {
    requireUser({user});
    const rows = await listReservations(db);
    return {
      reservations: rows.map((row) => ({
        ...reservationStaff(row),
        unread: row.unread_staff || 0,
        messageCount: row.message_count || 0,
        lastMessage: row.last_message ? {text: row.last_message, author: row.last_author} : null
      }))
    };
  });

  router.patch('/api/reservations/:id', async ({db, req, user, params}) => {
    const me = requireRole({user}, 'manager');
    const existing = (await db.query('select * from public.reservations where id = $1', [params.id])).rows[0];
    if (!existing) throw notFound('A foglalás nem található.');
    const body = parse(reservationUpdate, await readJson(req));
    if (body.status === undefined && body.staffNote === undefined) throw bad('Nincs mit menteni.');
    const status = body.status ?? existing.status;
    const staffNote = body.staffNote ?? existing.staff_note ?? '';
    const {rows} = await db.query(
      `update public.reservations set status = $2, staff_note = $3, handled_at = now(), handled_by_name = $4, updated_at = now() where id = $1 returning *`,
      [params.id, status, staffNote, me.name]
    );
    await audit(db, me, 'RESERVATION_UPDATE', `${existing.code} · ${existing.name} · ${status}`);
    await broadcast('reservations', 'update', {reservationId: params.id});
    return {reservation: reservationStaff(rows[0])};
  });

  /* ---------------- the message thread ---------------- */

  router.get('/api/reservations/:id/messages', async ({db, user, params}) => {
    requireUser({user});
    const reservation = (await db.query('select id from public.reservations where id = $1', [params.id])).rows[0];
    if (!reservation) throw notFound('A foglalás nem található.');
    const {rows} = await db.query('select * from public.reservation_messages where reservation_id = $1 order by at asc limit 200', [params.id]);
    return {messages: rows.map(messageOf)};
  });

  /* ---------------- recruitment ---------------- */

  router.get('/api/applications', async ({db, user}) => {
    requireRole({user}, 'manager');
    const {rows} = await db.query('select * from public.applications order by at desc limit 200');
    return {applications: rows.map(applicationStaff)};
  });

  router.patch('/api/applications/:id', async ({db, req, user, params}) => {
    const me = requireRole({user}, 'manager');
    const existing = (await db.query('select * from public.applications where id = $1', [params.id])).rows[0];
    if (!existing) throw notFound('A jelentkezés nem található.');
    const body = parse(applicationUpdate, await readJson(req));
    const {rows} = await db.query(`update public.applications set status = $2, staff_note = $3, handled_at = now(), handled_by_name = $4 where id = $1 returning *`, [
      params.id,
      body.status,
      body.staffNote,
      me.name
    ]);
    await audit(db, me, 'APPLICATION_UPDATE', `${existing.code} · ${existing.name} · ${body.status}`);
    if (body.status === 'interview') await notifyManagers(db, 'Interjúra hívva', `${existing.name} · ${existing.code}`, {applicationId: existing.id});
    return {application: applicationStaff(rows[0])};
  });
}
