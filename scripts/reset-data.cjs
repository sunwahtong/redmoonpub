#!/usr/bin/env node
/**
 * Clears the house's transactional data.
 *
 *   node scripts/reset-data.cjs            # show what would change
 *   node scripts/reset-data.cjs --apply    # do it
 *   node scripts/reset-data.cjs --apply --keep-users
 *   node scripts/reset-data.cjs --apply --reset-stock
 *
 * Empties sales, shifts, orders, expenses, documents, restock logs, audit,
 * notifications, reservations, applications, reviews and the club state, and
 * zeroes the finance counters. Products, signature drinks and events are kept:
 * those are the menu, not a transaction log.
 *
 * Accounts are removed unless `--keep-users` is passed. The two built-in
 * manager accounts are recreated by the server on the next start either way.
 *
 * Works against data/seed.json. For a PostgreSQL deployment, clear the state
 * row instead — see the reset section of DEPLOY-VERCEL.md.
 */
const fs = require('fs');
const path = require('path');

const SEED = path.join(__dirname, '..', 'data', 'seed.json');

const args = process.argv.slice(2);
const apply = args.includes('--apply');
const keepUsers = args.includes('--keep-users');
const resetStock = args.includes('--reset-stock');

/** Collections emptied outright. */
const CLEARED = [
  'sales',
  'shifts',
  'orders',
  'expenses',
  'documents',
  'restockLogs',
  'audit',
  'notifications',
  'reservations',
  'applications',
  'reviews',
  'mapBlips'
];

if (!fs.existsSync(SEED)) {
  console.error(`\n  Not found: ${SEED}\n`);
  process.exit(1);
}

const before = JSON.parse(fs.readFileSync(SEED, 'utf8'));
const after = JSON.parse(JSON.stringify(before));

const changes = [];

for (const key of CLEARED) {
  const count = Array.isArray(after[key]) ? after[key].length : 0;
  if (count) changes.push(`${key}: ${count} → 0`);
  after[key] = [];
}

if (!keepUsers) {
  const names = (after.users || []).map((user) => user.username);
  if (names.length) changes.push(`users: ${names.length} törölve (${names.join(', ')})`);
  after.users = [];
} else {
  changes.push(`users: ${(after.users || []).length} megtartva`);
}

const revenue = Number(after.finance?.overallRevenue) || 0;
const expense = Number(after.finance?.overallExpense) || 0;
if (revenue || expense) changes.push(`finance: ${revenue} bevétel / ${expense} kiadás → 0`);
after.finance = {overallRevenue: 0, overallRevenueOffset: 0, overallExpense: 0};

// The club keeps its provider settings; everything transient in it goes.
if (after.club) {
  const live = after.club.live;
  after.club = {
    ...after.club,
    live: false,
    dj: null,
    title: '',
    current: null,
    queue: [],
    chat: [],
    requests: [],
    nameRequests: [],
    approvedNames: [],
    bans: [],
    startedAt: null,
    library: []
  };
  if (live) changes.push('club: élő adás leállítva');
}

// Stock is left where it is by default — it is a real count of real bottles,
// not a transaction log. `--reset-stock` puts it back to the shipped levels,
// which is what a handover wants.
if (resetStock) {
  // Required lazily: loading server.cjs connects nothing, but it does read the
  // environment, and there is no reason to do that on a dry run.
  const {CANONICAL_DRINKS} = require('../server.cjs');
  let restored = 0;
  for (const product of after.products || []) {
    const canonical = CANONICAL_DRINKS.find((entry) => entry.id === product.id);
    if (canonical && Number(product.stock) !== Number(canonical.stock)) {
      product.stock = canonical.stock;
      restored += 1;
    }
  }
  if (restored) changes.push(`products: ${restored} készlet visszaállítva`);
} else {
  let repaired = 0;
  for (const product of after.products || []) {
    if (!Number.isFinite(Number(product.stock)) || Number(product.stock) < 0) {
      product.stock = 0;
      repaired += 1;
    }
  }
  if (repaired) changes.push(`products: ${repaired} érvénytelen készlet javítva`);
}

console.log(`\n  ${SEED}`);
console.log(`  Termékek: ${(after.products || []).length} (megmarad)\n`);

if (!changes.length) {
  console.log('  Nincs törlendő adat.\n');
  process.exit(0);
}

for (const line of changes) console.log(`  · ${line}`);

if (!apply) {
  console.log('\n  Próbafuttatás. Add hozzá a --apply kapcsolót a végrehajtáshoz.\n');
  process.exit(0);
}

const backup = `${SEED}.${new Date().toISOString().replace(/[:.]/g, '-')}.bak`;
fs.copyFileSync(SEED, backup);
fs.writeFileSync(SEED, `${JSON.stringify(after, null, 2)}\n`);

console.log(`\n  Kész. Biztonsági másolat: ${path.basename(backup)}\n`);
