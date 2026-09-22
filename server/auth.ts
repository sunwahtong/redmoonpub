/**
 * Accounts, passwords, sessions and permissions.
 *
 * Passwords are hashed with scrypt (memory-hard, built into Node, no native
 * dependency). Hashes created by the previous version (PBKDF2) still verify
 * and are re-hashed on the next successful login.
 *
 * A session is a random 256-bit token; only its SHA-256 is stored, so the
 * table is useless to anyone who reads it. The cookie is HttpOnly, SameSite,
 * and Secure whenever the request arrived over HTTPS.
 */
import crypto from 'node:crypto';
import type {ServerResponse} from 'node:http';
import {config} from './config.ts';
import {clientIp, forbidden, formatPhone, isSecure, parseCookies, setCookie, sha256, tooMany, unauthorized} from './http.ts';
import {generateSignatureSvg} from '../shared/signature.ts';
import type {Account, Capabilities, Queryable, Request, Role, Row, SessionUser, UserCtx} from './types.ts';

export const ROLES = ['staff', 'manager', 'owner'] as const;
export const JOBS = ['pultos', 'bartender', 'felszolgalo', 'biztonsag', 'hostess', 'dj', 'uzletvezeto'] as const;
/** Jobs that may claim a supply run without a manager rank. */
export const ORDER_RUNNER_JOBS = ['biztonsag'];

const RANK: Record<string, number> = {staff: 1, manager: 2, owner: 3};
export const roleAtLeast = (role: string, need: Role): boolean => (RANK[role] || 0) >= (RANK[need] || 99);

/* ------------------------------------------------------------------ */
/* Passwords                                                           */
/* ------------------------------------------------------------------ */

const SCRYPT = {N: 2 ** 15, r: 8, p: 1, keylen: 32, maxmem: 64 * 1024 * 1024};

export function hashPassword(password: string): string {
  const salt = crypto.randomBytes(16);
  const hash = crypto.scryptSync(String(password), salt, SCRYPT.keylen, SCRYPT);
  return `scrypt$${SCRYPT.N}$${SCRYPT.r}$${SCRYPT.p}$${salt.toString('base64')}$${hash.toString('base64')}`;
}

export function verifyPassword(password: string, encoded: string | null | undefined): boolean {
  const value = String(encoded || '');
  try {
    if (value.startsWith('scrypt$')) {
      const [, N, r, p, salt, hash] = value.split('$');
      const expected = Buffer.from(hash, 'base64');
      const got = crypto.scryptSync(String(password), Buffer.from(salt, 'base64'), expected.length, {
        N: Number(N),
        r: Number(r),
        p: Number(p),
        maxmem: SCRYPT.maxmem
      });
      return crypto.timingSafeEqual(got, expected);
    }
    if (value.startsWith('PBKDF2:')) {
      const [, iterations, algorithm, salt, hash] = value.split(':');
      const expected = Buffer.from(hash, 'hex');
      const got = crypto.pbkdf2Sync(String(password), salt, Number(iterations), expected.length, algorithm);
      return crypto.timingSafeEqual(got, expected);
    }
  } catch {
    return false;
  }
  return false;
}

/** A hash of a random password, verified for unknown users so timing does not reveal them. */
export const DUMMY_HASH = hashPassword(crypto.randomBytes(24).toString('hex'));

export const needsRehash = (encoded: string): boolean => !String(encoded || '').startsWith('scrypt$');

export function passwordProblem(password: string): string | null {
  const value = String(password || '');
  if (value.length < 8) return 'A jelszó legyen legalább 8 karakter.';
  if (value.length > 200) return 'A jelszó túl hosszú.';
  if (!/[a-zA-Z]/.test(value) || !/\d/.test(value)) return 'A jelszó tartalmazzon betűt és számot is.';
  return null;
}

/* ------------------------------------------------------------------ */
/* Login throttling                                                    */
/* ------------------------------------------------------------------ */

export async function assertLoginAllowed(db: Queryable, usernameLower: string, ip: string): Promise<void> {
  const since = new Date(Date.now() - config.loginWindowMs);
  const {rows} = await db.query<{user_failures: number; ip_failures: number}>(
    `select
       count(*) filter (where username_lower = $1 and not success)::int as user_failures,
       count(*) filter (where ip = $2 and not success)::int as ip_failures
     from public.login_attempts where at > $3`,
    [usernameLower, ip, since]
  );
  const userFailures = rows[0]?.user_failures || 0;
  const ipFailures = rows[0]?.ip_failures || 0;
  if (userFailures >= config.loginMaxPerUser || ipFailures >= config.loginMaxPerIp) {
    throw tooMany('Túl sok sikertelen belépés. Próbáld újra negyedóra múlva.', {retryAfterMs: config.loginWindowMs});
  }
}

export async function recordLoginAttempt(db: Queryable, usernameLower: string, ip: string, success: boolean): Promise<void> {
  await db.query('insert into public.login_attempts (username_lower, ip, success) values ($1, $2, $3)', [usernameLower, ip, success]);
  // Opportunistic sweep; the table must never grow without bound.
  if (Math.random() < 0.05) {
    await db.query(`delete from public.login_attempts where at < now() - interval '2 days'`);
  }
}

/* ------------------------------------------------------------------ */
/* Sessions                                                            */
/* ------------------------------------------------------------------ */

export const SESSION_COOKIE = 'rm_session';

export async function createSession(db: Queryable, req: Request, res: ServerResponse, userId: string): Promise<string> {
  const token = crypto.randomBytes(32).toString('base64url');
  const expiresAt = new Date(Date.now() + config.sessionMaxMs);
  await db.query(
    `insert into public.sessions (token_hash, user_id, expires_at, ip, user_agent)
     values ($1, $2, $3, $4, $5)`,
    [sha256(token), userId, expiresAt, clientIp(req), String(req.headers['user-agent'] || '').slice(0, 300)]
  );
  setCookie(res, SESSION_COOKIE, token, {maxAge: config.sessionMaxMs / 1000, secure: isSecure(req)});
  return token;
}

export function clearSessionCookie(req: Request, res: ServerResponse): void {
  setCookie(res, SESSION_COOKIE, '', {maxAge: 0, secure: isSecure(req)});
}

export async function revokeSession(db: Queryable, token: string | undefined, reason = 'logout'): Promise<void> {
  if (!token) return;
  await db.query(`update public.sessions set revoked_at = now(), revoked_reason = $2 where token_hash = $1`, [sha256(token), reason]);
}

export async function revokeUserSessions(db: Queryable, userId: string, reason: string, exceptTokenHash: string | null = null): Promise<number> {
  const {rowCount} = await db.query(
    `update public.sessions set revoked_at = now(), revoked_reason = $2
     where user_id = $1 and revoked_at is null and ($3::text is null or token_hash <> $3)`,
    [userId, reason, exceptTokenHash]
  );
  return rowCount;
}

/** Sessions that were seen recently and are still valid, per user. */
export async function activeSessionsOf(db: Queryable, userId: string, withinMs = 90 * 1000): Promise<Row[]> {
  const {rows} = await db.query(
    `select id, last_seen_at, ip from public.sessions
     where user_id = $1 and revoked_at is null and expires_at > now() and last_seen_at > $2
     order by last_seen_at desc`,
    [userId, new Date(Date.now() - withinMs)]
  );
  return rows;
}

const USER_COLUMNS = `id, username, name, nickname, title, role, jobs, phone, id_number, avatar,
  signature_svg, signature_at, must_change_password, show_public, active, last_login_at, last_active_at, created_at`;

/**
 * Resolves the signed-in account from the session cookie, or null.
 * Bumps `last_seen_at` at most once a minute so reads stay cheap.
 */
export async function authenticate(db: Queryable, req: Request): Promise<SessionUser | null> {
  const token = parseCookies(req)[SESSION_COOKIE];
  if (!token) return null;
  const tokenHash = sha256(token);
  const {rows} = await db.query(
    `select s.id as session_id, s.last_seen_at, s.created_at as session_created_at, s.expires_at,
            u.${USER_COLUMNS.replace(/,\s*/g, ', u.')}
     from public.sessions s
     join public.staff_accounts u on u.id = s.user_id
     where s.token_hash = $1 and s.revoked_at is null and s.expires_at > now() and u.active`,
    [tokenHash]
  );
  const row = rows[0];
  if (!row) return null;
  const lastSeen = new Date(row.last_seen_at).getTime();
  if (Date.now() - lastSeen > config.sessionIdleMs) {
    await db.query(`update public.sessions set revoked_at = now(), revoked_reason = 'idle' where id = $1`, [row.session_id]);
    return null;
  }
  if (Date.now() - lastSeen > 60 * 1000) {
    await db.query('update public.sessions set last_seen_at = now() where id = $1', [row.session_id]);
    await db.query('update public.staff_accounts set last_active_at = now() where id = $1', [row.id]);
  }
  return {...accountFromRow(row), sessionId: row.session_id, tokenHash};
}

/* ------------------------------------------------------------------ */
/* Accounts                                                            */
/* ------------------------------------------------------------------ */

export function accountFromRow(row: Row): Account {
  const jobs = Array.isArray(row.jobs) ? row.jobs : [];
  return {
    id: row.id,
    username: row.username,
    name: row.name,
    nickname: row.nickname || '',
    title: row.title || '',
    role: row.role,
    jobs,
    phone: row.phone || '',
    idNumber: row.id_number || '',
    avatar: row.avatar || '',
    signatureSvg: row.signature_svg || null,
    signatureAt: row.signature_at ? new Date(row.signature_at).toISOString() : null,
    mustChangePassword: !!row.must_change_password,
    showPublic: !!row.show_public,
    active: row.active !== false,
    lastLoginAt: row.last_login_at ? new Date(row.last_login_at).toISOString() : null,
    lastActiveAt: row.last_active_at ? new Date(row.last_active_at).toISOString() : null,
    createdAt: row.created_at ? new Date(row.created_at).toISOString() : null
  };
}

export function capabilitiesOf(account: Pick<Account, 'role' | 'jobs'>): Capabilities {
  const manager = roleAtLeast(account.role, 'manager');
  const owner = roleAtLeast(account.role, 'owner');
  return {
    manager,
    owner,
    dj: owner || manager || account.jobs.includes('dj'),
    runOrders: manager || account.jobs.some((job) => ORDER_RUNNER_JOBS.includes(job)),
    manageBlips: manager,
    manageEvents: owner,
    manageProducts: manager,
    manageUsers: owner,
    manageHouse: owner,
    viewAudit: owner,
    documents: manager
  };
}

/** What the browser is allowed to know about an account. */
export function publicUser(account: Account, {self = false}: {self?: boolean} = {}) {
  const jobs = account.jobs || [];
  return {
    id: account.id,
    username: account.username,
    name: account.name,
    nickname: account.nickname || '',
    title: account.title || '',
    role: account.role,
    jobs,
    job: jobs[0] || '',
    avatar: account.avatar || '',
    phone: formatPhone(account.phone || ''),
    idNumber: account.idNumber || '',
    hasSignature: !!account.signatureSvg,
    signatureSvg: account.signatureSvg || null,
    showPublic: !!account.showPublic,
    active: account.active !== false,
    lastActiveAt: account.lastActiveAt || null,
    lastLoginAt: account.lastLoginAt || null,
    createdAt: account.createdAt || null,
    mustChangePassword: self ? !!account.mustChangePassword : undefined,
    capabilities: capabilitiesOf(account)
  };
}

export async function loadAccount(db: Queryable, id: string): Promise<Account | null> {
  const {rows} = await db.query(`select ${USER_COLUMNS} from public.staff_accounts where id = $1`, [id]);
  return rows[0] ? accountFromRow(rows[0]) : null;
}

export async function listAccounts(db: Queryable, {includeInactive = true}: {includeInactive?: boolean} = {}): Promise<Account[]> {
  const {rows} = await db.query(
    `select ${USER_COLUMNS} from public.staff_accounts ${includeInactive ? '' : 'where active'}
     order by case role when 'owner' then 0 when 'manager' then 1 else 2 end, name`
  );
  return rows.map(accountFromRow);
}

/**
 * Gives an account its signature the moment it holds manager rank or above.
 * Existing signatures are kept, so promotions and demotions never redraw it.
 */
export async function ensureSignature(db: Queryable, account: Account): Promise<string | null> {
  if (!roleAtLeast(account.role, 'manager') || account.signatureSvg) return account.signatureSvg || null;
  const svg = generateSignatureSvg(account.name, account.id);
  await db.query('update public.staff_accounts set signature_svg = $2, signature_at = now() where id = $1', [account.id, svg]);
  return svg;
}

/* ------------------------------------------------------------------ */
/* Guards                                                              */
/* ------------------------------------------------------------------ */

export function requireUser(ctx: UserCtx): SessionUser {
  if (!ctx.user) throw unauthorized();
  return ctx.user;
}

export function requireRole(ctx: UserCtx, need: Role = 'staff'): SessionUser {
  const user = requireUser(ctx);
  if (!roleAtLeast(user.role, need)) throw forbidden();
  return user;
}

export function requireCapability(ctx: UserCtx, capability: keyof Capabilities, message?: string): SessionUser {
  const user = requireUser(ctx);
  if (!capabilitiesOf(user)[capability]) throw forbidden(message);
  return user;
}

/* ------------------------------------------------------------------ */
/* Audit & notifications                                               */
/* ------------------------------------------------------------------ */

export async function audit(db: Queryable, user: Pick<Account, 'id' | 'name' | 'role'> | null, action: string, details = ''): Promise<void> {
  await db.query('insert into public.audit_log (user_id, user_name, role, action, details) values ($1, $2, $3, $4, $5)', [
    user?.id || null,
    user?.name || 'rendszer',
    user?.role || '',
    action,
    String(details).slice(0, 2000)
  ]);
}

export async function notify(db: Queryable, audience: string[], title: string, message: string, meta: Record<string, unknown> = {}): Promise<void> {
  await db.query('insert into public.notifications (audience, title, message, meta) values ($1, $2, $3, $4)', [
    Array.isArray(audience) ? audience : ['owner'],
    title,
    message,
    JSON.stringify(meta)
  ]);
}

export const notifyManagers = (db: Queryable, title: string, message: string, meta?: Record<string, unknown>) =>
  notify(db, ['manager', 'owner'], title, message, meta);
export const notifyOwners = (db: Queryable, title: string, message: string, meta?: Record<string, unknown>) => notify(db, ['owner'], title, message, meta);

/* ------------------------------------------------------------------ */
/* Anonymous rate limiting                                             */
/* ------------------------------------------------------------------ */

/**
 * Fixed-window counter in the database, so the limit holds across serverless
 * instances. Throws 429 once `max` hits land in one window.
 */
export async function rateLimit(db: Queryable, key: string, max: number, windowMs: number): Promise<void> {
  const now = Date.now();
  const {rows} = await db.query<{window_start: string; count: number}>('select window_start, count from public.rate_limits where key = $1', [key]);
  const row = rows[0];
  const windowStart = row ? new Date(row.window_start).getTime() : 0;
  if (!row || now - windowStart >= windowMs) {
    await db.query(
      `insert into public.rate_limits (key, window_start, count) values ($1, $2, 1)
       on conflict (key) do update set window_start = excluded.window_start, count = 1`,
      [key, new Date(now)]
    );
    return;
  }
  if (row.count >= max) {
    const seconds = Math.max(1, Math.ceil((windowStart + windowMs - now) / 1000));
    throw tooMany(`Túl sok kérés. Próbáld újra ${seconds} másodperc múlva.`, {retryAfter: seconds});
  }
  await db.query('update public.rate_limits set count = count + 1 where key = $1', [key]);
}
