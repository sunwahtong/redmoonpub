/**
 * Signing in and out, the current account, presence and the profile.
 */
import {z} from 'zod';
import {
  activeSessionsOf,
  assertLoginAllowed,
  audit,
  capabilitiesOf,
  clearSessionCookie,
  createSession,
  DUMMY_HASH,
  ensureSignature,
  hashPassword,
  loadAccount,
  needsRehash,
  passwordProblem,
  publicUser,
  recordLoginAttempt,
  requireUser,
  revokeSession,
  revokeUserSessions,
  SESSION_COOKIE,
  verifyPassword
} from '../auth.ts';
import {bad, clientIp, conflict, formatPhone, iso, normalizePhone, parse, parseCookies, readJson, unauthorized, type Router} from '../http.ts';
import {config} from '../config.ts';

const loginBody = z.object({
  username: z.string().trim().min(1, 'Add meg a felhasználóneved.').max(80),
  password: z.string().min(1, 'Add meg a jelszavad.').max(200),
  force: z.boolean().optional().default(false)
});

const passwordChange = z.object({
  currentPassword: z.string().min(1, 'Add meg a jelenlegi jelszavadat.'),
  newPassword: z.string().min(8, 'Az új jelszó legyen legalább 8 karakter.').max(200)
});

const profilePatch = z.object({
  name: z.string().trim().min(2, 'A név legalább két karakter.').max(100).optional(),
  nickname: z.string().trim().max(40).optional(),
  idNumber: z.string().trim().max(40).optional(),
  avatar: z.string().max(config.maxAvatarBytes).optional()
});

export function registerSessionRoutes(router: Router): void {
  router.post('/api/login', async ({db, req, res}) => {
    const body = parse(loginBody, await readJson(req));
    const usernameLower = body.username.toLowerCase();
    const ip = clientIp(req);
    await assertLoginAllowed(db, usernameLower, ip);

    const {rows} = await db.query<{id: string; password_hash: string; active: boolean}>(
      'select id, password_hash, active from public.staff_accounts where lower(username) = $1',
      [usernameLower]
    );
    const row = rows[0];
    // Unknown users still cost a hash check, so timing does not reveal them.
    const valid = row ? verifyPassword(body.password, row.password_hash) : verifyPassword(body.password, DUMMY_HASH);
    if (!row || !valid || !row.active) {
      await recordLoginAttempt(db, usernameLower, ip, false);
      throw unauthorized('Hibás felhasználónév vagy jelszó');
    }

    // One account, one live session. A second device is offered the takeover.
    const live = await activeSessionsOf(db, row.id);
    if (live.length && !body.force) {
      throw conflict('Ez a fiók már be van jelentkezve egy másik eszközön.', {sessionConflict: true, since: iso(live[0].last_seen_at)});
    }
    if (live.length) await revokeUserSessions(db, row.id, 'takeover');

    if (needsRehash(row.password_hash)) {
      await db.query('update public.staff_accounts set password_hash = $2 where id = $1', [row.id, hashPassword(body.password)]);
    }
    await db.query('update public.staff_accounts set last_login_at = now(), last_active_at = now() where id = $1', [row.id]);
    await recordLoginAttempt(db, usernameLower, ip, true);
    await createSession(db, req, res, row.id);

    const account = (await loadAccount(db, row.id))!;
    account.signatureSvg = await ensureSignature(db, account);
    await audit(db, account, live.length ? 'SESSION_TAKEOVER' : 'LOGIN', live.length ? 'Korábbi munkamenet lezárva új belépéskor' : 'Sikeres belépés');
    return {user: publicUser(account, {self: true})};
  });

  router.post('/api/logout', async ({db, req, res, user}) => {
    const token = parseCookies(req)[SESSION_COOKIE];
    await revokeSession(db, token, 'logout');
    clearSessionCookie(req, res);
    if (user) await audit(db, user, 'LOGOUT', 'Kijelentkezés');
    return {ok: true};
  });

  router.get('/api/me', async ({db, user}) => {
    if (!user) return {user: null};
    const fresh = await loadAccount(db, user.id);
    if (!fresh) return {user: null};
    fresh.signatureSvg = await ensureSignature(db, fresh);
    return {user: publicUser(fresh, {self: true})};
  });

  router.post('/api/presence/heartbeat', async ({db, user}) => {
    const me = requireUser({user});
    await db.query('update public.sessions set last_seen_at = now() where id = $1', [me.sessionId]);
    await db.query('update public.staff_accounts set last_active_at = now() where id = $1', [me.id]);
    return {ok: true, at: new Date().toISOString()};
  });

  router.get('/api/presence', async ({db, user}) => {
    requireUser({user});
    const {rows} = await db.query(
      `select distinct on (u.id) u.id, u.username, u.name, u.nickname, u.role, u.jobs, u.phone, u.avatar, s.last_seen_at
       from public.sessions s join public.staff_accounts u on u.id = s.user_id
       where s.revoked_at is null and s.expires_at > now() and s.last_seen_at > now() - interval '90 seconds'
       order by u.id, s.last_seen_at desc`
    );
    const online = rows
      .map((row) => ({
        id: row.id,
        username: row.username,
        name: row.name,
        nickname: row.nickname || '',
        role: row.role,
        jobs: row.jobs || [],
        avatar: row.avatar || '',
        phone: formatPhone(row.phone || ''),
        lastSeen: iso(row.last_seen_at)
      }))
      .sort((a, b) => a.name.localeCompare(b.name, 'hu'));
    return {online, onlineCount: online.length, generatedAt: new Date().toISOString()};
  });

  /* ---------------- profile ---------------- */

  router.post('/api/profile/phone', async ({db, req, user}) => {
    const me = requireUser({user});
    const target = await loadAccount(db, me.id);
    if (!target) throw unauthorized('A fiók nem található');
    if (target.phone) throw conflict('Ehhez a fiókhoz már tartozik telefonszám. Csak az Owner törölheti.');
    const body = await readJson(req);
    const phone = normalizePhone(body.phone);
    if (!phone) throw bad('Pontosan 7 számjegyet adj meg. A +38-76 előtagot a rendszer automatikusan hozzáadja.');
    await db.query('update public.staff_accounts set phone = $2 where id = $1', [me.id, phone]);
    await audit(db, target, 'PHONE_REGISTER', formatPhone(phone));
    const fresh = (await loadAccount(db, me.id))!;
    return {user: publicUser(fresh, {self: true})};
  });

  router.patch('/api/profile', async ({db, req, user}) => {
    const me = requireUser({user});
    const body = parse(profilePatch, await readJson(req));
    if (body.avatar !== undefined && body.avatar && !/^data:image\/(png|jpe?g|webp);base64,[A-Za-z0-9+/=]+$/.test(body.avatar)) {
      throw bad('A profilképnek PNG/JPG/WebP képnek kell lennie.');
    }
    if (body.avatar !== undefined && body.avatar.length > config.maxAvatarBytes) throw bad('A profilkép túl nagy.');
    const fields: string[] = [];
    const values: unknown[] = [me.id];
    const set = (column: string, value: unknown) => {
      values.push(value);
      fields.push(`${column} = $${values.length}`);
    };
    if (body.name !== undefined) set('name', body.name);
    if (body.nickname !== undefined) set('nickname', body.nickname);
    if (body.idNumber !== undefined) set('id_number', body.idNumber);
    if (body.avatar !== undefined) set('avatar', body.avatar);
    if (fields.length) await db.query(`update public.staff_accounts set ${fields.join(', ')} where id = $1`, values);
    const fresh = (await loadAccount(db, me.id))!;
    await audit(db, fresh, 'PROFILE_UPDATE', 'Saját profil frissítve');
    return {user: publicUser(fresh, {self: true})};
  });

  router.post('/api/profile/password', async ({db, req, user}) => {
    const me = requireUser({user});
    const body = parse(passwordChange, await readJson(req));
    const {rows} = await db.query<{password_hash: string}>('select password_hash from public.staff_accounts where id = $1', [me.id]);
    if (!rows[0]) throw unauthorized('A fiók nem található');
    if (!verifyPassword(body.currentPassword, rows[0].password_hash)) throw unauthorized('A jelenlegi jelszó nem megfelelő.');
    if (body.currentPassword === body.newPassword) throw bad('Az új jelszó nem egyezhet meg a jelenlegivel.');
    const problem = passwordProblem(body.newPassword);
    if (problem) throw bad(problem);
    await db.query('update public.staff_accounts set password_hash = $2, must_change_password = false where id = $1', [me.id, hashPassword(body.newPassword)]);
    const revoked = await revokeUserSessions(db, me.id, 'password_changed', me.tokenHash);
    await audit(db, me, 'PASSWORD_CHANGE', `Jelszó megváltoztatva · ${revoked} másik munkamenet lezárva`);
    return {ok: true};
  });

  router.get('/api/permissions', async ({user}) => {
    const me = requireUser({user});
    return {permissions: {role: me.role, ...capabilitiesOf(me)}};
  });
}
