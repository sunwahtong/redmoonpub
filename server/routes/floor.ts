/**
 * The floor plan and what it means for bookings.
 *
 * The plan is one document (shared/floorPlan.ts describes it) the owner
 * edits from the console; without a saved one the default room is used. A
 * booking that names a table is checked against the plan (does the table
 * exist, does the party fit, does the House tier allow it) and against the
 * other bookings that already hold that table: only confirmed and seated
 * ones count — a request nobody has looked at yet holds nothing.
 */
import {audit, requireRole} from '../auth.ts';
import {bad, conflict, forbidden, iso, readJson, type Router} from '../http.ts';
import {broadcast} from '../realtime.ts';
import {DEFAULT_FLOOR_PLAN, normalizeFloorPlan, RESERVATION_SLOT_MINUTES, tierRank, type FloorPlan, type FloorTable} from '../../shared/floorPlan.ts';
import type {Queryable, Row} from '../types.ts';

const PLAN_ID = 'main';

/** Statuses that hold a table. */
export const BLOCKING_STATUSES = ['confirmed', 'seated'] as const;

const hhmm = (value: Date | string): string => new Date(value).toLocaleTimeString('hu-HU', {hour: '2-digit', minute: '2-digit', timeZone: 'Europe/Budapest'});

export const slotEnd = (start: Date | string): Date => new Date(new Date(start).getTime() + RESERVATION_SLOT_MINUTES * 60000);

/** The built-in room in canonical shape (defaults filled in), same as a saved one. */
const defaultPlan = (): FloorPlan => normalizeFloorPlan(DEFAULT_FLOOR_PLAN);

export async function loadFloorPlan(db: Queryable): Promise<FloorPlan> {
  const row = (await db.query('select plan from public.floor_plans where id = $1', [PLAN_ID])).rows[0];
  if (!row) return defaultPlan();
  try {
    return normalizeFloorPlan(row.plan);
  } catch {
    return defaultPlan();
  }
}

/** Confirmed or seated bookings holding a table for any moment of [from, to). */
export async function heldTables(db: Queryable, from: Date, to: Date, exceptId?: string): Promise<Row[]> {
  const {rows} = await db.query(
    `select id, code, name, guests, status, table_id, table_label, starts_at
       from public.reservations
      where table_id <> '' and status in ('confirmed', 'seated')
        and starts_at < $2 and starts_at + make_interval(mins => $3::int) > $1
      order by starts_at`,
    [from, to, RESERVATION_SLOT_MINUTES]
  );
  return exceptId ? rows.filter((row) => row.id !== exceptId) : rows;
}

/**
 * The table a booking may have, or the reason it may not: unknown, too
 * small, too big for the party, House-only, or already promised to someone.
 */
export async function checkTable(db: Queryable, plan: FloorPlan, tableId: string, guests: number, tier: string, when: Date, exceptId?: string, options: {skipTier?: boolean} = {}): Promise<FloorTable> {
  const table = plan.tables.find((entry) => entry.id === tableId);
  if (!table || table.active === false) throw bad('Ez az asztal nincs a térképen. Válassz másikat.');
  if (guests > table.seats) throw bad(`A(z) ${table.label} asztalnál legfeljebb ${table.seats} fő fér el.`);
  if (guests < (table.minGuests || 1)) throw bad(`A(z) ${table.label} asztalt legalább ${table.minGuests} főre adjuk ki.`);
  if (!options.skipTier && table.minTier && tierRank(tier) < tierRank(table.minTier)) throw forbidden(`A(z) ${table.label} asztal a House ${table.minTier} szintjétől foglalható — tagsági kóddal.`);
  const clash = (await heldTables(db, when, slotEnd(when), exceptId)).find((row) => row.table_id === tableId);
  if (clash) throw conflict(`A(z) ${table.label} asztal ekkor már foglalt (${hhmm(clash.starts_at)}–${hhmm(slotEnd(clash.starts_at))}). Válassz másik asztalt vagy időpontot.`);
  return table;
}

export function registerFloorRoutes(router: Router): void {
  /**
   * The plan plus the tables held around a moment (a day either way), so a
   * form can colour the room for any time of that evening without asking
   * again. Staff get the booking behind each held table.
   */
  router.get('/api/public/floor-plan', async ({db, user, query}) => {
    const plan = await loadFloorPlan(db);
    const raw = query.get('at');
    const at = raw ? new Date(raw) : new Date();
    if (Number.isNaN(at.getTime())) throw bad('Érvénytelen időpont.');
    const from = new Date(at.getTime() - 24 * 3600000);
    const to = new Date(at.getTime() + 24 * 3600000);
    const rows = await heldTables(db, from, to);
    return {
      plan,
      slotMinutes: RESERVATION_SLOT_MINUTES,
      at: at.toISOString(),
      taken: rows.map((row) => ({
        tableId: row.table_id,
        from: iso(row.starts_at),
        to: slotEnd(row.starts_at).toISOString(),
        ...(user ? {id: row.id, code: row.code, name: row.name, guests: row.guests, status: row.status} : {})
      }))
    };
  });

  /** The owner replaces the plan. The body is the plan itself, or {plan}. */
  router.put('/api/house/floor-plan', async ({db, req, user}) => {
    const me = requireRole({user}, 'owner');
    const body = (await readJson(req)) as Record<string, unknown>;
    let plan: FloorPlan;
    try {
      plan = normalizeFloorPlan(body && typeof body === 'object' && 'plan' in body ? body.plan : body);
    } catch (err) {
      throw bad(`Az alaprajz hibás — ${(err as Error).message}`);
    }
    await db.query(
      `insert into public.floor_plans (id, plan, updated_by_name) values ($1, $2, $3)
       on conflict (id) do update set plan = excluded.plan, updated_at = now(), updated_by_name = excluded.updated_by_name`,
      [PLAN_ID, JSON.stringify(plan), me.nickname || me.name]
    );
    await audit(db, me, 'FLOOR_PLAN_UPDATE', `${plan.name} · ${plan.tables.length} asztal`);
    await broadcast('content', 'floor-plan');
    return {plan};
  });

  /** Back to the default room. */
  router.delete('/api/house/floor-plan', async ({db, user}) => {
    const me = requireRole({user}, 'owner');
    await db.query('delete from public.floor_plans where id = $1', [PLAN_ID]);
    await audit(db, me, 'FLOOR_PLAN_RESET', 'alapértelmezett alaprajz');
    await broadcast('content', 'floor-plan');
    return {plan: defaultPlan()};
  });
}
