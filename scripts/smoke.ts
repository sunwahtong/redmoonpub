/**
 * End-to-end API smoke test.
 *
 * Runs a whole evening against a live server: sign in as the owner, create
 * staff, open a shift and the front door, ring up a sale, issue documents,
 * run a supply order, book a table, chat in the club, close the shift.
 * Every step asserts the status code it expects.
 *
 *   SMOKE_BASE=http://localhost:3100 SMOKE_USER=rm.owner SMOKE_PASS=... npm run smoke
 */
const BASE = process.env.SMOKE_BASE || 'http://localhost:3100';
const USER = process.env.SMOKE_USER || 'rm.owner';
const PASS = process.env.SMOKE_PASS || 'Owner12345';

type Json = Record<string, any>;

const jars = new Map<string, Map<string, string>>();
let failures = 0;

function jar(name: string): Map<string, string> {
  if (!jars.has(name)) jars.set(name, new Map());
  return jars.get(name)!;
}

interface CallOptions {
  headers?: Record<string, string>;
  expect?: number;
}

async function call(who: string, method: string, path: string, body?: unknown, {headers = {}, expect}: CallOptions = {}): Promise<{status: number; data: Json}> {
  const cookies = [...jar(who).entries()].map(([key, value]) => `${key}=${value}`).join('; ');
  const response = await fetch(BASE + path, {
    method,
    headers: {'Content-Type': 'application/json', Origin: BASE, 'Sec-Fetch-Site': 'same-origin', ...(cookies ? {Cookie: cookies} : {}), ...headers},
    body: body === undefined ? undefined : JSON.stringify(body)
  });
  const setCookies = response.headers.getSetCookie?.() || [];
  for (const line of setCookies) {
    const [pair] = line.split(';');
    const index = pair.indexOf('=');
    const key = pair.slice(0, index);
    const value = pair.slice(index + 1);
    if (/Max-Age=0/.test(line)) jar(who).delete(key);
    else jar(who).set(key, value);
  }
  let data: Json = {};
  try {
    data = (await response.json()) as Json;
  } catch {
    data = {};
  }
  const ok = expect === undefined ? response.ok : response.status === expect;
  const tag = ok ? 'ok ' : 'FAIL';
  if (!ok) failures += 1;
  console.log(`${tag} ${String(response.status).padEnd(3)} ${method.padEnd(6)} ${path}${ok ? '' : ' → ' + JSON.stringify(data)}`);
  return {status: response.status, data};
}

const owner = 'owner';

// ---------- public, signed out ----------
await call('guest', 'GET', '/api/health');
await call('guest', 'GET', '/api/public/status');
await call('guest', 'GET', '/api/public/house');
await call('guest', 'GET', '/api/me');
await call('guest', 'GET', '/api/products', undefined, {expect: 401});
await call('guest', 'POST', '/api/login', {username: USER, password: 'wrong-password'}, {expect: 401});
await call('guest', 'POST', '/api/login', {username: 'nobody', password: 'wrong-password'}, {expect: 401});

// ---------- owner ----------
const login = await call(owner, 'POST', '/api/login', {username: USER, password: PASS});
const me = login.data?.user;
if (!me) {
  console.error('Login failed, cannot continue.');
  process.exit(1);
}
await call(owner, 'GET', '/api/me');
await call(owner, 'POST', '/api/presence/heartbeat', {});
await call(owner, 'GET', '/api/presence');
await call(owner, 'GET', '/api/dashboard');
await call(owner, 'GET', '/api/notifications');
await call(owner, 'GET', '/api/audit');

// cross-site request must be refused
{
  const response = await fetch(BASE + '/api/presence/heartbeat', {
    method: 'POST',
    headers: {'Content-Type': 'application/json', Origin: 'https://evil.example', 'Sec-Fetch-Site': 'cross-site', Cookie: [...jar(owner).entries()].map(([k, v]) => `${k}=${v}`).join('; ')}
  });
  console.log(`${response.status === 403 ? 'ok ' : 'FAIL'} ${response.status} POST   /api/presence/heartbeat (cross-site)`);
  if (response.status !== 403) failures += 1;
}

// ---------- staff accounts ----------
const stamp = Date.now().toString(36);
const bartender = await call(owner, 'POST', '/api/users', {username: `smoke.bar.${stamp}`, password: 'Bar12345x', name: 'Smoke Bartender', role: 'staff', jobs: ['bartender'], mustChangePassword: false}, {expect: 201});
const manager = await call(owner, 'POST', '/api/users', {username: `smoke.mgr.${stamp}`, password: 'Mgr12345x', name: 'Smoke Manager', role: 'manager', jobs: ['uzletvezeto', 'dj'], mustChangePassword: false}, {expect: 201});
if (!manager.data?.user?.hasSignature) {
  console.log('FAIL manager account has no signature');
  failures += 1;
}
await call(owner, 'PATCH', `/api/users/${bartender.data.user.id}`, {jobs: ['bartender', 'biztonsag']});
await call(owner, 'POST', `/api/users/${manager.data.user.id}/signature`, {});
await call(owner, 'POST', '/api/users', {username: 'x', password: 'short', name: 'Bad'}, {expect: 400});

// ---------- house ----------
await call(owner, 'GET', '/api/house');
await call(owner, 'PATCH', '/api/house', {hourlyWage: 2000, registration: 'SC-RM-0001'});
await call(owner, 'GET', '/api/documents/context');
await call(owner, 'POST', '/api/house/pub/open', {}, {expect: 409}); // no shift yet

// ---------- shift ----------
await call(owner, 'POST', '/api/shifts/open', {openingCash: 5000, memberIds: []}, {expect: 400});
const shift = await call(owner, 'POST', '/api/shifts/open', {openingCash: 5000, memberIds: [bartender.data.user.id]}, {expect: 201});
await call(owner, 'GET', '/api/shifts/current');
await call(owner, 'POST', '/api/shifts/members', {userId: me.id});
await call(owner, 'POST', '/api/house/pub/open', {note: 'Smoke test'});
const status = await call('guest', 'GET', '/api/public/status');
if (!status.data?.open) {
  console.log('FAIL public status should be open');
  failures += 1;
}

// ---------- register ----------
const sale = await call(owner, 'POST', '/api/sales', {items: [{productId: 'p_kobaltas', qty: 2}, {productId: 'p_ragga', qty: 1}], paymentMethod: 'cash'}, {expect: 201});
await call(owner, 'POST', '/api/sales', {items: [{productId: 'p_kobaltas', qty: 99999}]}, {expect: 400});
await call(owner, 'GET', '/api/sales');
await call(owner, 'POST', '/api/receipts', {saleId: sale.data.sales[0].id});
await call(owner, 'POST', '/api/documents', {saleId: sale.data.sales[0].id, customer: {name: 'Smoke Kft.', address: 'See City', taxNumber: '123'}}, {expect: 201});
await call(owner, 'GET', '/api/documents');

// ---------- stock, orders ----------
await call(owner, 'POST', '/api/restock', {source: 'nagyker', items: [{productId: 'p_kobaltas', qty: 10, unitCost: 400}]}, {expect: 201});
await call(owner, 'GET', '/api/restock/logs');
const order = await call(owner, 'POST', '/api/orders', {items: [{productId: 'p_ragga', qty: 4, unitCost: 5000}], source: 'Nagyker', note: 'smoke'}, {expect: 201});
await call(owner, 'POST', `/api/orders/${order.data.order.id}/claim`, {});
await call(owner, 'POST', `/api/orders/${order.data.order.id}/start`, {});
await call(owner, 'POST', `/api/orders/${order.data.order.id}/complete`, {actualTotal: 21000, varianceNote: 'drágult'});
await call(owner, 'GET', '/api/orders');
await call(owner, 'GET', '/api/analytics/storage');
await call(owner, 'GET', '/api/analytics/business');
await call(owner, 'GET', '/api/analytics/me');
await call(owner, 'GET', '/api/owner/activity');
await call(owner, 'GET', '/api/owner/performance');
await call(owner, 'GET', '/api/finance/overall');

// ---------- catalogue & showcase ----------
const product = await call(owner, 'POST', '/api/products', {name: 'Smoke Lager', category: 'drink', section: 'beer', price: 900, stock: 5, minStock: 2}, {expect: 201});
await call(owner, 'PATCH', `/api/products/${product.data.product.id}`, {price: 950, subtitle: 'teszt'});
await call(owner, 'PUT', '/api/signature-drinks', {drinks: [{productId: 'p_ragga', description: 'A'}, {productId: 'p_kobaltas', description: 'B'}, {productId: product.data.product.id, description: 'C'}]});
await call('guest', 'GET', '/api/public-signature-drinks');
const event = await call(owner, 'POST', '/api/events', {title: 'Smoke Night', startsAt: new Date(Date.now() + 86400000).toISOString(), tag: 'LIVE DJ', featured: true, entryFee: 0}, {expect: 201});
await call(owner, 'PATCH', `/api/events/${event.data.event.id}`, {subtitle: 'A vörös hold alatt'});
await call('guest', 'GET', '/api/public-events');
await call(owner, 'POST', '/api/map-blips', {x: 100, y: 200, kind: 'bar', label: 'Smoke blip'}, {expect: 201});
await call('guest', 'GET', '/api/public-map-blips');
await call(owner, 'POST', '/api/house/people', {name: 'Smoke Person', title: 'Teszt', tier: 'manager'}, {expect: 201});

// ---------- guests ----------
const token = `v_smoke_${stamp}`;
const booking = await call('guest', 'POST', '/api/reservations', {name: 'Smoke Guest', phone: '1234567', guests: 3, at: new Date(Date.now() + 3 * 3600000).toISOString(), occasion: 'este', tier: 'none', note: '', visitorToken: token}, {expect: 201});
await call('guest', 'GET', `/api/reservations/mine?token=${token}`);
await call(owner, 'GET', '/api/reservations');
await call(owner, 'PATCH', `/api/reservations/${booking.data.reservation.id}`, {status: 'confirmed', staffNote: 'Várunk!'});
await call('guest', 'DELETE', `/api/reservations/${booking.data.reservation.id}`, {visitorToken: token});
const application = await call('guest', 'POST', '/api/careers', {name: 'Smoke Applicant', phone: '7654321', age: 22, position: 'bartender', availability: 'este', experience: '', why: 'Mert a Red Moon a legjobb hely a városban, ezért.', visitorToken: token}, {expect: 201});
await call(owner, 'GET', '/api/applications');
await call(owner, 'PATCH', `/api/applications/${application.data.application.id}`, {status: 'interview', staffNote: 'Gyere be'});
await call('guest', 'POST', '/api/reviews', {name: 'Smoke', rating: 5, text: 'Remek hely.', visitorToken: token}, {expect: 201, headers: {'X-Review-Token': token}});
await call('guest', 'POST', '/api/reviews', {name: 'Smoke', rating: 5, text: 'Remek hely.', visitorToken: token}, {expect: 409, headers: {'X-Review-Token': token}});
await call('guest', 'GET', '/api/reviews', undefined, {headers: {'X-Review-Token': token}});

// ---------- club ----------
await call('guest', 'POST', '/api/club/listener', {id: `c_${stamp}`});
await call('guest', 'GET', `/api/club/name-status?clientId=c_${stamp}`);
await call('guest', 'POST', '/api/club/name-request', {name: 'SmokeListener', clientId: `c_${stamp}`}, {expect: 201});
const djState = await call(owner, 'GET', '/api/dj/state');
const pendingName = djState.data?.state?.nameRequests?.[0];
if (pendingName) await call(owner, 'POST', '/api/club/name-decision', {id: pendingName.id, action: 'accept'});
const named = await call('guest', 'GET', `/api/club/name-status?clientId=c_${stamp}`);
if (named.data?.status === 'accepted') {
  await call('guest', 'POST', '/api/club/chat', {name: 'SmokeListener', text: 'Hello!', token: named.data.token}, {expect: 201});
  await call('guest', 'POST', '/api/club/chat', {name: 'SmokeListener', text: 'Too fast', token: named.data.token}, {expect: 429});
  await call('guest', 'POST', '/api/club/request', {title: 'Smoke song', token: named.data.token}, {expect: 201});
} else {
  console.log('FAIL listener not accepted', named.data);
  failures += 1;
}
await call(owner, 'POST', '/api/dj/live', {live: true, title: 'Smoke Live'});
await call('guest', 'GET', '/api/club/state');
await call(owner, 'POST', '/api/dj/chat', {text: 'DJ here'}, {expect: 201});
await call(owner, 'POST', '/api/dj/live', {live: false});

// ---------- bartender session (single session rule) ----------
await call('bar', 'POST', '/api/login', {username: bartender.data.user.username, password: 'Bar12345x'});
await call('bar2', 'POST', '/api/login', {username: bartender.data.user.username, password: 'Bar12345x'}, {expect: 409});
await call('bar2', 'POST', '/api/login', {username: bartender.data.user.username, password: 'Bar12345x', force: true});
await call('bar', 'GET', '/api/me');
await call('bar2', 'GET', '/api/users', undefined, {expect: 403});
await call('bar2', 'POST', '/api/profile/phone', {phone: '1112222'});
await call('bar2', 'POST', '/api/profile/password', {currentPassword: 'Bar12345x', newPassword: 'Bar12345y'});
await call('bar2', 'POST', '/api/logout', {});
await call('bar2', 'GET', '/api/products', undefined, {expect: 401});

// ---------- close ----------
await call(owner, 'POST', '/api/shifts/close', {closingCash: 9000, notes: 'smoke'});
const closed = await call('guest', 'GET', '/api/public/status');
if (closed.data?.open) {
  console.log('FAIL pub should close with the shift');
  failures += 1;
}
await call(owner, 'GET', `/api/shifts/${shift.data.shift.id}`);
await call(owner, 'GET', '/api/shifts');
await call(owner, 'DELETE', `/api/users/${bartender.data.user.id}`);
await call(owner, 'DELETE', `/api/users/${manager.data.user.id}`);
await call(owner, 'POST', '/api/logout', {});

console.log(failures ? `\n${failures} FAILED` : '\nALL OK');
process.exit(failures ? 1 : 0);
