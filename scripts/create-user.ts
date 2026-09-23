/**
 * Creates or resets a staff account from the command line.
 *
 * Works against whatever database the environment points at: the embedded
 * local one when DATABASE_URL is empty, or PostgreSQL / Supabase when set.
 *
 *   npm run user:create -- --username rm.owner --password "..." --role owner --name "Red Moon Owner"
 *   npm run user:create -- --username rm.owner --password "..." --reset
 *   npm run user:create -- --username dj.mara --password "..." --role staff --jobs dj,bartender
 *
 * A reset account must change its password on next login.
 */
import {closeDb, getDb} from '../server/db.ts';
import {hashPassword, JOBS, passwordProblem, ROLES} from '../server/auth.ts';
import {generateSignatureSvg} from '../shared/signature.ts';

function parseArgs(argv: string[]): Record<string, string | true> {
  const args: Record<string, string | true> = {};
  for (let i = 0; i < argv.length; i += 1) {
    const token = argv[i];
    if (!token.startsWith('--')) continue;
    const key = token.slice(2);
    const next = argv[i + 1];
    if (!next || next.startsWith('--')) args[key] = true;
    else {
      args[key] = next;
      i += 1;
    }
  }
  return args;
}

const args = parseArgs(process.argv.slice(2));
const username = String(args.username || '').trim();
const password = String(args.password || '');
const role = String(args.role || 'staff').toLowerCase();
const jobs = String(args.jobs || '')
  .split(',')
  .map((job) => job.trim())
  .filter(Boolean);

if (!username) throw new Error('--username is required');
const problem = passwordProblem(password);
if (problem) throw new Error(problem);
if (!(ROLES as readonly string[]).includes(role)) throw new Error(`--role must be one of: ${ROLES.join(', ')}`);
for (const job of jobs) if (!(JOBS as readonly string[]).includes(job)) throw new Error(`unknown job "${job}"; valid: ${JOBS.join(', ')}`);

const db = await getDb();
try {
  const existing = (await db.query<{id: string; role: string}>('select id, role from public.staff_accounts where lower(username) = lower($1)', [username])).rows[0];
  if (existing && !args.reset) throw new Error(`"${username}" already exists. Pass --reset to set a new password.`);

  if (existing) {
    await db.query(`update public.staff_accounts set password_hash = $2, must_change_password = true, active = true where id = $1`, [existing.id, await hashPassword(password)]);
    await db.query(`update public.sessions set revoked_at = now(), revoked_reason = 'cli_reset' where user_id = $1 and revoked_at is null`, [existing.id]);
    console.log(`password reset for ${username} (must change on next login)`);
  } else {
    const name = String(args.name || username);
    const {rows} = await db.query<{id: string}>(
      `insert into public.staff_accounts (username, name, nickname, role, jobs, password_hash, must_change_password, show_public)
       values ($1, $2, $3, $4, $5, $6, false, $7) returning id`,
      [username, name, String(args.nickname || name.split(' ').pop()), role, jobs, await hashPassword(password), role !== 'staff']
    );
    if (role !== 'staff') {
      await db.query('update public.staff_accounts set signature_svg = $2, signature_at = now() where id = $1', [rows[0].id, generateSignatureSvg(name, rows[0].id)]);
    }
    console.log(`created ${username} · ${role}${jobs.length ? ' · ' + jobs.join(', ') : ''}`);
  }
} finally {
  await closeDb();
}
