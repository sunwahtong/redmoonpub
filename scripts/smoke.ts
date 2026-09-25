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
  expect?: number | number[];
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
  const ok = expect === undefined ? response.ok : Array.isArray(expect) ? expect.includes(response.status) : response.status === expect;
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
// Takes over any session left open by a browser run, so the suite is repeatable.
const login = await call(owner, 'POST', '/api/login', {username: USER, password: PASS, force: true});
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
await call(owner, 'PATCH', '/api/house', {registration: 'SC-RM-0001'});
await call(owner, 'GET', '/api/documents/context');

// ---------- family tree order, gallery, signature ----------
const houseData = await call(owner, 'GET', '/api/house');
const people = (houseData.data?.people || []) as {id: string; tier: string}[];
if (people.length) {
  await call(owner, 'PUT', '/api/house/people/order', people.map((person, index) => ({id: person.id, tier: person.tier, sortOrder: index})));
}
await call('guest', 'GET', '/api/public/gallery');
const shot = await call(owner, 'POST', '/api/gallery', {title: 'SMOKE', caption: 'teszt', tag: 'este', imageUrl: '/assets/red-moon-logo.png', width: 800, height: 800}, {expect: 201});
await call(owner, 'PATCH', `/api/gallery/${shot.data.item.id}`, {caption: 'teszt 2', active: false});
await call(owner, 'PUT', '/api/gallery/order', [{id: shot.data.item.id, sortOrder: 0}]);
await call(owner, 'POST', '/api/gallery', {title: 'BAD', imageUrl: 'https://evil.example/x.png'}, {expect: 400});
await call(owner, 'DELETE', `/api/gallery/${shot.data.item.id}`);
await call(owner, 'POST', '/api/media/sign', {kind: 'image', purpose: 'gallery', filename: 'x.png', size: 1000});
await call(owner, 'POST', '/api/media/sign', {kind: 'image', purpose: 'gallery', filename: 'x.exe', size: 1000}, {expect: 400});
await call('mgr', 'POST', '/api/login', {username: manager.data.user.username, password: 'Mgr12345x'});
const mgrMe = await call('mgr', 'GET', '/api/me');
if (!mgrMe.data?.user?.signaturePrompt) {
  console.log('FAIL new manager should be asked to choose a signature', mgrMe.data?.user);
  failures += 1;
}
await call('mgr', 'PUT', '/api/profile/signature', {mode: 'generated', seed: 'smoke:1'});
await call('mgr', 'PUT', '/api/profile/signature', {mode: 'draw', path: 'M 20 60 C 40 20, 60 20, 80 60 L 120 50'});
await call('mgr', 'PUT', '/api/profile/signature', {mode: 'draw', path: '<script>'}, {expect: 400});
await call('mgr', 'PUT', '/api/profile/signature', {mode: 'upload', image: 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg=='});
const decided = await call('mgr', 'PUT', '/api/profile/signature', {mode: 'keep'});
if (decided.data?.user?.signaturePrompt !== false || decided.data?.user?.signatureKind !== 'uploaded') {
  console.log('FAIL signature choice not recorded', decided.data?.user);
  failures += 1;
}
if (!/\/signature\/.+\.png/.test(String(decided.data?.user?.signatureUrl || ''))) {
  console.log('FAIL uploaded signature should live in the media store as a PNG', decided.data?.user?.signatureUrl);
  failures += 1;
}
// Profile pictures come from the media store too: inline data is refused, clearing is fine.
await call('mgr', 'PATCH', '/api/profile', {avatar: 'data:image/png;base64,iVBORw0KGgo='}, {expect: 400});
await call('mgr', 'PATCH', '/api/profile', {avatar: 'https://example.com/x.png', avatarPublicId: 'redmoon/avatar/x'}, {expect: 400});
await call('mgr', 'PATCH', '/api/profile', {avatar: '', avatarPublicId: ''});
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
await call(owner, 'PATCH', `/api/reservations/${booking.data.reservation.id}`, {status: 'reviewing'});
await call('guest', 'POST', `/api/reservations/${booking.data.reservation.id}/messages`, {visitorToken: token, text: 'Lehet ablak mellé?'}, {expect: 201});
await call('guest', 'POST', `/api/reservations/${booking.data.reservation.id}/messages`, {visitorToken: 'wrong', text: 'x'}, {expect: 403});
await call(owner, 'GET', `/api/reservations/${booking.data.reservation.id}/messages`);
await call(owner, 'POST', `/api/reservations/${booking.data.reservation.id}/messages`, {text: 'Persze, ablak mellé.'});
await call(owner, 'POST', `/api/reservations/${booking.data.reservation.id}/read`, {});
const mine = await call('guest', 'GET', `/api/reservations/mine?token=${token}`);
if ((mine.data?.reservations?.[0]?.messages || []).length !== 2 || mine.data?.reservations?.[0]?.unread !== 1) {
  console.log('FAIL reservation thread', mine.data?.reservations?.[0]);
  failures += 1;
}
await call('guest', 'POST', `/api/reservations/${booking.data.reservation.id}/read`, {visitorToken: token});
await call(owner, 'PATCH', `/api/reservations/${booking.data.reservation.id}`, {status: 'waitlist'});
await call(owner, 'PATCH', `/api/reservations/${booking.data.reservation.id}`, {status: 'confirmed', staffNote: 'Várunk!'});
await call(owner, 'PATCH', `/api/reservations/${booking.data.reservation.id}`, {status: 'bogus'}, {expect: 400});
await call('guest', 'DELETE', `/api/reservations/${booking.data.reservation.id}`, {visitorToken: token});
await call('guest', 'POST', '/api/careers', {name: 'Old Role', phone: '7654321', age: 22, position: 'hostess', availability: 'este', experience: '', why: 'Mert a Red Moon a legjobb hely a városban, ezért.', visitorToken: token}, {expect: 400});
const application = await call('guest', 'POST', '/api/careers', {name: 'Smoke Applicant', phone: '7654321', age: 22, position: 'bartender', availability: 'este', experience: '', why: 'Mert a Red Moon a legjobb hely a városban, ezért.', visitorToken: token}, {expect: 201});
await call(owner, 'GET', '/api/applications');
await call(owner, 'PATCH', `/api/applications/${application.data.application.id}`, {status: 'interview', staffNote: 'Gyere be'});
await call('guest', 'POST', '/api/reviews', {name: 'Smoke', rating: 5, text: 'Remek hely.', visitorToken: token}, {expect: 201, headers: {'X-Review-Token': token}});
await call('guest', 'POST', '/api/reviews', {name: 'Smoke', rating: 5, text: 'Remek hely.', visitorToken: token}, {expect: 409, headers: {'X-Review-Token': token}});
await call('guest', 'GET', '/api/reviews', undefined, {headers: {'X-Review-Token': token}});

// ---------- club ----------
// A previous run on this machine may have left a listener behind; clear it so the flow is repeatable.
const before = await call(owner, 'GET', '/api/dj/state');
for (const listener of (before.data?.state?.registeredListeners || []) as {name: string; ip: string; browserHash: string}[]) {
  if (listener.name === 'SmokeListener') await call(owner, 'POST', '/api/club/listener-action', {action: 'remove', ip: listener.ip, browserHash: listener.browserHash});
}
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
  await call('guest', 'POST', '/api/club/color', {token: named.data.token, color: '#4cc9f0'});
  await call('guest', 'POST', '/api/club/color', {token: named.data.token, color: 'red'}, {expect: 400});
  await call('guest', 'POST', '/api/club/request', {title: 'Smoke song', token: named.data.token}, {expect: [201, 429]});
  const requests = await call(owner, 'GET', '/api/dj/state');
  const pendingRequest = (requests.data?.state?.requests || []).find((entry: {status: string}) => entry.status === 'pending');
  if (pendingRequest) {
    // Anyone in the room backs a request; a second tap takes the vote back.
    const up = await call('guest', 'POST', `/api/club/request/${pendingRequest.id}/vote`, {clientId: `c_${stamp}`});
    if (up.data?.voted !== true || up.data?.votes !== 1) {
      console.log('FAIL request vote not counted', up.data);
      failures += 1;
    }
    await call('guest', 'POST', `/api/club/request/${pendingRequest.id}/vote`, {clientId: `c_${stamp}`}, {expect: 429});
    await call(owner, 'POST', '/api/dj/request', {id: pendingRequest.id, action: 'played'});
    const played = await call('guest', 'GET', '/api/club/state');
    if (!(played.data?.state?.setlist || []).some((entry: {source: string}) => entry.source === 'request')) {
      console.log('FAIL a played request should join the setlist', played.data?.state?.setlist);
      failures += 1;
    }
  }
  // Reactions need no name; the vibe counts them.
  const reaction = await call('guest', 'POST', '/api/club/react', {emoji: '🔥', clientId: `c_${stamp}`, token: named.data.token});
  if (!reaction.data?.vibe) {
    console.log('FAIL reaction not counted', reaction.data);
    failures += 1;
  }
  await call('guest', 'POST', '/api/club/react', {emoji: '💣', clientId: `c_${stamp}`}, {expect: 400});
  const colored = await call('guest', 'GET', '/api/club/state');
  if (!(colored.data?.state?.people || []).some((person: {name: string; color: string}) => person.name === 'SmokeListener' && person.color === '#4cc9f0')) {
    console.log('FAIL listener colour not applied', colored.data?.state?.people);
    failures += 1;
  }
} else {
  console.log('FAIL listener not accepted', named.data);
  failures += 1;
}
await call(owner, 'POST', '/api/dj/live', {live: true, title: 'Smoke Live', streamUrl: 'https://stream.example.com/redmoon', providerUrl: 'https://gocast.fm/station/red-moon-pub'});
await call(owner, 'PATCH', '/api/dj/stream', {streamUrl: 'not a url'}, {expect: 400});
const liveStatus = await call('guest', 'GET', '/api/public/status');
if (!liveStatus.data?.live || liveStatus.data?.streamUrl !== 'https://stream.example.com/redmoon') {
  console.log('FAIL live status should carry the stream', liveStatus.data);
  failures += 1;
}
await call('guest', 'GET', '/api/club/state');
await call(owner, 'POST', '/api/dj/chat', {text: 'DJ here'}, {expect: 201});

// ---------- the booth's new tools ----------
await call(owner, 'POST', '/api/dj/announce', {title: 'Smack That', artist: 'Akon'}, {expect: 201});
await call(owner, 'POST', '/api/dj/announce', {title: ''}, {expect: 400});
await call(owner, 'PATCH', '/api/dj/notice', {text: 'Kérések nyitva!'});
await call(owner, 'PATCH', '/api/dj/chat-mode', {slowSeconds: 15, requestsOpen: false});
await call(owner, 'PATCH', '/api/dj/chat-mode', {slowSeconds: 7}, {expect: 400});
if (named.data?.status === 'accepted') {
  await call('guest', 'POST', '/api/club/request', {title: 'Closed door', token: named.data.token}, {expect: [409, 429]});
}
const poll = await call(owner, 'POST', '/api/dj/poll', {question: 'Merre menjen az este?', options: ['House', 'Hip-hop', 'Retro'], minutes: 5}, {expect: 201});
await call(owner, 'POST', '/api/dj/poll', {question: 'x', options: ['csak egy']}, {expect: 400});
if (poll.data?.poll?.id) {
  const vote = await call('guest', 'POST', `/api/club/poll/${poll.data.poll.id}/vote`, {optionId: 'o2', clientId: `c_${stamp}`});
  if (vote.data?.poll?.total !== 1) {
    console.log('FAIL poll vote not counted', vote.data);
    failures += 1;
  }
  await call('guest', 'POST', `/api/club/poll/${poll.data.poll.id}/vote`, {optionId: 'nope', clientId: `c_${stamp}`}, {expect: [400, 429]});
  const closed = await call(owner, 'POST', `/api/dj/poll/${poll.data.poll.id}/close`, {});
  if (closed.data?.poll?.open !== false) {
    console.log('FAIL poll should be closed', closed.data?.poll);
    failures += 1;
  }
  await call('guest', 'POST', `/api/club/poll/${poll.data.poll.id}/vote`, {optionId: 'o1', clientId: `c_${stamp}_b`}, {expect: [409, 429]});
  await call(owner, 'DELETE', `/api/dj/poll/${poll.data.poll.id}`);
}
const withNotice = await call('guest', 'GET', '/api/club/state');
if (withNotice.data?.state?.notice !== 'Kérések nyitva!' || withNotice.data?.state?.slowMode !== 15 || withNotice.data?.state?.requestsOpen !== false || !withNotice.data?.state?.station) {
  console.log('FAIL club state should carry notice, slow mode, request gate and station', withNotice.data?.state);
  failures += 1;
}
const announced = (withNotice.data?.state?.setlist || []).find((entry: {source: string; artist: string}) => entry.source === 'announce' && entry.artist === 'Akon');
if (!announced) {
  console.log('FAIL announced track missing from the setlist', withNotice.data?.state?.setlist);
  failures += 1;
} else {
  await call(owner, 'DELETE', `/api/dj/setlist/${announced.id}`);
}
await call(owner, 'PATCH', '/api/dj/notice', {text: ''});
await call(owner, 'PATCH', '/api/dj/chat-mode', {slowSeconds: 0, requestsOpen: true});
await call(owner, 'DELETE', '/api/dj/chat');
const cleared = await call('guest', 'GET', '/api/club/state');
if ((cleared.data?.state?.chat || []).filter((entry: {kind: string}) => entry.kind !== 'system').length) {
  console.log('FAIL chat should be empty after a clear', cleared.data?.state?.chat);
  failures += 1;
}
await call(owner, 'POST', '/api/dj/live', {live: false});
// Back to the station's own mount: an empty address means the derived one.
const derived = await call(owner, 'PATCH', '/api/dj/stream', {streamUrl: ''});
if (derived.data?.state?.streamUrl !== 'https://icecast.gocast.fm/stream/red-moon-pub' || derived.data?.state?.customStreamUrl !== '') {
  console.log('FAIL empty stream address should fall back to the station mount', derived.data?.state?.streamUrl, derived.data?.state?.customStreamUrl);
  failures += 1;
}
const silent = await call('guest', 'GET', '/api/public/status');
if (silent.data?.onAir !== false) {
  console.log('FAIL a booth over a silent station must not be on air', silent.data);
  failures += 1;
}

// ---------- news, "ott leszek", the staff board ----------
const post = await call(owner, 'POST', '/api/posts', {title: 'Smoke hír', body: 'Első bekezdés.\n\nMásodik bekezdés.', pinned: true}, {expect: 201});
await call(owner, 'POST', '/api/posts', {title: 'x'}, {expect: 400});
await call('guest', 'POST', '/api/posts', {title: 'Nem'}, {expect: 401});
await call(owner, 'PATCH', `/api/posts/${post.data.post.id}`, {imageUrl: 'https://evil.example/x.png', imagePublicId: 'nope'}, {expect: 400});
await call(owner, 'PATCH', `/api/posts/${post.data.post.id}`, {pinned: false});
const publicPosts = await call('guest', 'GET', '/api/public/posts');
if (!(publicPosts.data?.posts || []).some((entry: {id: string; pinned: boolean}) => entry.id === post.data.post.id && entry.pinned === false)) {
  console.log('FAIL the post should be public and unpinned', publicPosts.data);
  failures += 1;
}
await call(owner, 'DELETE', `/api/posts/${post.data.post.id}`);

const rsvpEvent = await call(owner, 'POST', '/api/events', {title: 'Smoke Night', startsAt: new Date(Date.now() + 86400000).toISOString()}, {expect: 201});
const going = await call('guest', 'POST', `/api/public-events/${rsvpEvent.data.event.id}/rsvp`, {visitorToken: token});
if (going.data?.going !== true || going.data?.count !== 1) {
  console.log('FAIL rsvp should count once', going.data);
  failures += 1;
}
const events = await call('guest', 'GET', '/api/public-events');
if (!(events.data?.events || []).some((entry: {id: string; going: number}) => entry.id === rsvpEvent.data.event.id && entry.going === 1)) {
  console.log('FAIL public events should carry the count', events.data);
  failures += 1;
}
const back = await call('guest', 'POST', `/api/public-events/${rsvpEvent.data.event.id}/rsvp`, {visitorToken: token});
if (back.data?.going !== false || back.data?.count !== 0) {
  console.log('FAIL a second tap should take the rsvp back', back.data);
  failures += 1;
}
await call('guest', 'POST', `/api/public-events/${rsvpEvent.data.event.id}/rsvp`, {}, {expect: 400});
await call(owner, 'DELETE', `/api/events/${rsvpEvent.data.event.id}`);

const note = await call('mgr', 'POST', '/api/staff/notes', {text: 'Ma este dupla műszak, figyeljetek a bejáratra.'}, {expect: 201});
await call('guest', 'POST', '/api/staff/notes', {text: 'nem'}, {expect: 401});
await call('mgr', 'PATCH', `/api/staff/notes/${note.data.note.id}`, {pinned: true}, {expect: 403});
await call(owner, 'PATCH', `/api/staff/notes/${note.data.note.id}`, {pinned: true});
const board = await call('mgr', 'GET', '/api/staff/notes');
if (!(board.data?.notes || []).some((entry: {id: string; pinned: boolean}) => entry.id === note.data.note.id && entry.pinned)) {
  console.log('FAIL the note should be on the board, pinned', board.data);
  failures += 1;
}
await call('mgr', 'DELETE', `/api/staff/notes/${note.data.note.id}`);
const dash = await call(owner, 'GET', '/api/dashboard');
if (!dash.data?.counts || typeof dash.data.counts.ordersOpen !== 'number' || typeof dash.data.counts.reservationsToday !== 'number') {
  console.log('FAIL the dashboard should carry counts', dash.data?.counts);
  failures += 1;
}

// ---------- the tour ----------
const toured = await call(owner, 'POST', '/api/profile/tour', {module: 'staff', status: 'done'});
if (toured.data?.user?.tours?.staff !== 'done') {
  console.log('FAIL the tour should be recorded on the account', toured.data?.user?.tours);
  failures += 1;
}
await call(owner, 'POST', '/api/profile/tour', {module: 'staff', status: 'reset'});
await call(owner, 'POST', '/api/profile/tour', {module: 'nope', status: 'done'}, {expect: 400});
const untoured = await call(owner, 'GET', '/api/me');
if (untoured.data?.user?.tours?.staff) {
  console.log('FAIL the tour reset should clear the module', untoured.data?.user?.tours);
  failures += 1;
}

// ---------- the film ----------
await call(owner, 'PATCH', '/api/house', {featuredVideo: 'https://youtu.be/dQw4w9WgXcQ', featuredVideoTitle: 'Smoke film', featuredVideoCaption: 'teszt'});
const filmed = await call('guest', 'GET', '/api/public/house');
if (filmed.data?.video?.id !== 'dQw4w9WgXcQ' || filmed.data?.video?.title !== 'Smoke film') {
  console.log('FAIL the film should be public', filmed.data?.video);
  failures += 1;
}
if (typeof filmed.data?.members?.total !== 'number') {
  console.log('FAIL the house should count its members', filmed.data?.members);
  failures += 1;
}
await call(owner, 'PATCH', '/api/house', {featuredVideo: 'https://vimeo.com/12345'}, {expect: 400});
await call(owner, 'PATCH', '/api/house', {featuredVideo: ''});
const unfilmed = await call('guest', 'GET', '/api/public/house');
if (unfilmed.data?.video) {
  console.log('FAIL the film should be gone', unfilmed.data?.video);
  failures += 1;
}

// ---------- the House ----------
const silver = await call('mgr', 'POST', '/api/members', {name: 'Smoke Silver', phone: '2223334', tier: 'silver', note: 'smoke'}, {expect: 201});
await call('mgr', 'POST', '/api/members', {name: 'Smoke Black', tier: 'black'}, {expect: 403});
const black = await call(owner, 'POST', '/api/members', {name: 'Smoke Black', phone: '3334445', tier: 'black'}, {expect: 201});
await call('guest', 'POST', '/api/members', {name: 'Nope'}, {expect: 401});
await call('mgr', 'POST', '/api/members', {name: 'Smoke Twin', phone: '2223334'}, {expect: 409});
if (!/^RM-H-[A-Z0-9]{4}$/.test(String(silver.data?.member?.code))) {
  console.log('FAIL a member code should read RM-H-XXXX', silver.data?.member?.code);
  failures += 1;
}
const card = await call('guest', 'POST', '/api/public/member-lookup', {code: silver.data.member.code.toLowerCase(), phone: '2223334'});
if (card.data?.member?.tier !== 'silver') {
  console.log('FAIL the card should open with code + phone', card.data);
  failures += 1;
}
await call('guest', 'POST', '/api/public/member-lookup', {code: silver.data.member.code, phone: '9999999'}, {expect: 403});
await call('guest', 'POST', '/api/public/member-lookup', {code: 'RM-H-NOPE', phone: '2223334'}, {expect: 404});
const memberToken = `v_smoke_m_${stamp}`;
const memberBooking = await call('guest', 'POST', '/api/reservations', {name: 'Smoke Silver', phone: '2223334', guests: 2, at: new Date(Date.now() + 4 * 3600000).toISOString(), occasion: 'este', memberCode: silver.data.member.code.toLowerCase(), note: '', visitorToken: memberToken}, {expect: 201});
if (memberBooking.data?.reservation?.tier !== 'silver') {
  console.log('FAIL the booking should carry the member tier', memberBooking.data?.reservation);
  failures += 1;
}
await call('guest', 'POST', '/api/reservations', {name: 'Smoke Guest', phone: '1234567', guests: 2, at: new Date(Date.now() + 5 * 3600000).toISOString(), occasion: 'este', memberCode: silver.data.member.code, note: '', visitorToken: memberToken}, {expect: 400});
const staffView = await call(owner, 'GET', '/api/reservations');
const seenBooking = (staffView.data?.reservations || []).find((entry: {id: string}) => entry.id === memberBooking.data?.reservation?.id);
if (seenBooking && seenBooking.memberName !== 'Smoke Silver') {
  console.log('FAIL the staff list should name the member', seenBooking);
  failures += 1;
}
await call('guest', 'DELETE', `/api/reservations/${memberBooking.data.reservation.id}`, {visitorToken: memberToken});
const visited = await call(owner, 'POST', `/api/members/${silver.data.member.id}/visit`, {});
if (visited.data?.member?.visits !== 1) {
  console.log('FAIL the visit should count', visited.data?.member);
  failures += 1;
}
const grantHistory = silver.data?.member?.tierHistory;
if (!Array.isArray(grantHistory) || grantHistory.length !== 1 || grantHistory[0]?.tier !== 'silver') {
  console.log('FAIL a grant should open the tier history', grantHistory);
  failures += 1;
}
const raised = await call(owner, 'PATCH', `/api/members/${silver.data.member.id}`, {tier: 'gold'});
const raisedHistory = raised.data?.member?.tierHistory;
if (raised.data?.member?.tier !== 'gold' || !Array.isArray(raisedHistory) || raisedHistory.length !== 2 || raisedHistory[1]?.tier !== 'gold') {
  console.log('FAIL a tier change should append to the history', raisedHistory);
  failures += 1;
}
const raisedCard = await call('guest', 'POST', '/api/public/member-lookup', {code: silver.data.member.code, phone: '2223334'});
if (raisedCard.data?.member?.tierHistory?.length !== 2 || 'by' in (raisedCard.data?.member?.tierHistory?.[0] || {})) {
  console.log('FAIL the guest card should carry the climb without names', raisedCard.data?.member);
  failures += 1;
}
await call('mgr', 'PATCH', `/api/members/${black.data.member.id}`, {active: false}, {expect: 403});
await call('mgr', 'PATCH', `/api/members/${silver.data.member.id}`, {active: false});
await call('guest', 'POST', '/api/public/member-lookup', {code: silver.data.member.code, phone: '2223334'}, {expect: 404});
const roster = await call('mgr', 'GET', '/api/members?q=smoke');
if (!(roster.data?.members || []).some((entry: {id: string}) => entry.id === black.data?.member?.id) || typeof roster.data?.stats?.total !== 'number') {
  console.log('FAIL the roster should list the members with stats', roster.data?.stats);
  failures += 1;
}
await call('mgr', 'DELETE', `/api/members/${silver.data.member.id}`, undefined, {expect: 403});
await call(owner, 'DELETE', `/api/members/${silver.data.member.id}`);
await call(owner, 'DELETE', `/api/members/${black.data.member.id}`);

// ---------- blips ----------
const blip = await call('mgr', 'POST', '/api/map-blips', {x: 100, y: 200, label: 'Smoke blip', kind: 'food', description: 'teszt'}, {expect: 201});
const movedBlip = await call('mgr', 'PATCH', `/api/map-blips/${blip.data.blip.id}`, {x: 150, y: 250});
if (Math.round(movedBlip.data?.blip?.x) !== 150 || Math.round(movedBlip.data?.blip?.y) !== 250) {
  console.log('FAIL the blip should move', movedBlip.data?.blip);
  failures += 1;
}
await call('mgr', 'POST', '/api/map-blips', {x: 1, y: 1, label: 'Bad kind', kind: 'castle'}, {expect: 400});
await call('mgr', 'DELETE', `/api/map-blips/${blip.data.blip.id}`);

// ---------- the floor plan and tables ----------
const floor = await call('guest', 'GET', '/api/public/floor-plan');
const tables = (floor.data?.plan?.tables || []) as {id: string; label: string; seats: number; minGuests?: number; minTier?: string}[];
if (!tables.length || typeof floor.data?.slotMinutes !== 'number') {
  console.log('FAIL the floor plan should list tables', floor.data);
  failures += 1;
}
const four = tables.find((table) => table.seats >= 4 && !table.minTier && (table.minGuests || 1) <= 4);
const other = tables.find((table) => four && table.id !== four.id && table.seats >= 4 && !table.minTier && (table.minGuests || 1) <= 4);
const vip = tables.find((table) => table.minTier);
if (four && other) {
  const tableAt = new Date(Date.now() + 6 * 3600000).toISOString();
  const booking = (suffix: string, extra: Record<string, unknown>) => ({name: 'Smoke Table', phone: '4445556', guests: 4, at: tableAt, occasion: 'este', note: '', visitorToken: `v_smoke_t_${stamp}_${suffix}`, ...extra});
  const picked = await call('guest', 'POST', '/api/reservations', booking('a', {tableId: four.id}), {expect: 201});
  if (picked.data?.reservation?.tableId !== four.id || picked.data?.reservation?.tableLabel !== four.label) {
    console.log('FAIL the booking should carry the table', picked.data?.reservation);
    failures += 1;
  }
  await call('guest', 'POST', '/api/reservations', booking('b', {tableId: four.id, guests: four.seats + 1}), {expect: 400});
  await call('guest', 'POST', '/api/reservations', booking('c', {tableId: 'no-such-table'}), {expect: 400});
  // Nobody has looked at the first request yet, so a second one on the same table is allowed.
  const rival = await call('guest', 'POST', '/api/reservations', booking('d', {tableId: four.id}), {expect: 201});
  await call('mgr', 'PATCH', `/api/reservations/${picked.data.reservation.id}`, {status: 'confirmed'});
  const heldPublic = await call('guest', 'GET', `/api/public/floor-plan?at=${encodeURIComponent(tableAt)}`);
  const heldEntry = (heldPublic.data?.taken || []).find((entry: {tableId: string; code?: string}) => entry.tableId === four.id);
  if (!heldEntry || heldEntry.code) {
    console.log('FAIL a confirmed booking should hold its table, without naming the guest to the public', heldPublic.data?.taken);
    failures += 1;
  }
  const heldStaff = await call('mgr', 'GET', `/api/public/floor-plan?at=${encodeURIComponent(tableAt)}`);
  if (!(heldStaff.data?.taken || []).find((entry: {tableId: string; code?: string}) => entry.tableId === four.id && entry.code === picked.data.reservation.code)) {
    console.log('FAIL staff should see who holds the table', heldStaff.data?.taken);
    failures += 1;
  }
  await call('mgr', 'PATCH', `/api/reservations/${rival.data.reservation.id}`, {status: 'confirmed'}, {expect: 409});
  await call('guest', 'POST', '/api/reservations', booking('e', {tableId: four.id}), {expect: 409});
  const moved = await call('mgr', 'PATCH', `/api/reservations/${rival.data.reservation.id}`, {tableId: other.id});
  if (moved.data?.reservation?.tableLabel !== other.label) {
    console.log('FAIL the house should be able to move a booking to another table', moved.data?.reservation);
    failures += 1;
  }
  await call('mgr', 'PATCH', `/api/reservations/${rival.data.reservation.id}`, {status: 'confirmed'});
  if (vip) await call('guest', 'POST', '/api/reservations', booking('f', {tableId: vip.id, guests: Math.max(vip.minGuests || 1, 2)}), {expect: 403});
  await call('guest', 'DELETE', `/api/reservations/${picked.data.reservation.id}`, {visitorToken: `v_smoke_t_${stamp}_a`});
  await call('guest', 'DELETE', `/api/reservations/${rival.data.reservation.id}`, {visitorToken: `v_smoke_t_${stamp}_d`});
} else {
  console.log('FAIL the plan should have two open tables for four', tables.map((table) => table.id));
  failures += 1;
}
await call('mgr', 'PUT', '/api/house/floor-plan', {plan: floor.data.plan}, {expect: 403});
await call(owner, 'PUT', '/api/house/floor-plan', {plan: {...floor.data.plan, tables: [{id: 'X'}]}}, {expect: 400});
const renamed = await call(owner, 'PUT', '/api/house/floor-plan', {plan: {...floor.data.plan, name: 'Smoke plan'}});
if (renamed.data?.plan?.name !== 'Smoke plan') {
  console.log('FAIL the owner should be able to save a plan', renamed.data);
  failures += 1;
}
const savedPlan = await call('guest', 'GET', '/api/public/floor-plan');
if (savedPlan.data?.plan?.name !== 'Smoke plan') {
  console.log('FAIL the saved plan should be the public one', savedPlan.data?.plan?.name);
  failures += 1;
}
await call(owner, 'DELETE', '/api/house/floor-plan');

// ---------- what the browser needs for pushes ----------
const clubNow = await call('guest', 'GET', '/api/club/state');
if (!Array.isArray(clubNow.data?.state?.recentReactions)) {
  console.log('FAIL the club state should replay recent reactions', Object.keys(clubNow.data?.state || {}));
  failures += 1;
}
const statusNow = await call('guest', 'GET', '/api/public/status');
if (!('realtime' in (statusNow.data || {}))) {
  console.log('FAIL the status should say where realtime lives');
  failures += 1;
}

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
await call('mgr', 'POST', '/api/documents/issued', {kind: 'transactions', reference: `RM/TRX-SMOKE-${stamp}`, countersigned: false});
await call('mgr', 'PUT', '/api/profile/signature', {mode: 'generated', seed: 'after-lock'}, {expect: 409});
await call(owner, 'POST', `/api/users/${manager.data.user.id}/signature`, {}, {expect: 409});
await call('mgr', 'POST', '/api/logout', {});
const closing = await call(owner, 'POST', '/api/shifts/close', {closingCash: 9000, notes: 'smoke'});
const report = closing.data?.report;
const [ownerFirst, ...ownerRest] = String(me.name || '').trim().split(/\s+/);
const ownerShort = [ownerFirst, ...ownerRest.map((part: string) => `${part[0].toUpperCase()}.`)].join(' ').replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
if (!report || typeof report.amount !== 'number' || !new RegExp(`^M-\\d+, \\S+ \\d+\\.( \\d+/\\d+)? - ${ownerShort}$`).test(String(report.transfer?.memo))) {
  console.log('FAIL the closer should get a closing report with the transfer memo', report);
  failures += 1;
}
if (report?.transfer?.account !== '21541444-70524373' || report?.transfer?.owner !== 'Zhen Yu Xiao') {
  console.log('FAIL the report should say where the money goes', report?.transfer);
  failures += 1;
}
const pendingOwner = await call(owner, 'GET', '/api/shift-reports/pending');
if (!(pendingOwner.data?.reports || []).some((entry: {id: string}) => entry.id === report?.id)) {
  console.log('FAIL the report should wait for the closer until seen', pendingOwner.data);
  failures += 1;
}
await call('bar3', 'POST', '/api/login', {username: bartender.data.user.username, password: 'Bar12345y', force: true});
const pendingBar = await call('bar3', 'GET', '/api/shift-reports/pending');
const barReport = (pendingBar.data?.reports || []).find((entry: {shiftId: string}) => entry.shiftId === shift.data.shift.id);
if (!barReport || barReport.amount !== 0 || !String(barReport.transfer?.memo).endsWith('- Smoke B.')) {
  console.log('FAIL every member of the shift should get a report', pendingBar.data);
  failures += 1;
}
if (barReport) {
  const seen = await call('bar3', 'POST', `/api/shift-reports/${barReport.id}/seen`, {});
  if (seen.data?.pending !== 0) {
    console.log('FAIL a seen report should leave nothing pending', seen.data);
    failures += 1;
  }
}
await call('bar3', 'POST', `/api/shift-reports/${report?.id}/seen`, {}, {expect: 404});
await call('bar3', 'GET', '/api/shift-reports');
await call('bar3', 'POST', '/api/logout', {});
await call(owner, 'POST', `/api/shift-reports/${report?.id}/seen`, {});
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
