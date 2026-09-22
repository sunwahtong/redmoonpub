/**
 * Staff side of the guest features: the booking book and the recruitment inbox.
 */
import {z} from 'zod';
import {audit, requireRole, requireUser} from '../auth.ts';
import {notFound, parse, readJson, type Router} from '../http.ts';
import {applicationStaff, reservationStaff} from './public.ts';

const reservationUpdate = z.object({
  status: z.enum(['pending', 'confirmed', 'declined', 'seated', 'cancelled', 'noshow'], {message: 'Ismeretlen állapot.'}),
  staffNote: z.string().trim().max(300).default('')
});

const applicationUpdate = z.object({
  status: z.enum(['pending', 'interview', 'accepted', 'rejected', 'withdrawn'], {message: 'Ismeretlen állapot.'}),
  staffNote: z.string().trim().max(400).default('')
});

export function registerGuestRoutes(router: Router): void {
  router.get('/api/reservations', async ({db, user}) => {
    requireUser({user});
    const {rows} = await db.query('select * from public.reservations order by starts_at desc limit 300');
    return {reservations: rows.map(reservationStaff)};
  });

  router.patch('/api/reservations/:id', async ({db, req, user, params}) => {
    const me = requireRole({user}, 'manager');
    const existing = (await db.query('select * from public.reservations where id = $1', [params.id])).rows[0];
    if (!existing) throw notFound('A foglalás nem található.');
    const body = parse(reservationUpdate, await readJson(req));
    const {rows} = await db.query(`update public.reservations set status = $2, staff_note = $3, handled_at = now(), handled_by_name = $4 where id = $1 returning *`, [
      params.id,
      body.status,
      body.staffNote,
      me.name
    ]);
    await audit(db, me, 'RESERVATION_UPDATE', `${existing.code} · ${existing.name} · ${body.status}`);
    return {reservation: reservationStaff(rows[0])};
  });

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
    return {application: applicationStaff(rows[0])};
  });
}
