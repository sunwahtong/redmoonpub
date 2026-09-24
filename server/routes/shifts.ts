/**
 * Shifts (the working day) and the front door.
 *
 * A shift is opened with at least one member; the person who opens it is not
 * automatically part of it. The pub door — what the public site shows as
 * open or closed — can only be opened while a shift is running, and closes
 * itself when the shift does.
 */
import {z} from 'zod';
import {audit, loadAccount, requireRole, requireUser, roleAtLeast} from '../auth.ts';
import {bad, conflict, created, forbidden, iso, notFound, parse, readJson, type Router} from '../http.ts';
import {saleFromRow} from './staff.ts';
import {broadcast} from '../realtime.ts';
import {createShiftReports, reportView} from './shiftReports.ts';
import type {Queryable, Row, SessionUser} from '../types.ts';

const openBody = z.object({
  openingCash: z.coerce.number().min(0, 'A kezdő kassza nem lehet negatív.').max(1_000_000_000).default(0),
  memberIds: z.array(z.string().min(1)).min(1, 'Válassz legalább egy dolgozót a műszakba.').max(60),
  notes: z.string().trim().max(600).default('')
});

const closeBody = z.object({
  closingCash: z.coerce.number().min(0, 'Adj meg érvényes záró kassza összeget.').max(1_000_000_000),
  notes: z.string().trim().max(600).optional()
});

export interface ShiftMember {
  name: string;
  userId: string | null;
  joinedAt: string | null;
  joinedById: string | null;
  joinedByName: string | null;
  reason: string | null;
  leftAt: string | null;
}

export interface Shift {
  id: string;
  status: 'open' | 'closed';
  startedAt: string;
  endedAt: string | null;
  startedById: string | null;
  startedByName: string;
  closedById: string | null;
  closedByName: string;
  openingCash: number;
  closingCash: number | null;
  revenue: number;
  cashRevenue: number;
  transferRevenue: number;
  overallRevenue: number;
  salesCount: number;
  items: number;
  notes: string;
  closure: Row | null;
  members: string[];
  memberIds: string[];
  memberHistory: ShiftMember[];
}

export const shiftFromRow = (row: Row, members: Row[] = []): Shift => ({
  id: row.id,
  status: row.status,
  startedAt: iso(row.started_at)!,
  endedAt: iso(row.ended_at),
  startedById: row.started_by,
  startedByName: row.started_by_name,
  closedById: row.closed_by,
  closedByName: row.closed_by_name || '',
  openingCash: row.opening_cash,
  closingCash: row.closing_cash,
  revenue: row.revenue,
  cashRevenue: row.cash_revenue,
  transferRevenue: row.transfer_revenue,
  overallRevenue: row.revenue,
  salesCount: row.sales_count,
  items: row.items,
  notes: row.notes || '',
  closure: row.closure || null,
  members: members.map((member) => member.name),
  memberIds: members.filter((member) => member.user_id).map((member) => member.user_id),
  memberHistory: members.map((member) => ({
    name: member.name,
    userId: member.user_id,
    joinedAt: iso(member.joined_at),
    joinedById: member.joined_by,
    joinedByName: member.joined_by_name || null,
    reason: member.reason || null,
    leftAt: iso(member.left_at)
  }))
});

export async function loadShift(db: Queryable, id: string): Promise<Shift | null> {
  const {rows} = await db.query('select * from public.shifts where id = $1', [id]);
  if (!rows[0]) return null;
  const members = await db.query('select * from public.shift_members where shift_id = $1 order by joined_at', [id]);
  return shiftFromRow(rows[0], members.rows);
}

export async function openShift(db: Queryable): Promise<Shift | null> {
  const {rows} = await db.query<{id: string}>(`select id from public.shifts where status = 'open' limit 1`);
  return rows[0] ? loadShift(db, rows[0].id) : null;
}

async function nextShiftId(db: Queryable): Promise<string> {
  const {rows} = await db.query<{id: string}>(`select id from public.shifts where id ~ '^M-[0-9]+$'`);
  let n = rows.reduce((max, row) => Math.max(max, Number(row.id.slice(2)) || 0), 0) + 1;
  const used = new Set(rows.map((row) => row.id));
  let id = `M-${String(n).padStart(3, '0')}`;
  while (used.has(id)) {
    n += 1;
    id = `M-${String(n).padStart(3, '0')}`;
  }
  return id;
}

function shiftHours(startedAt: string, endedAt: string | null): number {
  const start = new Date(startedAt).getTime();
  const end = endedAt ? new Date(endedAt).getTime() : Date.now();
  if (!Number.isFinite(start) || !Number.isFinite(end) || end < start) return 0;
  return (end - start) / 3600000;
}

/** Per-member summary a closed shift keeps forever. */
export function employeeBreakdown(shift: Shift, sales: Row[]) {
  const seen = new Set<string>();
  const out: {name: string; userId: string | null; joinedAt: string; workedMs: number; sales: number; items: number; revenue: number}[] = [];
  const endedAt = shift.endedAt ? new Date(shift.endedAt).getTime() : Date.now();
  for (const member of shift.memberHistory) {
    const key = member.userId || member.name;
    if (!key || seen.has(key)) continue;
    seen.add(key);
    const own = sales.filter((sale) => (member.userId ? sale.user_id === member.userId : sale.user_name === member.name));
    const transactions = new Set(own.map((sale) => sale.transaction_id));
    const joined = new Date(member.joinedAt || shift.startedAt).getTime();
    const left = member.leftAt ? new Date(member.leftAt).getTime() : endedAt;
    out.push({
      name: member.name,
      userId: member.userId || null,
      joinedAt: member.joinedAt || shift.startedAt,
      workedMs: Math.max(0, left - joined),
      sales: transactions.size,
      items: own.reduce((sum, sale) => sum + Number(sale.qty || 0), 0),
      revenue: own.reduce((sum, sale) => sum + Number(sale.total || 0), 0)
    });
  }
  return out;
}

const canManageShift = (user: SessionUser, shift: Shift): boolean => shift.startedById === user.id || roleAtLeast(user.role, 'manager');

export function registerShiftRoutes(router: Router): void {
  router.get('/api/shifts', async ({db, user}) => {
    requireRole({user}, 'manager');
    const {rows} = await db.query('select * from public.shifts order by started_at desc limit 300');
    const ids = rows.map((row) => row.id);
    const members = ids.length ? (await db.query('select * from public.shift_members where shift_id = any($1) order by joined_at', [ids])).rows : [];
    return {shifts: rows.map((row) => shiftFromRow(row, members.filter((member) => member.shift_id === row.id)))};
  });

  router.get('/api/shifts/current', async ({db, user}) => {
    requireUser({user});
    return {shift: await openShift(db)};
  });

  router.get('/api/shifts/available-members', async ({db, user}) => {
    requireUser({user});
    const {rows} = await db.query('select id, name, nickname, role, jobs, avatar from public.staff_accounts where active order by name');
    return {users: rows.map((row) => ({id: row.id, name: row.name, nickname: row.nickname || '', role: row.role, jobs: row.jobs || [], avatar: row.avatar || ''}))};
  });

  router.post('/api/shifts/open', async ({db, req, user}) => {
    const me = requireUser({user});
    const body = parse(openBody, await readJson(req));
    const existing = await openShift(db);
    if (existing) throw conflict(`Már van nyitott műszak: ${existing.startedByName}. Zárd le előbb.`);
    const ids = [...new Set(body.memberIds)];
    const members = await db.query<{id: string; name: string}>('select id, name from public.staff_accounts where active and id = any($1)', [ids]);
    if (!members.rows.length) throw bad('Válassz legalább egy dolgozót a műszakba.');

    const id = await nextShiftId(db);
    await db.tx(async (tx) => {
      await tx.query(`insert into public.shifts (id, status, started_by, started_by_name, opening_cash, notes) values ($1, 'open', $2, $3, $4, $5)`, [
        id,
        me.id,
        me.name,
        Math.round(body.openingCash),
        body.notes
      ]);
      for (const member of members.rows) {
        await tx.query(
          `insert into public.shift_members (shift_id, user_id, name, joined_by, joined_by_name, reason) values ($1, $2, $3, $4, $5, $6)`,
          [id, member.id, member.name, me.id, me.name, member.id === me.id ? 'műszak indítása' : 'műszaknyitáskor hozzáadva']
        );
      }
    });
    const shift = (await loadShift(db, id))!;
    await audit(db, me, 'SHIFT_OPEN', `Műszak nyitva · kezdő kassza ${Math.round(body.openingCash)} Ft · ${shift.members.join(', ')}`);
    await broadcast('house', 'shift', {open: true});
    return created({shift});
  });

  router.post('/api/shifts/members', async ({db, req, user}) => {
    const me = requireUser({user});
    const shift = await openShift(db);
    if (!shift) throw conflict('Nincs nyitott műszak.');
    if (!canManageShift(me, shift)) throw forbidden('Ezt a műszakot csak a műszakindító, MANAGER vagy OWNER bővítheti.');
    const body = await readJson(req);
    const member = await loadAccount(db, String(body.userId || ''));
    if (!member || !member.active) throw notFound('A kiválasztott dolgozó nem található.');
    if (shift.memberIds.includes(member.id)) throw conflict('Ez a dolgozó már tagja ennek a műszaknak.');
    await db.query(
      `insert into public.shift_members (shift_id, user_id, name, joined_by, joined_by_name, reason) values ($1, $2, $3, $4, $5, 'menet közben hozzáadva')`,
      [shift.id, member.id, member.name, me.id, me.name]
    );
    await audit(db, me, 'SHIFT_MEMBER_ADD', `Műszaktag hozzáadva · ${member.name} · műszak ${shift.id}`);
    return {shift: await loadShift(db, shift.id), member: {id: member.id, name: member.name}};
  });

  router.delete('/api/shifts/members/:userId', async ({db, user, params}) => {
    const me = requireUser({user});
    const shift = await openShift(db);
    if (!shift) throw conflict('Nincs nyitott műszak.');
    const self = params.userId === me.id;
    if (!self && !canManageShift(me, shift)) throw forbidden('Tagot csak a műszakindító, MANAGER vagy OWNER vehet ki.');
    if (!shift.memberIds.includes(params.userId)) throw notFound('Ez a dolgozó nem tagja a műszaknak.');
    if (shift.memberIds.length <= 1) throw bad('A műszak nem maradhat tag nélkül. Zárd le inkább.');
    const {rows} = await db.query<{name: string}>('delete from public.shift_members where shift_id = $1 and user_id = $2 returning name', [shift.id, params.userId]);
    await audit(db, me, 'SHIFT_MEMBER_REMOVE', `${rows[0]?.name || params.userId} · műszak ${shift.id}`);
    return {shift: await loadShift(db, shift.id)};
  });

  router.post('/api/shifts/close', async ({db, req, user}) => {
    const me = requireUser({user});
    const shift = await openShift(db);
    if (!shift) throw conflict('Nincs nyitott műszak.');
    if (!canManageShift(me, shift)) throw forbidden('Ezt a műszakot csak a műszak indítója, MANAGER vagy OWNER zárhatja.');
    const body = parse(closeBody, await readJson(req));
    const sales = (await db.query('select * from public.sales where shift_id = $1', [shift.id])).rows;
    const revenue = sales.reduce((sum, sale) => sum + Number(sale.total || 0), 0);
    const cash = sales.filter((sale) => sale.payment_method === 'cash').reduce((sum, sale) => sum + Number(sale.total || 0), 0);
    const transfer = sales.filter((sale) => sale.payment_method === 'transfer').reduce((sum, sale) => sum + Number(sale.total || 0), 0);
    const items = sales.reduce((sum, sale) => sum + Number(sale.qty || 0), 0);
    const endedAt = new Date();
    const house = (await db.query('select transfer_account, transfer_name, pub_open from public.house where id = 1')).rows[0];

    const closedShift: Shift = {...shift, endedAt: endedAt.toISOString()};
    const breakdown = employeeBreakdown(closedShift, sales);
    const closure = {
      shiftId: shift.id,
      openedAt: shift.startedAt,
      closedAt: endedAt.toISOString(),
      startedById: shift.startedById,
      startedByName: shift.startedByName,
      closedById: me.id,
      closedByName: me.name,
      members: shift.memberHistory,
      employeeBreakdown: breakdown,
      cashRevenue: cash,
      transferRevenue: transfer,
      overallRevenue: revenue,
      salesCount: sales.length,
      items,
      openingCash: shift.openingCash,
      closingCash: Math.round(body.closingCash),
      transfer: {amount: revenue, account: house.transfer_account, name: house.transfer_name, reference: shift.id}
    };

    await db.tx(async (tx) => {
      await tx.query(
        `update public.shifts set status = 'closed', ended_at = $2, closed_by = $3, closed_by_name = $4, closing_cash = $5,
           revenue = $6, cash_revenue = $7, transfer_revenue = $8, sales_count = $9, items = $10, notes = $11, closure = $12
         where id = $1`,
        [shift.id, endedAt, me.id, me.name, Math.round(body.closingCash), revenue, cash, transfer, sales.length, items, body.notes ?? shift.notes, JSON.stringify(closure)]
      );
      await tx.query('update public.shift_members set left_at = $2 where shift_id = $1 and left_at is null', [shift.id, endedAt]);
      if (house.pub_open) {
        await tx.query(`update public.house set pub_open = false, pub_closed_at = now(), pub_note = '' where id = 1`);
      }
    });
    await audit(db, me, 'SHIFT_CLOSE', `Műszak zárva · bevétel ${revenue} Ft · záró kassza ${Math.round(body.closingCash)} Ft${house.pub_open ? ' · a ház bezárt' : ''}`);
    await broadcast('house', 'shift', {open: false});
    // Everyone who worked it gets their closing report; the closer sees theirs in the reply.
    const reports = await createShiftReports(db, shift.id, {id: me.id, name: me.name}, breakdown, endedAt);
    await broadcast('staff', 'shift-closed', {shiftId: shift.id, userIds: reports.map((row) => row.user_id)});
    const own = reports.find((row) => row.user_id === me.id);
    return {shift: await loadShift(db, shift.id), transfer: closure.transfer, pubClosed: !!house.pub_open, report: own ? await reportView(db, own) : null};
  });

  router.delete('/api/shifts/:id', async ({db, user, params}) => {
    const me = requireRole({user}, 'owner');
    const shift = await loadShift(db, params.id);
    if (!shift) throw notFound('A műszak nem található');
    if (shift.status !== 'closed') throw bad('Csak lezárt műszak törölhető.');
    const sales = (await db.query('select * from public.sales where shift_id = $1', [shift.id])).rows;
    const documentIds = [...new Set(sales.flatMap((sale) => [sale.receipt_id, sale.invoice_id]).filter(Boolean))];
    await db.tx(async (tx) => {
      for (const sale of sales) await tx.query('update public.products set stock = stock + $2 where id = $1', [sale.product_id, sale.qty]);
      if (documentIds.length) await tx.query('delete from public.documents where id = any($1)', [documentIds]);
      await tx.query('delete from public.shifts where id = $1', [shift.id]);
    });
    await audit(db, me, 'SHIFT_DELETE', `Lezárt műszak törölve · ${shift.id} · ${sales.length} eladás · ${documentIds.length} bizonylat · készlet visszaállítva`);
    return {ok: true, deletedShiftId: shift.id, deletedSales: sales.length, deletedInvoices: documentIds.length};
  });

  router.get('/api/shifts/:id', async ({db, user, params}) => {
    requireUser({user});
    const shift = await loadShift(db, params.id);
    if (!shift) throw notFound('Műszak nem található');
    const sales = (await db.query('select * from public.sales where shift_id = $1 order by at desc', [shift.id])).rows;
    if (shift.status === 'closed' && !shift.closure?.employeeBreakdown) {
      shift.closure = {...(shift.closure || {}), employeeBreakdown: employeeBreakdown(shift, sales)};
    }
    return {shift, sales: sales.map(saleFromRow), hours: Math.round(shiftHours(shift.startedAt, shift.endedAt) * 10) / 10};
  });

  /* ---------------- the front door ---------------- */

  router.post('/api/house/pub/open', async ({db, req, user}) => {
    const me = requireRole({user}, 'manager');
    const shift = await openShift(db);
    if (!shift) throw conflict('A ház csak nyitott műszak mellett nyitható ki.');
    const body = await readJson(req).catch(() => ({}) as Record<string, unknown>);
    const note = String(body.note || '').trim().slice(0, 160);
    const house = (await db.query('select pub_open from public.house where id = 1')).rows[0];
    if (house.pub_open) throw conflict('A ház már nyitva van.');
    await db.query(
      `update public.house set pub_open = true, pub_opened_at = now(), pub_opened_by = $1, pub_opened_by_name = $2, pub_note = $3, pub_closed_at = null where id = 1`,
      [me.id, me.name, note]
    );
    await audit(db, me, 'PUB_OPEN', `A ház kinyitott · műszak ${shift.id}${note ? ' · ' + note : ''}`);
    await broadcast('house', 'door', {open: true});
    return {ok: true, open: true};
  });

  router.post('/api/house/pub/close', async ({db, user}) => {
    const me = requireRole({user}, 'manager');
    const house = (await db.query('select pub_open from public.house where id = 1')).rows[0];
    if (!house.pub_open) throw conflict('A ház már zárva van.');
    await db.query(`update public.house set pub_open = false, pub_closed_at = now(), pub_note = '' where id = 1`);
    await audit(db, me, 'PUB_CLOSE', 'A ház bezárt');
    await broadcast('house', 'door', {open: false});
    return {ok: true, open: false};
  });
}
