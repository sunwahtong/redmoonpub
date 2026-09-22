/**
 * Accounts, the team list, notifications, the audit log and the dashboard.
 */
import {z} from 'zod';
import {
  audit,
  ensureSignature,
  hashPassword,
  JOBS,
  listAccounts,
  loadAccount,
  passwordProblem,
  publicUser,
  requireRole,
  requireUser,
  revokeUserSessions,
  ROLES,
  roleAtLeast
} from '../auth.ts';
import {bad, conflict, created, formatPhone, iso, notFound, parse, readJson, type Router} from '../http.ts';
import {generateSignatureSvg} from '../../shared/signature.ts';
import {houseStatus} from './public.ts';
import type {Row} from '../types.ts';

const jobsSchema = z.array(z.enum(JOBS)).max(JOBS.length).default([]);
const usernameSchema = z
  .string()
  .trim()
  .min(3, 'A felhasználónév legalább 3 karakter.')
  .max(40)
  .regex(/^[a-zA-Z0-9._-]+$/, 'A felhasználónév csak betűt, számot, pontot, kötőjelet tartalmazhat.');

const userCreate = z.object({
  username: usernameSchema,
  password: z.string().min(8, 'A jelszó legalább 8 karakter.').max(200),
  name: z.string().trim().min(2, 'A név legalább két karakter.').max(100),
  nickname: z.string().trim().max(40).default(''),
  title: z.string().trim().max(80).default(''),
  role: z.enum(ROLES).default('staff'),
  jobs: jobsSchema,
  idNumber: z.string().trim().max(40).default(''),
  showPublic: z.boolean().default(false),
  mustChangePassword: z.boolean().default(true)
});

const userPatch = z.object({
  username: usernameSchema.optional(),
  password: z.string().max(200).optional(),
  name: z.string().trim().min(2).max(100).optional(),
  nickname: z.string().trim().max(40).optional(),
  title: z.string().trim().max(80).optional(),
  role: z.enum(ROLES).optional(),
  jobs: jobsSchema.optional(),
  idNumber: z.string().trim().max(40).optional(),
  showPublic: z.boolean().optional(),
  active: z.boolean().optional(),
  mustChangePassword: z.boolean().optional()
});

export const saleFromRow = (row: Row) => ({
  id: row.id,
  transactionId: row.transaction_id,
  cartId: row.cart_id || '',
  at: iso(row.at),
  shiftId: row.shift_id,
  userId: row.user_id,
  user: row.user_name,
  soldByName: row.user_name,
  productId: row.product_id,
  product: row.product_name,
  category: row.category,
  qty: row.qty,
  unitPrice: row.unit_price,
  total: row.total,
  paymentMethod: row.payment_method,
  receiptId: row.receipt_id || null,
  documentId: row.invoice_id || null
});

export function registerStaffRoutes(router: Router): void {
  /* ---------------- team ---------------- */

  router.get('/api/employees', async ({db, user}) => {
    requireUser({user});
    const accounts = await listAccounts(db, {includeInactive: false});
    return {users: accounts.map((account) => publicUser(account))};
  });

  router.get('/api/users', async ({db, user}) => {
    requireRole({user}, 'owner');
    const accounts = await listAccounts(db);
    return {users: accounts.map((account) => publicUser(account))};
  });

  router.post('/api/users', async ({db, req, user}) => {
    const me = requireRole({user}, 'owner');
    const body = parse(userCreate, await readJson(req));
    const problem = passwordProblem(body.password);
    if (problem) throw bad(problem);
    const taken = await db.query('select 1 from public.staff_accounts where lower(username) = lower($1)', [body.username]);
    if (taken.rows.length) throw conflict('Ez a felhasználónév már létezik');
    const {rows} = await db.query<{id: string}>(
      `insert into public.staff_accounts (username, name, nickname, title, role, jobs, password_hash, id_number, show_public, must_change_password, created_by)
       values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11) returning id`,
      [body.username, body.name, body.nickname, body.title, body.role, body.jobs, await hashPassword(body.password), body.idNumber, body.showPublic, body.mustChangePassword, me.id]
    );
    const account = (await loadAccount(db, rows[0].id))!;
    account.signatureSvg = await ensureSignature(db, account);
    await audit(db, me, 'USER_CREATE', `${account.name} (${account.username}) · ${account.role}${account.jobs.length ? ' · ' + account.jobs.join(', ') : ''}`);
    return created({user: publicUser(account)});
  });

  router.patch('/api/users/:id', async ({db, req, user, params}) => {
    const me = requireRole({user}, 'owner');
    const target = await loadAccount(db, params.id);
    if (!target) throw notFound('Felhasználó nem található');
    const body = parse(userPatch, await readJson(req));

    if (body.username && body.username.toLowerCase() !== target.username.toLowerCase()) {
      const taken = await db.query('select 1 from public.staff_accounts where lower(username) = lower($1) and id <> $2', [body.username, target.id]);
      if (taken.rows.length) throw conflict('Ez a felhasználónév már használatban van');
    }

    const owners = await db.query<{n: number}>(`select count(*)::int as n from public.staff_accounts where role = 'owner' and active`);
    const demotingLastOwner = target.role === 'owner' && ((body.role && body.role !== 'owner') || body.active === false) && owners.rows[0].n <= 1;
    if (demotingLastOwner) throw bad('Az utolsó OWNER jogosultság nem vehető el.');
    if (target.id === me.id && body.role && body.role !== 'owner') throw bad('A saját OWNER jogosultságodat innen nem veheted el.');
    if (target.id === me.id && body.active === false) throw bad('A saját fiókodat nem tilthatod le.');

    const fields: string[] = [];
    const values: unknown[] = [target.id];
    const set = (column: string, value: unknown) => {
      values.push(value);
      fields.push(`${column} = $${values.length}`);
    };
    if (body.username !== undefined) set('username', body.username);
    if (body.name !== undefined) set('name', body.name);
    if (body.nickname !== undefined) set('nickname', body.nickname);
    if (body.title !== undefined) set('title', body.title);
    if (body.role !== undefined) set('role', body.role);
    if (body.jobs !== undefined) set('jobs', body.jobs);
    if (body.idNumber !== undefined) set('id_number', body.idNumber);
    if (body.showPublic !== undefined) set('show_public', body.showPublic);
    if (body.active !== undefined) set('active', body.active);
    if (body.mustChangePassword !== undefined) set('must_change_password', body.mustChangePassword);

    let passwordChanged = false;
    if (body.password) {
      const problem = passwordProblem(body.password);
      if (problem) throw bad(problem);
      set('password_hash', await hashPassword(body.password));
      set('must_change_password', body.mustChangePassword ?? true);
      passwordChanged = true;
    }
    if (fields.length) await db.query(`update public.staff_accounts set ${fields.join(', ')} where id = $1`, values);

    const fresh = (await loadAccount(db, target.id))!;
    fresh.signatureSvg = await ensureSignature(db, fresh);

    let revoked = 0;
    if (passwordChanged || body.active === false) {
      revoked = await revokeUserSessions(db, target.id, passwordChanged ? 'password_changed' : 'disabled');
    }
    const changes: string[] = [];
    if (body.role && body.role !== target.role) changes.push(`${target.role} → ${body.role}`);
    if (passwordChanged) changes.push('jelszó frissítve');
    if (body.active === false) changes.push('letiltva');
    if (body.active === true && !target.active) changes.push('engedélyezve');
    if (revoked) changes.push(`${revoked} munkamenet lezárva`);
    await audit(db, me, 'USER_UPDATE', `${fresh.name} (${fresh.username})${changes.length ? ' · ' + changes.join(' · ') : ''}`);
    return {user: publicUser(fresh), sessionRevoked: revoked > 0};
  });

  router.delete('/api/users/:id', async ({db, user, params}) => {
    const me = requireRole({user}, 'owner');
    if (params.id === me.id) throw bad('A saját OWNER fiókodat nem törölheted.');
    const target = await loadAccount(db, params.id);
    if (!target) throw notFound('Felhasználó nem található');
    if (target.role === 'owner') {
      const owners = await db.query<{n: number}>(`select count(*)::int as n from public.staff_accounts where role = 'owner'`);
      if (owners.rows[0].n <= 1) throw bad('Az utolsó OWNER fiók nem törölhető.');
    }
    await db.query('delete from public.staff_accounts where id = $1', [params.id]);
    await audit(db, me, 'USER_DELETE', `${target.name} (${target.username})`);
    return {ok: true};
  });

  router.post('/api/users/:id/force-logout', async ({db, user, params}) => {
    const me = requireRole({user}, 'owner');
    if (params.id === me.id) throw bad('A saját aktív munkamenetedet innen nem léptetheted ki.');
    const target = await loadAccount(db, params.id);
    if (!target) throw notFound('Felhasználó nem található');
    const count = await revokeUserSessions(db, params.id, 'owner_force_logout');
    await audit(db, me, 'FORCE_LOGOUT', `${target.name} · ${count} munkamenet lezárva`);
    return {ok: true, count};
  });

  router.delete('/api/users/:id/phone', async ({db, user, params}) => {
    const me = requireRole({user}, 'owner');
    const target = await loadAccount(db, params.id);
    if (!target) throw notFound('Felhasználó nem található');
    if (!target.phone) return {ok: true, user: publicUser(target)};
    await db.query(`update public.staff_accounts set phone = '' where id = $1`, [params.id]);
    await audit(db, me, 'PHONE_CLEAR', `${target.name} · ${formatPhone(target.phone)}`);
    return {ok: true, user: publicUser((await loadAccount(db, params.id))!)};
  });

  /** Redraws a signature. Only for managers and above; the old mark is replaced. */
  router.post('/api/users/:id/signature', async ({db, user, params}) => {
    const me = requireRole({user}, 'owner');
    const target = await loadAccount(db, params.id);
    if (!target) throw notFound('Felhasználó nem található');
    if (!roleAtLeast(target.role, 'manager')) throw bad('Aláírás csak üzletvezetői vagy tulajdonosi fióknak készül.');
    const svg = generateSignatureSvg(target.name, `${target.id}:${Date.now()}`);
    await db.query('update public.staff_accounts set signature_svg = $2, signature_at = now() where id = $1', [target.id, svg]);
    await audit(db, me, 'SIGNATURE_REGENERATE', target.name);
    return {user: publicUser((await loadAccount(db, target.id))!)};
  });

  /* ---------------- notifications ---------------- */

  router.get('/api/notifications', async ({db, user}) => {
    const me = requireRole({user}, 'manager');
    const {rows} = await db.query(
      `select n.*, r.read_at from public.notifications n
       left join public.notification_reads r on r.notification_id = n.id and r.user_id = $2
       where $1 = any(n.audience) order by n.at desc limit 100`,
      [me.role, me.id]
    );
    return {
      notifications: rows.map((row) => ({
        id: row.id,
        at: iso(row.at),
        audience: row.audience,
        title: row.title,
        message: row.message,
        meta: row.meta || {},
        read: !!row.read_at
      })),
      unread: rows.filter((row) => !row.read_at).length
    };
  });

  router.post('/api/notifications/read', async ({db, req, user}) => {
    const me = requireRole({user}, 'manager');
    const body = await readJson(req);
    if (body.all) {
      await db.query(
        `insert into public.notification_reads (notification_id, user_id)
         select id, $1 from public.notifications where $2 = any(audience)
         on conflict do nothing`,
        [me.id, me.role]
      );
      return {ok: true};
    }
    const id = String(body.id || '');
    const {rows} = await db.query('select id, title from public.notifications where id = $1', [id]);
    if (!rows[0]) throw notFound('Értesítés nem található');
    await db.query('insert into public.notification_reads (notification_id, user_id) values ($1, $2) on conflict do nothing', [id, me.id]);
    return {ok: true};
  });

  /* ---------------- audit ---------------- */

  router.get('/api/audit', async ({db, user}) => {
    requireRole({user}, 'owner');
    const {rows} = await db.query('select * from public.audit_log order by at desc limit 500');
    return {
      audit: rows.map((row) => ({id: row.id, at: iso(row.at), userId: row.user_id, user: row.user_name, role: row.role, action: row.action, details: row.details}))
    };
  });

  /* ---------------- dashboard ---------------- */

  router.get('/api/dashboard', async ({db, user}) => {
    requireUser({user});
    const [today, low, top, recent, status] = await Promise.all([
      db.query<{revenue: number; items: number; sales_count: number}>(
        `select coalesce(sum(total),0)::int as revenue, coalesce(sum(qty),0)::int as items, count(*)::int as sales_count
         from public.sales where at >= date_trunc('day', now())`
      ),
      db.query('select id, name, stock, min_stock from public.products where active and stock <= min_stock order by stock asc'),
      db.query(
        `select product_name as product, sum(qty)::int as qty from public.sales
         where at >= date_trunc('day', now()) group by product_name order by qty desc limit 6`
      ),
      db.query('select * from public.sales order by at desc limit 20'),
      houseStatus(db)
    ]);
    const overall = await db.query<{revenue: number}>(
      `select coalesce(sum(s.total),0)::int as revenue from public.sales s, public.house h
       where h.id = 1 and (h.revenue_reset_at is null or s.at > h.revenue_reset_at)`
    );
    const shift = await db.query(`select id, started_at, started_by_name from public.shifts where status = 'open' limit 1`);
    return {
      today: {revenue: today.rows[0].revenue, items: today.rows[0].items, salesCount: today.rows[0].sales_count},
      overallRevenue: overall.rows[0].revenue,
      lowStock: low.rows.map((row) => ({id: row.id, name: row.name, stock: row.stock, minStock: row.min_stock})),
      topSales: top.rows,
      recentSales: recent.rows.map(saleFromRow),
      openShift: shift.rows[0] ? {id: shift.rows[0].id, openedAt: iso(shift.rows[0].started_at), openedByName: shift.rows[0].started_by_name} : null,
      house: status
    };
  });
}
