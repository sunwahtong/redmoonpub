/**
 * Creates or resets a staff account.
 *
 * Works against both storage backends: data/seed.json locally, and the
 * red_moon_state row in PostgreSQL when DATABASE_URL is set. Replaces
 * create-owner.cjs, which was PostgreSQL-only and interactive.
 *
 *   node scripts/create-user.cjs --username rm.owner --password "..." --role owner --name "Red Moon Owner"
 *   node scripts/create-user.cjs --username rm.owner --password "..." --reset
 */
require('dotenv').config();
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

const ROLES = ['staff', 'manager', 'owner', 'dj'];
const DB_FILE = path.join(__dirname, '..', 'data', 'seed.json');

function parseArgs(argv) {
  const args = {};
  for (let i = 0; i < argv.length; i += 1) {
    const token = argv[i];
    if (!token.startsWith('--')) continue;
    const key = token.slice(2);
    const next = argv[i + 1];
    if (!next || next.startsWith('--')) {
      args[key] = true;
    } else {
      args[key] = next;
      i += 1;
    }
  }
  return args;
}

function hashPassword(password) {
  const salt = crypto.randomBytes(16).toString('hex');
  const hash = crypto.pbkdf2Sync(password, salt, 310000, 32, 'sha256').toString('hex');
  return `PBKDF2:310000:sha256:${salt}:${hash}`;
}

function applyUser(data, options) {
  data.users = Array.isArray(data.users) ? data.users : [];

  const existing = data.users.find(
    (user) => String(user.username || '').toLowerCase() === options.username.toLowerCase()
  );

  if (existing && !options.reset) {
    throw new Error(`"${options.username}" already exists. Pass --reset to overwrite its password.`);
  }

  if (existing) {
    existing.passwordHash = options.passwordHash;
    existing.role = options.role;
    existing.portal = options.role === 'dj' ? 'dj' : 'staff';
    existing.name = options.name;
    return 'updated';
  }

  data.users.push({
    id: `u_${options.role}_${crypto.randomBytes(6).toString('hex')}`,
    username: options.username,
    name: options.name,
    nickname: options.nickname,
    role: options.role,
    portal: options.role === 'dj' ? 'dj' : 'staff',
    passwordHash: options.passwordHash
  });
  return 'created';
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const username = String(args.username || '').trim();
  const password = String(args.password || '');
  const role = String(args.role || 'owner').toLowerCase();

  if (!username) throw new Error('--username is required');
  if (password.length < 8) throw new Error('--password must be at least 8 characters');
  if (!ROLES.includes(role)) throw new Error(`--role must be one of: ${ROLES.join(', ')}`);

  const options = {
    username,
    role,
    name: String(args.name || username),
    nickname: String(args.nickname || username.split('.').pop() || username),
    passwordHash: hashPassword(password),
    reset: !!args.reset
  };

  let outcome;

  if (process.env.DATABASE_URL) {
    const {Client} = require('pg');
    const client = new Client({
      connectionString: process.env.DATABASE_URL,
      ssl: process.env.DB_SSLMODE === 'disable' ? false : {rejectUnauthorized: false}
    });
    await client.connect();
    try {
      const result = await client.query('SELECT data FROM red_moon_state WHERE id = 1');
      if (!result.rows.length) throw new Error('red_moon_state row not found. Start the server once first.');
      const data = result.rows[0].data;
      outcome = applyUser(data, options);
      await client.query('UPDATE red_moon_state SET data = $1::jsonb WHERE id = 1', [JSON.stringify(data)]);
    } finally {
      await client.end().catch(() => {});
    }
    console.log(`${outcome} in PostgreSQL`);
  } else {
    const data = JSON.parse(fs.readFileSync(DB_FILE, 'utf8'));
    outcome = applyUser(data, options);
    fs.writeFileSync(DB_FILE, JSON.stringify(data, null, 2), 'utf8');
    console.log(`${outcome} in ${DB_FILE}`);
  }

  console.log(`username: ${options.username}`);
  console.log(`role:     ${options.role}`);
  console.log('Restart the server so it reloads the account.');
}

main().catch((error) => {
  console.error('ERROR:', error.message);
  process.exit(1);
});
