/**
 * The House: membership as something the house grants and the site recognises.
 *
 * A member has a code (read out at the door, typed into a booking), a tier
 * (silver, gold, black, royal), a phone number that proves the code is theirs,
 * and a visit count the staff bump at the door. Managers grant silver and
 * gold; black and royal are the owner's to give. A guest looks their card up
 * with code + phone; a booking made with a valid code carries the tier.
 */
import crypto from 'node:crypto';
import {z} from 'zod';
import {audit, rateLimit, requireRole, roleAtLeast} from '../auth.ts';
import {bad, clientIp, conflict, created, forbidden, iso, normalizePhone, notFound, parse, readJson, type Router} from '../http.ts';
import {broadcast} from '../realtime.ts';
import type {Queryable, Row} from '../types.ts';

export const MEMBER_TIERS = ['silver', 'gold', 'black', 'royal'] as const;
export type MemberTier = (typeof MEMBER_TIERS)[number];

const RANK: Record<string, number> = {silver: 1, gold: 2, black: 3, royal: 4};

const memberBody = z.object({
  name: z.string().trim().min(2, 'Add meg a nevet.').max(80),
  phone: z.string().trim().max(40).default(''),
  tier: z.enum(MEMBER_TIERS, {message: 'Ismeretlen szint.'}).default('silver'),
  note: z.string().trim().max(400).default('')
});
const memberPatch = memberBody.partial().extend({active: z.boolean().optional()});

export const memberOf = (row: Row) => ({
  id: row.id,
  code: row.code,
  name: row.name,
  phone: row.phone || '',
  tier: row.tier as MemberTier,
  note: row.note || '',
  active: row.active !== false,
  visits: Number(row.visits) || 0,
  lastVisitAt: iso(row.last_visit_at),
  grantedByName: row.granted_by_name || '',
  grantedAt: iso(row.granted_at),
  updatedAt: iso(row.updated_at)
});

/** What a guest sees of their own card. */
const cardOf = (row: Row) => ({
  code: row.code,
  name: row.name,
  tier: row.tier as MemberTier,
  visits: Number(row.visits) || 0,
  lastVisitAt: iso(row.last_visit_at),
  grantedAt: iso(row.granted_at)
});

/** RM-H-XXXX: easy to say at the door, no lookalike characters. */
function memberCode(): string {
  const alphabet = 'BCDFGHJKLMNPQRSTVWXYZ23456789';
  let code = '';
  for (let i = 0; i < 4; i += 1) code += alphabet[crypto.randomInt(alphabet.length)];
  return `RM-H-${code}`;
}

const normalizeCode = (value: unknown): string => String(value || '').trim().toUpperCase().replace(/\s+/g, '');

/** The tiers this person may hand out. */
const mayGrant = (role: string, tier: string): boolean => roleAtLeast(role, 'owner') || RANK[tier] <= RANK.gold;

/**
 * Resolves a booking's member code: the active member behind it, if the
 * phone on the booking is theirs (or the card has no phone on file).
 */
export async function memberForBooking(db: Queryable, code: unknown, phone: string): Promise<Row | null> {
  const clean = normalizeCode(code);
  if (!clean) return null;
  const member = (await db.query('select * from public.members where code = $1 and active', [clean])).rows[0];
  if (!member) throw bad('Ezzel a kóddal nincs aktív tagság. Ellenőrizd, vagy foglalj tagság nélkül.');
  if (member.phone && member.phone !== phone) throw bad('A tagsági kódhoz más telefonszám tartozik.');
  return member;
}

export async function memberStats(db: Queryable) {
  const {rows} = await db.query<{tier: string; n: number}>('select tier, count(*)::int as n from public.members where active group by tier');
  const byTier = Object.fromEntries(MEMBER_TIERS.map((tier) => [tier, 0])) as Record<MemberTier, number>;
  for (const row of rows) byTier[row.tier as MemberTier] = row.n;
  return {total: rows.reduce((sum, row) => sum + row.n, 0), byTier};
}

export function registerMemberRoutes(router: Router): void {
  /* ---------------- public ---------------- */

  router.get('/api/public/members/stats', async ({db}) => memberStats(db));

  /** A guest looks up their own card: the code plus the phone number on file. */
  router.post('/api/public/member-lookup', async ({db, req}) => {
    const body = await readJson(req);
    await rateLimit(db, `member-lookup:${clientIp(req)}`, 12, 10 * 60 * 1000);
    const code = normalizeCode(body.code);
    const phone = normalizePhone(body.phone);
    if (!code) throw bad('Add meg a tagsági kódot.');
    const member = (await db.query('select * from public.members where code = $1 and active', [code])).rows[0];
    if (!member) throw notFound('Nincs ilyen aktív tagság.');
    if (member.phone && (!phone || member.phone !== phone)) throw forbidden('A kódhoz tartozó telefonszám nem egyezik.');
    return {member: cardOf(member)};
  });

  /* ---------------- console ---------------- */

  router.get('/api/members', async ({db, user, query}) => {
    requireRole({user}, 'manager');
    const q = String(query.get('q') || '').trim().toLowerCase();
    const {rows} = await db.query(
      `select * from public.members
        where $1 = '' or lower(name) like $2 or lower(code) like $2 or phone like $2
        order by active desc, case tier when 'royal' then 0 when 'black' then 1 when 'gold' then 2 else 3 end, name limit 400`,
      [q, `%${q}%`]
    );
    return {members: rows.map(memberOf), stats: await memberStats(db)};
  });

  router.post('/api/members', async ({db, req, user}) => {
    const me = requireRole({user}, 'manager');
    const body = parse(memberBody, await readJson(req));
    if (!mayGrant(me.role, body.tier)) throw forbidden('Black és Royal szintet csak a tulajdonos adhat.');
    const phone = body.phone ? normalizePhone(body.phone) : '';
    if (body.phone && !phone) throw bad('A telefonszám 7 számjegyű legyen.');
    if (phone) {
      const taken = (await db.query('select code from public.members where phone = $1 and active', [phone])).rows[0];
      if (taken) throw conflict(`Ehhez a számhoz már tartozik tagság (${taken.code}).`);
    }
    let code = memberCode();
    for (let attempt = 0; attempt < 5; attempt += 1) {
      const clash = (await db.query('select 1 from public.members where code = $1', [code])).rows[0];
      if (!clash) break;
      code = memberCode();
    }
    const {rows} = await db.query(
      'insert into public.members (code, name, phone, tier, note, granted_by, granted_by_name) values ($1, $2, $3, $4, $5, $6, $7) returning *',
      [code, body.name, phone, body.tier, body.note, me.id, me.nickname || me.name]
    );
    await audit(db, me, 'MEMBER_GRANT', `${body.name} · ${body.tier} · ${code}`);
    await broadcast('content', 'members');
    return created({member: memberOf(rows[0])});
  });

  router.patch('/api/members/:id', async ({db, req, user, params}) => {
    const me = requireRole({user}, 'manager');
    const existing = (await db.query('select * from public.members where id = $1', [params.id])).rows[0];
    if (!existing) throw notFound('A tag nem található');
    const body = parse(memberPatch, await readJson(req));
    if (body.tier !== undefined && !mayGrant(me.role, body.tier)) throw forbidden('Black és Royal szintet csak a tulajdonos adhat.');
    if (!mayGrant(me.role, existing.tier) && (body.tier !== undefined || body.active !== undefined)) throw forbidden('Ezt a tagságot csak a tulajdonos módosíthatja.');
    let phone: string | undefined;
    if (body.phone !== undefined) {
      phone = body.phone ? normalizePhone(body.phone) : '';
      if (body.phone && !phone) throw bad('A telefonszám 7 számjegyű legyen.');
    }
    const {rows} = await db.query(
      `update public.members set name = $2, phone = $3, tier = $4, note = $5, active = $6, updated_at = now() where id = $1 returning *`,
      [existing.id, body.name ?? existing.name, phone ?? existing.phone, body.tier ?? existing.tier, body.note ?? existing.note, body.active ?? existing.active]
    );
    await audit(db, me, body.active === false ? 'MEMBER_REVOKE' : 'MEMBER_UPDATE', `${rows[0].name} · ${rows[0].tier} · ${rows[0].code}`);
    await broadcast('content', 'members');
    return {member: memberOf(rows[0])};
  });

  /** The door marks a visit. */
  router.post('/api/members/:id/visit', async ({db, user, params}) => {
    const me = requireRole({user}, 'staff');
    const {rows} = await db.query('update public.members set visits = visits + 1, last_visit_at = now(), updated_at = now() where id = $1 and active returning *', [params.id]);
    if (!rows[0]) throw notFound('A tag nem található');
    await audit(db, me, 'MEMBER_VISIT', `${rows[0].name} · ${rows[0].visits}. látogatás`);
    await broadcast('content', 'members');
    return {member: memberOf(rows[0])};
  });

  router.delete('/api/members/:id', async ({db, user, params}) => {
    const me = requireRole({user}, 'owner');
    const {rows} = await db.query('delete from public.members where id = $1 returning *', [params.id]);
    if (!rows[0]) throw notFound('A tag nem található');
    await audit(db, me, 'MEMBER_DELETE', `${rows[0].name} · ${rows[0].code}`);
    await broadcast('content', 'members');
    return {ok: true};
  });
}
