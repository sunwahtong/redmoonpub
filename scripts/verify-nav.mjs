/**
 * Proves every public route is reachable by clicking, not only by typing a URL.
 *
 *   npm run verify:nav
 *
 * Starts the built server on its own port, opens the homepage, collects every
 * internal link it can reach — including the ones behind the header dropdown —
 * and exits non-zero if any public route is never linked.
 *
 * This exists because `/careers` shipped reachable only from the footer, and
 * nothing in the test suite noticed.
 */
import {chromium} from 'playwright';
import {spawn} from 'node:child_process';
import path from 'node:path';
import {fileURLToPath} from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const PORT = 4074;
const BASE = `http://127.0.0.1:${PORT}`;

const PUBLIC_ROUTES = ['/', '/menu', '/events', '/club', '/vip', '/about', '/gallery', '/location', '/careers', '/reservations', '/staff-login'];

let child = null;
let browser = null;

try {
  child = spawn(process.execPath, ['server/index.ts'], {
    cwd: ROOT,
    env: {...process.env, NODE_ENV: 'production', PORT: String(PORT), DATABASE_URL: ''},
    stdio: ['ignore', 'pipe', 'pipe']
  });
  await new Promise((resolve, reject) => {
    let out = '';
    child.stdout.on('data', c => { out += c; if (out.includes('Red Moon Pub server on')) resolve(); });
    child.on('exit', c => reject(new Error('exit ' + c)));
    setTimeout(() => reject(new Error('timeout\n' + out)), 25000);
  });

  browser = await chromium.launch();

  /** Every internal href reachable from one page, including behind the menu. */
  const linksOn = async (route, {openMenus = true} = {}) => {
    const page = await browser.newPage({viewport: {width: 1440, height: 900}});
    await page.goto(BASE + route, {waitUntil: 'networkidle'});
    const enter = page.locator('.rm-loader-enter');
    if (await enter.count()) { await enter.click().catch(() => {}); await page.waitForTimeout(1200); }

    if (openMenus) {
      // The header group is a dropdown; its links do not exist until opened.
      const group = page.getByRole('button', {name: 'A HÁZ'});
      if (await group.count()) { await group.click().catch(() => {}); await page.waitForTimeout(400); }
    }

    const hrefs = await page.$$eval('a[href]', nodes =>
      nodes.map(n => n.getAttribute('href')).filter(h => h && h.startsWith('/'))
    );
    await page.close();
    return [...new Set(hrefs.map(h => h.split('#')[0]).filter(Boolean))];
  };

  const fromHome = await linksOn('/');
  console.log('links on "/" :', fromHome.sort().join(' '));

  const unreachable = PUBLIC_ROUTES.filter(r => r !== '/' && !fromHome.includes(r));
  if (unreachable.length) {
    console.log('NOT LINKED FROM HOME:', unreachable.join(' '));
  } else {
    console.log('every public route is one click from home');
  }

  // Desktop header without opening the dropdown — what a visitor sees at rest.
  const headerOnly = await linksOn('/', {openMenus: false});
  console.log('visible at rest:', headerOnly.sort().join(' '));

  process.exitCode = unreachable.length ? 1 : 0;
} finally {
  if (browser) await browser.close().catch(() => {});
  if (child) { child.kill(); await new Promise(r => setTimeout(r, 400)); }
}
