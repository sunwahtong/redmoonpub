/**
 * Headless UI verification.
 *
 * Loads every public route, records console errors and failed network requests,
 * and writes one screenshot per route to `.verify/`. Run it after UI changes:
 *
 *   node scripts/verify.mjs
 *   node scripts/verify.mjs /location        # single route
 *   VERIFY_VIEWPORT=mobile node scripts/verify.mjs
 */
import {chromium, devices} from 'playwright';
import {mkdir, writeFile} from 'node:fs/promises';

const BASE = process.env.VERIFY_BASE || 'http://localhost:5173';
const OUT = '.verify';

const ROUTES = process.argv.slice(2).length
  ? process.argv.slice(2)
  : ['/', '/menu', '/events', '/gallery', '/about', '/location', '/staff-login', '/nincs-ilyen'];

/**
 * Viewports to check. "both" is the default because a desktop-only pass cannot
 * see the failure mode that actually reaches visitors: a fixed-width element
 * pushing the page sideways on a phone.
 */
const VIEWPORTS = {
  desktop: {name: 'desktop', context: {viewport: {width: 1440, height: 900}}},
  mobile: {name: 'mobile', context: {...devices['iPhone 13'], isMobile: true, hasTouch: true}}
};

const selected = String(process.env.VERIFY_VIEWPORT || 'both').toLowerCase();
const passes = selected === 'both' ? [VIEWPORTS.desktop, VIEWPORTS.mobile] : [VIEWPORTS[selected] || VIEWPORTS.desktop];

/** Assets the site is allowed to request without them existing yet. */
const IGNORED_FAILURES = [/\/assets\/map\/style/, /\/assets\/map\/blips\//];

const slug = (route) => (route === '/' ? 'home' : route.replace(/[^a-z0-9]+/gi, '-').replace(/^-|-$/g, ''));

const browser = await chromium.launch();
const report = [];

await mkdir(OUT, {recursive: true});

for (const pass of passes) {
for (const route of ROUTES) {
  const context = await browser.newContext(pass.context);
  const page = await context.newPage();

  const consoleErrors = [];
  const failedRequests = [];

  page.on('console', (message) => {
    if (message.type() !== 'error') return;
    const text = message.text();
    // Network failures carry no URL here; the `response` handler reports those
    // with enough detail to act on, so drop the duplicate noise.
    if (text.startsWith('Failed to load resource')) return;
    consoleErrors.push(text);
  });
  page.on('pageerror', (error) => consoleErrors.push(`pageerror: ${error.message}`));
  page.on('response', (response) => {
    if (response.status() < 400) return;
    const url = response.url();
    if (IGNORED_FAILURES.some((pattern) => pattern.test(url))) return;
    failedRequests.push(`${response.status()} ${url}`);
  });

  await page.goto(`${BASE}${route}`, {waitUntil: 'networkidle', timeout: 30000}).catch(() => {});

  // Dismiss the intro loader so the page underneath is what gets captured.
  const enter = page.locator('.rm-loader-enter');
  if (await enter.count()) {
    await enter.click({timeout: 5000}).catch(() => {});
    await page.waitForTimeout(1200);
  }

  await page.waitForTimeout(600);
  await page.screenshot({path: `${OUT}/${pass.name}-${slug(route)}.png`, fullPage: false});

  /* Horizontal overflow. A page wider than its own viewport is the mobile
     failure that screenshots hide: the capture is cropped to the viewport, so
     it looks fine while the real device scrolls sideways. Report the widest
     offending elements rather than just the fact, so the cause is actionable.
     8px of slack absorbs sub-pixel layout rounding. */
  const overflow = await page.evaluate(() => {
    const limit = document.documentElement.clientWidth;
    const scrollWidth = document.documentElement.scrollWidth;
    if (scrollWidth <= limit + 8) return null;

    const culprits = [...document.querySelectorAll('body *')]
      .map((element) => {
        const box = element.getBoundingClientRect();
        return {
          overhang: Math.round(box.right - limit),
          label:
            element.tagName.toLowerCase() +
            (element.id ? `#${element.id}` : '') +
            (typeof element.className === 'string' && element.className
              ? `.${element.className.trim().split(/\s+/).slice(0, 3).join('.')}`
              : '')
        };
      })
      .filter((entry) => entry.overhang > 8)
      .sort((a, b) => b.overhang - a.overhang)
      .slice(0, 3);

    return {scrollWidth, limit, culprits};
  });

  report.push({pass: pass.name, route, consoleErrors, failedRequests, overflow});
  await context.close();
}
}

await browser.close();

const lines = report.map(({pass, route, consoleErrors, failedRequests, overflow}) => {
  const problems = [
    ...consoleErrors.map((text) => `  console: ${text}`),
    ...failedRequests.map((text) => `  request: ${text}`)
  ];
  if (overflow) {
    problems.push(`  overflow: page is ${overflow.scrollWidth}px wide in a ${overflow.limit}px viewport`);
    for (const culprit of overflow.culprits) {
      problems.push(`    +${culprit.overhang}px  ${culprit.label}`);
    }
  }
  return `[${pass}] ${route} ${problems.length ? `FAIL (${problems.length})` : 'OK'}\n${problems.join('\n')}`.trimEnd();
});

const summary = lines.join('\n');
await writeFile(`${OUT}/report.txt`, `${summary}\n`, 'utf8');
console.log(summary);
