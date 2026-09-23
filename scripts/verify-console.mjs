/**
 * Walks the console as the owner and screenshots every page.
 *
 *   VERIFY_BASE=http://localhost:3100 VERIFY_USER=rm.owner VERIFY_PASS=... node scripts/verify-console.mjs
 *
 * Handles the first-login gates (password change, phone number) if they
 * appear, then visits each console route and a few public pages. Console
 * errors and failed requests are reported per page; screenshots land in
 * .verify/console/.
 */
import {chromium} from 'playwright';
import {mkdir} from 'node:fs/promises';

const BASE = process.env.VERIFY_BASE || 'http://localhost:3100';
const USER = process.env.VERIFY_USER || 'rm.owner';
const PASS = process.env.VERIFY_PASS || 'Owner12345';
const OUT = '.verify/console';

const PUBLIC = ['/', '/events', '/about', '/club', '/staff-login'];
const CONSOLE = [
  '/staff',
  '/staff/shift',
  '/staff/register',
  '/staff/sales',
  '/staff/reservations',
  '/staff/applications',
  '/staff/orders',
  '/staff/inventory',
  '/staff/products',
  '/staff/documents',
  '/staff/events',
  '/staff/showcase',
  '/staff/gallery',
  '/staff/reports',
  '/staff/users',
  '/staff/audit',
  '/staff/profile',
  '/dj'
];

await mkdir(OUT, {recursive: true});
const browser = await chromium.launch();
const context = await browser.newContext({viewport: {width: 1440, height: 900}});
const page = await context.newPage();
const problems = [];
page.on('console', (message) => {
  if (message.type() === 'error') problems.push(`${page.url()} console: ${message.text().slice(0, 200)}`);
});
page.on('requestfailed', (request) => {
  if (!/\/assets\/map\//.test(request.url())) problems.push(`${page.url()} failed: ${request.url()}`);
});
page.on('response', (response) => {
  if (response.status() >= 500) problems.push(`${page.url()} ${response.status()}: ${response.url()}`);
});

const slug = (route) => (route === '/' ? 'home' : route.replace(/[^a-z0-9]+/gi, '-').replace(/^-|-$/g, ''));

const shoot = async (route) => {
  await page.goto(BASE + route, {waitUntil: 'networkidle'});
  const enter = page.locator('.rm-loader-enter');
  if (await enter.count()) {
    await enter.click().catch(() => {});
    await page.waitForTimeout(1200);
  }
  await page.waitForTimeout(800);
  await page.screenshot({path: `${OUT}/${slug(route)}.png`, fullPage: true});
  console.log(`shot ${route}`);
};

for (const route of PUBLIC) await shoot(route);

// Sign in.
await page.goto(BASE + '/staff-login', {waitUntil: 'networkidle'});
await page.fill('input[autocomplete="username"]', USER);
await page.fill('input[autocomplete="current-password"]', PASS);
await page.click('button[type="submit"]');
await page.waitForTimeout(1500);

// Takeover if another session holds the account.
const takeover = page.getByText('KILÉPTETÉS ONNAN ÉS BELÉPÉS ITT');
if (await takeover.count()) {
  await takeover.click();
  await page.waitForTimeout(1500);
}

// Gates: temporary password, then phone number.
if (await page.getByText('Új jelszó').count()) {
  await page.screenshot({path: `${OUT}/gate-password.png`, fullPage: true});
  await page.fill('input[autocomplete="current-password"]', PASS);
  const fresh = PASS + 'x1';
  const inputs = page.locator('input[autocomplete="new-password"]');
  await inputs.nth(0).fill(fresh);
  await inputs.nth(1).fill(fresh);
  await page.click('button[type="submit"]');
  await page.waitForTimeout(1500);
  console.log(`password changed to ${fresh}`);
}
if (await page.getByText('Telefonszám').count()) {
  await page.screenshot({path: `${OUT}/gate-phone.png`, fullPage: true});
  await page.fill('input[inputmode="numeric"]', '+38-76-1234567');
  await page.click('button[type="submit"]');
  await page.waitForTimeout(1500);
}
await page.screenshot({path: `${OUT}/logged-in.png`, fullPage: true});

// A manager or owner who has not chosen a signature yet is asked once per visit.
await page.goto(BASE + '/staff', {waitUntil: 'networkidle'});
const later = page.getByRole('button', {name: 'KÉSŐBB'});
if (await later.count()) {
  await page.screenshot({path: `${OUT}/dialog-signature.png`});
  await later.click();
  await page.waitForTimeout(400);
}

for (const route of CONSOLE) await shoot(route);

// Open a document preview and the dialog once, for the screenshots.
await page.goto(BASE + '/staff/documents', {waitUntil: 'networkidle'});
await page.waitForTimeout(1200);
const preview = page.getByRole('button', {name: /ELŐNÉZET/}).first();
if (await preview.count()) {
  await preview.click();
  await page.waitForTimeout(1500);
  await page.screenshot({path: `${OUT}/document-preview.png`});
}
await page.goto(BASE + '/staff/users', {waitUntil: 'networkidle'});
await page.waitForTimeout(800);
const key = page.locator('button[aria-label="Jelszó visszaállítása"]').first();
if (await key.count()) {
  await key.click();
  await page.waitForTimeout(500);
  await page.screenshot({path: `${OUT}/dialog-prompt.png`});
}

await browser.close();
console.log(problems.length ? `\n${problems.length} problem(s):\n${problems.join('\n')}` : '\nno console errors, no failed requests');
