/**
 * Clears the house's transactional data.
 *
 *   npm run data:reset                    # show what would be removed
 *   npm run data:reset -- --apply         # do it
 *   npm run data:reset -- --apply --keep-users
 *   npm run data:reset -- --apply --reset-stock
 *
 * Empties sales, shifts, supply orders, expenses, documents, restock logs,
 * the audit log, notifications, reservations, applications, reviews, map
 * markers and the club. Products, the signature drinks, events and the house
 * particulars are kept: those are the menu and the identity, not a ledger.
 *
 * Accounts are removed unless --keep-users is passed. Without accounts the
 * next start recreates the first owner from OWNER_USERNAME / OWNER_PASSWORD.
 */
import {closeDb, getDb} from '../server/db.ts';
import {CANONICAL_DRINKS} from '../server/seed.ts';

const args = process.argv.slice(2);
const apply = args.includes('--apply');
const keepUsers = args.includes('--keep-users');
const resetStock = args.includes('--reset-stock');

const CLEARED = [
  'sales',
  'documents',
  'shift_members',
  'shifts',
  'supply_order_items',
  'supply_orders',
  'restock_logs',
  'expenses',
  'audit_log',
  'notification_reads',
  'notifications',
  'reservations',
  'applications',
  'reviews',
  'map_blips',
  'club_queue',
  'club_tracks',
  'club_chat',
  'club_requests',
  'club_name_requests',
  'club_listeners',
  'club_bans',
  'club_presence',
  'rate_limits',
  'login_attempts'
];

const db = await getDb();
try {
  const changes: string[] = [];
  for (const table of CLEARED) {
    const {rows} = await db.query<{n: number}>(`select count(*)::int as n from public.${table}`);
    if (rows[0].n) changes.push(`${table}: ${rows[0].n} → 0`);
  }
  const users = (await db.query<{username: string}>('select username from public.staff_accounts order by username')).rows;
  changes.push(keepUsers ? `staff_accounts: ${users.length} kept` : `staff_accounts: ${users.length} removed (${users.map((row) => row.username).join(', ')})`);

  console.log('');
  for (const line of changes) console.log(`  · ${line}`);

  if (!apply) {
    console.log('\n  Dry run. Add --apply to execute.\n');
  } else {
    await db.tx(async (tx) => {
      for (const table of CLEARED) await tx.query(`delete from public.${table}`);
      await tx.query(`update public.club_state set live = false, dj_user_id = null, dj_name = '', title = '', started_at = null, current = null where id = 1`);
      await tx.query(
        `update public.house set pub_open = false, pub_opened_at = null, pub_opened_by = null, pub_opened_by_name = '', pub_note = '', pub_closed_at = null, revenue_reset_at = null, activity_reset_at = null where id = 1`
      );
      if (!keepUsers) {
        await tx.query('delete from public.sessions');
        await tx.query('update public.house set owner_user_id = null where id = 1');
        await tx.query('delete from public.staff_accounts');
      }
      if (resetStock) {
        for (const drink of CANONICAL_DRINKS) await tx.query('update public.products set stock = $2 where id = $1', [drink.id, drink.stock]);
      }
    });
    console.log(`\n  Done.${resetStock ? ' Stock restored to shipped levels.' : ''}\n`);
  }
} finally {
  await closeDb();
}
