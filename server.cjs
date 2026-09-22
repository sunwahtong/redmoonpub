require("dotenv").config();
const http = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { Pool } = require('pg');
const { z } = require('zod');
const {
  AUDIO_CONTENT_TYPES,
  bucketDelete,
  bucketKeyFromUrl,
  bucketStorageEnabled,
  bucketUpload
} = require('./lib/storage.cjs');

const ROOT = __dirname;
const PUBLIC = path.join(ROOT, 'public');
const DB_FILE = path.join(ROOT, 'data', 'seed.json');
const PORT = Number(process.env.PORT || 8787);
const sessions = new Map();
const pendingSessionLeaves = new Map();
const realtimeClients = new Set();
const clubRealtimeClients = new Set();
const clubListeners = new Map();

// ---------- RUNTIME MODE ----------
// The same file runs in two shapes:
//
//   server    one long-lived Node process (VPS, Render, `npm start`, local dev).
//             State stays in memory between requests and Server-Sent Events work.
//
//   function  one short-lived serverless invocation per request (Vercel).
//             Nothing survives between requests, and an open SSE stream is
//             billed until the platform kills it. So the state and the session
//             table are reloaded per request, and clients poll instead.
//
// Vercel sets VERCEL=1 itself. RM_SERVERLESS=1 forces the same behaviour locally,
// which is how the serverless path is tested without deploying.
const SERVERLESS = !!(process.env.VERCEL || process.env.RM_SERVERLESS === '1');

// Online storage: when DATABASE_URL is present, all staff data lives in PostgreSQL.
// Local development keeps the original db.json fallback so the project still works offline.
//
// Supabase note: use the *pooler* connection string (port 6543, "Transaction"
// mode) for serverless. A direct 5432 connection opens one PostgreSQL backend
// per invocation and Supabase runs out of connections under load. `max: 1` is
// deliberate for the same reason — a function instance handles one request.
const pool = process.env.DATABASE_URL ? new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.DB_SSLMODE === 'disable' ? false : { rejectUnauthorized: false },
  max: SERVERLESS ? 1 : 5,
  idleTimeoutMillis: SERVERLESS ? 10000 : 30000,
  connectionTimeoutMillis: 10000
}) : null;
let db = null;
let writeQueue = Promise.resolve();
// Optimistic-concurrency token for the state row. Only used in serverless mode,
// where two invocations can hold the same snapshot at the same time.
let stateRev = 0;

function readLocalDB(){ return JSON.parse(fs.readFileSync(DB_FILE,'utf8')); }

/**
 * Creates the first OWNER account from the environment.
 *
 * A real password never lives in the repository, so the first account has to
 * come from somewhere else exactly once. `fresh` says whether the caller knows
 * the storage is brand new:
 *
 *   true   the PostgreSQL state row did not exist, so this is the first ever
 *          start against this database. Always create the account.
 *   false  the JSON fallback, which cannot tell a first start from any other.
 *          Create the account only when no owner exists yet and the name is
 *          free, so restarting never resets or duplicates a login.
 *
 * Note that the shipped seed already contains two manager accounts, so "no
 * users at all" is not a usable test for either case.
 *
 * Returns true when an account was added.
 */
function bootstrapOwner(target, fresh){
  const username = String(process.env.OWNER_USERNAME || '').trim();
  const password = String(process.env.OWNER_PASSWORD || '');
  if(!username || !password) return false;

  target.users ||= [];
  if(!fresh){
    const ownerExists = target.users.some(x => x.role === 'owner');
    const nameTaken = target.users.some(x => String(x.username||'').toLowerCase() === username.toLowerCase());
    if(ownerExists || nameTaken) return false;
  }

  const name = String(process.env.OWNER_NAME || 'Red Moon Owner').trim() || 'Red Moon Owner';
  const hp = hashPassword(password);
  target.users.unshift({
    id:'u_owner_'+crypto.randomBytes(6).toString('hex'),
    username,
    name,
    role:'owner',
    passwordHash:`PBKDF2:310000:sha256:${hp.salt}:${hp.hash}`
  });
  return true;
}
async function initDB(){
  if(!pool){
    db = readLocalDB();
    // Same first-run owner bootstrap as the PostgreSQL branch, so a VPS running
    // on the file fallback behaves identically to one running on a database.
    let changed=false; if(bootstrapOwner(db,false)) changed=true; if(ensureBuiltInManagers()) changed=true; db.products ||= CANONICAL_DRINKS.map(x=>({...x})); if(!Array.isArray(db.signatureDrinks)){ db.signatureDrinks=DEFAULT_SIGNATURE_DRINKS.map(x=>({...x})); changed=true; }
    const beforeSections=JSON.stringify((db.products||[]).map(p=>[p.id,p.section]));
    db.products=(db.products||[]).map(p=>({...p,section:inferProductSection(p)}));
    if(beforeSections!==JSON.stringify(db.products.map(p=>[p.id,p.section]))) changed=true;
    if(migrateShortShiftIds()) changed=true;
    db.club ||= clubDefaults();
    if(!Array.isArray(db.mapBlips)){ db.mapBlips=[]; changed=true; }
    if(!Array.isArray(db.reservations)){ db.reservations=[]; changed=true; }
    if(!Array.isArray(db.applications)){ db.applications=[]; changed=true; }
    if(!Array.isArray(db.orders)){ db.orders=[]; changed=true; }
    if(!Array.isArray(db.expenses)){ db.expenses=[]; changed=true; }
    if(!db.club.v58NamesReset){ db.club.approvedNames=[]; db.club.nameRequests=[]; db.club.v58NamesReset=true; changed=true; }
    if(changed) await writeDB(db);
    return;
  }
  await pool.query(`CREATE TABLE IF NOT EXISTS red_moon_state (id INTEGER PRIMARY KEY, data JSONB NOT NULL, updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW())`);
  // `rev` is the optimistic-concurrency token. Added separately so an existing
  // Render/VPS database upgrades in place instead of needing a manual migration.
  await pool.query(`ALTER TABLE red_moon_state ADD COLUMN IF NOT EXISTS rev BIGINT NOT NULL DEFAULT 0`);
  // Sessions live in the database so a serverless invocation can find the
  // session another invocation created. In server mode this table is written
  // through but the in-memory Map stays authoritative for the process.
  await pool.query(`CREATE TABLE IF NOT EXISTS red_moon_sessions (
    sid TEXT PRIMARY KEY,
    data JSONB NOT NULL,
    last_seen TIMESTAMPTZ NOT NULL DEFAULT NOW()
  )`);
  await pool.query(`CREATE INDEX IF NOT EXISTS red_moon_sessions_last_seen ON red_moon_sessions (last_seen)`);
  const result = await pool.query('SELECT data, rev FROM red_moon_state WHERE id=1');
  if(result.rowCount === 0){
    db = readLocalDB();
    // First deployment: create the initial OWNER from the environment.
    // No real password is stored in the Git repository.
    bootstrapOwner(db, true);
    await pool.query('INSERT INTO red_moon_state (id,data,rev) VALUES (1,$1::jsonb,1) ON CONFLICT (id) DO NOTHING', [JSON.stringify(db)]);
    const seeded = await pool.query('SELECT data, rev FROM red_moon_state WHERE id=1');
    db = seeded.rows[0].data;
    stateRev = Number(seeded.rows[0].rev) || 0;
  } else {
    db = result.rows[0].data;
    stateRev = Number(result.rows[0].rev) || 0;
  }
  await migrateDrinkCatalog();
  let changed = false;
  if(!Array.isArray(db.signatureDrinks)){ db.signatureDrinks=DEFAULT_SIGNATURE_DRINKS.map(x=>({...x})); changed=true; }
  if(migrateCartIds()) changed = true;
  if(migrateShortShiftIds()) changed = true;
  if(ensureBuiltInManagers()) changed = true;
  db.club ||= clubDefaults();
  if(!Array.isArray(db.mapBlips)){ db.mapBlips=[]; changed=true; }
  if(!Array.isArray(db.reservations)){ db.reservations=[]; changed=true; }
  if(!Array.isArray(db.applications)){ db.applications=[]; changed=true; }
  if(!Array.isArray(db.orders)){ db.orders=[]; changed=true; }
  if(!Array.isArray(db.expenses)){ db.expenses=[]; changed=true; }
  if(!db.club.v58NamesReset){ db.club.approvedNames=[]; db.club.nameRequests=[]; db.club.v58NamesReset=true; changed=true; }
  if(changed) await writeDB(db);
}


// ---------- REQUEST LIFECYCLE ----------
// Sessions are persisted in PostgreSQL in both runtime modes.
//
//   server mode    the map is loaded once at startup and written through after
//                  each request. A restart or a deploy no longer signs everyone
//                  out, which used to happen because sessions were memory-only.
//
//   function mode  the map and the state blob are reloaded before every
//                  request, because the invocation that reads a session is
//                  almost never the one that created it.

/** Session TTL. Matches the 8 hour login cookie with slack for clock skew. */
const SESSION_TTL_HOURS = 12;

/** JSON snapshot of the session map, used to detect what a request changed. */
function snapshotSessions(){
  const out = new Map();
  for(const [sid, data] of sessions.entries()) out.set(sid, JSON.stringify(data));
  return out;
}

async function hydrateSessions(){
  if(!pool) return;
  const {rows} = await pool.query(
    `SELECT sid, data FROM red_moon_sessions WHERE last_seen > NOW() - ($1 || ' hours')::interval`,
    [String(SESSION_TTL_HOURS)]
  );
  sessions.clear();
  for(const row of rows) sessions.set(row.sid, row.data);
}

/**
 * Writes back only the sessions a request actually touched.
 *
 * `sessionUser()` bumps `lastSeen` on every single request. Persisting that
 * every time would turn each page view into a database write, so a session that
 * differs *only* by a sub-minute `lastSeen` bump is left alone.
 */
async function flushSessions(before){
  if(!pool) return;
  const after = snapshotSessions();
  const work = [];

  for(const sid of before.keys()){
    if(!after.has(sid)) work.push(pool.query('DELETE FROM red_moon_sessions WHERE sid=$1', [sid]));
  }

  for(const [sid, json] of after.entries()){
    const previous = before.get(sid);
    if(previous === json) continue;
    if(previous && onlyLastSeenMoved(previous, json)) continue;
    work.push(pool.query(
      `INSERT INTO red_moon_sessions (sid,data,last_seen) VALUES ($1,$2::jsonb,NOW())
       ON CONFLICT (sid) DO UPDATE SET data=EXCLUDED.data, last_seen=NOW()`,
      [sid, json]
    ));
  }

  if(work.length) await Promise.all(work);
}

/** True when two session snapshots differ by less than a minute of `lastSeen`. */
function onlyLastSeenMoved(previousJson, nextJson){
  try{
    const previous = JSON.parse(previousJson);
    const next = JSON.parse(nextJson);
    const drift = Math.abs((next.lastSeen || 0) - (previous.lastSeen || 0));
    if(drift >= 60000) return false;
    return JSON.stringify({...previous, lastSeen: 0}) === JSON.stringify({...next, lastSeen: 0});
  }catch{
    return false;
  }
}

let readyPromise = null;

/** Runs the one-time initialisation, and the per-request reload in function mode. */
async function ensureReady(){
  if(!readyPromise){
    // Sessions are restored once here, so a restarted server keeps its users
    // signed in. In function mode this run is per-instance and the per-request
    // hydrate below is what actually matters.
    readyPromise = initDB().then(hydrateSessions);
  }
  try{
    await readyPromise;
  }catch(err){
    readyPromise = null;   // let the next request retry a cold-start failure
    throw err;
  }

  if(!SERVERLESS || !pool) return;

  const state = await pool.query('SELECT data, rev FROM red_moon_state WHERE id=1');
  if(state.rowCount){
    db = state.rows[0].data;
    stateRev = Number(state.rows[0].rev) || 0;
  }
  await hydrateSessions();
}

/** Thrown when two invocations wrote the same state row. Answered with 409. */
class StateConflictError extends Error {
  constructor(){
    super('State revision conflict');
    this.rmConflict = true;
  }
}

// `db` and `stateRev` are module-level, so two requests being handled by the
// same instance at the same time share them. In server mode that is the whole
// design and it is safe, because the state is never reloaded underneath a
// running request. In function mode every request reloads it — so without a
// lock, request B's reload would replace the object request A is still editing,
// and A's sale would be written from B's snapshot and lost.
//
// The lock makes reload, route and write one atomic step per instance. Writes
// from *other* instances are caught by the revision check in writeDB().
let requestLock = Promise.resolve();

function withRequestLock(run){
  const result = requestLock.then(run, run);
  // Keep the chain alive whatever the outcome; the caller handles the error.
  requestLock = result.then(() => undefined, () => undefined);
  return result;
}

// ---------- VALIDATION ----------
// Zod keeps request parsing in one place instead of scattered String()/Number()
// coercion, and returns a single readable Hungarian message per failure.
const BLIP_KINDS = ['hq','bar','parking','meeting','danger','info','event','custom'];

const blipCreateSchema = z.object({
  x: z.coerce.number().finite(),
  y: z.coerce.number().finite(),
  kind: z.enum(BLIP_KINDS, {message:'Ismeretlen jelölő típus.'}).default('custom'),
  icon: z.coerce.number().int().min(1).max(999).default(1),
  label: z.string().trim().min(1, 'A jelölő neve kötelező.').max(80),
  description: z.string().trim().max(400).default(''),
  group: z.string().trim().max(60).default('Red Moon')
});

const blipUpdateSchema = blipCreateSchema.partial().extend({
  active: z.boolean().optional()
});

// ---------- RESERVATIONS ----------
// Table bookings. Stored inside the same JSONB state document as everything
// else, so no schema migration is needed on any deployment.
const RESERVATION_OCCASIONS = ['este','szuletesnap','uzleti','randi','csapat','vip','egyeb'];
const RESERVATION_TIERS = ['none','silver','gold','black','royal'];
const RESERVATION_STATUSES = ['pending','confirmed','declined','seated','cancelled','noshow'];
/** How far ahead a table can be booked. Beyond this the evening does not exist yet. */
const RESERVATION_MAX_DAYS = 60;
/** Open bookings one visitor may hold at once. Stops the form being spammed. */
const RESERVATION_MAX_OPEN = 3;

const reservationCreateSchema = z.object({
  name: z.string().trim().min(2, 'Add meg a neved.').max(80),
  phone: z.string().trim().min(1, 'Telefonszám kötelező.').max(40),
  guests: z.coerce.number().int().min(1, 'Legalább egy vendég.').max(20, 'Húsz főnél nagyobb társaságot írj meg üzenetben.'),
  at: z.string().trim().min(1, 'Válassz időpontot.'),
  occasion: z.enum(RESERVATION_OCCASIONS, {message:'Ismeretlen alkalom.'}).default('este'),
  tier: z.enum(RESERVATION_TIERS, {message:'Ismeretlen tagsági szint.'}).default('none'),
  note: z.string().trim().max(400).default(''),
  visitorToken: z.string().trim().min(1, 'A böngészőazonosító hiányzik. Frissítsd az oldalt.').max(200)
});

const reservationUpdateSchema = z.object({
  status: z.enum(RESERVATION_STATUSES, {message:'Ismeretlen állapot.'}),
  staffNote: z.string().trim().max(300).default('')
});

// ---------- RECRUITMENT ----------
// Job applications. Same storage story as reservations: inside the JSONB state
// document, so no deployment needs a migration.
const CAREER_POSITIONS = ['bartender','pultos','felszolgalo','dj','biztonsag','hostess','uzletvezeto'];
const CAREER_STATUSES = ['pending','interview','accepted','rejected','withdrawn'];
/** Open applications one visitor may hold. One role at a time is the point. */
const CAREER_MAX_OPEN = 1;

const careerCreateSchema = z.object({
  name: z.string().trim().min(2, 'Add meg a karaktered nevét.').max(80),
  phone: z.string().trim().min(1, 'Telefonszám kötelező.').max(40),
  age: z.coerce.number().int().min(18, 'A Red Moon csak nagykorúakat vesz fel.').max(99),
  radio: z.string().trim().max(24).default(''),
  position: z.enum(CAREER_POSITIONS, {message:'Ismeretlen pozíció.'}),
  availability: z.string().trim().min(3, 'Írd le, mikor érsz rá.').max(200),
  experience: z.string().trim().max(600).default(''),
  why: z.string().trim().min(20, 'Legalább pár mondatot írj arról, miért minket választanál.').max(900),
  visitorToken: z.string().trim().min(1, 'A böngészőazonosító hiányzik. Frissítsd az oldalt.').max(200)
});

const careerUpdateSchema = z.object({
  status: z.enum(CAREER_STATUSES, {message:'Ismeretlen állapot.'}),
  staffNote: z.string().trim().max(400).default('')
});

// ---------- SUPPLY ORDERS ----------
// The house has no supplier: somebody walks to a shop, buys the stock and
// carries it back. So an order is a job ticket, not a purchase order.
//
// The point of the flow is the audit trail. A manager records what the run
// *should* cost; whoever runs it records what it *did* cost. Both numbers are
// kept forever, and the gap between them is what an owner reads when somebody
// is suspected of pocketing the difference.
const ORDER_STATUSES = ['open','claimed','progress','completed','cancelled'];

/** Jobs a person can hold. Display and order-claiming; `role` stays the permission ladder. */
const STAFF_JOBS = ['pultos','bartender','felszolgalo','biztonsag','hostess','dj','uzletvezeto',''];
/** Jobs allowed to claim and run a supply order, on top of manager and owner. */
const ORDER_RUNNER_JOBS = ['biztonsag'];

const orderCreateSchema = z.object({
  items: z.array(z.object({
    productId: z.string().trim().min(1),
    qty: z.coerce.number().int().min(1, 'A mennyiség legalább 1 legyen.').max(999),
    unitCost: z.coerce.number().min(0, 'A becsült egységár nem lehet negatív.').max(10_000_000)
  })).min(1, 'A rendelés üres.').max(40),
  note: z.string().trim().max(400).default(''),
  source: z.string().trim().max(80).default('Nagyker')
});

const orderCompleteSchema = z.object({
  actualTotal: z.coerce.number().min(0, 'Az összeg nem lehet negatív.').max(1_000_000_000),
  varianceNote: z.string().trim().max(400).default('')
});

const passwordChangeSchema = z.object({
  currentPassword: z.string().min(1, 'Add meg a jelenlegi jelszavadat.'),
  newPassword: z.string().min(8, 'Az új jelszó legyen legalább 8 karakter.').max(200)
});

/** Parses a body, or replies 400 with the first validation message. */
function parseBody(res, schema, body){
  const result = schema.safeParse(body);
  if(!result.success){
    const issue = result.error.issues[0];
    json(res, 400, { error: issue?.message || 'Érvénytelen adat.', field: issue?.path?.join('.') || undefined });
    return null;
  }
  return result.data;
}

const CANONICAL_DRINKS = [{"id":"p_kobaltas","name":"Kőbaltás","section":"beer","category":"drink","price":1200,"stock":24,"minStock":8,"image":"assets/menu/drinks/kobaltas.png","active":true},{"id":"p_barracho","name":"Barracho","section":"beer","category":"drink","price":1800,"stock":24,"minStock":8,"image":"assets/menu/drinks/barracho.png","active":true},{"id":"p_sornyito","name":"Sörnyitó","section":"accessories","category":"drink","price":2400,"stock":18,"minStock":6,"image":"assets/menu/drinks/sornyito.png","active":true},{"id":"p_syrah","name":"Syrah vörösbor","section":"wine","category":"drink","price":5000,"stock":18,"minStock":6,"image":"assets/menu/drinks/syrah.png","active":true},{"id":"p_two_roosters","name":"Two Roosters rozé","section":"wine","category":"drink","price":5600,"stock":18,"minStock":6,"image":"assets/menu/drinks/two_roosters.png","active":true},{"id":"p_bleuterd","name":"Bleuter'D pezsgő","section":"wine","category":"drink","price":4800,"stock":18,"minStock":6,"image":"assets/menu/drinks/bleuterd.png","active":true},{"id":"p_mount_bourbon","name":"The Mount Bourbon Whiskey","section":"spirits","category":"drink","price":11200,"stock":16,"minStock":5,"image":"assets/menu/drinks/mount_bourbon.png","active":true},{"id":"p_vinewood","name":"Vinewood Sauvignon Blanc fehérbor","section":"wine","category":"drink","price":5800,"stock":18,"minStock":6,"image":"assets/menu/drinks/vinewood.png","active":true},{"id":"p_chernekov","name":"Cherenkov Premium Vodka","section":"spirits","category":"drink","price":12600,"stock":16,"minStock":5,"image":"assets/menu/drinks/chernekov.png","active":true},{"id":"p_cazafortunas","name":"Cazafortunas Tequila","section":"spirits","category":"drink","price":12200,"stock":16,"minStock":5,"image":"assets/menu/drinks/cazafortunas.png","active":true},{"id":"p_sinmisito","name":"Sinmisito Tequila","section":"spirits","category":"drink","price":15800,"stock":14,"minStock":4,"image":"assets/menu/drinks/sinmisito.png","active":true},{"id":"p_ragga","name":"Ragga rum","section":"spirits","category":"drink","price":11200,"stock":16,"minStock":5,"image":"assets/menu/drinks/ragga.png","active":true},{"id":"p_sprunk","name":"Sprunk (dobozos)","section":"nonalcoholic","category":"drink","price":1780,"stock":30,"minStock":10,"image":"assets/menu/drinks/sprunk.png","active":true},{"id":"p_ecola","name":"E-Cola (dobozos)","section":"nonalcoholic","category":"drink","price":1780,"stock":30,"minStock":10,"image":"assets/menu/drinks/ecola.png","active":true},{"id":"p_raine","name":"Rainé ásványvíz","section":"nonalcoholic","category":"drink","price":1600,"stock":32,"minStock":10,"image":"assets/menu/drinks/raine.png","active":true}];

const DEFAULT_SIGNATURE_DRINKS = [
  {productId:'p_sinmisito',description:'Ha hirtelen akarod megérezni az estét.'},
  {productId:'p_ragga',description:'Az igazi kalózok ezt isszák.'},
  {productId:'p_two_roosters',description:'Könnyed, elegáns választás a Red Moon estékhez.'}
];

function initialsFromName(name){
  const parts=String(name||'').trim().split(/\s+/).filter(Boolean);
  const letters=parts.map(part=>{
    const clean=part.normalize('NFD').replace(/[\u0300-\u036f]/g,'').replace(/[^A-Za-z0-9]/g,'');
    return clean ? clean[0].toUpperCase() : '';
  }).filter(Boolean);
  if(letters.length>=2) return letters.slice(0,6).join('');
  const fallback=String(name||'').normalize('NFD').replace(/[\u0300-\u036f]/g,'').replace(/[^A-Za-z0-9]/g,'').toUpperCase();
  return (fallback.slice(0,3) || 'RED');
}
function makeShiftId(db){
  // V64.7 — rövid, könnyen bediktálható műszakazonosító.
  // Példa: M-001, M-002, M-003...
  const ids=(db.shifts||[]).map(s=>String(s.id||''));
  const nums=ids.map(id=>{ const m=id.match(/^M-(\d+)$/); return m?Number(m[1]):0; });
  let n=Math.max(0,...nums)+1;
  let id=`M-${String(n).padStart(3,'0')}`;
  const used=new Set(ids);
  while(used.has(id)){ n++; id=`M-${String(n).padStart(3,'0')}`; }
  return id;
}

function migrateShortShiftIds(){
  db.shifts ||= []; db.sales ||= []; db.documents ||= [];
  const legacy=db.shifts.filter(s=>!/^M-\d+$/.test(String(s.id||'')));
  if(!legacy.length) return false;
  let changed=false;
  const used=new Set(db.shifts.filter(s=>/^M-\d+$/.test(String(s.id||''))).map(s=>String(s.id)));
  let next=Math.max(0,...[...used].map(id=>Number(id.slice(2))||0))+1;
  const mapping=new Map();
  legacy.sort((a,b)=>new Date(a.startedAt||0)-new Date(b.startedAt||0));
  for(const shift of legacy){
    let id=`M-${String(next).padStart(3,'0')}`;
    while(used.has(id)){ next++; id=`M-${String(next).padStart(3,'0')}`; }
    mapping.set(String(shift.id),id); shift.id=id;
    if(shift.closure) shift.closure.shiftId=id;
    if(shift.closure?.transfer) shift.closure.transfer.reference=id;
    used.add(id); next++; changed=true;
  }
  if(changed){
    for(const sale of db.sales){ if(mapping.has(String(sale.shiftId))) sale.shiftId=mapping.get(String(sale.shiftId)); }
    for(const doc of db.documents){ if(mapping.has(String(doc.shiftId))) doc.shiftId=mapping.get(String(doc.shiftId)); }
    for(const audit of (db.audit||[])){
      for(const [from,to] of mapping){
        if(typeof audit.details==='string' && audit.details.includes(from)) audit.details=audit.details.split(from).join(to);
      }
    }
  }
  return changed;
}
function makeDocumentId(prefix){
  return `${prefix}-${new Date().toISOString().replace(/\D/g,'').slice(0,14)}-${crypto.randomBytes(3).toString('hex').toUpperCase()}`;
}

function makeCartId(shift,user,number){
  return `${initialsFromName(user.name)}${String(number).padStart(2,'0')}`;
}
function migrateCartIds(){
  db.sales ||= [];
  db.shifts ||= [];
  const valid=/^[A-Z]{2,8}\d{2,}$/;
  const counters=new Map();
  let changed=false;
  const groups=new Map();
  for(const sale of db.sales){
    const key=`${sale.shiftId||'legacy'}::${sale.userId||sale.user||'unknown'}::${sale.transactionId||sale.id}`;
    if(!groups.has(key)) groups.set(key,[]);
    groups.get(key).push(sale);
  }
  const ordered=[...groups.values()].sort((a,b)=>new Date(a[0].at||0)-new Date(b[0].at||0));
  for(const group of ordered){
    const first=group[0];
    const shift=db.shifts.find(x=>x.id===first.shiftId);
    const name=first.user||shift?.startedByName||'Red Moon';
    const counterKey=`${first.shiftId||'legacy'}::${first.userId||name}`;
    let n=counters.get(counterKey)||0;
    const existing=String(first.cartId||'');
    if(valid.test(existing)){
      const m=existing.match(/(\d+)$/); n=Math.max(n,Number(m[1])||0); counters.set(counterKey,n);
      if(shift){ shift.cartCounters ||= {}; shift.cartCounters[String(first.userId||name)] = Math.max(Number(shift.cartCounters[String(first.userId||name)])||0,n); }
      continue;
    }
    n+=1; counters.set(counterKey,n);
    if(shift){ shift.cartCounters ||= {}; shift.cartCounters[String(first.userId||name)] = n; }
    const cartId=makeCartId(shift,{name},n);
    for(const sale of group){ sale.cartId=cartId; changed=true; }
  }
  return changed;
}

function inferProductSection(p){
  const raw=String(p?.section||'').trim().toLowerCase();
  const id=String(p?.id||'').trim().toLowerCase();
  const name=String(p?.name||'').toLowerCase().trim();
  const explicit={
    p_barracho:'beer', p_kobaltas:'beer', p_sornyito:'accessories',
    p_syrah:'wine', p_two_roosters:'wine', p_vinewood:'wine', p_bleuterd:'wine',
    p_ragga:'spirits', p_mount_bourbon:'spirits', p_chernekov:'spirits', p_cazafortunas:'spirits', p_sinmisito:'spirits',
    p_ecola:'nonalcoholic', p_sprunk:'nonalcoholic', p_raine:'nonalcoholic'
  };
  if(explicit[id]) return explicit[id];
  if(raw==='nonalcoholic' || raw==='alcoholfree' || raw==='alcohol-free') return 'nonalcoholic';
  if(['beer','wine','spirits','nonalcoholic','accessories'].includes(raw)) return raw;
  if(name==='barracho' || name==='kőbaltás' || name==='kobaltas') return 'beer';
  if(name.includes('sörnyitó') || name.includes('sornyito')) return 'accessories';
  if(/\b(e-cola|e cola|sprunk|raine|ásványvíz|mineral water|alkoholmentes)\b/.test(name)) return 'nonalcoholic';
  if(/\b(sör|beer|lager|ale|ipa|pils)\b/.test(name)) return 'beer';
  if(/\b(bor|wine|rozé|rose|pezsgő|prosecco|champagne)\b/.test(name)) return 'wine';
  if(/whiskey|whisky|vodka|tequila|rum|gin|brandy|cognac|pálink|bourbon/.test(name)) return 'spirits';
  if(String(p?.category||'')==='food') return 'other';
  return 'other';
}

async function migrateDrinkCatalog(){
  db.products ||= [];
  const ids=new Set(CANONICAL_DRINKS.map(p=>p.id));
  const hasSales=Array.isArray(db.sales)&&db.sales.length>0;
  const byName=new Map(db.products.map(p=>[String(p.name||'').trim().toLowerCase(),p]));
  const current=CANONICAL_DRINKS.map(base=>{
    const old=byName.get(base.name.toLowerCase());
    const merged={...base,...(old||{})};
    merged.stock=Number.isFinite(Number(old?.stock))?Math.max(0,Math.floor(Number(old.stock))):base.stock;
    merged.minStock=Number.isFinite(Number(old?.minStock))?Math.max(0,Math.floor(Number(old.minStock))):base.minStock;
    merged.price=Number.isFinite(Number(old?.price))?Math.max(0,Number(old.price)):base.price;
    merged.image=old?.image||base.image;
    merged.subtitle=old?.subtitle||base.subtitle||'';
    merged.active=old?.active!==undefined?!!old.active:true;
    merged.section=inferProductSection(merged);
    return merged;
  });
  const legacy=db.products.filter(p=>!ids.has(p.id)).map(p=>({...p,section:inferProductSection(p)}));
  db.products=[...current,...legacy];
  if(pool) await writeDB(db);
}
// Built-in manager accounts requested for the Ownership / Users menu.
// Passwords are stored only as PBKDF2 hashes; these are temporary credentials
// intended to be changed from the Owner account after first login.
function ensureBuiltInManagers(){
  db.users ||= [];
  const accounts = [
    {
      username: 'rei',
      name: 'Yuna Yue Rei',
      nickname: 'Rei',
      role: 'manager',
      portal: 'staff',
      passwordHash: 'PBKDF2:310000:sha256:7d4981cb3ec768c15db22853638538d4:d19707f9906cf9f4849cce3391ee1e3299f2f82c77a717d328355ef848a52ca3'
    },
    {
      username: 'redmoon.manager',
      name: 'Red Moon Manager',
      nickname: 'Manager',
      role: 'manager',
      portal: 'staff',
      passwordHash: 'PBKDF2:310000:sha256:e442f4cf2b8d4d6c5258590264520fd6:f66e394031e18517d51c8075e4661279a400a0cc85e6b521caa36fde796bf944'
    }
  ];
  let changed = false;
  for(const account of accounts){
    let u = db.users.find(x => String(x.username||'').toLowerCase() === account.username);
    if(!u){
      u = {id:'u_manager_'+crypto.randomBytes(6).toString('hex'), ...account};
      db.users.push(u);
      changed = true;
      continue;
    }
    // Do not overwrite an Owner's/customized account if an administrator has
    // already edited it; only ensure the requested manager role/name/portal.
    if(u.role !== 'manager'){ u.role = 'manager'; changed = true; }
    if(!u.name){ u.name = account.name; changed = true; }
    if(!u.nickname){ u.nickname = account.nickname; changed = true; }
    if(!u.portal){ u.portal = 'staff'; changed = true; }
  }
  return changed;
}

function broadcastClub(type='club_state', payload={}){
  for(const client of [...clubRealtimeClients]){
    try{
      let data={type,...payload,at:new Date().toISOString()};
      if(type==='club_state'&&payload.state&&client.userId){
        const viewer=db.users?.find(x=>x.id===client.userId);
        if(viewer&&['dj','manager','owner'].includes(viewer.role)){
          const c=ensureClub();
          data.state={...payload.state,
            chat:(c.chat||[]).slice(0,8).map(djChatMessage),
            requests:(c.requests||[]).slice(0,100).map(r=>({...r,ip:r.ip||null,browserHash:r.browserHash||null})),
            nameRequests:(c.nameRequests||[]).slice(0,80),
            registeredListeners:(c.approvedNames||[]).filter(x=>x.expiresAt>Date.now()).slice(-300).reverse().map(x=>({name:x.name,ip:x.ip||null,browserHash:x.browserHash||null,approvedAt:x.approvedAt||null,expiresAt:x.expiresAt||null,banned:!!activeBan(x.ip,x.browserHash),banUntil:activeBan(x.ip,x.browserHash)?.until||null}))
          };
        }
      }
      client.res.write(`data: ${JSON.stringify(data)}\n\n`);
    }catch{clubRealtimeClients.delete(client)}
  }
}
function clubDefaults(){ return {live:false,dj:null,title:'',current:null,queue:[],chat:[],requests:[],nameRequests:[],approvedNames:[],bans:[],startedAt:null,library:[],provider:'gocast',providerUrl:'https://gocast.fm/station/red-moon-pub'}; }
function ensureMusicDir(){ const dir=path.join(PUBLIC,'assets','dj-music'); fs.mkdirSync(dir,{recursive:true}); return dir; }
function sanitizeFilename(name){ let n=String(name||'track').normalize('NFKC').replace(/[^a-zA-Z0-9._ -]+/g,'_').trim(); if(!n)n='track'; return n.slice(0,100); }
function extAllowed(name){ return ['.mp3','.wav','.ogg','.m4a','.aac','.webm'].includes(path.extname(name).toLowerCase()); }
function readMultipartAudio(req){ return new Promise((resolve,reject)=>{ const ct=String(req.headers['content-type']||''); const m=ct.match(/boundary=(?:"([^"]+)"|([^;]+))/i); if(!m)return reject(new Error('Multipart feltöltés szükséges')); const boundary=Buffer.from('--'+(m[1]||m[2])); const chunks=[]; let total=0; req.on('data',c=>{ total+=c.length; if(total>80*1024*1024){reject(new Error('A zene maximum 80 MB lehet.')); req.destroy(); return;} chunks.push(c); }); req.on('end',()=>{ try{ const buf=Buffer.concat(chunks); const start=buf.indexOf(Buffer.from('Content-Disposition:'),'utf8'); if(start<0)throw new Error('Fájl nem található a feltöltésben'); const headerEnd=buf.indexOf(Buffer.from('\r\n\r\n'),start); if(headerEnd<0)throw new Error('Érvénytelen feltöltés'); const header=buf.slice(start,headerEnd).toString('utf8'); const fm=header.match(/filename="([^"]*)"/i); const filename=fm?fm[1]:''; const dataStart=headerEnd+4; const end=buf.indexOf(Buffer.concat([Buffer.from('\r\n'),boundary]),dataStart); if(end<0)throw new Error('Érvénytelen fájlhatár'); resolve({filename,data:buf.slice(dataStart,end)}); }catch(e){reject(e)} }); req.on('error',reject); }); }
function ensureClub(){ db.club ||= clubDefaults(); db.club.library ||= []; db.club.nameRequests ||= []; db.club.approvedNames ||= []; db.club.bans ||= []; db.club.chat ||= []; db.club.requests ||= []; db.club.queue ||= []; return db.club; }
function getClientIP(req){
  const raw=String(
    req.headers['cf-connecting-ip'] ||
    req.headers['true-client-ip'] ||
    req.headers['x-real-ip'] ||
    req.headers['x-forwarded-for'] ||
    req.socket.remoteAddress ||
    ''
  ).split(',')[0].trim();
  const ip=raw.replace(/^::ffff:/,'').replace(/^\[|\]$/g,'');
  return ip || 'unknown';
}
function activeBan(ip,browserHash=''){ const c=ensureClub(), now=Date.now(); c.bans=c.bans.filter(b=>!b.until || b.until>now); return c.bans.find(b=>b.ip===ip && (!b.browserHash || !browserHash || b.browserHash===browserHash))||null; }
function browserHashFromClientId(clientId){ const id=String(clientId||'').trim().slice(0,160); return id?crypto.createHash('sha256').update(id).digest('hex'):''; }
function identityBan(req,identity=null,clientId=''){ const ip=getClientIP(req); const bh=identity?.browserHash||browserHashFromClientId(clientId); return activeBan(ip,bh); }
function cleanNameToken(raw){ return String(raw||'').trim().slice(0,160); }
function approvedIdentity(req,name,token){ const c=ensureClub(), ip=getClientIP(req), n=String(name||'').trim().slice(0,32), t=cleanNameToken(token); if(!n||!t)return false; const hash=crypto.createHash('sha256').update(t).digest('hex'); const identity=c.approvedNames.find(x=>x.tokenHash===hash && x.ip===ip && x.name===n && x.expiresAt>Date.now()); if(!identity||identityBan(req,identity))return false; return identity; }
function approvedIdentityByToken(req,token){ const c=ensureClub(), ip=getClientIP(req), t=cleanNameToken(token); if(!t)return null; const hash=crypto.createHash('sha256').update(t).digest('hex'); const identity=c.approvedNames.find(x=>x.tokenHash===hash && x.ip===ip && x.expiresAt>Date.now())||null; return identity&&!identityBan(req,identity)?identity:null; }
function clubState(req=null){
  const c=ensureClub();
  purgeExpiredChat();
  const active=[...clubListeners.entries()].filter(([id,x])=>!id.startsWith('chat:')&&!id.startsWith('request:')&&x.lastSeen>Date.now()-30000);
  for(const [id,x] of clubListeners) if(x.lastSeen<=Date.now()-30000) clubListeners.delete(id);
  c.nameRequests=c.nameRequests.filter(x=>x.status==='pending').slice(0,80);
  c.approvedNames=c.approvedNames.filter(x=>x.expiresAt>Date.now()).slice(-300);
  c.bans=c.bans.filter(x=>!x.until||x.until>Date.now()).slice(-200);
  const viewer=req?sessionUser(req):null;
  const canModerate=!!viewer&&['dj','manager','owner'].includes(viewer.role);
  return {serverNow:Date.now(),live:!!c.live,dj:c.dj||null,title:c.title||'',provider:c.provider||'gocast',providerUrl:c.providerUrl||'https://gocast.fm/station/red-moon-pub',current:null,queue:[],library:[],chat:canModerate?(c.chat||[]).slice(0,8).map(djChatMessage):(c.chat||[]).slice(0,8).map(publicChatMessage),requests:canModerate?(c.requests||[]).slice(0,100).map(r=>({...r,item:r.item?{id:r.item.id,name:r.item.name,url:''}:null})):[],nameRequests:canModerate?(c.nameRequests||[]).slice(0,80):[],registeredListeners:canModerate?(c.approvedNames||[]).filter(x=>x.expiresAt>Date.now()).slice(-300).reverse().map(x=>({name:x.name,ip:x.ip||null,browserHash:x.browserHash||null,approvedAt:x.approvedAt||null,expiresAt:x.expiresAt||null,banned:!!activeBan(x.ip,x.browserHash),banUntil:activeBan(x.ip,x.browserHash)?.until||null})):[],listenerCount:active.length,startedAt:c.startedAt||null};
}
function broadcastClubState(){ broadcastClub('club_state',{state:clubState()}); }
function authDJ(req,res){ const u=sessionUser(req); if(!u){json(res,401,{error:'Bejelentkezés szükséges'});return null;} if((u.portal|| (u.role==='dj'?'dj':'staff'))!=='dj'){json(res,403,{error:'Ez a fiók a Kassza / Staff konzolhoz tartozik. DJ konzolhoz külön DJ fiók szükséges.'});return null;} if(!['dj','manager','owner'].includes(u.role)){json(res,403,{error:'Ehhez a DJ jogosultság szükséges'});return null;} return u; }
function parseYoutubeLink(raw){
  const value=String(raw||'').trim(); if(!value)return null;
  let u; try{u=new URL(value)}catch{return null;}
  const host=u.hostname.replace(/^www\./,'').toLowerCase();
  let videoId=null, playlistId=u.searchParams.get('list');
  if(host==='youtu.be') videoId=u.pathname.split('/').filter(Boolean)[0]||null;
  else if(host==='youtube.com'||host==='m.youtube.com'||host==='music.youtube.com'){
    if(u.pathname==='/watch') videoId=u.searchParams.get('v');
    else if(u.pathname.startsWith('/shorts/')) videoId=u.pathname.split('/')[2]||null;
    else if(u.pathname.startsWith('/embed/')) videoId=u.pathname.split('/')[2]||null;
  }
  const clean=id=>id&&/^[A-Za-z0-9_-]{6,20}$/.test(id)?id:null; videoId=clean(videoId);
  if(playlistId && !/^[A-Za-z0-9_-]{6,100}$/.test(playlistId)) playlistId=null;
  if(!videoId && !playlistId)return null;
  return {type:videoId?'video':'playlist',videoId,playlistId,url:value,label:videoId?`YouTube · ${videoId}`:`YouTube playlist · ${playlistId}`};
}
function publicChatMessage(m){return {id:m.id,at:m.at,name:m.name,text:m.text,kind:m.kind||'chat',requestId:m.requestId||null};}
function djChatMessage(m){return {...publicChatMessage(m),ip:m.ip||null,browserHash:m.browserHash||null};}
function purgeExpiredChat(){ const c=ensureClub(); const cutoff=Date.now()-60000; c.chat=(c.chat||[]).filter(m=>new Date(m.at).getTime()>cutoff); }
/**
 * Refuses to open a Server-Sent Events stream in function mode.
 *
 * A held-open stream in a serverless function is billed for its whole life and
 * is killed by the platform anyway, and a broadcast from one invocation can
 * never reach a listener held by another. 501 is deliberate: EventSource treats
 * a non-2xx response as fatal and stops, instead of reconnecting forever. The
 * frontend reads `realtime` from /api/health and polls instead.
 */
function refuseStream(res){
  if(!SERVERLESS) return false;
  json(res,501,{error:'Ez a telepítés lekérdezéses frissítést használ.',realtime:'poll'});
  return true;
}

function broadcastRealtime(type='state', payload={}){
  const message=`data: ${JSON.stringify({type,...payload,at:new Date().toISOString()})}\n\n`;
  for(const client of [...realtimeClients]){
    try{client.res.write(message)}catch{realtimeClients.delete(client)}
  }
}
function writeDB(next){
  if(!pool){
    const tmp=DB_FILE+'.tmp';
    fs.writeFileSync(tmp, JSON.stringify(next,null,2));
    fs.renameSync(tmp,DB_FILE);
    broadcastRealtime('state');
    return Promise.resolve();
  }
  // Serialize writes so two quick POS actions cannot overwrite one another.
  writeQueue = writeQueue.then(async()=>{
    if(SERVERLESS){
      // Two invocations can hold the same snapshot at the same time, and the
      // whole state is one JSONB blob — so a blind UPDATE would silently drop
      // the other request's sale. Write only if the row is still the revision
      // this request read, otherwise fail loudly and let the client retry.
      const result = await pool.query(
        'UPDATE red_moon_state SET data=$1::jsonb, rev=rev+1, updated_at=NOW() WHERE id=1 AND rev=$2',
        [JSON.stringify(next), stateRev]
      );
      if(result.rowCount === 0) throw new StateConflictError();
      stateRev += 1;
      return;
    }
    await pool.query('UPDATE red_moon_state SET data=$1::jsonb, rev=rev+1, updated_at=NOW() WHERE id=1', [JSON.stringify(next)]);
    stateRev += 1;
    broadcastRealtime('state');
  });
  return writeQueue;
}
function json(res,status,obj){ const body=JSON.stringify(obj); const origin=res.req?.headers?.origin; const headers={'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store','X-Content-Type-Options':'nosniff','X-Frame-Options':'SAMEORIGIN','Referrer-Policy':'same-origin'}; if(origin==='null' || origin===`http://localhost:${PORT}` || origin===`http://127.0.0.1:${PORT}`){headers['Access-Control-Allow-Origin']=origin;headers['Access-Control-Allow-Credentials']='true';headers['Access-Control-Allow-Headers']='Content-Type';headers['Access-Control-Allow-Methods']='GET,POST,PATCH,DELETE,OPTIONS';} res.writeHead(status,headers); res.end(body); }
function parseCookies(req){ const out={}; (req.headers.cookie||'').split(';').forEach(p=>{const i=p.indexOf('='); if(i>0) out[p.slice(0,i).trim()]=decodeURIComponent(p.slice(i+1));}); return out; }
/** Grace period for a tab that navigated away but may be coming straight back. */
const SESSION_LEAVE_GRACE_MS=6000;

/** True when `/api/session/leave` was called and the grace period has run out. */
function sessionAbandoned(session){
  return !!session?.leavingAt && Date.now()-session.leavingAt>SESSION_LEAVE_GRACE_MS;
}

function sessionUser(req){
  const sid=parseCookies(req).rm_session;
  const s=sid&&sessions.get(sid);
  if(s && sessionAbandoned(s)){ sessions.delete(sid); return null; }
  if(s){ s.lastSeen=Date.now(); delete s.leavingAt; if(!s.portal) s.portal=s.role==='dj'?'dj':'staff'; }
  return s||null;
}
function onlineUsers(){
  const cutoff=Date.now()-45000;
  const seen=new Map();
  for(const session of sessions.values()){
    if(!session?.id || !session.lastSeen || session.lastSeen<cutoff) continue;
    if(sessionAbandoned(session)) continue;
    const current=seen.get(session.id);
    if(!current || session.lastSeen>current.lastSeen){
      const account=db?.users?.find(x=>x.id===session.id);
      seen.set(session.id,{id:session.id,username:session.username,name:session.name,role:session.role,lastSeen:session.lastSeen,phone:formatStaffPhone(account?.phone||'')});
    }
  }
  return [...seen.values()].sort((a,b)=>a.name.localeCompare(b.name,'hu'));
}
function roleAtLeast(role,need){ const r={staff:1,manager:2,owner:3}; return (r[role]||0)>=(r[need]||99); }
function auth(req,res,need='staff'){ const u=sessionUser(req); if(!u){json(res,401,{error:'Bejelentkezés szükséges'});return null;} if((u.portal|| (u.role==='dj'?'dj':'staff'))!=='staff'){json(res,403,{error:'Ez a fiók a DJ konzolhoz tartozik. Kasszához külön Staff / Kasszás fiók szükséges.'});return null;} if(!roleAtLeast(u.role,need)){json(res,403,{error:'Nincs jogosultságod ehhez a művelethez'});return null;} return u; }
function readBody(req){
  // A serverless platform may have consumed the stream already and handed the
  // parsed body over. Reading the stream again would block until the function
  // times out, so use what was parsed.
  if(req.rmParsedBody!==undefined){
    const parsed=req.rmParsedBody;
    if(parsed===null) return Promise.resolve({});
    if(typeof parsed==='string'){ try{ return Promise.resolve(parsed?JSON.parse(parsed):{}); }catch(e){ return Promise.reject(e); } }
    if(Buffer.isBuffer(parsed)){ const text=parsed.toString('utf8'); try{ return Promise.resolve(text?JSON.parse(text):{}); }catch(e){ return Promise.reject(e); } }
    return Promise.resolve(parsed);
  }
  return new Promise((resolve,reject)=>{let d='';req.on('data',c=>{d+=c;if(d.length>32e6) req.destroy();});req.on('end',()=>{try{resolve(d?JSON.parse(d):{})}catch(e){reject(e)}});req.on('error',reject)})
}
function hashPassword(password,salt=crypto.randomBytes(16).toString('hex')){return {salt,hash:crypto.pbkdf2Sync(password,salt,310000,32,'sha256').toString('hex')}}
function verifyPassword(password,encoded){ const [scheme,it,alg,salt,hash]=encoded.split(':'); if(scheme!=='PBKDF2') return false; const got=crypto.pbkdf2Sync(password,salt,Number(it),32,alg); return crypto.timingSafeEqual(got,Buffer.from(hash,'hex')); }
function audit(db,user,action,details){db.audit.unshift({id:crypto.randomUUID(),at:new Date().toISOString(),userId:user.id,user:user.name,role:user.role,action,details}); if(db.audit.length>1000) db.audit.length=1000;}
function notifyAudience(db,audience,title,message,meta={}){db.notifications.unshift({id:crypto.randomUUID(),at:new Date().toISOString(),audience:Array.isArray(audience)?audience:['owner'],title,message,meta,readBy:{}});if(db.notifications.length>500)db.notifications.length=500;}
function notifyManagersOwners(db,title,message,meta={}){notifyAudience(db,['manager','owner'],title,message,meta);}
function notifyOwners(db,title,message,meta={}){notifyAudience(db,['owner'],title,message,meta);}
function formatStaffPhone(raw){ const d=String(raw||'').replace(/\D/g,''); if(!/^3876\d{7}$/.test(d))return ''; const local=d.slice(4); return `+38-76-${local.slice(0,3)}-${local.slice(3)}`; }
function normalizeStaffPhone(raw){ const d=String(raw||'').replace(/\D/g,''); if(/^\d{7}$/.test(d))return '3876'+d; if(/^763?/.test(d) && d.length===9)return '38'+d; if(/^3876\d{7}$/.test(d))return d; return ''; }
/**
 * Ties an anonymous action to one browser on one connection.
 *
 * The raw token never leaves the visitor's machine and is never stored — only
 * this hash is — so a guest can find their own booking again without the site
 * holding anything that identifies them.
 */
function visitorFingerprint(req,token){
  return crypto.createHash('sha256').update(`${getClientIP(req)}|${String(token||'').trim().slice(0,200)}`).digest('hex');
}

/**
 * Short code a guest can read out at the door.
 *
 * No vowels, so four random characters can never spell a word — a booking
 * reference is read aloud by staff to guests, and a generator that can produce
 * an insult eventually will. No 0/O or 1/I either, which are the pair people
 * mishear over a phone.
 */
function makeReservationCode(){
  const alphabet='BCDFGHJKLMNPQRSTVWXYZ23456789';
  let code='';
  for(let i=0;i<4;i++) code+=alphabet[crypto.randomInt(alphabet.length)];
  return `RM-${code}`;
}

/** What the guest may see: their own booking, without the fingerprint. */
function publicReservation(r){
  return {
    id:r.id, code:r.code, at:r.at, when:r.when,
    name:r.name, guests:r.guests, occasion:r.occasion, tier:r.tier, note:r.note||'',
    status:r.status, staffNote:r.staffNote||'', handledAt:r.handledAt||null,
    phone:formatStaffPhone(r.phone||'')
  };
}

/** What staff see. Adds who handled it; still never exposes the fingerprint. */
function staffReservation(r){
  return {...publicReservation(r), handledByName:r.handledByName||null};
}

/** Application reference. Same no-vowel alphabet as a booking code. */
function makeApplicationCode(){
  return makeReservationCode().replace('RM-','RM-A');
}

/** Supply order reference. */
function makeOrderCode(){
  return makeReservationCode().replace('RM-','RM-B');
}

/** Pulls the order id out of `/api/orders/<id>/<action>`. */
function findOrder(url, suffix){
  const id=decodeURIComponent(url.slice('/api/orders/'.length, url.length-suffix.length));
  return (db.orders||[]).find(x=>x.id===id)||null;
}

/**
 * Who may claim and run a supply order.
 *
 * Managers and owners always can. Below that it is the *job* that decides, not
 * the permission role: a bartender and a doorman are both `staff`, but only one
 * of them leaves the building to fetch stock.
 */
function canRunOrders(user){
  if(!user) return false;
  if(roleAtLeast(user.role,'manager')) return true;
  const account=(db.users||[]).find(x=>x.id===user.id);
  return ORDER_RUNNER_JOBS.includes(String(account?.job||''));
}

/**
 * Appends to the expense ledger.
 *
 * Revenue was already tracked in `finance.overallRevenue`; without a matching
 * expense side an owner can see takings but never profit, which is the number
 * that actually matters to the house.
 */
function recordExpense(target, entry){
  target.expenses ||= [];
  target.finance ||= {};
  const record={
    id:crypto.randomUUID(),
    at:new Date().toISOString(),
    kind:entry.kind, ref:entry.ref||'', amount:Number(entry.amount)||0,
    byId:entry.byId||null, byName:entry.byName||'', note:entry.note||''
  };
  target.expenses.unshift(record);
  target.expenses=target.expenses.slice(0,1000);
  target.finance.overallExpense=(Number(target.finance.overallExpense)||0)+record.amount;
  return record;
}

/** Local calendar day key, `YYYY-MM-DD`. Used by every activity heatmap. */
function dayKey(value){
  const date=new Date(value);
  if(Number.isNaN(date.getTime())) return '';
  const pad=(n)=>String(n).padStart(2,'0');
  return `${date.getFullYear()}-${pad(date.getMonth()+1)}-${pad(date.getDate())}`;
}

/** Hours a shift ran, or the hours so far for one still open. */
function shiftHours(shift){
  const start=new Date(shift.startedAt).getTime();
  const end=shift.endedAt?new Date(shift.endedAt).getTime():Date.now();
  if(!Number.isFinite(start)||!Number.isFinite(end)||end<start) return 0;
  return (end-start)/3600000;
}

/**
 * One person's record: shifts worked, sales rung up, supply runs completed.
 *
 * `days` is the per-day roll-up the activity calendar renders. It is built
 * server side so the browser never has to pull the raw sale list to draw it.
 */
function personalAnalytics(userId){
  const account=(db.users||[]).find(x=>x.id===userId);
  const name=account?.name||'';

  const shifts=(db.shifts||[]).filter(s=>
    (s.memberIds||[]).includes(userId) || (s.members||[]).includes(name)
  );
  const sales=(db.sales||[]).filter(s=>s.userId===userId || s.user===name);
  const orders=(db.orders||[]).filter(o=>o.completedById===userId);
  const claimed=(db.orders||[]).filter(o=>o.claimedById===userId && ['claimed','progress'].includes(o.status));

  const days={};
  const bump=(at,field,value)=>{
    const key=dayKey(at);
    if(!key) return;
    days[key] ||= {date:key, shifts:0, hours:0, sales:0, revenue:0, orders:0, spend:0};
    days[key][field]+=value;
  };

  for(const shift of shifts){ bump(shift.startedAt,'shifts',1); bump(shift.startedAt,'hours',shiftHours(shift)); }
  for(const sale of sales){ bump(sale.at,'sales',1); bump(sale.at,'revenue',Number(sale.total)||0); }
  for(const order of orders){ bump(order.completedAt,'orders',1); bump(order.completedAt,'spend',Number(order.actualTotal)||0); }

  const hours=shifts.reduce((sum,s)=>sum+shiftHours(s),0);
  const revenue=sales.reduce((sum,s)=>sum+(Number(s.total)||0),0);
  const estimated=orders.reduce((sum,o)=>sum+(Number(o.estimatedTotal)||0),0);
  const actual=orders.reduce((sum,o)=>sum+(Number(o.actualTotal)||0),0);

  return {
    totals:{
      shifts:shifts.length,
      hours:Math.round(hours*10)/10,
      sales:sales.length,
      items:sales.reduce((sum,s)=>sum+(Number(s.qty)||0),0),
      revenue,
      // Wage is derived, not stored: the house has no payroll table yet.
      // HOURLY_WAGE is the single place to change that assumption.
      wage:Math.round(hours*HOURLY_WAGE),
      orders:orders.length,
      orderEstimated:estimated,
      orderActual:actual,
      orderVariance:actual-estimated
    },
    openShift:(db.shifts||[]).find(s=>s.status==='open' && ((s.memberIds||[]).includes(userId)))||null,
    claimedOrders:claimed.map(o=>({id:o.id,code:o.code,status:o.status,estimatedTotal:o.estimatedTotal,items:o.items.length})),
    recentShifts:shifts.slice(0,12).map(s=>({
      id:s.id, startedAt:s.startedAt, endedAt:s.endedAt, status:s.status,
      hours:Math.round(shiftHours(s)*10)/10, revenue:Number(s.revenue)||0
    })),
    days:Object.values(days).sort((a,b)=>a.date<b.date?-1:1)
  };
}

/** Flat hourly wage used for the payroll preview until real rates exist. */
const HOURLY_WAGE=1800;

/**
 * Stock health: how fast each product sells, and how long the shelf lasts.
 *
 * Burn rate is measured over the window below rather than over all time — a
 * product that sold hard three months ago and not since should not read as
 * "two days left".
 */
const BURN_WINDOW_DAYS=14;

function storageAnalytics(){
  const since=Date.now()-BURN_WINDOW_DAYS*86400000;
  const sold={};
  for(const sale of db.sales||[]){
    if(new Date(sale.at).getTime()<since) continue;
    sold[sale.productId]=(sold[sale.productId]||0)+(Number(sale.qty)||0);
  }

  const restocked={};
  const cost={};
  for(const log of db.restockLogs||[]){
    if(new Date(log.at).getTime()<since) continue;
    restocked[log.productId]=(restocked[log.productId]||0)+(Number(log.qty)||0);
    cost[log.productId]=(cost[log.productId]||0)+(Number(log.totalCost)||0);
  }

  const products=(db.products||[]).filter(p=>p.active!==false).map(product=>{
    const soldQty=sold[product.id]||0;
    const perDay=soldQty/BURN_WINDOW_DAYS;
    const stock=Number(product.stock)||0;
    // No measurable movement means no honest forecast. `null` says so, instead
    // of Infinity pretending the shelf lasts forever.
    const daysLeft=perDay>0?Math.round((stock/perDay)*10)/10:null;
    const restockQty=restocked[product.id]||0;
    return {
      id:product.id, name:product.name, section:product.section||'other',
      stock, minStock:Number(product.minStock)||0,
      price:Number(product.price)||0,
      sold:soldQty,
      perDay:Math.round(perDay*100)/100,
      daysLeft,
      restocked:restockQty,
      restockCost:cost[product.id]||0,
      avgUnitCost:restockQty?Math.round((cost[product.id]||0)/restockQty):null,
      below:stock<=(Number(product.minStock)||0)
    };
  }).sort((a,b)=>{
    // Most urgent first: a shelf with a forecast beats one without.
    if(a.daysLeft===null && b.daysLeft===null) return b.sold-a.sold;
    if(a.daysLeft===null) return 1;
    if(b.daysLeft===null) return -1;
    return a.daysLeft-b.daysLeft;
  });

  return {
    windowDays:BURN_WINDOW_DAYS,
    generatedAt:new Date().toISOString(),
    products,
    stockValue:products.reduce((sum,p)=>sum+p.stock*(p.avgUnitCost??0),0),
    retailValue:products.reduce((sum,p)=>sum+p.stock*p.price,0)
  };
}

/** Revenue, expense and profit for the house, plus a 30 day trend. */
function businessAnalytics(){
  const DAYS=30;
  const since=Date.now()-DAYS*86400000;

  const trend={};
  for(let i=DAYS-1;i>=0;i--){
    trend[dayKey(Date.now()-i*86400000)]={date:dayKey(Date.now()-i*86400000),revenue:0,expense:0,sales:0};
  }

  for(const sale of db.sales||[]){
    const key=dayKey(sale.at);
    if(trend[key]){ trend[key].revenue+=Number(sale.total)||0; trend[key].sales+=1; }
  }
  for(const expense of db.expenses||[]){
    const key=dayKey(expense.at);
    if(trend[key]) trend[key].expense+=Number(expense.amount)||0;
  }

  const recentSales=(db.sales||[]).filter(s=>new Date(s.at).getTime()>=since);
  const recentExpenses=(db.expenses||[]).filter(x=>new Date(x.at).getTime()>=since);

  const byProduct={};
  for(const sale of recentSales){
    byProduct[sale.product||sale.productId] ||= {product:sale.product||sale.productId,qty:0,revenue:0};
    byProduct[sale.product||sale.productId].qty+=Number(sale.qty)||0;
    byProduct[sale.product||sale.productId].revenue+=Number(sale.total)||0;
  }

  const revenue=Number(db.finance?.overallRevenue)||0;
  const expense=Number(db.finance?.overallExpense)||0;

  return {
    generatedAt:new Date().toISOString(),
    windowDays:DAYS,
    lifetime:{revenue,expense,profit:revenue-expense},
    window:{
      revenue:recentSales.reduce((sum,s)=>sum+(Number(s.total)||0),0),
      expense:recentExpenses.reduce((sum,x)=>sum+(Number(x.amount)||0),0),
      sales:recentSales.length
    },
    trend:Object.values(trend),
    topProducts:Object.values(byProduct).sort((a,b)=>b.revenue-a.revenue).slice(0,8),
    orders:{
      open:(db.orders||[]).filter(o=>o.status==='open').length,
      running:(db.orders||[]).filter(o=>['claimed','progress'].includes(o.status)).length,
      completed:(db.orders||[]).filter(o=>o.status==='completed').length,
      variance:(db.orders||[]).filter(o=>o.status==='completed').reduce((sum,o)=>sum+(Number(o.variance)||0),0)
    },
    staffCount:(db.users||[]).filter(x=>x.role!=='dj').length
  };
}

/**
 * What the applicant may see of their own application.
 *
 * Deliberately excludes `experience` and `why` — the applicant wrote them and
 * echoing long free text back adds nothing, while keeping the payload small.
 */
function publicApplication(a){
  return {
    id:a.id, code:a.code, at:a.at,
    name:a.name, position:a.position, age:a.age,
    status:a.status, staffNote:a.staffNote||'', handledAt:a.handledAt||null,
    phone:formatStaffPhone(a.phone||'')
  };
}

/** What a manager sees: everything except the fingerprint. */
function staffApplication(a){
  return {
    ...publicApplication(a),
    radio:a.radio||'',
    availability:a.availability||'',
    experience:a.experience||'',
    why:a.why||'',
    handledByName:a.handledByName||null
  };
}

function publicUser(u){return {id:u.id,username:u.username,name:u.name,nickname:u.nickname||'',role:u.role,portal:u.portal||(u.role==='dj'?'dj':'staff'),job:u.job||'',avatar:u.avatar||'',lastActiveAt:u.lastActiveAt||null,phone:formatStaffPhone(u.phone||'')};}
function currency(n){return Number(n)||0}


async function api(req,res,url){
  if(req.method==='OPTIONS'){
    const origin=req.headers.origin;
    if(origin==='null' || origin===`http://localhost:${PORT}` || origin===`http://127.0.0.1:${PORT}`){
      res.writeHead(204,{'Access-Control-Allow-Origin':origin,'Access-Control-Allow-Credentials':'true','Access-Control-Allow-Headers':'Content-Type, X-Review-Token','Access-Control-Allow-Methods':'GET,POST,PATCH,DELETE,OPTIONS','Vary':'Origin'});
      return res.end();
    }
    res.writeHead(204); return res.end();
  }
  const dbState=db;
  // Lightweight migration so an existing V15 database can be upgraded without losing data.
  dbState.shifts ||= [];
  dbState.documents ||= [];
  dbState.users ||= [];
  dbState.products ||= [];
  dbState.sales ||= [];
  dbState.audit ||= [];
  dbState.notifications ||= [];
  dbState.reviews ||= [];
  dbState.events ||= [];
  dbState.restockLogs ||= [];
  dbState.finance ||= {};
  if(!Number.isFinite(Number(dbState.finance.overallRevenue))) dbState.finance.overallRevenue=dbState.sales.reduce((a,x)=>a+(Number(x.total)||0),0);
  dbState.finance.overallRevenueOffset ||= 0;
  for(const s of dbState.sales){ s.shiftId ??= null; s.documentId ??= null; s.receiptId ??= null; s.paymentMethod ??= 'cash'; if(s.paymentMethod==='card') s.paymentMethod='cash'; s.transactionId ??= s.id; }
  try{
    if(req.method==='GET' && url==='/api/health'){
      // `realtime` tells the frontend whether to open an EventSource or to
      // poll. `storage` tells it where uploaded DJ audio is served from.
      return json(res,200,{
        ok:true,
        service:'red-moon-staff',
        version:'19.0-realtime-neon',
        time:new Date().toISOString(),
        runtime:SERVERLESS?'function':'server',
        realtime:SERVERLESS?'poll':'sse',
        storage:bucketStorageEnabled()?'bucket':'disk',
        database:pool?'postgres':'file'
      });
    }

    if(req.method==='POST' && url==='/api/login'){
      const b=await readBody(req);
      const portal=String(b.portal||'staff').toLowerCase()==='dj'?'dj':'staff';
      const u=db.users.find(x=>x.username.toLowerCase()===String(b.username||'').trim().toLowerCase());
      if(!u || !verifyPassword(String(b.password||''),u.passwordHash)) return json(res,401,{error:'Hibás felhasználónév vagy jelszó'});
      const allowedStaff=['staff','manager','owner'].includes(u.role);
      const allowedDJ=['dj','manager','owner'].includes(u.role);
      if(portal==='staff' && !allowedStaff) return json(res,403,{error:'Ez DJ fiók. Ezzel a fiókkal csak a DJ konzolba lehet belépni.'});
      if(portal==='dj' && !allowedDJ) return json(res,403,{error:'Ez kasszás / Staff fiók. A DJ konzolhoz külön DJ fiók szükséges.'});
      // One account may have only one active session at a time.
      const sessionCutoff=Date.now()-60000;
      for(const [oldSid,oldSession] of sessions.entries()){
        if(!oldSession?.id || oldSession.lastSeen<sessionCutoff) sessions.delete(oldSid);
      }
      const existingSession=[...sessions.entries()].find(([,session])=>session.id===u.id && session.lastSeen>=sessionCutoff);
      if(existingSession && !b.force){
        // Answer with enough detail for the client to offer "sign out there and
        // continue here" instead of leaving the account stuck until it expires.
        return json(res,409,{error:'Ez a fiók már be van jelentkezve egy másik eszközön.',sessionConflict:true,since:new Date(existingSession[1].lastSeen).toISOString()});
      }
      if(existingSession && b.force){
        for(const [oldSid,session] of sessions.entries()){ if(session.id===u.id) sessions.delete(oldSid); }
        audit(db,u,'SESSION_TAKEOVER','Korábbi munkamenet lezárva új belépéskor');
      }
      const sid=crypto.randomBytes(32).toString('hex');
      const now=new Date().toISOString();
      u.lastActiveAt=now;
      sessions.set(sid,{id:u.id,username:u.username,name:u.name,role:u.role,portal,avatar:u.avatar||'',lastSeen:Date.now(),lastPersistedActive:Date.now(),ip:getClientIP(req)});
      res.setHeader('Set-Cookie',`rm_session=${sid}; HttpOnly; SameSite=Lax; Path=/; Max-Age=28800${process.env.NODE_ENV==='production'?' ; Secure':''}`.replace(' ; Secure','; Secure'));
      audit(db,u,'LOGIN','Sikeres belépés'); await writeDB(db);
      return json(res,200,{user:publicUser(u)});
    }

    if(req.method==='POST' && url==='/api/session/leave'){
      const sid=parseCookies(req).rm_session;
      if(sid && sessions.has(sid)){
        if(SERVERLESS){
          // A timer cannot outlive the invocation, so the grace period is
          // expressed as data instead: the session is marked, and the next
          // `/api/session/resume` clears the mark. Anything that reads sessions
          // treats a stale `leavingAt` as gone.
          const session=sessions.get(sid);
          session.leavingAt=Date.now();
        }else{
          const old=pendingSessionLeaves.get(sid); if(old)clearTimeout(old);
          const timer=setTimeout(()=>{sessions.delete(sid);pendingSessionLeaves.delete(sid);broadcastRealtime('presence')},6000);
          pendingSessionLeaves.set(sid,timer);
        }
      }
      return json(res,200,{ok:true,pending:true});
    }

    if(req.method==='POST' && url==='/api/session/resume'){
      const sid=parseCookies(req).rm_session;
      const timer=sid&&pendingSessionLeaves.get(sid);
      if(timer){clearTimeout(timer);pendingSessionLeaves.delete(sid)}
      const session=sid&&sessions.get(sid); if(session){session.lastSeen=Date.now(); delete session.leavingAt;}
      return json(res,200,{ok:!!session});
    }

    if(req.method==='POST' && url==='/api/logout'){
      const sid=parseCookies(req).rm_session; const u=sessionUser(req);
      const pending=sid&&pendingSessionLeaves.get(sid); if(pending){clearTimeout(pending);pendingSessionLeaves.delete(sid)}
      if(u){u.lastActiveAt=new Date().toISOString();audit(db,u,'LOGOUT','Kijelentkezés');await writeDB(db)}
      sessions.delete(sid); res.setHeader('Set-Cookie',`rm_session=; HttpOnly; SameSite=Lax; Path=/; Max-Age=0${process.env.NODE_ENV==='production'?'; Secure':''}`);
      return json(res,200,{ok:true});
    }

    if(req.method==='GET' && url==='/api/me'){
      const session=sessionUser(req);
      const fresh=session ? db.users.find(x=>x.id===session.id) : null;
      if(fresh && session){ session.name=fresh.name; session.username=fresh.username; session.role=fresh.role; session.portal=fresh.portal||(fresh.role==='dj'?'dj':'staff'); session.avatar=fresh.avatar||''; }
      return json(res,200,{user:fresh?publicUser(fresh):null});
    }

    if(req.method==='POST' && url==='/api/profile/phone'){
      const session=sessionUser(req); if(!session)return json(res,401,{error:'Bejelentkezés szükséges'});
      const target=db.users.find(x=>x.id===session.id); if(!target)return json(res,401,{error:'A fiók nem található'});
      if(target.phone)return json(res,409,{error:'Ehhez a fiókhoz már tartozik telefonszám. Csak az Owner törölheti.'});
      const b=await readBody(req); const phone=normalizeStaffPhone(b.phone);
      if(!phone)return json(res,400,{error:'Pontosan 7 számjegyet adj meg. A +38-76 előtagot a rendszer automatikusan hozzáadja.'});
      target.phone=phone; audit(db,target,'PHONE_REGISTER',formatStaffPhone(phone)); await writeDB(db);
      return json(res,200,{user:publicUser(target)});
    }

    if(req.method==='DELETE' && url.startsWith('/api/users/') && url.endsWith('/phone')){
      const owner=auth(req,res,'owner'); if(!owner)return;
      const id=decodeURIComponent(url.slice('/api/users/'.length,-'/phone'.length));
      const target=db.users.find(x=>x.id===id); if(!target)return json(res,404,{error:'Felhasználó nem található'});
      if(!target.phone)return json(res,200,{ok:true,user:publicUser(target)});
      const old=formatStaffPhone(target.phone); target.phone='';
      audit(db,owner,'PHONE_CLEAR',`${target.name} · ${old}`); await writeDB(db);
      broadcastRealtime('state'); return json(res,200,{ok:true,user:publicUser(target)});
    }

    // A bejelentkezett dolgozó addig semmilyen Staff/DJ műveletet nem végezhet,
    // amíg az első telefonszám-regisztrációt el nem végezte.
    { const su=sessionUser(req); const phoneGateExempt=(url==='/api/logout'||url==='/api/me'||url==='/api/profile/phone'||url==='/api/reviews'||url.startsWith('/api/reviews/')); if(su&&!phoneGateExempt){ const fresh=db.users.find(x=>x.id===su.id); if(fresh && !fresh.phone) return json(res,428,{error:'Első belépéskor kötelező megadnod a telefonszámodat.',phoneRequired:true}); } }

    // ---------- REALTIME STAFF CHANNEL ----------
    // ---------- RED MOON CLUB PUBLIC REALTIME ----------
    if(req.method==='GET' && url==='/api/club/state'){ return json(res,200,{state:clubState(req)}); }
    if(req.method==='GET' && url==='/api/public/status'){ const open=db.shifts.some(s=>s.status==='open'); return json(res,200,{open}); }
    if(req.method==='GET' && url==='/api/club/events'){
      if(refuseStream(res)) return;
      res.writeHead(200,{'Content-Type':'text/event-stream; charset=utf-8','Cache-Control':'no-cache, no-store, must-revalidate','Connection':'keep-alive','X-Accel-Buffering':'no-store'});
      res.write(`data: ${JSON.stringify({type:'connected',state:clubState(req),at:new Date().toISOString()})}\n\n`);
      const client={res}; clubRealtimeClients.add(client);
      const keepAlive=setInterval(()=>{try{res.write(': keepalive\n\n')}catch{}},20000);
      req.on('close',()=>{clearInterval(keepAlive);clubRealtimeClients.delete(client);try{res.end()}catch{}});
      return;
    }
    if(req.method==='POST' && url==='/api/club/listener'){
      const b=await readBody(req); const id=String(b.id||'').trim(); if(!id)return json(res,400,{error:'Hiányzó listener azonosító'});
      clubListeners.set(id,{lastSeen:Date.now()}); broadcastClubState(); return json(res,200,{ok:true});
    }
    if(req.method==='GET' && url.startsWith('/api/club/name-status')){
      const q=req.rmQuery||new URLSearchParams(); const clientId=String(q.get('clientId')||'').trim();
      if(!clientId)return json(res,400,{error:'Hiányzó kliens azonosító'}); const c=ensureClub(); const ip=getClientIP(req), browserHash=browserHashFromClientId(clientId), now=Date.now();
      const ban=activeBan(ip,browserHash); if(ban)return json(res,200,{status:'banned',until:ban.until,reason:ban.reason||''});
      // The accepted identity is restored only to the same browser, but one public IP may hold only one active approved name.
      const approvedHere=c.approvedNames.find(x=>x.ip===ip&&x.browserHash===browserHash&&x.expiresAt>now);
      if(approvedHere){ const fresh=crypto.randomBytes(32).toString('hex'); approvedHere.tokenHash=crypto.createHash('sha256').update(fresh).digest('hex'); return json(res,200,{status:'accepted',name:approvedHere.name,token:fresh,expiresAt:approvedHere.expiresAt}); }
      const approvedOnIp=c.approvedNames.find(x=>x.ip===ip&&x.expiresAt>now);
      if(approvedOnIp)return json(res,200,{status:'already_named',name:approvedOnIp.name,expiresAt:approvedOnIp.expiresAt});
      const pending=c.nameRequests.find(x=>x.ip===ip&&x.status==='pending');
      if(pending)return json(res,200,{status:'pending',name:pending.name});
      const declined=(c.nameRequests||[]).filter(x=>x.ip===ip&&x.status==='declined').sort((a,b)=>Date.parse(b.handledAt||b.at||0)-Date.parse(a.handledAt||a.at||0))[0];
      if(declined){ const retryAt=Number(declined.retryAt)||Date.parse(declined.handledAt||declined.at||0)+5*60*1000; if(retryAt>now)return json(res,200,{status:'declined',name:declined.name,retryAt}); }
      return json(res,200,{status:'none'});
    }
    if(req.method==='POST' && url==='/api/club/name-request'){
      const b=await readBody(req); const name=String(b.name||'').trim().slice(0,32); const clientId=String(b.clientId||'').trim().slice(0,80);
      if(!name||!clientId)return json(res,400,{error:'Megjelenési név szükséges'});
      const ip=getClientIP(req), browserHash=browserHashFromClientId(clientId), now=Date.now(); const ban=activeBan(ip,browserHash); if(ban)return json(res,403,{error:`A chat tiltva van${ban.until?` ${new Date(ban.until).toLocaleString('hu-HU')}-ig`:''}. Indok: ${ban.reason||'nincs megadva'}`});
      const c=ensureClub();
      const approvedHere=c.approvedNames.find(x=>x.ip===ip&&x.browserHash===browserHash&&x.expiresAt>now);
      if(approvedHere){ const fresh=crypto.randomBytes(32).toString('hex'); approvedHere.tokenHash=crypto.createHash('sha256').update(fresh).digest('hex'); return json(res,200,{approved:true,alreadyNamed:true,token:fresh,name:approvedHere.name}); }
      if(c.approvedNames.some(x=>x.ip===ip&&x.expiresAt>now))return json(res,409,{error:'Már van neved!'});
      if(c.nameRequests.some(x=>x.ip===ip&&x.status==='pending'))return json(res,409,{error:'Te már küldtél be név kérelmet!'});
      const declined=(c.nameRequests||[]).filter(x=>x.ip===ip&&x.status==='declined').sort((a,b)=>Date.parse(b.handledAt||b.at||0)-Date.parse(a.handledAt||a.at||0))[0];
      if(declined){ const retryAt=Number(declined.retryAt)||Date.parse(declined.handledAt||declined.at||0)+5*60*1000; if(retryAt>now){ const seconds=Math.max(1,Math.ceil((retryAt-now)/1000)); return json(res,429,{error:'A neved elutasították. 5 perc múlva tudsz újat kérni!',retryAt,seconds}); } }
      const request={id:crypto.randomUUID(),clientId,browserHash,name,ip,at:new Date().toISOString(),status:'pending'}; c.nameRequests.unshift(request); c.nameRequests=c.nameRequests.slice(0,100); await writeDB(db); broadcastClub('name_request',{request:{id:request.id,clientId,name,at:request.at}}); broadcastClubState(); return json(res,201,{pending:true,requestId:request.id});
    }
    if(req.method==='POST' && url==='/api/club/chat'){
      const b=await readBody(req); const name=String(b.name||'').trim().slice(0,32); const text=String(b.text||'').trim().slice(0,500); const token=cleanNameToken(b.token);
      const djSession=sessionUser(req); const isDJ=djSession?.role==='dj';
      const identity=isDJ?null:approvedIdentity(req,name,token);
      if(!name||!text||(!isDJ&&!identity))return json(res,403,{error:'Előbb kérd a megjelenési neved jóváhagyását a DJ-től.'});
      const ip=getClientIP(req), ban=activeBan(ip,identity?.browserHash||''); if(ban)return json(res,403,{error:`Chat tiltás aktív. Indok: ${ban.reason||'nincs megadva'}`});
      const last=clubListeners.get(`chat:${ip}`)?.lastChat||0; if(Date.now()-last<5000)return json(res,429,{error:`Várj még ${Math.ceil((5000-(Date.now()-last))/1000)} mp-et az új üzenetig.`});
      clubListeners.set(`chat:${ip}`,{lastChat:Date.now(),lastSeen:Date.now()}); const c=ensureClub(); const msg={id:crypto.randomUUID(),at:new Date().toISOString(),name,text,kind:'chat',ip,browserHash:identity?.browserHash||null}; c.chat.unshift(msg); c.chat=c.chat.slice(0,120); await writeDB(db); broadcastClub('chat_message',{message:publicChatMessage(msg)}); broadcastClubState(); return json(res,201,{ok:true});
    }
    if(req.method==='DELETE' && url.startsWith('/api/club/chat/')){
      const u=authDJ(req,res); if(!u)return; const id=decodeURIComponent(url.slice('/api/club/chat/'.length)); const c=ensureClub(); const idx=c.chat.findIndex(x=>x.id===id); if(idx<0)return json(res,404,{error:'Üzenet nem található'}); const [removed]=c.chat.splice(idx,1); audit(db,u,'DJ_CHAT_DELETE',`${removed.name}: ${removed.text}`); await writeDB(db); broadcastClub('chat_deleted',{id}); broadcastClubState(); return json(res,200,{ok:true});
    }
    if(req.method==='POST' && url==='/api/club/request'){
      const b=await readBody(req); const token=cleanNameToken(b.token); const identity=approvedIdentityByToken(req,token); const name=identity?.name||'';
      if(!identity)return json(res,403,{error:'Érvényes névjóváhagyás szükséges'});
      const ip=getClientIP(req), ban=activeBan(ip,identity?.browserHash||''); if(ban)return json(res,403,{error:`Chat tiltás aktív. Indok: ${ban.reason||'nincs megadva'}`});
      const last=clubListeners.get(`request:${ip}`)?.lastRequest||0; if(Date.now()-last<5000)return json(res,429,{error:`Várj még ${Math.ceil((5000-(Date.now()-last))/1000)} mp-et az új kérésig.`});
      const c=ensureClub(); let item=null;
      if(b.trackId) item=(c.library||[]).find(x=>x.id===String(b.trackId))||null;
      if(!item && b.title){ const q=String(b.title).trim().slice(0,120); if(q)item={id:'text_'+crypto.randomUUID(),name:q,url:'',requestOnly:true}; }
      if(!item)return json(res,400,{error:'Válassz egy feltöltött zenét.'});
      const request={id:crypto.randomUUID(),at:new Date().toISOString(),name,ip,browserHash:identity.browserHash||null,item:{id:item.id,name:item.name,url:item.url||''},status:'pending'}; c.requests.unshift(request); c.requests=c.requests.slice(0,100);
      const msg={id:crypto.randomUUID(),at:request.at,name,text:`Zenei kérés: ${item.name}`,kind:'request',requestId:request.id,ip,browserHash:identity.browserHash||null}; c.chat.unshift(msg); c.chat=c.chat.slice(0,120);
      clubListeners.set(`request:${ip}`,{lastRequest:Date.now(),lastSeen:Date.now()}); await writeDB(db); broadcastClub('chat_message',{message:publicChatMessage(msg)}); broadcastClub('music_request',{request:{id:request.id,name,item:item.name}}); broadcastClubState(); return json(res,201,{request});
    }
    if(req.method==='POST' && url==='/api/club/name-decision'){
      const u=authDJ(req,res); if(!u)return; const b=await readBody(req); const id=String(b.id||''); const action=String(b.action||'').toLowerCase(); const c=ensureClub(); const nr=c.nameRequests.find(x=>x.id===id); if(!nr)return json(res,404,{error:'Névkérelem nem található'}); if(!['accept','decline'].includes(action))return json(res,400,{error:'Érvénytelen művelet'});
      nr.status=action==='accept'?'accepted':'declined'; nr.handledBy=u.name; nr.handledAt=new Date().toISOString(); nr.retryAt=action==='decline'?Date.now()+5*60*1000:null; let token=null;
      if(action==='accept'){ token=crypto.randomBytes(32).toString('hex'); c.approvedNames=c.approvedNames.filter(x=>!(x.ip===nr.ip&&x.expiresAt>Date.now())); c.approvedNames.push({tokenHash:crypto.createHash('sha256').update(token).digest('hex'),name:nr.name,ip:nr.ip,browserHash:nr.browserHash||browserHashFromClientId(nr.clientId),approvedAt:nr.handledAt,expiresAt:Date.now()+3*24*60*60*1000}); }
      await writeDB(db); broadcastClub('name_decision',{clientId:nr.clientId,accepted:action==='accept',name:nr.name,token,retryAt:nr.retryAt}); broadcastClubState(); return json(res,200,{ok:true,retryAt:nr.retryAt,state:clubState(req)});
    }
    if(req.method==='POST' && url==='/api/club/listener-action'){
      const u=authDJ(req,res); if(!u)return;
      const b=await readBody(req), action=String(b.action||'').toLowerCase();
      const ip=String(b.ip||'').trim().replace(/^::ffff:/,'').replace(/^\[|\]$/g,'');
      const browserHash=String(b.browserHash||'').trim().slice(0,128);
      const c=ensureClub();
      const idx=(c.approvedNames||[]).findIndex(x=>x.ip===ip && x.browserHash===browserHash && x.expiresAt>Date.now());
      if(idx<0)return json(res,404,{error:'A regisztrált hallgató nem található.'});
      const identity=c.approvedNames[idx];
      if(action==='delete'){
        c.approvedNames.splice(idx,1);
        c.nameRequests=(c.nameRequests||[]).filter(x=>!(x.ip===ip && (x.browserHash||browserHashFromClientId(x.clientId))===browserHash));
        c.bans=(c.bans||[]).filter(x=>!(x.ip===ip && (!x.browserHash || x.browserHash===browserHash)));
        audit(db,u,'DJ_LISTENER_DELETE',identity.name);
        await writeDB(db); broadcastClubState();
        return json(res,200,{ok:true,state:clubState(req)});
      }
      if(action==='rename'){
        const name=String(b.name||'').trim().slice(0,32);
        if(!name)return json(res,400,{error:'Az új név nem lehet üres.'});
        const duplicate=(c.approvedNames||[]).some((x,i)=>i!==idx && x.name.toLowerCase()===name.toLowerCase() && x.expiresAt>Date.now());
        if(duplicate)return json(res,409,{error:'Ez a megjelenési név már használatban van.'});
        const old=identity.name; identity.name=name;
        for(const nr of (c.nameRequests||[])){
          const bh=nr.browserHash||browserHashFromClientId(nr.clientId);
          if(nr.ip===ip && bh===browserHash)nr.name=name;
        }
        audit(db,u,'DJ_LISTENER_RENAME',`${old} -> ${name}`);
        await writeDB(db); broadcastClubState();
        return json(res,200,{ok:true,state:clubState(req)});
      }
      return json(res,400,{error:'Ismeretlen hallgató művelet.'});
    }

    if(req.method==='POST' && url==='/api/club/ban'){
      const u=authDJ(req,res); if(!u)return;
      const b=await readBody(req);
      const ip=String(b.ip||'').trim().replace(/^::ffff:/,'').replace(/^\[|\]$/g,'');
      const browserHash=String(b.browserHash||'').trim().slice(0,128);
      const allowedMinutes=[5,15,30,60,1440]; const requested=Number(b.minutes)||60; const minutes=allowedMinutes.includes(requested)?requested:60;
      const reason=String(b.reason||'').trim().slice(0,240);
      if(!ip||ip==='unknown'||!browserHash||!reason)return json(res,400,{error:'Érvényes IP + böngésző azonosító és indok kötelező'});
      const c=ensureClub();
      const until=Date.now()+minutes*60000;
      c.bans=c.bans.filter(x=>!(x.ip===ip&&x.browserHash===browserHash));
      c.bans.push({id:crypto.randomUUID(),ip,browserHash,until,minutes,reason,by:u.name,at:new Date().toISOString()});
      await writeDB(db);
      broadcastClub('user_banned',{ip,until,reason,by:u.name});
      broadcastClubState();
      return json(res,200,{ok:true,ip,browserHash,until,minutes,state:clubState(req)});
    }
    // ---------- DJ CONSOLE ----------
    if(req.method==='GET' && url==='/api/dj/state'){ const u=authDJ(req,res); if(!u)return; const c=ensureClub(); const st=clubState(req); purgeExpiredChat(); st.chat=(c.chat||[]).slice(0,8).map(djChatMessage); st.requests=(c.requests||[]).slice(0,100).map(r=>({...r,ip:r.ip||null})); st.nameRequests=(c.nameRequests||[]).slice(0,80); return json(res,200,{state:st,me:publicUser(db.users.find(x=>x.id===u.id)||u)}); }
    if(req.method==='GET' && url==='/api/dj/events'){
      const u=authDJ(req,res); if(!u)return;
      if(refuseStream(res)) return;
      res.writeHead(200,{'Content-Type':'text/event-stream; charset=utf-8','Cache-Control':'no-cache, no-store, must-revalidate','Connection':'keep-alive','X-Accel-Buffering':'no-store'});
      res.write(`data: ${JSON.stringify({type:'connected',state:clubState(req),at:new Date().toISOString()})}\n\n`);
      const client={res,userId:u.id}; clubRealtimeClients.add(client);
      const keepAlive=setInterval(()=>{try{res.write(': keepalive\n\n')}catch{}},20000);
      req.on('close',()=>{clearInterval(keepAlive);clubRealtimeClients.delete(client);try{res.end()}catch{}});
      return;
    }
    if(req.method==='POST' && url==='/api/dj/live'){
      const u=authDJ(req,res); if(!u)return; const b=await readBody(req); const c=ensureClub();
      const on=!!b.live; c.live=on; c.dj=on?{id:u.id,name:u.name}:null; c.title=on?String(b.title||'Red Moon Live').trim().slice(0,80):''; c.startedAt=on?new Date().toISOString():null;
      if(!on){c.current=null;c.queue=[];} audit(db,u,on?'DJ_LIVE_START':'DJ_LIVE_STOP',on?c.title:'Live leállítva'); await writeDB(db); broadcastClub('live_status',{live:on,dj:on?{id:u.id,name:u.name}:null,title:on?db.club.title:''}); broadcastClubState(); return json(res,200,{state:clubState()});
    }
    if(req.method==='POST' && url==='/api/dj/upload'){
      const u=authDJ(req,res); if(!u)return;
      try{
        const file=await readMultipartAudio(req); if(!file.filename||!extAllowed(file.filename))return json(res,400,{error:'Csak MP3, WAV, OGG, M4A, AAC vagy WEBM hangfájl tölthető fel.'});
        if(file.data.length<1000)return json(res,400,{error:'A feltöltött fájl üres vagy hibás.'});
        const id='track_'+crypto.randomBytes(8).toString('hex'); const safe=`${id}_${sanitizeFilename(file.filename)}`;
        // Bucket when Supabase is configured (required on Vercel, where the
        // filesystem is read-only), local disk otherwise.
        let storedUrl;
        if(bucketStorageEnabled()){
          const contentType=AUDIO_CONTENT_TYPES[path.extname(safe).toLowerCase()]||'application/octet-stream';
          storedUrl=await bucketUpload(safe,file.data,contentType);
        }else{
          fs.writeFileSync(path.join(ensureMusicDir(),safe),file.data);
          storedUrl=`assets/dj-music/${safe}`;
        }
        const item={id,name:sanitizeFilename(file.filename).replace(/\.[^.]+$/,''),url:storedUrl,size:file.data.length,addedAt:new Date().toISOString(),addedBy:u.name}; const c=ensureClub(); c.library.unshift(item); c.library=c.library.slice(0,200); await writeDB(db); broadcastClubState(); return json(res,201,{track:item,state:clubState()});
      }catch(e){ return json(res,400,{error:e.message||'Feltöltési hiba'}); }
    }
    if(req.method==='DELETE' && url.startsWith('/api/dj/library/')){
      const u=authDJ(req,res); if(!u)return; const id=decodeURIComponent(url.slice('/api/dj/library/'.length)); const c=ensureClub(); const idx=(c.library||[]).findIndex(x=>x.id===id); if(idx<0)return json(res,404,{error:'A zene nem található'}); const [item]=c.library.splice(idx,1);
      const bucketKey=bucketKeyFromUrl(item.url);
      if(bucketKey){ await bucketDelete(bucketKey); }
      else { try{fs.unlinkSync(path.join(PUBLIC,item.url.replace(/^assets\//,'assets/')))}catch{} }
      c.queue=(c.queue||[]).filter(x=>x.trackId!==id); if(c.current?.id===id)c.current=null; await writeDB(db); broadcastClubState(); return json(res,200,{ok:true});
    }
    if(req.method==='POST' && url==='/api/dj/queue'){
      const u=authDJ(req,res); if(!u)return; const b=await readBody(req); const item=ensureClub().library.find(x=>x.id===String(b.trackId)); if(!item)return json(res,404,{error:'A feltöltött zene nem található'});
      const q={...item,trackId:item.id,id:crypto.randomUUID(),addedBy:u.name,addedAt:new Date().toISOString()}; ensureClub().queue.push(q); ensureClub().queue=ensureClub().queue.slice(-50); await writeDB(db); broadcastClubState(); return json(res,201,{item:q,state:clubState()});
    }
    if(req.method==='POST' && url==='/api/dj/play'){
      const u=authDJ(req,res); if(!u)return; const b=await readBody(req); const c=ensureClub(); let item=null;
      if(b.queueId)item=(c.queue||[]).find(x=>x.id===String(b.queueId))||null; else if(b.trackId)item=(c.library||[]).find(x=>x.id===String(b.trackId))||null;
      if(!item)return json(res,404,{error:'A lejátszandó zene nem található'});
      c.current={id:item.id,trackId:item.trackId||item.id,name:item.name,url:item.url,addedBy:item.addedBy||u.name,playbackPosition:0,playbackPlaying:true,playbackAt:Date.now()}; c.live=true; c.dj={id:u.id,name:u.name}; c.startedAt=new Date().toISOString(); c.queue=(c.queue||[]).filter(x=>x.id!==item.id); audit(db,u,'DJ_TRACK_START',item.name); await writeDB(db); broadcastClub('player_sync',{serverNow:Date.now(),sync:{id:c.current.id,trackId:c.current.trackId,url:c.current.url,name:c.current.name,position:0,playing:true,at:c.current.playbackAt}}); broadcastClubState(); return json(res,200,{state:clubState()});
    }
    if(req.method==='POST' && url==='/api/dj/control'){
      const u=authDJ(req,res); if(!u)return; const b=await readBody(req); const c=ensureClub(); if(!c.current)return json(res,400,{error:'Nincs lejátszott zene'});
      const action=String(b.action||''); const currentPos=Number.isFinite(Number(b.position))?Math.max(0,Number(b.position)):Number(c.current.playbackPosition)||0;
      if(action==='play'){c.current.playbackPosition=currentPos;c.current.playbackPlaying=true;c.current.playbackAt=Date.now();}
      else if(action==='pause'){c.current.playbackPosition=currentPos;c.current.playbackPlaying=false;c.current.playbackAt=null;}
      else if(action==='seek'){c.current.playbackPosition=currentPos;c.current.playbackAt=c.current.playbackPlaying?Date.now():null;}
      else if(action==='next'){const n=c.queue.shift(); if(!n){c.current=null;} else {c.current={id:n.id,trackId:n.trackId||n.id,name:n.name,url:n.url,addedBy:n.addedBy||u.name,playbackPosition:0,playbackPlaying:true,playbackAt:Date.now()};}}
      else return json(res,400,{error:'Ismeretlen lejátszó művelet'});
      await writeDB(db); broadcastClub('player_sync',{serverNow:Date.now(),sync:{id:c.current?.id||null,trackId:c.current?.trackId||null,url:c.current?.url||null,name:c.current?.name||null,position:c.current?Number(c.current.playbackPosition)||0:0,playing:!!c.current?.playbackPlaying,at:c.current?.playbackAt||Date.now()}}); broadcastClubState(); return json(res,200,{state:clubState()});
    }
    if(req.method==='POST' && url==='/api/dj/player-sync'){
      const u=authDJ(req,res); if(!u)return; const b=await readBody(req); const c=ensureClub(); if(!c.current)return json(res,200,{state:clubState()});
      const pos=Math.max(0,Number(b.position)||0); c.current.playbackPosition=pos; c.current.playbackPlaying=!!b.playing; c.current.playbackAt=c.current.playbackPlaying?Date.now():null; await writeDB(db); broadcastClub('player_sync',{serverNow:Date.now(),sync:{id:c.current.id,trackId:c.current.trackId,url:c.current.url,name:c.current.name,position:pos,playing:c.current.playbackPlaying,at:c.current.playbackAt||Date.now()}}); return json(res,200,{state:clubState()});
    }
    if(req.method==='POST' && url==='/api/dj/chat'){
      const u=authDJ(req,res); if(!u)return; const b=await readBody(req); const text=String(b.text||'').trim().slice(0,500);
      if(!text)return json(res,400,{error:'Az üzenet nem lehet üres.'});
      const c=ensureClub(); const msg={id:crypto.randomUUID(),at:new Date().toISOString(),name:u.name,text,kind:'dj'};
      c.chat.unshift(msg); purgeExpiredChat(); await writeDB(db); broadcastClub('chat_message',{message:publicChatMessage(msg)}); broadcastClubState(); return json(res,201,{ok:true,state:clubState()});
    }
    if(req.method==='POST' && url==='/api/dj/request'){
      const u=authDJ(req,res); if(!u)return; const b=await readBody(req); const id=String(b.id||''); const reqItem=(db.club?.requests||[]).find(x=>x.id===id); if(!reqItem)return json(res,404,{error:'Kérés nem található'});
      const action=String(b.action||'').toLowerCase(); if(!['accept','decline'].includes(action))return json(res,400,{error:'Érvénytelen művelet'}); reqItem.status=action==='accept'?'accepted':'declined'; reqItem.handledBy=u.name; reqItem.handledAt=new Date().toISOString();
      if(action==='accept' && reqItem.item?.id){ const lib=(db.club.library||[]).find(x=>x.id===reqItem.item.id); if(lib){const item={...lib,trackId:lib.id,id:crypto.randomUUID(),addedBy:reqItem.name,requestId:reqItem.id,addedAt:reqItem.handledAt}; db.club.queue.push(item); db.club.queue=db.club.queue.slice(-50);}}
      db.club.chat.unshift({id:crypto.randomUUID(),at:new Date().toISOString(),name:'Red Moon',text:action==='accept'?`${u.name} elfogadta a kérést: ${reqItem.item.name}`:`${u.name} elutasította a kérést: ${reqItem.item.name}`,kind:action==='accept'?'request-accepted':'request-declined',requestId:reqItem.id,ip:reqItem.ip||null,browserHash:reqItem.browserHash||null}); db.club.chat=db.club.chat.slice(0,120); await writeDB(db); broadcastClubState(); return json(res,200,{state:clubState()});
    }
    if(req.method==='DELETE' && url.startsWith('/api/dj/request/')){
      const u=authDJ(req,res); if(!u)return; const id=decodeURIComponent(url.slice('/api/dj/request/'.length)); const c=ensureClub(); const idx=c.requests.findIndex(x=>x.id===id); if(idx<0)return json(res,404,{error:'Kérés nem található'}); const [removed]=c.requests.splice(idx,1); c.chat=(c.chat||[]).filter(m=>m.requestId!==id); audit(db,u,'DJ_REQUEST_DELETE',`${removed.name}: ${removed.item?.name||''}`); await writeDB(db); broadcastClub('request_deleted',{id}); broadcastClubState(); return json(res,200,{ok:true,state:clubState()});
    }

    if(req.method==='GET' && url==='/api/events'){
      const u=auth(req,res); if(!u)return;
      if(refuseStream(res)) return;
      res.writeHead(200,{
        'Content-Type':'text/event-stream; charset=utf-8',
        'Cache-Control':'no-cache, no-store, must-revalidate',
        'Connection':'keep-alive',
        'X-Accel-Buffering':'no'
      });
      res.write(`data: ${JSON.stringify({type:'connected',at:new Date().toISOString()})}\n\n`);
      const client={res,userId:u.id};
      realtimeClients.add(client);
      const keepAlive=setInterval(()=>{try{res.write(': keepalive\\n\\n')}catch{}},20000);
      req.on('close',()=>{clearInterval(keepAlive);realtimeClients.delete(client);try{res.end()}catch{}});
      return;
    }

    if(req.method==='POST' && url==='/api/presence/heartbeat'){
      const u=auth(req,res); if(!u)return;
      const sid=parseCookies(req).rm_session;
      const session=sid&&sessions.get(sid);
      const nowMs=Date.now();
      const nowIso=new Date(nowMs).toISOString();
      if(session){
        session.lastSeen=nowMs;
        const account=db.users.find(x=>x.id===session.id);
        // Persist activity at most once per minute so presence stays cheap on PostgreSQL.
        if(account && (!account.lastActiveAt || nowMs-Date.parse(account.lastActiveAt)>=60000)){
          account.lastActiveAt=nowIso;
          session.lastPersistedActive=nowMs;
          await writeDB(db);
        }
      }
      broadcastRealtime('presence');
      return json(res,200,{ok:true,at:nowIso});
    }

    if(req.method==='GET' && url==='/api/presence'){
      const u=auth(req,res); if(!u)return;
      const online=onlineUsers();
      return json(res,200,{online,onlineCount:online.length,generatedAt:new Date().toISOString()});
    }

    if(req.method==='GET' && url==='/api/products'){
      const u=auth(req,res); if(!u)return;
      db.products=(db.products||[]).map(p=>({...p,section:inferProductSection(p)}));
      return json(res,200,{products:db.products});
    }
    if(req.method==='GET' && url==='/api/public-products'){
      // `section` is additive (the old frontend ignores it) and lets the menu page filter by category.
      return json(res,200,{products:(db.products||[]).filter(x=>x.active&&x.category==='drink').map(x=>({id:x.id,name:x.name,price:x.price,image:x.image||'',subtitle:x.subtitle||'',section:inferProductSection(x)}))});
    }

    if(req.method==='GET' && url==='/api/dashboard'){
      const u=auth(req,res); if(!u)return;
      const today=new Date().toISOString().slice(0,10);
      const todaySales=db.sales.filter(s=>s.at.slice(0,10)===today);
      const revenue=todaySales.reduce((a,s)=>a+s.total,0);
      const items=todaySales.reduce((a,s)=>a+s.qty,0);
      const low=db.products.filter(p=>p.active&&p.stock<=p.minStock);
      const byProduct={}; todaySales.forEach(s=>byProduct[s.productId]=(byProduct[s.productId]||0)+s.qty);
      const top=Object.entries(byProduct).map(([id,qty])=>({product:db.products.find(p=>p.id===id)?.name||id,qty})).sort((a,b)=>b.qty-a.qty).slice(0,6);
      const openShift=db.shifts.find(s=>s.status==='open')||null;
      const overall=Math.max(0,Number(db.finance?.overallRevenue||0)-Number(db.finance?.overallRevenueOffset||0)); return json(res,200,{today:{revenue,items,salesCount:todaySales.length},overallRevenue:overall,lowStock:low,topSales:top,recentSales:db.sales.slice(0,20),openShift});
    }

    // ---------- PUBLIC REVIEWS ----------
    // One review per IP + browser token. The raw IP/token are never stored on a review.
    const reviewToken=String(req.headers['x-review-token']||'').trim().slice(0,200);
    const reviewFingerprint=reviewToken ? crypto.createHash('sha256').update(`${getClientIP(req)}|${reviewToken}`).digest('hex') : '';
    const publicReview=x=>({id:x.id,name:x.name,rating:x.rating,text:x.text,phone:formatStaffPhone(x.phone||''),at:x.at,status:x.status,isOwn:!!reviewFingerprint&&x.visitorHash===reviewFingerprint});
    if(req.method==='GET' && url==='/api/reviews'){
      const reviews=(db.reviews||[]).filter(x=>x.status!=='hidden').slice(0,100);
      const total=reviews.reduce((a,x)=>a+Number(x.rating||0),0);
      return json(res,200,{reviews:reviews.map(publicReview),average:reviews.length?Math.round((total/reviews.length)*10)/10:0,count:reviews.length,hasOwnReview:reviews.some(x=>reviewFingerprint&&x.visitorHash===reviewFingerprint)});
    }
    if(req.method==='POST' && url==='/api/reviews'){
      const b=await readBody(req); const token=String(b.visitorToken||reviewToken||'').trim().slice(0,200);
      if(!token)return json(res,400,{error:'A böngészőazonosító hiányzik. Frissítsd az oldalt és próbáld újra.'});
      const fingerprint=crypto.createHash('sha256').update(`${getClientIP(req)}|${token}`).digest('hex');
      if((db.reviews||[]).some(x=>x.visitorHash===fingerprint))return json(res,409,{error:'Tőled már érkezett vélemény!'});
      const name=String(b.name||'').trim().slice(0,80); const rating=Math.round(Number(b.rating)); const text=[...String(b.text||'').trim()].slice(0,140).join(''); const phoneRaw=String(b.phone||'').trim(); const phoneDigits=phoneRaw.replace(/\D/g,''); const phone=phoneDigits&&phoneDigits!=='3876'?normalizeStaffPhone(phoneRaw):'';
      if(!name||!Number.isInteger(rating)||rating<1||rating>5||!text)return json(res,400,{error:'Név, 1–5 csillag és szöveges vélemény kötelező.'});
      if(phoneDigits&&phoneDigits!=='3876'&&!phone)return json(res,400,{error:'Az opcionális telefonszámhoz 7 számjegyet adj meg.'});
      const review={id:crypto.randomUUID(),name,rating,text,phone,at:new Date().toISOString(),updatedAt:null,status:'published',visitorHash:fingerprint}; db.reviews.unshift(review); db.reviews=db.reviews.slice(0,300); await writeDB(db); return json(res,201,{review:publicReview(review)});
    }
    if(req.method==='PATCH' && url.startsWith('/api/reviews/')){
      const logged=sessionUser(req); if(logged?.role==='owner')return json(res,403,{error:'Az Owner a vendégvéleményeket nem szerkesztheti.'});
      const id=decodeURIComponent(url.split('/').pop()); const review=(db.reviews||[]).find(x=>x.id===id);
      if(!review)return json(res,404,{error:'A vélemény nem található'});
      const b=await readBody(req); const token=String(b.visitorToken||reviewToken||'').trim().slice(0,200); const fingerprint=token?crypto.createHash('sha256').update(`${getClientIP(req)}|${token}`).digest('hex'):'';
      if(!fingerprint||review.visitorHash!==fingerprint)return json(res,403,{error:'Csak a saját véleményedet szerkesztheted.'});
      const name=String(b.name||'').trim().slice(0,80); const rating=Math.round(Number(b.rating)); const text=[...String(b.text||'').trim()].slice(0,140).join(''); const phoneRaw=String(b.phone||'').trim(); const phoneDigits=phoneRaw.replace(/\D/g,''); const phone=phoneDigits&&phoneDigits!=='3876'?normalizeStaffPhone(phoneRaw):'';
      if(!name||!Number.isInteger(rating)||rating<1||rating>5||!text)return json(res,400,{error:'Név, 1–5 csillag és szöveges vélemény kötelező.'});
      if(phoneDigits&&phoneDigits!=='3876'&&!phone)return json(res,400,{error:'Az opcionális telefonszámhoz 7 számjegyet adj meg.'});
      review.name=name; review.rating=rating; review.text=text; review.phone=phone; review.updatedAt=new Date().toISOString(); await writeDB(db); return json(res,200,{review:publicReview(review)});
    }
    if(req.method==='DELETE' && url.startsWith('/api/reviews/')){
      const id=decodeURIComponent(url.split('/').pop()); const idx=(db.reviews||[]).findIndex(x=>x.id===id);
      if(idx<0)return json(res,404,{error:'A vélemény nem található'});
      const logged=sessionUser(req); let owner=null;
      if(logged?.role==='owner' && (logged.portal||'staff')==='staff') owner=logged;
      if(!owner){
        const b=await readBody(req); const token=String(b.visitorToken||reviewToken||'').trim().slice(0,200); const fingerprint=token?crypto.createHash('sha256').update(`${getClientIP(req)}|${token}`).digest('hex'):'';
        if(!fingerprint||db.reviews[idx].visitorHash!==fingerprint)return json(res,403,{error:'Csak a saját véleményedet törölheted.'});
      }
      const review=db.reviews[idx]; db.reviews.splice(idx,1);
      if(owner) audit(db,owner,'REVIEW_DELETE',`${review.name} · ${review.rating}/5 · ${review.text}`);
      await writeDB(db); return json(res,200,{ok:true,deletedReviewId:id});
    }

    // ---------- TABLE RESERVATIONS ----------
    // The guest side is anonymous: a booking is tied to a hash of the client IP
    // and a token the browser keeps, never to an account. That is enough to let
    // somebody find and cancel their own booking without ever making them
    // register, and enough to stop the form being used as a spam cannon.
    if(req.method==='GET' && url==='/api/public-reservation-info'){
      return json(res,200,{
        occasions:RESERVATION_OCCASIONS,
        tiers:RESERVATION_TIERS,
        maxGuests:20,
        maxDaysAhead:RESERVATION_MAX_DAYS,
        maxOpen:RESERVATION_MAX_OPEN,
        serverNow:new Date().toISOString()
      });
    }

    if(req.method==='GET' && url==='/api/reservations/mine'){
      const token=String(req.rmQuery?.get('token')||'').trim().slice(0,200);
      if(!token) return json(res,200,{reservations:[]});
      const fingerprint=visitorFingerprint(req,token);
      const mine=(db.reservations||[]).filter(x=>x.visitorHash===fingerprint).slice(0,20).map(publicReservation);
      return json(res,200,{reservations:mine});
    }

    if(req.method==='POST' && url==='/api/reservations'){
      const b=parseBody(res,reservationCreateSchema,await readBody(req)); if(!b)return;

      const when=new Date(b.at);
      if(Number.isNaN(when.getTime())) return json(res,400,{error:'Érvénytelen időpont.'});
      if(when.getTime() < Date.now()+30*60000) return json(res,400,{error:'Legalább fél órával előbbre foglalj.'});
      if(when.getTime() > Date.now()+RESERVATION_MAX_DAYS*86400000) return json(res,400,{error:`Legfeljebb ${RESERVATION_MAX_DAYS} nappal előre lehet foglalni.`});

      const phone=normalizeStaffPhone(b.phone);
      if(!phone) return json(res,400,{error:'A telefonszám 7 számjegyű legyen.'});

      const fingerprint=visitorFingerprint(req,b.visitorToken);
      db.reservations ||= [];
      const open=db.reservations.filter(x=>x.visitorHash===fingerprint && ['pending','confirmed'].includes(x.status));
      if(open.length>=RESERVATION_MAX_OPEN){
        return json(res,429,{error:`Egyszerre legfeljebb ${RESERVATION_MAX_OPEN} élő foglalásod lehet. Mondj le egyet, mielőtt újat kérsz.`});
      }

      const reservation={
        id:crypto.randomUUID(),
        code:makeReservationCode(),
        at:new Date().toISOString(),
        when:when.toISOString(),
        name:b.name, phone, guests:b.guests,
        occasion:b.occasion, tier:b.tier, note:b.note,
        status:'pending',
        handledAt:null, handledByName:null, staffNote:'',
        visitorHash:fingerprint
      };
      db.reservations.unshift(reservation);
      db.reservations=db.reservations.slice(0,500);
      notifyManagersOwners(db,'Új asztalfoglalás',`${reservation.name} · ${reservation.guests} fő · ${new Date(reservation.when).toLocaleString('hu-HU')} · ${reservation.code}`,{reservationId:reservation.id});
      await writeDB(db);
      broadcastRealtime('reservations');
      return json(res,201,{reservation:publicReservation(reservation)});
    }

    if(req.method==='GET' && url==='/api/reservations'){
      const u=auth(req,res); if(!u)return;
      return json(res,200,{reservations:(db.reservations||[]).slice(0,300).map(staffReservation)});
    }

    if(req.method==='PATCH' && url.startsWith('/api/reservations/')){
      const u=auth(req,res,'manager'); if(!u)return;
      const id=decodeURIComponent(url.slice('/api/reservations/'.length));
      const reservation=(db.reservations||[]).find(x=>x.id===id);
      if(!reservation) return json(res,404,{error:'A foglalás nem található.'});
      const b=parseBody(res,reservationUpdateSchema,await readBody(req)); if(!b)return;
      reservation.status=b.status;
      reservation.staffNote=b.staffNote;
      reservation.handledAt=new Date().toISOString();
      reservation.handledByName=u.name;
      audit(db,u,'RESERVATION_UPDATE',`${reservation.code} · ${reservation.name} · ${b.status}`);
      await writeDB(db);
      broadcastRealtime('reservations');
      return json(res,200,{reservation:staffReservation(reservation)});
    }

    if(req.method==='DELETE' && url.startsWith('/api/reservations/')){
      const id=decodeURIComponent(url.slice('/api/reservations/'.length));
      const reservation=(db.reservations||[]).find(x=>x.id===id);
      if(!reservation) return json(res,404,{error:'A foglalás nem található.'});

      // A manager may cancel anything; a guest only their own, proven by the
      // same IP and browser token that created it.
      const staffUser=sessionUser(req);
      const isManager=staffUser && (staffUser.portal||'staff')==='staff' && roleAtLeast(staffUser.role,'manager');
      if(!isManager){
        const b=await readBody(req).catch(()=>({}));
        const token=String(b.visitorToken||'').trim().slice(0,200);
        if(!token || reservation.visitorHash!==visitorFingerprint(req,token)){
          return json(res,403,{error:'Csak a saját foglalásodat mondhatod le.'});
        }
      }
      reservation.status='cancelled';
      reservation.handledAt=new Date().toISOString();
      reservation.handledByName=isManager?staffUser.name:'Vendég';
      if(isManager) audit(db,staffUser,'RESERVATION_CANCEL',`${reservation.code} · ${reservation.name}`);
      await writeDB(db);
      broadcastRealtime('reservations');
      return json(res,200,{ok:true,reservation:publicReservation(reservation)});
    }

    // ---------- ANALYTICS ----------
    // Everything the dashboards and profiles read. Kept as three endpoints
    // rather than one per widget: a console screen wants the whole picture at
    // once, and one round trip beats eight.

    /** Own activity: what a person did, earned and is owed. Anybody signed in. */
    if(req.method==='GET' && url==='/api/analytics/me'){
      const u=auth(req,res); if(!u)return;
      return json(res,200,personalAnalytics(u.id));
    }

    /** One employee's activity, for a manager reading the team. */
    if(req.method==='GET' && url.startsWith('/api/analytics/staff/')){
      const u=auth(req,res,'manager'); if(!u)return;
      const id=decodeURIComponent(url.slice('/api/analytics/staff/'.length));
      const target=(db.users||[]).find(x=>x.id===id);
      if(!target) return json(res,404,{error:'A dolgozó nem található.'});
      return json(res,200,{user:publicUser(target),...personalAnalytics(id)});
    }

    /** Stock burn rate and days-to-empty. Manager and above. */
    if(req.method==='GET' && url==='/api/analytics/storage'){
      const u=auth(req,res,'manager'); if(!u)return;
      return json(res,200,storageAnalytics());
    }

    /** The whole business: revenue, expense, profit, trend. Owner only. */
    if(req.method==='GET' && url==='/api/analytics/business'){
      const u=auth(req,res,'owner'); if(!u)return;
      return json(res,200,businessAnalytics());
    }

    // ---------- SUPPLY ORDERS ----------
    if(req.method==='GET' && url==='/api/orders'){
      const u=auth(req,res); if(!u)return;
      return json(res,200,{
        orders:(db.orders||[]).slice(0,300),
        canCreate:roleAtLeast(u.role,'manager'),
        canRun:canRunOrders(u)
      });
    }

    if(req.method==='POST' && url==='/api/orders'){
      const u=auth(req,res,'manager'); if(!u)return;
      const b=parseBody(res,orderCreateSchema,await readBody(req)); if(!b)return;

      const items=[];
      for(const line of b.items){
        const product=(db.products||[]).find(x=>x.id===line.productId && x.active!==false);
        if(!product) return json(res,404,{error:`Ismeretlen termék: ${line.productId}`});
        const existing=items.find(x=>x.productId===product.id);
        if(existing){ existing.qty+=line.qty; existing.lineEstimate=existing.qty*existing.unitCost; continue; }
        items.push({
          productId:product.id, product:product.name,
          qty:line.qty, unitCost:line.unitCost, lineEstimate:line.qty*line.unitCost
        });
      }

      const order={
        id:crypto.randomUUID(),
        code:makeOrderCode(),
        at:new Date().toISOString(),
        createdById:u.id, createdByName:u.name,
        items,
        estimatedTotal:items.reduce((sum,x)=>sum+x.lineEstimate,0),
        source:b.source, note:b.note,
        status:'open',
        claimedById:null, claimedByName:null, claimedAt:null,
        startedAt:null,
        completedById:null, completedByName:null, completedAt:null,
        actualTotal:null, variance:null, varianceNote:''
      };
      db.orders ||= [];
      db.orders.unshift(order);
      db.orders=db.orders.slice(0,500);
      audit(db,u,'ORDER_CREATE',`${order.code} · ${items.length} tétel · becsült ${order.estimatedTotal} Ft`);
      notifyAudience(db,['manager','owner'],'Új beszerzés',`${order.code} · ${items.length} tétel · becsült ${order.estimatedTotal} Ft`,{orderId:order.id});
      await writeDB(db);
      broadcastRealtime('orders');
      return json(res,201,{order});
    }

    if(req.method==='POST' && url.startsWith('/api/orders/') && url.endsWith('/claim')){
      const u=auth(req,res); if(!u)return;
      if(!canRunOrders(u)) return json(res,403,{error:'Beszerzést biztonsági vagy üzletvezetői jogosultsággal lehet elvállalni.'});
      const order=findOrder(url,'/claim'); if(!order)return json(res,404,{error:'A beszerzés nem található.'});
      if(order.status!=='open') return json(res,409,{error:'Ezt a beszerzést már elvállalták.'});
      order.status='claimed';
      order.claimedById=u.id; order.claimedByName=u.name; order.claimedAt=new Date().toISOString();
      audit(db,u,'ORDER_CLAIM',order.code);
      await writeDB(db);
      broadcastRealtime('orders');
      return json(res,200,{order});
    }

    if(req.method==='POST' && url.startsWith('/api/orders/') && url.endsWith('/start')){
      const u=auth(req,res); if(!u)return;
      const order=findOrder(url,'/start'); if(!order)return json(res,404,{error:'A beszerzés nem található.'});
      if(order.claimedById!==u.id && !roleAtLeast(u.role,'manager')) return json(res,403,{error:'Csak az veheti fel, aki elvállalta.'});
      if(order.status!=='claimed') return json(res,409,{error:'Ez a beszerzés nincs elvállalt állapotban.'});
      order.status='progress';
      order.startedAt=new Date().toISOString();
      audit(db,u,'ORDER_START',order.code);
      await writeDB(db);
      broadcastRealtime('orders');
      return json(res,200,{order});
    }

    if(req.method==='POST' && url.startsWith('/api/orders/') && url.endsWith('/complete')){
      const u=auth(req,res); if(!u)return;
      const order=findOrder(url,'/complete'); if(!order)return json(res,404,{error:'A beszerzés nem található.'});
      if(order.claimedById!==u.id && !roleAtLeast(u.role,'manager')) return json(res,403,{error:'Csak az zárhatja le, aki elvállalta.'});
      if(!['claimed','progress'].includes(order.status)) return json(res,409,{error:'Ez a beszerzés már lezárult.'});
      const b=parseBody(res,orderCompleteSchema,await readBody(req)); if(!b)return;

      // The stock only moves now, when the goods are physically in the store
      // room — an order that is claimed but never completed must not inflate it.
      db.restockLogs ||= [];
      const now=new Date().toISOString();
      for(const line of order.items){
        const product=(db.products||[]).find(x=>x.id===line.productId);
        if(!product) continue;
        product.stock=(Number(product.stock)||0)+line.qty;
        db.restockLogs.unshift({
          id:crypto.randomUUID(), at:now,
          userId:u.id, user:u.name,
          productId:product.id, product:product.name,
          qty:line.qty, unitCost:line.unitCost, totalCost:line.lineEstimate,
          source:order.source||'Beszerzés', note:`${order.code} beszerzés`, orderId:order.id
        });
      }
      db.restockLogs=db.restockLogs.slice(0,1000);

      order.status='completed';
      order.completedById=u.id; order.completedByName=u.name; order.completedAt=now;
      order.actualTotal=b.actualTotal;
      order.variance=b.actualTotal-order.estimatedTotal;
      order.varianceNote=b.varianceNote;

      recordExpense(db,{
        kind:'order', ref:order.code, amount:b.actualTotal,
        byId:u.id, byName:u.name,
        note:`${order.items.length} tétel · becsült ${order.estimatedTotal} Ft`
      });

      audit(db,u,'ORDER_COMPLETE',`${order.code} · becsült ${order.estimatedTotal} Ft · tényleges ${b.actualTotal} Ft · eltérés ${order.variance} Ft`);
      // An overspend is what an audit looks for, so it is pushed rather than
      // left for somebody to find in a list.
      if(Math.abs(order.variance)>0){
        notifyAudience(db,['manager','owner'],'Beszerzési eltérés',
          `${order.code} · ${order.variance>0?'+':''}${order.variance} Ft · ${u.name}`,{orderId:order.id});
      }
      await writeDB(db);
      broadcastRealtime('orders');
      return json(res,200,{order});
    }

    if(req.method==='POST' && url.startsWith('/api/orders/') && url.endsWith('/cancel')){
      const u=auth(req,res,'manager'); if(!u)return;
      const order=findOrder(url,'/cancel'); if(!order)return json(res,404,{error:'A beszerzés nem található.'});
      if(order.status==='completed') return json(res,409,{error:'Lezárt beszerzést nem lehet visszavonni.'});
      order.status='cancelled';
      audit(db,u,'ORDER_CANCEL',order.code);
      await writeDB(db);
      broadcastRealtime('orders');
      return json(res,200,{order});
    }

    // ---------- RECRUITMENT ----------
    // Same anonymous model as reservations: an applicant is identified by a
    // hash of their IP and a browser token, never by an account. Applying to
    // work here should not require an account here.
    if(req.method==='GET' && url==='/api/public-positions'){
      return json(res,200,{positions:CAREER_POSITIONS,maxOpen:CAREER_MAX_OPEN});
    }

    if(req.method==='GET' && url==='/api/careers/mine'){
      const token=String(req.rmQuery?.get('token')||'').trim().slice(0,200);
      if(!token) return json(res,200,{applications:[]});
      const fingerprint=visitorFingerprint(req,token);
      const mine=(db.applications||[]).filter(x=>x.visitorHash===fingerprint).slice(0,10).map(publicApplication);
      return json(res,200,{applications:mine});
    }

    if(req.method==='POST' && url==='/api/careers'){
      const b=parseBody(res,careerCreateSchema,await readBody(req)); if(!b)return;

      const phone=normalizeStaffPhone(b.phone);
      if(!phone) return json(res,400,{error:'A telefonszám 7 számjegyű legyen.'});

      const fingerprint=visitorFingerprint(req,b.visitorToken);
      db.applications ||= [];
      const open=db.applications.filter(x=>x.visitorHash===fingerprint && ['pending','interview'].includes(x.status));
      if(open.length>=CAREER_MAX_OPEN){
        return json(res,429,{error:'Már van folyamatban lévő jelentkezésed. Várd meg a választ, vagy vond vissza.'});
      }

      const application={
        id:crypto.randomUUID(),
        code:makeApplicationCode(),
        at:new Date().toISOString(),
        name:b.name, phone, age:b.age, radio:b.radio,
        position:b.position, availability:b.availability,
        experience:b.experience, why:b.why,
        status:'pending',
        handledAt:null, handledByName:null, staffNote:'',
        visitorHash:fingerprint
      };
      db.applications.unshift(application);
      db.applications=db.applications.slice(0,300);
      notifyManagersOwners(db,'Új jelentkezés',`${application.name} · ${application.position} · ${application.code}`,{applicationId:application.id});
      await writeDB(db);
      broadcastRealtime('applications');
      return json(res,201,{application:publicApplication(application)});
    }

    if(req.method==='GET' && url==='/api/applications'){
      const u=auth(req,res,'manager'); if(!u)return;
      return json(res,200,{applications:(db.applications||[]).slice(0,200).map(staffApplication)});
    }

    if(req.method==='PATCH' && url.startsWith('/api/applications/')){
      const u=auth(req,res,'manager'); if(!u)return;
      const id=decodeURIComponent(url.slice('/api/applications/'.length));
      const application=(db.applications||[]).find(x=>x.id===id);
      if(!application) return json(res,404,{error:'A jelentkezés nem található.'});
      const b=parseBody(res,careerUpdateSchema,await readBody(req)); if(!b)return;
      application.status=b.status;
      application.staffNote=b.staffNote;
      application.handledAt=new Date().toISOString();
      application.handledByName=u.name;
      audit(db,u,'APPLICATION_UPDATE',`${application.code} · ${application.name} · ${b.status}`);
      await writeDB(db);
      broadcastRealtime('applications');
      return json(res,200,{application:staffApplication(application)});
    }

    if(req.method==='DELETE' && url.startsWith('/api/careers/')){
      const id=decodeURIComponent(url.slice('/api/careers/'.length));
      const application=(db.applications||[]).find(x=>x.id===id);
      if(!application) return json(res,404,{error:'A jelentkezés nem található.'});
      const b=await readBody(req).catch(()=>({}));
      const token=String(b.visitorToken||'').trim().slice(0,200);
      if(!token || application.visitorHash!==visitorFingerprint(req,token)){
        return json(res,403,{error:'Csak a saját jelentkezésedet vonhatod vissza.'});
      }
      application.status='withdrawn';
      application.handledAt=new Date().toISOString();
      application.handledByName='Jelentkező';
      await writeDB(db);
      broadcastRealtime('applications');
      return json(res,200,{ok:true,application:publicApplication(application)});
    }

    // ---------- SIGNATURE DRINKS / OWNER CONTROL ----------
    if(req.method==='GET' && url==='/api/public-signature-drinks') {
      const picks=Array.isArray(db.signatureDrinks)?db.signatureDrinks:[];
      const drinks=picks.map((x,i)=>{ const p=(db.products||[]).find(q=>q.id===x.productId && q.active!==false); if(!p)return null; return {id:p.id,name:p.name,image:p.image||'',description:String(x.description||p.subtitle||'').trim(),slot:i+1}; }).filter(Boolean).slice(0,3);
      return json(res,200,{drinks});
    }
    if(req.method==='GET' && url==='/api/signature-drinks') {
      const u=auth(req,res,'owner'); if(!u)return;
      const picks=Array.isArray(db.signatureDrinks)?db.signatureDrinks:[];
      const drinks=picks.map((x,i)=>{ const p=(db.products||[]).find(q=>q.id===x.productId); if(!p)return null; return {productId:p.id,name:p.name,image:p.image||'',description:String(x.description||'').trim(),slot:i+1}; }).filter(Boolean).slice(0,3);
      return json(res,200,{drinks});
    }
    if(req.method==='PUT' && url==='/api/signature-drinks') {
      const u=auth(req,res,'owner'); if(!u)return;
      const b=await readBody(req);
      const raw=Array.isArray(b.drinks)?b.drinks:[];
      const seen=new Set(); const cleaned=[];
      for(const item of raw.slice(0,3)){
        const productId=String(item?.productId||'').trim();
        if(!productId || seen.has(productId)) continue;
        const p=(db.products||[]).find(q=>q.id===productId && q.active!==false && q.category==='drink');
        if(!p) return json(res,400,{error:'A kiválasztott ital nem található az aktív italok között.'});
        seen.add(productId); cleaned.push({productId,description:String(item?.description||'').trim().slice(0,260)});
      }
      db.signatureDrinks=cleaned;
      audit(db,u,'SIGNATURE_DRINKS_UPDATE',cleaned.length?cleaned.map((x,i)=>{const p=db.products.find(q=>q.id===x.productId);return `${i+1}. ${p?.name||x.productId}${x.description?' · '+x.description:''}`}).join(' | '):'A Signature Drinks lista kiürítve');
      await writeDB(db);
      return json(res,200,{drinks:cleaned.map((x,i)=>{const p=db.products.find(q=>q.id===x.productId);return {productId:p.id,name:p.name,image:p.image||'',description:x.description,slot:i+1}})});
    }

    // ---------- PUBLIC EVENTS / OWNER EVENT CONTROL ----------
    if(req.method==='GET' && url==='/api/public-events') return json(res,200,{events:(db.events||[]).filter(x=>x.active!==false).sort((a,b)=>new Date(a.startsAt)-new Date(b.startsAt)).slice(0,50)});
    if(req.method==='POST' && url==='/api/events/create'){
      const u=auth(req,res,'owner'); if(!u)return; const b=await readBody(req); const title=String(b.title||'').trim().slice(0,120); const description=String(b.description||'').trim().slice(0,800); const place=String(b.place||'Red Moon Pub').trim().slice(0,120); const startsAt=new Date(b.startsAt); const endsAt=b.endsAt?new Date(b.endsAt):null;
      if(!title||Number.isNaN(startsAt.getTime()))return json(res,400,{error:'Cím és érvényes kezdési idő kötelező.'});
      const ev={id:'evt_'+crypto.randomBytes(6).toString('hex'),title,description,place,startsAt:startsAt.toISOString(),endsAt:endsAt&&!Number.isNaN(endsAt.getTime())?endsAt.toISOString():null,createdById:u.id,createdByName:u.name,active:true}; db.events.unshift(ev); audit(db,u,'EVENT_CREATE',`${title} · ${place}`); await writeDB(db); return json(res,201,{event:ev});
    }
    if(req.method==='PATCH' && url.startsWith('/api/events/')){
      const u=auth(req,res,'owner'); if(!u)return; const id=decodeURIComponent(url.split('/').pop()); const ev=(db.events||[]).find(x=>x.id===id); if(!ev)return json(res,404,{error:'Rendezvény nem található'}); const b=await readBody(req);
      if(b.title!==undefined)ev.title=String(b.title).trim().slice(0,120); if(b.description!==undefined)ev.description=String(b.description).trim().slice(0,800); if(b.place!==undefined)ev.place=String(b.place).trim().slice(0,120); if(b.startsAt!==undefined){const d=new Date(b.startsAt);if(Number.isNaN(d.getTime()))return json(res,400,{error:'Érvénytelen kezdési idő'});ev.startsAt=d.toISOString()} if(b.endsAt!==undefined)ev.endsAt=b.endsAt?new Date(b.endsAt).toISOString():null; if(b.active!==undefined)ev.active=!!b.active;
      audit(db,u,'EVENT_UPDATE',ev.title); await writeDB(db); return json(res,200,{event:ev});
    }
    if(req.method==='DELETE' && url.startsWith('/api/events/')){
      const u=auth(req,res,'owner'); if(!u)return; const id=decodeURIComponent(url.split('/').pop()); const idx=(db.events||[]).findIndex(x=>x.id===id); if(idx<0)return json(res,404,{error:'Rendezvény nem található'}); const ev=db.events[idx]; db.events.splice(idx,1); audit(db,u,'EVENT_DELETE',ev.title); await writeDB(db); return json(res,200,{ok:true});
    }

    // ---------- MAP BLIPS ----------
    // Public read, manager+ write. Coordinates are GTA V game units, so they stay
    // correct if the map tiles or resolution are ever swapped.
    const publicBlip=x=>({id:x.id,x:x.x,y:x.y,kind:x.kind||'custom',icon:x.icon,label:x.label,description:x.description,group:x.group});
    if(req.method==='GET' && url==='/api/public-map-blips'){
      return json(res,200,{blips:(db.mapBlips||[]).filter(x=>x.active!==false).map(publicBlip)});
    }
    if(req.method==='GET' && url==='/api/map-blips'){
      const u=auth(req,res); if(!u)return;
      return json(res,200,{blips:(db.mapBlips||[]).map(x=>({...publicBlip(x),active:x.active!==false,createdByName:x.createdByName||'',createdAt:x.createdAt||null}))});
    }
    if(req.method==='POST' && url==='/api/map-blips'){
      const u=auth(req,res,'manager'); if(!u)return;
      const data=parseBody(res,blipCreateSchema,await readBody(req)); if(!data)return;
      const blip={id:'blip_'+crypto.randomBytes(6).toString('hex'),...data,group:data.group||'Red Moon',active:true,createdById:u.id,createdByName:u.name,createdAt:new Date().toISOString()};
      db.mapBlips=db.mapBlips||[]; db.mapBlips.unshift(blip); db.mapBlips=db.mapBlips.slice(0,500);
      audit(db,u,'MAP_BLIP_CREATE',`${blip.label} · ${Math.round(blip.x)}, ${Math.round(blip.y)}`);
      await writeDB(db);
      return json(res,201,{blip:publicBlip(blip)});
    }
    if(req.method==='PATCH' && url.startsWith('/api/map-blips/')){
      const u=auth(req,res,'manager'); if(!u)return;
      const id=decodeURIComponent(url.split('/').pop());
      const blip=(db.mapBlips||[]).find(q=>q.id===id);
      if(!blip)return json(res,404,{error:'A jelölő nem található'});
      const data=parseBody(res,blipUpdateSchema,await readBody(req)); if(!data)return;
      Object.assign(blip,data);
      if(!blip.group) blip.group='Red Moon';
      audit(db,u,'MAP_BLIP_UPDATE',blip.label); await writeDB(db);
      return json(res,200,{blip:publicBlip(blip)});
    }
    if(req.method==='DELETE' && url.startsWith('/api/map-blips/')){
      const u=auth(req,res,'manager'); if(!u)return;
      const id=decodeURIComponent(url.split('/').pop());
      const idx=(db.mapBlips||[]).findIndex(q=>q.id===id);
      if(idx<0)return json(res,404,{error:'A jelölő nem található'});
      const [blip]=db.mapBlips.splice(idx,1);
      audit(db,u,'MAP_BLIP_DELETE',blip.label); await writeDB(db);
      return json(res,200,{ok:true});
    }

    if(req.method==='GET' && url==='/api/finance/overall'){
      const u=auth(req,res); if(!u)return; const raw=(db.finance?.overallRevenue ?? db.sales.reduce((a,x)=>a+(Number(x.total)||0),0)); const offset=Number(db.finance?.overallRevenueOffset)||0; return json(res,200,{overallRevenue:Math.max(0,raw-offset),rawRevenue:raw,offset});
    }
    if(req.method==='POST' && url==='/api/finance/reset'){
      const u=auth(req,res,'owner'); if(!u)return; db.finance ||= {}; db.finance.overallRevenueOffset=Number(db.finance.overallRevenue)||0; audit(db,u,'OVERALL_REVENUE_RESET','Az overall bevétel számláló nullázva'); await writeDB(db); return json(res,200,{overallRevenue:0});
    }

    // ---------- PROFILE / EMPLOYEES ----------
    if(req.method==='PATCH' && url==='/api/profile'){
      const u=auth(req,res); if(!u)return; const b=await readBody(req); const target=db.users.find(x=>x.id===u.id); if(!target)return json(res,404,{error:'Fiók nem található'});
      if(b.name!==undefined)target.name=String(b.name).trim().slice(0,100); if(b.avatar!==undefined){const avatar=String(b.avatar); if(avatar.length>30000000)return json(res,400,{error:'A profilkép túl nagy. Maximum kb. 22 MB.'}); if(avatar && !/^data:image\/(png|jpe?g|webp);base64,/i.test(avatar))return json(res,400,{error:'A profilképnek PNG/JPG/WebP képnek kell lennie.'}); target.avatar=avatar;}
      audit(db,target,'PROFILE_UPDATE','Saját profil frissítve'); await writeDB(db); const sid=parseCookies(req).rm_session; const session=sid&&sessions.get(sid); if(session){session.name=target.name;session.username=target.username;session.avatar=target.avatar||''} return json(res,200,{user:publicUser(target)});
    }
    // Change own password. Requires the current one, and drops every other
    // session for the account so a stolen cookie cannot outlive the change.
    if(req.method==='POST' && url==='/api/profile/password'){
      const u=auth(req,res); if(!u)return;
      const data=parseBody(res,passwordChangeSchema,await readBody(req)); if(!data)return;
      const target=db.users.find(x=>x.id===u.id);
      if(!target)return json(res,404,{error:'Fiók nem található'});
      if(!verifyPassword(data.currentPassword,target.passwordHash))return json(res,401,{error:'A jelenlegi jelszó nem megfelelő.'});
      if(data.currentPassword===data.newPassword)return json(res,400,{error:'Az új jelszó nem egyezhet meg a jelenlegivel.'});
      const hp=hashPassword(data.newPassword);
      target.passwordHash=`PBKDF2:310000:sha256:${hp.salt}:${hp.hash}`;
      const currentSid=parseCookies(req).rm_session;
      for(const [sid,session] of sessions.entries()){ if(session.id===target.id && sid!==currentSid) sessions.delete(sid); }
      audit(db,target,'PASSWORD_CHANGE','Jelszó megváltoztatva'); await writeDB(db);
      return json(res,200,{ok:true});
    }

    // What the signed-in account may do. The client uses this to show or hide
    // controls, but every endpoint still enforces its own role check.
    if(req.method==='GET' && url==='/api/permissions'){
      const u=auth(req,res); if(!u)return;
      return json(res,200,{permissions:{
        role:u.role,
        manageBlips:roleAtLeast(u.role,'manager'),
        manageEvents:roleAtLeast(u.role,'owner'),
        manageProducts:roleAtLeast(u.role,'manager'),
        manageUsers:roleAtLeast(u.role,'owner'),
        viewDashboard:roleAtLeast(u.role,'staff'),
        viewAudit:roleAtLeast(u.role,'owner')
      }});
    }

    if(req.method==='GET' && url==='/api/employees'){
      const u=auth(req,res); if(!u)return; return json(res,200,{users:db.users.filter(x=>x.role!=='dj').map(publicUser)});
    }

    // ---------- RESTOCK / INVENTORY LOG ----------
    if(req.method==='GET' && url==='/api/restock/logs'){
      const u=auth(req,res,'manager'); if(!u)return; return json(res,200,{logs:(db.restockLogs||[]).slice(0,500)});
    }
    if(req.method==='DELETE' && url.startsWith('/api/restock/logs/')){
      const u=auth(req,res,'owner'); if(!u)return;
      const id=decodeURIComponent(url.split('/').pop());
      const idx=(db.restockLogs||[]).findIndex(x=>x.id===id);
      if(idx<0)return json(res,404,{error:'A feltöltési naplóbejegyzés nem található'});
      const log=db.restockLogs[idx]; db.restockLogs.splice(idx,1);
      audit(db,u,'RESTOCK_LOG_DELETE',`${log.product} · +${log.qty} db · ${log.user}`);
      await writeDB(db); return json(res,200,{ok:true,deletedRestockLogId:id});
    }
    if(req.method==='POST' && url==='/api/restock'){
      const u=auth(req,res,'manager'); if(!u)return; const b=await readBody(req);
      const rawItems=Array.isArray(b.items)?b.items:[b];
      const items=rawItems.map(x=>({productId:String(x.productId||''),qty:Math.floor(Number(x.qty)),unitCost:Number(x.unitCost)||0,source:String(x.source||b.source||'nagyker').slice(0,60),note:String(x.note||b.note||'').slice(0,300)})).filter(x=>x.productId);
      if(!items.length)return json(res,400,{error:'A feltöltési kosár üres.'});
      const checked=[];
      for(const item of items){
        if(!Number.isInteger(item.qty)||item.qty<1||item.unitCost<0)return json(res,400,{error:'Minden feltöltési tételhez érvényes mennyiség és beszerzési ár szükséges.'});
        const product=db.products.find(x=>x.id===item.productId&&x.active);
        if(!product)return json(res,404,{error:'A feltöltendő termék nem található vagy már nem aktív.'});
        const existing=checked.find(x=>x.product.id===product.id);
        if(existing) existing.qty+=item.qty; else checked.push({product,qty:item.qty,unitCost:item.unitCost,source:item.source,note:item.note});
      }
      db.restockLogs ||= []; const logs=[]; const now=new Date().toISOString();
      for(const item of checked){
        const p=item.product; p.stock=(Number(p.stock)||0)+item.qty;
        const log={id:crypto.randomUUID(),at:now,userId:u.id,user:u.name,productId:p.id,product:p.name,qty:item.qty,unitCost:item.unitCost,totalCost:item.qty*item.unitCost,source:item.source,note:item.note};
        db.restockLogs.unshift(log); logs.push(log);
        notifyManagersOwners(db,'Készletfeltöltés',`${u.name}: ${p.name} +${item.qty} db · ${Number(log.totalCost).toLocaleString('hu-HU')} Ft`,{restockId:log.id});
      }
      audit(db,u,'RESTOCK',`${logs.map(x=>`${x.product}: +${x.qty} db · ${x.totalCost} Ft`).join(' | ')}`);
      await writeDB(db); return json(res,201,{products:checked.map(x=>x.product),logs});
    }

    if(req.method==='GET' && url==='/api/sales'){
      const u=auth(req,res); if(!u)return;
      return json(res,200,{sales:db.sales.slice(0,500)});
    }

    if(req.method==='GET' && url==='/api/audit'){
      const u=auth(req,res,'owner'); if(!u)return;
      return json(res,200,{audit:db.audit.slice(0,500)});
    }

    if(req.method==='GET' && url==='/api/notifications'){
      const u=auth(req,res,'manager'); if(!u)return;
      const notifications=db.notifications.filter(n=>Array.isArray(n.audience)&&n.audience.includes(u.role)).slice(0,100).map(n=>({...n,read:!!n.readBy?.[u.id]}));
      return json(res,200,{notifications});
    }

    if(req.method==='POST' && url==='/api/notifications/read'){
      const u=auth(req,res,'manager'); if(!u)return;
      const b=await readBody(req);
      const n=db.notifications.find(x=>x.id===b.id);
      if(!n)return json(res,404,{error:'Értesítés nem található'});
      n.readBy ||= {};
      n.readBy[u.id]=new Date().toISOString();
      audit(db,u,'NOTIFICATION_READ',`Értesítés olvasva · ${n.title||n.id}`);
      await writeDB(db);
      return json(res,200,{ok:true});
    }

    // ---------- SHIFTS / CASH REGISTER ----------
    if(req.method==='GET' && url==='/api/shifts'){
      const u=auth(req,res,'manager'); if(!u)return;
      return json(res,200,{shifts:db.shifts.slice(0,500)});
    }

    if(req.method==='GET' && url==='/api/shifts/current'){
      const u=auth(req,res); if(!u)return;
      const open=db.shifts.find(s=>s.status==='open')||null;
      return json(res,200,{shift:open});
    }

    if(req.method==='POST' && url==='/api/shifts/open'){
      const u=auth(req,res);
      if(!u)return;
      const existing=db.shifts.find(s=>s.status==='open');
      if(existing) return json(res,409,{error:`Már van nyitott műszak: ${existing.startedByName}. Zárd le előbb.`});
      const b=await readBody(req);
      const openingCash=Number(b.openingCash)||0;
      let memberIds=Array.isArray(b.memberIds)?[...new Set(b.memberIds.map(String).filter(Boolean))]:[];
      if(!memberIds.length && Array.isArray(b.members)){
        memberIds=[...new Set(b.members.map(String).map(name=>db.users.find(x=>x.name===name)?.id).filter(Boolean))];
      }
      const memberUsers=memberIds.map(id=>db.users.find(x=>x.id===id)).filter(Boolean).filter(x=>x.role!=='dj');
      memberIds=memberUsers.map(x=>x.id);
      if(!memberIds.includes(u.id)) memberIds.unshift(u.id);
      const members=[...new Set(memberIds.map(id=>db.users.find(x=>x.id===id)?.name).filter(Boolean))];
      const shift={
        id:makeShiftId(db),
        status:'open',
        startedAt:new Date().toISOString(),
        endedAt:null,
        startedById:u.id,
        startedByName:u.name,
        members:[...new Set(members)],
        memberIds,
        memberHistory:members.map(name=>({name,userId:db.users.find(x=>x.name===name)?.id||null,joinedAt:new Date().toISOString(),joinedById:u.id,joinedByName:u.name,reason:name===u.name?'műszak indítása':'műszaknyitáskor hozzáadva'})),
        openingCash,
        closingCash:null,
        revenue:0,
        cashRevenue:0,
        transferRevenue:0,
        salesCount:0,
        items:0,
        notes:String(b.notes||''),
        cartCounters:{}
      };
      db.shifts.unshift(shift);
      audit(db,u,'SHIFT_OPEN',`Műszak nyitva · kezdő kassza ${openingCash} Ft · ${shift.members.join(', ')}`);
      await writeDB(db);
      return json(res,201,{shift});
    }

    if(req.method==='GET' && url==='/api/shifts/available-members'){
      const u=auth(req,res);
      if(!u)return;
      const users=db.users.filter(x=>x.role!=='dj').map(publicUser);
      return json(res,200,{users});
    }

    if(req.method==='GET' && url==='/api/shifts/eligible-members'){
      const u=auth(req,res);
      if(!u)return;
      const shift=db.shifts.find(s=>s.status==='open')||null;
      if(!shift)return json(res,409,{error:'Nincs nyitott műszak.'});
      const currentIds=new Set(shift.memberIds||[]);
      const currentNames=new Set(shift.members||[]);
      const users=db.users.filter(x=>x.role!=='dj' && !currentIds.has(x.id) && !currentNames.has(x.name)).map(publicUser);
      return json(res,200,{users});
    }

    if(req.method==='POST' && url==='/api/shifts/members'){
      const u=auth(req,res);
      if(!u)return;
      const shift=db.shifts.find(s=>s.status==='open')||null;
      if(!shift)return json(res,409,{error:'Nincs nyitott műszak.'});
      if(shift.startedById!==u.id && !['manager','owner'].includes(u.role)){
        return json(res,403,{error:'Ezt a műszakot csak a műszakindító, MANAGER vagy OWNER bővítheti.'});
      }
      const b=await readBody(req);
      const member=db.users.find(x=>x.id===String(b.userId||''));
      if(!member || member.role==='dj')return json(res,404,{error:'A kiválasztott dolgozó nem található.'});
      shift.members ||= [];
      shift.memberIds ||= [];
      if(shift.memberIds.includes(member.id) || shift.members.includes(member.name)){
        return json(res,409,{error:'Ez a dolgozó már tagja ennek a műszaknak.'});
      }
      shift.members.push(member.name);
      shift.memberIds.push(member.id);
      shift.memberHistory ||= [];
      shift.memberHistory.push({name:member.name,userId:member.id,joinedAt:new Date().toISOString(),joinedById:u.id,joinedByName:u.name});
      audit(db,u,'SHIFT_MEMBER_ADD',`Műszaktag hozzáadva · ${member.name} · műszak ${shift.id}`);
      await writeDB(db);
      return json(res,200,{shift,member:publicUser(member)});
    }

    if(req.method==='POST' && url==='/api/shifts/close'){
      const u=auth(req,res);
      if(!u)return;
      const shift=db.shifts.find(s=>s.status==='open');
      if(!shift)return json(res,409,{error:'Nincs nyitott műszak.'});
      if(shift.startedById!==u.id && !['manager','owner'].includes(u.role)) return json(res,403,{error:'Ezt a műszakot csak a műszak indítója, MANAGER vagy OWNER zárhatja.'});
      const b=await readBody(req);
      const sales=db.sales.filter(s=>s.shiftId===shift.id);
      const revenue=sales.reduce((a,s)=>a+Number(s.total||0),0);
      const cashRevenue=sales.filter(s=>s.paymentMethod==='cash').reduce((a,s)=>a+Number(s.total||0),0);
      const transferRevenue=sales.filter(s=>s.paymentMethod==='transfer').reduce((a,s)=>a+Number(s.total||0),0);
      const items=sales.reduce((a,s)=>a+Number(s.qty||0),0);
      const closingCash=Number(b.closingCash);
      if(!Number.isFinite(closingCash)||closingCash<0)return json(res,400,{error:'Adj meg érvényes záró kassza összeget.'});
      shift.status='closed';
      shift.endedAt=new Date().toISOString();
      shift.closedById=u.id;
      shift.closedByName=u.name;
      shift.closingCash=closingCash;
      shift.revenue=revenue;
      shift.cashRevenue=cashRevenue;
      shift.transferRevenue=transferRevenue;
      shift.overallRevenue=revenue;
      shift.salesCount=sales.length;
      shift.items=items;
      shift.notes=String(b.notes||shift.notes||'');
      const employeeBreakdown=[];
      const seenMembers=new Set();
      const history=(Array.isArray(shift.memberHistory)&&shift.memberHistory.length)?shift.memberHistory:(shift.members||[shift.startedByName]).map(name=>({name,userId:db.users.find(x=>x.name===name)?.id||null,joinedAt:shift.startedAt}));
      for(const member of history){
        const key=member.userId||member.name; if(!key||seenMembers.has(key))continue; seenMembers.add(key);
        const own=sales.filter(x=>member.userId?x.userId===member.userId:x.user===member.name);
        const transactions=new Set(own.map(x=>x.transactionId||x.cartId||x.id));
        employeeBreakdown.push({name:member.name,userId:member.userId||null,joinedAt:member.joinedAt||shift.startedAt,workedMs:Math.max(0,new Date(shift.endedAt)-new Date(member.joinedAt||shift.startedAt)),sales:transactions.size,items:own.reduce((a,x)=>a+Number(x.qty||0),0),revenue:own.reduce((a,x)=>a+Number(x.total||0),0)});
      }
      shift.closure={
        shiftId:shift.id,
        openedAt:shift.startedAt,
        closedAt:shift.endedAt,
        startedById:shift.startedById,
        startedByName:shift.startedByName,
        closedById:shift.closedById,
        closedByName:shift.closedByName,
        members:Array.isArray(shift.memberHistory)&&shift.memberHistory.length?shift.memberHistory.map(m=>({name:m.name,userId:m.userId||null,joinedAt:m.joinedAt,joinedByName:m.joinedByName||null,reason:m.reason||null})):[],
        employeeBreakdown,
        cashRevenue,
        transferRevenue,
        overallRevenue:revenue,
        salesCount:sales.length,
        items,
        openingCash:shift.openingCash,
        closingCash,
        transfer:{amount:revenue,account:'21541444-70524373',name:'Zhen Yu Xiao',reference:shift.id}
      };
      audit(db,u,'SHIFT_CLOSE',`Műszak zárva · bevétel ${revenue} Ft · záró kassza ${closingCash} Ft`);
      await writeDB(db);
      return json(res,200,{shift,transfer:{
        amount:revenue,
        account:'21541444-70524373',
        name:'Zhen Yu Xiao',
        reference:shift.id
      }});
    }

    // ---------- OWNER: DELETE CLOSED SHIFT + ITS SHIFT DATA ----------
    if(req.method==='DELETE' && url.startsWith('/api/shifts/')){
      const u=auth(req,res,'owner'); if(!u)return;
      const id=decodeURIComponent(url.split('/').pop());
      const idx=db.shifts.findIndex(s=>s.id===id);
      if(idx<0)return json(res,404,{error:'A műszak nem található'});
      const shift=db.shifts[idx];
      if(shift.status!=='closed')return json(res,400,{error:'Csak lezárt műszak törölhető.'});
      const shiftSales=db.sales.filter(x=>x.shiftId===id);
      const saleIds=new Set(shiftSales.map(x=>x.id));
      const shiftDocs=db.documents.filter(x=>saleIds.has(x.saleId) || shiftSales.some(s=>s.documentId===x.id || s.receiptId===x.id));
      // A műszak törlésekor az ahhoz tartozó eladások is törlődnek,
      // a készlet pedig visszaáll az eladások előtti állapotra.
      for(const sale of shiftSales){
        const product=db.products.find(p=>p.id===sale.productId);
        if(product) product.stock += Number(sale.qty)||0;
      }
      db.documents=db.documents.filter(x=>!shiftDocs.includes(x));
      db.finance ||= {}; db.finance.overallRevenue=Math.max(0,Number(db.finance.overallRevenue||0)-shiftSales.reduce((a,x)=>a+(Number(x.total)||0),0));
      db.sales=db.sales.filter(x=>x.shiftId!==id);
      db.shifts.splice(idx,1);
      audit(db,u,'SHIFT_DELETE',`Lezárt műszak törölve · ${id} · ${shiftSales.length} eladás · ${shiftDocs.length} számla · készlet visszaállítva`);
      await writeDB(db);
      return json(res,200,{ok:true,deletedShiftId:id,deletedSales:shiftSales.length,deletedInvoices:shiftDocs.length});
    }

    if(req.method==='GET' && url.startsWith('/api/shifts/')){
      const u=auth(req,res); if(!u)return;
      const id=url.split('/').pop();
      const shift=db.shifts.find(s=>s.id===id);
      if(!shift)return json(res,404,{error:'Műszak nem található'});
      const sales=db.sales.filter(s=>s.shiftId===shift.id);
      if(shift.status==='closed'){
        shift.closure ||= {};
        if(!Array.isArray(shift.closure.employeeBreakdown)){
          const history=(Array.isArray(shift.memberHistory)&&shift.memberHistory.length)?shift.memberHistory:(shift.members||[shift.startedByName]).map(name=>({name,userId:db.users.find(x=>x.name===name)?.id||null,joinedAt:shift.startedAt}));
          const seen=new Set(); shift.closure.employeeBreakdown=[];
          for(const member of history){const key=member.userId||member.name;if(!key||seen.has(key))continue;seen.add(key);const own=sales.filter(x=>member.userId?x.userId===member.userId:x.user===member.name);const tx=new Set(own.map(x=>x.transactionId||x.cartId||x.id));shift.closure.employeeBreakdown.push({name:member.name,userId:member.userId||null,joinedAt:member.joinedAt||shift.startedAt,workedMs:Math.max(0,new Date(shift.endedAt)-new Date(member.joinedAt||shift.startedAt)),sales:tx.size,items:own.reduce((a,x)=>a+Number(x.qty||0),0),revenue:own.reduce((a,x)=>a+Number(x.total||0),0)});}
        }
      }
      return json(res,200,{shift,sales});
    }

    // ---------- SALES + RECEIPTS / INVOICES ----------
    if(req.method==='POST' && url==='/api/sales'){
      const u=auth(req,res);
      if(!u)return;
      const shift=db.shifts.find(s=>s.status==='open');
      if(!shift)return json(res,409,{error:'Eladás előtt nyisd meg a kasszát / műszakot.'});
      if(!(shift.memberIds||[]).includes(u.id)) return json(res,403,{error:'Csak az aktuális műszak tagjai értékesíthetnek.'});
      const b=await readBody(req);
      const rawItems=Array.isArray(b.items)?b.items:[{productId:b.productId,qty:b.qty}];
      const items=rawItems.map(x=>({productId:String(x.productId||''),qty:Math.floor(Number(x.qty))})).filter(x=>x.productId);
      if(!items.length)return json(res,400,{error:'A kosár üres.'});
      const paymentMethod=['cash','transfer'].includes(b.paymentMethod)?b.paymentMethod:'cash';
      const checked=[];
      for(const item of items){
        if(!Number.isInteger(item.qty)||item.qty<1)return json(res,400,{error:'Érvénytelen mennyiség a kosárban.'});
        const p=db.products.find(x=>x.id===item.productId && x.active);
        if(!p)return json(res,400,{error:'A kosár egyik terméke már nem elérhető.'});
        if(!['drink','food'].includes(p.category))return json(res,400,{error:'Ez a termék nem értékesíthető.'});
        const already=checked.find(x=>x.p.id===p.id);
        if(already)already.qty+=item.qty; else checked.push({p,qty:item.qty});
      }
      for(const item of checked){
        if(item.p.stock<item.qty)return json(res,400,{error:`Nincs elég készlet. ${item.p.name}: jelenleg ${item.p.stock} db van.`});
      }
      const transactionId=crypto.randomUUID();
      const at=new Date().toISOString();
      shift.cartCounters ||= {};
      const cartKey=String(u.id);
      const nextCartNumber=(Number(shift.cartCounters[cartKey])||0)+1;
      shift.cartCounters[cartKey]=nextCartNumber;
      const cartId=makeCartId(shift,u,nextCartNumber);
      const sales=checked.map(item=>{
        const p=item.p, qty=item.qty, total=p.price*qty;
        p.stock-=qty;
        return {
          id:crypto.randomUUID(),transactionId,cartId,at,userId:u.id,user:u.name,
          productId:p.id,product:p.name,category:p.category,qty,unitPrice:p.price,total,
          shiftId:shift.id,paymentMethod,documentId:null
        };
      });
      const total=sales.reduce((sum,s)=>sum+s.total,0);
      const receipt={
        id:makeDocumentId('REC'),type:'receipt',createdAt:at,createdById:u.id,createdByName:u.name,
        saleId:sales[0]?.id||null,transactionId,shiftId:shift.id,customer:{name:'Vásárló',address:'',taxNumber:''},
        seller:{name:'Red Moon Pub',owner:'Zhen Yu Xiao'},
        items:sales.map(s=>({product:s.product,qty:s.qty,unitPrice:s.unitPrice,total:s.total})),
        total,paymentMethod
      };
      sales.forEach(s=>s.receiptId=receipt.id);
      db.documents.unshift(receipt);
      db.sales.unshift(...sales);
      db.finance ||= {}; db.finance.overallRevenue=Number(db.finance.overallRevenue||0)+total;
      audit(db,u,'SALE',`${sales.map(s=>`${s.product} × ${s.qty}`).join(' + ')} · ${total} Ft · ${paymentMethod} · műszak ${shift.id}`);
      await writeDB(db);
      return json(res,201,{sales,product:checked[0]?.p,shift,total,transactionId,cartId});
    }

    if(req.method==='DELETE' && url.startsWith('/api/sales/cart/')){
      const u=auth(req,res,'manager');
      if(!u)return;
      const cartId=decodeURIComponent(url.slice('/api/sales/cart/'.length));
      const cartSales=db.sales.filter(x=>String(x.cartId||'')===String(cartId));
      if(!cartSales.length)return json(res,404,{error:'Az eladási kosár nem található.'});
      const restored=[];
      for(const sale of cartSales){
        const product=db.products.find(p=>p.id===sale.productId);
        if(product){product.stock=(Number(product.stock)||0)+(Number(sale.qty)||0);restored.push({productId:product.id,product:product.name,qty:Number(sale.qty)||0});}
      }
      const total=cartSales.reduce((a,s)=>a+Number(s.total||0),0);
      const saleIds=new Set(cartSales.map(s=>s.id));
      const receiptIds=new Set(cartSales.map(s=>s.receiptId).filter(Boolean));
      // A kapcsolódó nyugták automatikusan törlődnek az eladással együtt.
      db.documents=db.documents.filter(doc=>!(doc.type==='receipt' && (receiptIds.has(doc.id) || (saleIds.has(doc.saleId) && doc.transactionId===cartSales[0]?.transactionId))));
      // A kapcsolódó számla megmarad, az OWNER később külön törölheti.
      db.sales=db.sales.filter(x=>!saleIds.has(x.id));
      db.finance ||= {};
      db.finance.overallRevenue=Math.max(0,Number(db.finance.overallRevenue||0)-total);
      audit(db,u,'SALE_CART_DELETE',`${cartId} · ${cartSales.length} tétel · ${total} Ft · teljes kosár törölve · készlet visszaállítva · nyugta automatikusan törölve`);
      await writeDB(db);
      return json(res,200,{ok:true,deletedCartId:cartId,deletedSales:cartSales.length,deletedTotal:total,restoredStock:restored,deletedReceipts:receiptIds.size,invoicePreserved:cartSales.some(s=>s.documentId)});
    }

    if(req.method==='DELETE' && url.startsWith('/api/sales/')){
      const u=auth(req,res,'manager');
      if(!u)return;
      const id=decodeURIComponent(url.split('/').pop());
      const sale=db.sales.find(x=>x.id===id);
      if(!sale)return json(res,404,{error:'Az eladás nem található'});
      // Egy kosár mindig egy tranzakció: törléskor a teljes kosarat töröljük.
      const cartId=String(sale.cartId||'');
      if(cartId){
        const cartSales=db.sales.filter(x=>String(x.cartId||'')===cartId);
        const restored=[];
        for(const item of cartSales){const product=db.products.find(p=>p.id===item.productId);if(product){product.stock=(Number(product.stock)||0)+(Number(item.qty)||0);restored.push({productId:product.id,product:product.name,qty:Number(item.qty)||0});}}
        const total=cartSales.reduce((a,x)=>a+Number(x.total||0),0);
        const ids=new Set(cartSales.map(x=>x.id));
        const receiptIds=new Set(cartSales.map(x=>x.receiptId).filter(Boolean));
        db.documents=db.documents.filter(doc=>!(doc.type==='receipt' && (receiptIds.has(doc.id) || (ids.has(doc.saleId) && doc.transactionId===cartSales[0]?.transactionId))));
        db.sales=db.sales.filter(x=>!ids.has(x.id));
        db.finance ||= {}; db.finance.overallRevenue=Math.max(0,Number(db.finance.overallRevenue||0)-total);
        audit(db,u,'SALE_CART_DELETE',`${cartId} · ${cartSales.length} tétel · ${total} Ft · teljes kosár törölve · nyugta automatikusan törölve`);
        await writeDB(db);
        return json(res,200,{ok:true,deletedCartId:cartId,deletedSales:cartSales.length,deletedTotal:total,restoredStock:restored,deletedReceipts:receiptIds.size,invoicePreserved:cartSales.some(x=>x.documentId)});
      }
      const product=db.products.find(p=>p.id===sale.productId);
      if(product) product.stock=(Number(product.stock)||0)+(Number(sale.qty)||0);
      const receiptId=sale.receiptId;
      if(receiptId) db.documents=db.documents.filter(doc=>!(doc.type==='receipt' && doc.id===receiptId));
      db.sales=db.sales.filter(x=>x.id!==sale.id);
      db.finance ||= {}; db.finance.overallRevenue=Math.max(0,Number(db.finance.overallRevenue||0)-Number(sale.total||0));
      audit(db,u,'SALE_DELETE',`${sale.product} × ${sale.qty} · ${sale.total} Ft · ${sale.id} · nyugta automatikusan törölve`);
      await writeDB(db);
      return json(res,200,{ok:true,deletedSaleId:sale.id,restoredStock:Number(sale.qty)||0,deletedReceipt:!!receiptId,invoicePreserved:!!sale.documentId});
    }

    if(req.method==='POST' && url==='/api/documents'){
      const u=auth(req,res);
      if(!u)return;
      const b=await readBody(req);
      const sale=db.sales.find(s=>s.id===b.saleId);
      if(!sale)return json(res,404,{error:'Az eladás nem található'});
      const transactionId=sale.transactionId||sale.id;
      const transactionSales=db.sales.filter(s=>((s.transactionId||s.id)===transactionId));
      const existingInvoiceId=transactionSales.map(s=>s.documentId).find(Boolean);
      const existingInvoice=existingInvoiceId?db.documents.find(x=>x.id===existingInvoiceId && x.type==='invoice'):null;
      if(existingInvoice){
        return json(res,200,{document:existingInvoice,alreadyExists:true});
      }
      const existingInvoiceByTransaction=db.documents.find(x=>x.type==='invoice' && x.transactionId===transactionId);
      if(existingInvoiceByTransaction){
        transactionSales.forEach(s=>s.documentId=existingInvoiceByTransaction.id);
        await writeDB(db);
        return json(res,200,{document:existingInvoiceByTransaction,alreadyExists:true});
      }
      const type='invoice';
      const doc={
        id:makeDocumentId('INV'),
        type,
        createdAt:new Date().toISOString(),
        createdById:u.id,createdByName:u.name,
        saleId:sale.id,transactionId,shiftId:sale.shiftId,
        customer:{
          name:String(b.customer?.name||'Vásárló'),
          address:String(b.customer?.address||''),
          taxNumber:String(b.customer?.taxNumber||'')
        },
        seller:{name:'Red Moon Pub',owner:'Zhen Yu Xiao'},
        items:transactionSales.map(s=>({product:s.product,qty:s.qty,unitPrice:s.unitPrice,total:s.total})),
        total:transactionSales.reduce((sum,s)=>sum+s.total,0),
        paymentMethod:sale.paymentMethod
      };
      db.documents.unshift(doc);
      transactionSales.forEach(s=>{s.documentId=doc.id});
      audit(db,u,'INVOICE_CREATE',`${doc.id} · ${transactionSales.map(s=>s.product).join(', ')} · ${doc.total} Ft`);
      notifyOwners(db,'Új számla készült',`${u.name} számlát készített: ${doc.id} · ${transactionSales.length} tétel · ${doc.total} Ft`,{documentId:doc.id,saleId:sale.id,createdBy:u.name});
      await writeDB(db);
      return json(res,201,{document:doc});
    }

    if(req.method==='DELETE' && url.startsWith('/api/documents/')){
      const id=decodeURIComponent(url.split('/').pop());
      const idx=db.documents.findIndex(x=>x.id===id);
      if(idx<0)return json(res,404,{error:'A dokumentum nem található'});
      const doc=db.documents[idx];
      const u=auth(req,res,doc.type==='receipt'?'manager':'owner');
      if(!u)return;
      const transactionSales=db.sales.filter(x=>(x.transactionId||x.id)===(doc.transactionId||doc.saleId));
      if(doc.type==='receipt'){
        transactionSales.forEach(s=>{if(s.receiptId===doc.id)s.receiptId=null});
        db.documents.splice(idx,1);
        audit(db,u,'RECEIPT_DELETE',`${doc.id} · ${doc.total} Ft`);
        await writeDB(db);
        return json(res,200,{ok:true,deletedReceiptId:doc.id});
      }
      transactionSales.forEach(s=>{if(s.documentId===doc.id)s.documentId=null});
      db.documents.splice(idx,1);
      audit(db,u,'INVOICE_DELETE',`${doc.id} · ${doc.total} Ft`);
      await writeDB(db);
      return json(res,200,{ok:true,deletedInvoiceId:doc.id});
    }

    if(req.method==='POST' && url==='/api/receipts'){
      const u=auth(req,res);
      if(!u)return;
      const b=await readBody(req);
      const sale=db.sales.find(s=>s.id===String(b.saleId||''));
      if(!sale)return json(res,404,{error:'Az eladás nem található'});
      if(sale.receiptId){const existing=db.documents.find(x=>x.id===sale.receiptId);if(existing)return json(res,200,{document:existing});}
      const transactionId=sale.transactionId||sale.id;
      const transactionSales=db.sales.filter(s=>(s.transactionId||s.id)===transactionId);
      const receipt={
        id:makeDocumentId('REC'),type:'receipt',createdAt:new Date().toISOString(),createdById:u.id,createdByName:u.name,
        saleId:sale.id,transactionId,shiftId:sale.shiftId,customer:{name:'Vásárló',address:'',taxNumber:''},seller:{name:'Red Moon Pub',owner:'Zhen Yu Xiao'},
        items:transactionSales.map(s=>({product:s.product,qty:s.qty,unitPrice:s.unitPrice,total:s.total})),
        total:transactionSales.reduce((sum,s)=>sum+Number(s.total||0),0),paymentMethod:sale.paymentMethod
      };
      db.documents.unshift(receipt);
      transactionSales.forEach(s=>{s.receiptId=receipt.id});
      audit(db,u,'RECEIPT_CREATE',`${receipt.id} · ${receipt.total} Ft`);
      await writeDB(db);
      return json(res,201,{document:receipt});
    }

    if(req.method==='GET' && url==='/api/documents'){
      const u=auth(req,res,'manager'); if(!u)return;
      return json(res,200,{documents:db.documents.slice(0,500)});
    }

    // ---------- INVENTORY / PRODUCTS ----------
    if(req.method==='POST' && url==='/api/inventory/adjust'){
      const u=auth(req,res,'owner'); if(!u)return;
      const b=await readBody(req); const p=db.products.find(x=>x.id===b.productId); const stock=Math.floor(Number(b.stock));
      if(!p || !Number.isInteger(stock) || stock<0)return json(res,400,{error:'Érvénytelen készletadat'});
      const old=p.stock; p.stock=stock; audit(db,u,'INVENTORY_OPENING_SET',`${p.name}: ${old} → ${stock} · nyitókészlet beállítva`); await writeDB(db);
      return json(res,200,{product:p,openingStock:true});
    }

    if(req.method==='POST' && url==='/api/products'){
      const u=auth(req,res,'manager'); if(!u)return;
      const b=await readBody(req);
      if(!b.name||!b.category)return json(res,400,{error:'Név és kategória kötelező'});
      const p={id:'p_'+crypto.randomBytes(6).toString('hex'),name:String(b.name),category:b.category==='food'?'food':'drink',section:(String(b.section||'').trim() && String(b.section||'').trim()!=='all')?String(b.section||'').trim():inferProductSection({name:b.name,category:b.category}),price:currency(b.price),stock:Math.max(0,Math.floor(currency(b.stock))),minStock:Math.max(0,Math.floor(currency(b.minStock))),image:String(b.image||''),subtitle:String(b.subtitle||'').slice(0,180),active:true};
      db.products.push(p); audit(db,u,'PRODUCT_CREATE',p.name); await writeDB(db); return json(res,201,{product:p});
    }

    if(req.method==='DELETE' && url.startsWith('/api/products/')){
      const u=auth(req,res,'owner'); if(!u)return;
      const id=decodeURIComponent(url.split('/').pop()); const p=db.products.find(x=>x.id===id);
      if(!p)return json(res,404,{error:'Termék nem található'});
      if(!p.active)return json(res,200,{ok:true,product:p});
      p.active=false; audit(db,u,'PRODUCT_DELETE',`${p.name} · katalógusból eltávolítva`);
      await writeDB(db); return json(res,200,{ok:true,product:p});
    }

    if(req.method==='PATCH' && url.startsWith('/api/products/')){
      const u=auth(req,res,'manager'); if(!u)return;
      const id=url.split('/').pop(); const p=db.products.find(x=>x.id===id);
      if(!p)return json(res,404,{error:'Termék nem található'});
      const b=await readBody(req);
      if(b.name!==undefined)p.name=String(b.name);
      if(b.price!==undefined){ if(u.role!=='owner') return json(res,403,{error:'Az eladási árat csak OWNER módosíthatja.'}); p.price=currency(b.price); }
      if(b.minStock!==undefined)p.minStock=Math.max(0,Math.floor(currency(b.minStock)));
      if(b.active!==undefined)p.active=!!b.active;
      if(b.image!==undefined)p.image=String(b.image||'');
      if(b.section!==undefined){const sec=String(b.section||'').trim();p.section=(sec&&sec!=='all')?sec:inferProductSection(p);}
      if(b.subtitle!==undefined){
        if(u.role!=='owner') return json(res,403,{error:'A termék aláírását csak OWNER módosíthatja.'});
        p.subtitle=String(b.subtitle||'').slice(0,180);
      }
      audit(db,u,'PRODUCT_UPDATE',p.name); await writeDB(db); return json(res,200,{product:p});
    }

    // ---------- USERS / OWNER ----------
    if(req.method==='GET' && url==='/api/users'){
      const u=auth(req,res,'owner'); if(!u)return;
      return json(res,200,{users:db.users.map(publicUser)});
    }

    if(req.method==='POST' && url==='/api/users'){
      const u=auth(req,res,'owner'); if(!u)return;
      const b=await readBody(req);
      if(!b.username||!b.password||!b.name)return json(res,400,{error:'Név, felhasználónév és jelszó kötelező'});
      if(db.users.some(x=>x.username.toLowerCase()===String(b.username).toLowerCase()))return json(res,409,{error:'Ez a felhasználónév már létezik'});
      const role=['staff','manager','owner','dj'].includes(b.role)?b.role:'staff';
      const hp=hashPassword(String(b.password));
      const job=STAFF_JOBS.includes(String(b.job||''))?String(b.job||''):'';
      const nu={id:'u_'+crypto.randomBytes(6).toString('hex'),username:String(b.username),name:String(b.name),role,job,passwordHash:`PBKDF2:310000:sha256:${hp.salt}:${hp.hash}`};
      db.users.push(nu);
      audit(db,u,'USER_CREATE',`${nu.name} (${nu.role})`);
      await writeDB(db);
      return json(res,201,{user:publicUser(nu)});
    }

    if(req.method==='POST' && url.startsWith('/api/users/') && url.endsWith('/force-logout')){
      const u=auth(req,res,'owner'); if(!u)return;
      const id=decodeURIComponent(url.slice('/api/users/'.length,-'/force-logout'.length));
      if(id===u.id)return json(res,400,{error:'A saját aktív munkamenetedet innen nem léptetheted ki.'});
      const target=db.users.find(x=>x.id===id); if(!target)return json(res,404,{error:'Felhasználó nem található'});
      let count=0; for(const [sid,session] of [...sessions.entries()]){ if(session.id===id){sessions.delete(sid);count++;} }
      audit(db,u,'FORCE_LOGOUT',`${target.name} · ${count} munkamenet lezárva`); await writeDB(db);
      broadcastRealtime('session_revoked',{targetUserId:id,reason:'owner_force_logout'}); broadcastClub('session_revoked',{targetUserId:id,reason:'owner_force_logout'}); broadcastRealtime('presence');
      return json(res,200,{ok:true,count});
    }

    if(req.method==='PATCH' && url.startsWith('/api/users/')){
      const u=auth(req,res,'owner'); if(!u)return;
      const id=decodeURIComponent(url.split('/').pop());
      const target=db.users.find(x=>x.id===id);
      if(!target)return json(res,404,{error:'Felhasználó nem található'});
      const b=await readBody(req);
      const nextName=String(b.name??target.name).trim();
      const nextUsername=String(b.username??target.username).trim();
      const nextRole=String(b.role??target.role).toLowerCase();
      const newPassword=String(b.password??'');
      if(!nextName||!nextUsername)return json(res,400,{error:'A név és a felhasználónév kötelező'});
      if(!['staff','manager','owner','dj'].includes(nextRole))return json(res,400,{error:'Érvénytelen jogosultsági szint'});
      const duplicate=db.users.find(x=>x.id!==id && x.username.toLowerCase()===nextUsername.toLowerCase());
      if(duplicate)return json(res,409,{error:'Ez a felhasználónév már használatban van'});
      if(target.role==='owner' && nextRole!=='owner' && db.users.filter(x=>x.role==='owner').length<=1){
        return json(res,400,{error:'Az utolsó OWNER jogosultság nem vehető el.'});
      }
      target.name=nextName;
      target.username=nextUsername;
      target.role=nextRole;
      if(b.job!==undefined){
        const nextJob=String(b.job||'');
        if(!STAFF_JOBS.includes(nextJob))return json(res,400,{error:'Érvénytelen beosztás.'});
        target.job=nextJob;
      }
      let passwordChanged=false;
      if(newPassword){
        const hp=hashPassword(newPassword);
        target.passwordHash=`PBKDF2:310000:sha256:${hp.salt}:${hp.hash}`;
        passwordChanged=true;
      }
      const revokedSessionIds=[];
      for(const [sid,session] of sessions.entries()){
        if(session.id===target.id){
          if(passwordChanged){
            revokedSessionIds.push(sid);
            sessions.delete(sid);
          } else {
            session.username=target.username;
            session.name=target.name;
            session.role=target.role;
            session.portal=target.role==='dj'?'dj':'staff';
            session.lastSeen=Date.now();
          }
        }
      }
      audit(db,u,'USER_UPDATE',`${target.name} (${target.username}) · ${target.role}${passwordChanged?' · jelszó frissítve · aktív munkamenetek kiléptetve':''}`);
      await writeDB(db);
      if(passwordChanged){
        broadcastRealtime('session_revoked',{targetUserId:target.id,reason:'password_changed'});
      }
      return json(res,200,{user:publicUser(target),sessionRevoked:passwordChanged});
    }

    if(req.method==='DELETE' && url.startsWith('/api/users/')){
      const u=auth(req,res,'owner'); if(!u)return;
      const id=decodeURIComponent(url.split('/').pop());
      if(id===u.id)return json(res,400,{error:'A saját OWNER fiókodat nem törölheted.'});
      const target=db.users.find(x=>x.id===id);
      if(!target)return json(res,404,{error:'Felhasználó nem található'});
      if(target.role==='owner' && db.users.filter(x=>x.role==='owner').length<=1)return json(res,400,{error:'Az utolsó OWNER fiók nem törölhető.'});
      db.users=db.users.filter(x=>x.id!==id);
      for(const [sid,session] of sessions.entries()) if(session.id===id) sessions.delete(sid);
      audit(db,u,'USER_DELETE',`${target.name} (${target.username})`);
      await writeDB(db);
      return json(res,200,{ok:true});
    }

    // ---------- OWNER ACTIVITY ----------
    if(req.method==='GET' && url==='/api/owner/activity'){
      const u=auth(req,res,'owner'); if(!u)return;
      db.finance ||= {};
      const resetAt=Date.parse(db.finance.activityResetAt||0)||0, now=Date.now();
      const rows=db.users.filter(x=>x.role!=='dj').map(user=>{
        let workedMs=0, shifts=0;
        for(const sh of db.shifts||[]){
          const end=sh.status==='open'?now:Date.parse(sh.endedAt||0); if(!end||end<=resetAt)continue;
          const hist=(Array.isArray(sh.memberHistory)&&sh.memberHistory.length)?sh.memberHistory:(sh.members||[]).map(name=>({name,userId:db.users.find(x=>x.name===name)?.id||null,joinedAt:sh.startedAt}));
          const m=hist.find(x=>x.userId===user.id || (!x.userId&&x.name===user.name)); if(!m)continue;
          const start=Math.max(Date.parse(m.joinedAt||sh.startedAt)||0,resetAt); if(end>start){workedMs+=end-start;shifts++;}
        }
        const own=(db.sales||[]).filter(x=>x.userId===user.id && (Date.parse(x.at||0)||0)>=resetAt);
        const tx=new Set(own.map(x=>x.transactionId||x.cartId||x.id));
        const active=(db.shifts||[]).some(sh=>sh.status==='open' && ((sh.memberIds||[]).includes(user.id) || (sh.members||[]).includes(user.name)));
        return {id:user.id,name:user.name,role:user.role,workedMs,active,shifts,sales:tx.size,items:own.reduce((a,x)=>a+Number(x.qty||0),0),revenue:own.reduce((a,x)=>a+Number(x.total||0),0)};
      }).sort((a,b)=>b.workedMs-a.workedMs || b.revenue-a.revenue || a.name.localeCompare(b.name,'hu'));
      return json(res,200,{resetAt:db.finance.activityResetAt||null,generatedAt:new Date().toISOString(),staff:rows});
    }
    if(req.method==='POST' && url==='/api/owner/activity/reset'){
      const u=auth(req,res,'owner'); if(!u)return;
      db.finance ||= {}; db.finance.activityResetAt=new Date().toISOString();
      audit(db,u,'STAFF_ACTIVITY_RESET','Dolgozói aktivitás nullázva'); await writeDB(db);
      return json(res,200,{ok:true,resetAt:db.finance.activityResetAt});
    }

    // ---------- OWNER PERFORMANCE ----------
    if(req.method==='GET' && url==='/api/owner/performance'){
      const u=auth(req,res,'owner'); if(!u)return;
      const now=Date.now();
      const shifts=db.shifts.filter(s=>s.status==='closed');
      const userMap={};
      for(const s of shifts){
        const sales=db.sales.filter(x=>x.shiftId===s.id);
        const duration=Math.max(0,(new Date(s.endedAt)-new Date(s.startedAt))/3600000);
        for(const name of (s.members||[s.startedByName])){
          userMap[name] ||= {name,shifts:0,revenue:0,sales:0,items:0,hours:0};
          userMap[name].shifts++;
          userMap[name].revenue+=s.revenue||sales.reduce((a,x)=>a+x.total,0);
          userMap[name].sales+=sales.filter(x=>x.user===name).length;
          userMap[name].items+=sales.filter(x=>x.user===name).reduce((a,x)=>a+x.qty,0);
          userMap[name].hours+=duration;
        }
      }
      const staff=Object.values(userMap).map(x=>({...x,revenuePerHour:x.hours?Math.round(x.revenue/x.hours):0}));
      const shiftBreakdown=shifts.map(s=>{
        const ss=db.sales.filter(x=>x.shiftId===s.id);
        const byUser={};
        for(const x of ss){
          byUser[x.user] ||= {name:x.user,revenue:0,sales:0,items:0};
          byUser[x.user].revenue+=x.total; byUser[x.user].sales++; byUser[x.user].items+=x.qty;
        }
        return {...s,employees:Object.values(byUser)};
      });
      const productMap={};
      for(const s of db.sales){productMap[s.product]=(productMap[s.product]||0)+s.qty}
      const topProducts=Object.entries(productMap).map(([product,qty])=>({product,qty})).sort((a,b)=>b.qty-a.qty).slice(0,12);
      return json(res,200,{staff,shifts:shifts.slice(0,100),shiftBreakdown:shiftBreakdown.slice(0,100),topProducts,generatedAt:new Date().toISOString()});
    }

    return json(res,404,{error:'API útvonal nem található'});
  }catch(e){
    if(e && e.rmConflict){
      return json(res,409,{error:'Közben más is módosította az adatot. Próbáld újra.',retry:true});
    }
    console.error(e);
    return json(res,500,{error:'Szerverhiba',detail:process.env.NODE_ENV==='development'?e.message:undefined});
  }
}

const mime={'.html':'text/html; charset=utf-8','.css':'text/css; charset=utf-8','.js':'text/javascript; charset=utf-8','.mjs':'text/javascript; charset=utf-8','.json':'application/json; charset=utf-8','.png':'image/png','.jpg':'image/jpeg','.jpeg':'image/jpeg','.webp':'image/webp','.gif':'image/gif','.mp3':'audio/mpeg','.wav':'audio/wav','.ogg':'audio/ogg','.m4a':'audio/mp4','.svg':'image/svg+xml','.ico':'image/x-icon','.woff':'font/woff','.woff2':'font/woff2','.ttf':'font/ttf','.txt':'text/plain; charset=utf-8'};

// The built single-page app. `npm run build` writes it; in development Vite
// serves the frontend instead and only proxies /api here.
const DIST = path.join(ROOT, 'dist');
const INDEX_HTML = path.join(DIST, 'index.html');
const hasBuild = fs.existsSync(INDEX_HTML);

/** Serves one file, or calls `miss()` when it is not there. */
function sendFile(res, file, miss, cacheControl = 'no-store'){
  fs.stat(file, (err, stat) => {
    if(err || !stat.isFile()) return miss();
    const ext = path.extname(file).toLowerCase();
    res.writeHead(200, {
      'Content-Type': mime[ext] || 'application/octet-stream',
      'Cache-Control': cacheControl
    });
    fs.createReadStream(file).pipe(res);
  });
}

// Vite emits content-hashed names into dist/assets, so those are safe to pin.
const IMMUTABLE = 'public, max-age=31536000, immutable';
// public/assets holds the map tiles and artwork: stable names, but replaceable,
// so cache for a day rather than forever.
const STATIC = 'public, max-age=86400';

/** Blocks path traversal before touching the filesystem. */
function resolveWithin(root, pathname){
  const file = path.normalize(path.join(root, pathname));
  return file.startsWith(root) ? file : null;
}

/**
 * Handles one `/api/...` request, including the per-request state lifecycle.
 *
 * In server mode this is a thin wrapper around `api()`. In function mode it is
 * where the state and the sessions are pulled out of PostgreSQL before the
 * route runs, and where the sessions the route changed are written back.
 */
async function handleApiRequest(req, res, pathname, searchParams){
  if(SERVERLESS) return withRequestLock(() => serveApiRequest(req, res, pathname, searchParams));
  return serveApiRequest(req, res, pathname, searchParams);
}

async function serveApiRequest(req, res, pathname, searchParams){
  req.rmQuery = searchParams || new URLSearchParams();

  try{
    await ensureReady();
  }catch(err){
    console.error('Red Moon database initialization failed:', err);
    return json(res, 503, {error:'Az adatbázis jelenleg nem érhető el.'});
  }

  if(pool) deferResponseUntilSessionsPersisted(res, snapshotSessions());

  await api(req, res, pathname);
}

/**
 * Holds the response back until the sessions this request changed are stored.
 *
 * Doing it after the response instead would be a race: the browser could send
 * its next request — with a cookie whose session has not been written yet — and
 * be told to sign in again. It also loses the write outright if the process is
 * killed at that moment, which is exactly what a deploy does.
 */
function deferResponseUntilSessionsPersisted(res, before){
  const originalEnd = res.end.bind(res);
  let handled = false;

  res.end = (...args) => {
    if(handled) return originalEnd(...args);
    handled = true;
    flushSessions(before)
      // A session that fails to store must not break the response the user
      // already earned; it only means they may have to sign in again.
      .catch((err) => console.error('Session flush failed:', err))
      .finally(() => originalEnd(...args));
    return res;
  };
}

const server=http.createServer(async(req,res)=>{
  const url=new URL(req.url,`http://${req.headers.host||'localhost'}`);
  if(url.pathname.startsWith('/api/')) return handleApiRequest(req,res,url.pathname,url.searchParams);

  let pathname=decodeURIComponent(url.pathname);

  // Legacy .html bookmarks stay valid, redirected to the clean address.
  if(pathname.endsWith('.html')){
    const clean=pathname==='/index.html' ? '/' : pathname.slice(0,-5);
    res.writeHead(301,{Location:clean+(url.search||''),'Cache-Control':'no-store'});
    return res.end();
  }

  if(!hasBuild){
    res.writeHead(503,{'Content-Type':'text/plain; charset=utf-8','Cache-Control':'no-store'});
    return res.end('Build missing. Run "npm run build" before starting the server.');
  }

  const spa = () => sendFile(res, INDEX_HTML, () => res.writeHead(404).end('Not found'));

  if(pathname === '/') return spa();

  // 1) Hashed build output, 2) static assets shipped in public/, 3) the SPA.
  const distFile = resolveWithin(DIST, pathname);
  const publicFile = resolveWithin(PUBLIC, pathname);

  if(!distFile || !publicFile) return res.writeHead(403).end('Forbidden');

  sendFile(
    res,
    distFile,
    () => sendFile(res, publicFile, spa, STATIC),
    pathname.startsWith('/assets/') ? IMMUTABLE : 'no-store'
  );
});

// Only listen when started directly (`npm start`, VPS, Render). When this file
// is required — by the Vercel function in api/index.cjs, or by a test — nothing
// binds a port and the caller drives `handleApiRequest` itself.
if(require.main === module){
  ensureReady().then(()=>{
    server.listen(PORT,()=>console.log(`Red Moon Pub V17 online server running on port ${PORT}${pool?' · PostgreSQL':' · local db.json'}${SERVERLESS?' · function mode':''}`));
  }).catch(err=>{
    console.error('Red Moon database initialization failed:',err);
    process.exit(1);
  });
}

module.exports = {
  /** The shipped drink catalogue, with its starting stock levels. */
  CANONICAL_DRINKS,
  /** Serves one `/api/...` request. Used by the Vercel function. */
  handleApiRequest,
  /** The full Node request handler, API and static files. Used by tests. */
  requestListener: server,
  ensureReady,
  SERVERLESS
};
