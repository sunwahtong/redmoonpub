/**
 * The closing report: what each person sold in a shift, and where to send it.
 *
 * Written when a shift closes, one row per member (and the closer), kept
 * unseen until the person opens it. The transfer memo is built when the
 * report is read, so "which shift of the day" is right even when a second
 * shift closes on the same day later.
 */
import {audit, requireUser} from '../auth.ts';
import {iso, notFound, type Router} from '../http.ts';
import type {Queryable, Row} from '../types.ts';

/** Where the house's money goes. */
export const TRANSFER_ACCOUNT = '21541444-70524373';
export const TRANSFER_OWNER = 'Zhen Yu Xiao';
const HOUSE_TZ = 'Europe/Budapest';

/** "Yuanzhe Guan" → "Yuanzhe G.", "Lin Tho Gua" → "Lin T. G." */
export function shortName(name: string): string {
  const parts = String(name || '').trim().split(/\s+/).filter(Boolean);
  if (!parts.length) return '';
  const [first, ...rest] = parts;
  return [first, ...rest.map((part) => `${part[0].toUpperCase()}.`)].join(' ');
}

/** "szeptember 25." — with "2/3" when the day had several closings. */
export function closingLabel(closedAt: Date, ordinal: number, total: number): string {
  const day = closedAt.toLocaleDateString('hu-HU', {month: 'long', day: 'numeric', timeZone: HOUSE_TZ});
  return total > 1 ? `${day} ${ordinal}/${total}` : day;
}

export const transferMemo = (shiftId: string, label: string, name: string): string => `${shiftId}, ${label} - ${shortName(name)}`;

/** The n-th closing of its day, out of how many so far. */
async function dayOrdinal(db: Queryable, shiftId: string, closedAt: Date): Promise<{ordinal: number; total: number}> {
  const {rows} = await db.query<{id: string}>(
    `select id from public.shifts
      where status = 'closed' and ended_at is not null
        and (ended_at at time zone $2)::date = ($1::timestamptz at time zone $2)::date
      order by ended_at, id`,
    [closedAt, HOUSE_TZ]
  );
  const index = rows.findIndex((row) => row.id === shiftId);
  return index >= 0 ? {ordinal: index + 1, total: rows.length} : {ordinal: rows.length + 1, total: rows.length + 1};
}

export async function reportView(db: Queryable, row: Row) {
  const closedAt = new Date(row.closed_at);
  const {ordinal, total} = await dayOrdinal(db, row.shift_id, closedAt);
  const label = closingLabel(closedAt, ordinal, total);
  return {
    id: row.id,
    shiftId: row.shift_id,
    userId: row.user_id,
    userName: row.user_name,
    amount: Number(row.amount) || 0,
    salesCount: Number(row.sales_count) || 0,
    items: Number(row.items) || 0,
    closedAt: iso(row.closed_at),
    closedByName: row.closed_by_name || '',
    seenAt: iso(row.seen_at),
    closingLabel: label,
    transfer: {account: TRANSFER_ACCOUNT, owner: TRANSFER_OWNER, memo: transferMemo(row.shift_id, label, row.user_name)}
  };
}

interface Seller {
  userId: string | null;
  name: string;
  revenue: number;
  sales: number;
  items: number;
}

/** One report per member who has an account, plus the closer. */
export async function createShiftReports(db: Queryable, shiftId: string, closer: {id: string; name: string}, breakdown: Seller[], closedAt: Date): Promise<Row[]> {
  const people = new Map<string, Seller>();
  for (const entry of breakdown) if (entry.userId) people.set(entry.userId, entry);
  if (!people.has(closer.id)) people.set(closer.id, {userId: closer.id, name: closer.name, revenue: 0, sales: 0, items: 0});
  const rows: Row[] = [];
  for (const [userId, entry] of people) {
    const {rows: inserted} = await db.query(
      `insert into public.shift_reports (shift_id, user_id, user_name, amount, sales_count, items, closed_at, closed_by_name)
       values ($1, $2, $3, $4, $5, $6, $7, $8)
       on conflict (shift_id, user_id) do update set amount = excluded.amount, sales_count = excluded.sales_count, items = excluded.items, closed_at = excluded.closed_at, closed_by_name = excluded.closed_by_name
       returning *`,
      [shiftId, userId, entry.name, Math.round(entry.revenue), entry.sales, entry.items, closedAt, closer.name]
    );
    rows.push(inserted[0]);
  }
  return rows;
}

export async function unseenCount(db: Queryable, userId: string): Promise<number> {
  const {rows} = await db.query<{n: number}>('select count(*)::int as n from public.shift_reports where user_id = $1 and seen_at is null', [userId]);
  return rows[0]?.n || 0;
}

export function registerShiftReportRoutes(router: Router): void {
  /** What is waiting for me, oldest first. */
  router.get('/api/shift-reports/pending', async ({db, user}) => {
    const me = requireUser({user});
    const {rows} = await db.query('select * from public.shift_reports where user_id = $1 and seen_at is null order by closed_at', [me.id]);
    return {reports: await Promise.all(rows.map((row) => reportView(db, row)))};
  });

  /** My own reports, newest first — the ones already seen included. */
  router.get('/api/shift-reports', async ({db, user}) => {
    const me = requireUser({user});
    const {rows} = await db.query('select * from public.shift_reports where user_id = $1 order by closed_at desc limit 30', [me.id]);
    return {reports: await Promise.all(rows.map((row) => reportView(db, row)))};
  });

  router.post('/api/shift-reports/:id/seen', async ({db, user, params}) => {
    const me = requireUser({user});
    const {rows} = await db.query('update public.shift_reports set seen_at = coalesce(seen_at, now()) where id = $1 and user_id = $2 returning *', [params.id, me.id]);
    if (!rows[0]) throw notFound('A zárás nem található.');
    await audit(db, me, 'SHIFT_REPORT_SEEN', `${rows[0].shift_id} · ${rows[0].amount} Ft`);
    return {report: await reportView(db, rows[0]), pending: await unseenCount(db, me.id)};
  });
}
