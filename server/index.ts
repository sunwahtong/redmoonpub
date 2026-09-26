/**
 * The Red Moon backend.
 *
 * One router serves every `/api/...` route. The same module runs as a
 * long-lived process (`npm start`, a VPS) that also serves the built site,
 * and as a serverless function on Vercel through `api/index.ts`, which only
 * calls `handleApiRequest`.
 *
 * Plain TypeScript, run by Node's built-in type stripping (Node 22.18+ / 24):
 * only erasable syntax, explicit `.ts` import specifiers, no build step.
 */
import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import zlib from 'node:zlib';
import type {ServerResponse} from 'node:http';
import {fileURLToPath} from 'node:url';
import {config} from './config.ts';
import {getDb} from './db.ts';
import {seed} from './seed.ts';
import {migrateInlineMedia} from './mediaMigrate.ts';
import {authenticate} from './auth.ts';
import {assertSameOrigin, createRouter, HttpError, json} from './http.ts';
import {registerPublicRoutes} from './routes/public.ts';
import {registerSessionRoutes} from './routes/session.ts';
import {registerStaffRoutes} from './routes/staff.ts';
import {registerShiftRoutes} from './routes/shifts.ts';
import {registerSalesRoutes} from './routes/sales.ts';
import {registerInventoryRoutes} from './routes/inventory.ts';
import {registerGuestRoutes} from './routes/guests.ts';
import {registerHouseRoutes} from './routes/house.ts';
import {registerClubRoutes} from './routes/club.ts';
import {registerMediaRoutes} from './routes/media.ts';
import {registerCommunityRoutes} from './routes/community.ts';
import {registerMemberRoutes} from './routes/members.ts';
import {registerFloorRoutes} from './routes/floor.ts';
import {registerShiftReportRoutes} from './routes/shiftReports.ts';
import {registerLoungeRoutes} from './routes/lounge.ts';
import type {Ctx, Db, Request} from './types.ts';

const router = createRouter();
registerPublicRoutes(router);
registerSessionRoutes(router);
registerStaffRoutes(router);
registerShiftRoutes(router);
registerSalesRoutes(router);
registerInventoryRoutes(router);
registerGuestRoutes(router);
registerHouseRoutes(router);
registerClubRoutes(router);
registerMediaRoutes(router);
registerCommunityRoutes(router);
registerMemberRoutes(router);
registerFloorRoutes(router);
registerShiftReportRoutes(router);
registerLoungeRoutes(router);

let seeded: Promise<void> | null = null;

/** Database plus first-run data, ready once per process. */
export async function ready(): Promise<Db> {
  const db = await getDb();
  if (!seeded) {
    seeded = seed(db)
      .then(() => migrateInlineMedia(db))
      .catch((error) => {
      seeded = null;
      throw error;
    });
  }
  await seeded;
  return db;
}

const MUTATING = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);

/** Handles one API request end to end. */
export async function handleApiRequest(req: Request, res: ServerResponse, pathname: string, searchParams?: URLSearchParams): Promise<void> {
  if (req.method === 'OPTIONS') {
    res.writeHead(204, {'Cache-Control': 'no-store'});
    res.end();
    return;
  }

  let db: Db;
  try {
    db = await ready();
  } catch (error) {
    console.error('[db] not available:', error);
    json(res, 503, {error: 'Az adatbázis jelenleg nem érhető el.'});
    return;
  }

  const method = req.method === 'HEAD' ? 'GET' : req.method || 'GET';
  const match = router.match(method, pathname);
  if (!match) {
    json(res, 404, {error: 'API útvonal nem található'});
    return;
  }
  if ('methodNotAllowed' in match) {
    json(res, 405, {error: 'A metódus nem engedélyezett'});
    return;
  }

  try {
    if (MUTATING.has(req.method || '')) assertSameOrigin(req);
    const user = await authenticate(db, req);
    const ctx: Ctx = {req, res, db, user, params: match.params, query: searchParams || new URLSearchParams()};
    const result = await match.handler(ctx);
    if (res.writableEnded) return;
    if (result && typeof result === 'object' && '__status' in result) {
      const reply = result as {__status: number; body: unknown};
      json(res, reply.__status, reply.body);
    } else {
      json(res, 200, result ?? {ok: true});
    }
  } catch (error) {
    if (error instanceof HttpError) {
      json(res, error.status, {error: error.message, ...error.extra});
      return;
    }
    console.error(`[api] ${req.method} ${pathname}`, error);
    json(res, 500, {error: 'Szerverhiba'});
  }
}

/* ------------------------------------------------------------------ */
/* Static site (long-lived process only)                              */
/* ------------------------------------------------------------------ */

const MIME: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.gif': 'image/gif',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
  '.mp3': 'audio/mpeg',
  '.wav': 'audio/wav',
  '.ogg': 'audio/ogg',
  '.m4a': 'audio/mp4',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  '.ttf': 'font/ttf',
  '.txt': 'text/plain; charset=utf-8'
};

const IMMUTABLE = 'public, max-age=31536000, immutable';
const STATIC = 'public, max-age=86400';

/** The tile host's origin, when the tiles are served from elsewhere: the map probes it with a fetch. */
const tileOrigin = (): string => {
  try {
    return /^https?:/.test(config.tileBase) ? new URL(config.tileBase).origin : '';
  } catch {
    return '';
  }
};

/** What the page may load. The long-lived server sets this itself; no platform config does. */
const CSP = [
  "default-src 'self'",
  "script-src 'self'",
  "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
  "font-src 'self' https://fonts.gstatic.com data:",
  "img-src 'self' data: blob: https:",
  "media-src 'self' blob: data: https:",
  `connect-src 'self' https://*.supabase.co wss://*.supabase.co https://api.cloudinary.com https://res.cloudinary.com https://fonts.googleapis.com https://fonts.gstatic.com ${tileOrigin()}`.trim(),
  "frame-src 'self' https://gocast.fm https://www.youtube.com https://www.youtube-nocookie.com",
  "worker-src 'self' blob:",
  "object-src 'none'",
  "base-uri 'self'",
  "form-action 'self'",
  "frame-ancestors 'none'"
].join('; ');

const PAGE_HEADERS: Record<string, string> = {
  'X-Content-Type-Options': 'nosniff',
  'X-Frame-Options': 'DENY',
  'Referrer-Policy': 'strict-origin-when-cross-origin',
  'Permissions-Policy': 'camera=(), microphone=(), geolocation=()',
  'Content-Security-Policy': CSP,
  ...(config.production ? {'Strict-Transport-Security': 'max-age=63072000; includeSubDomains'} : {})
};

/** Text is worth compressing on the way out; pictures, tiles and audio are compressed already. */
const COMPRESSIBLE = new Set(['.html', '.css', '.js', '.mjs', '.json', '.svg', '.txt']);

function sendFile(res: ServerResponse, file: string, miss: () => void, cacheControl = 'no-store', gzip = false): void {
  fs.stat(file, (error, stat) => {
    if (error || !stat.isFile()) return miss();
    const ext = path.extname(file).toLowerCase();
    const headers: Record<string, string> = {...PAGE_HEADERS, 'Content-Type': MIME[ext] || 'application/octet-stream', 'Cache-Control': cacheControl};
    const stream = fs.createReadStream(file);
    if (gzip && COMPRESSIBLE.has(ext)) {
      headers['Content-Encoding'] = 'gzip';
      headers.Vary = 'Accept-Encoding';
      res.writeHead(200, headers);
      stream.pipe(zlib.createGzip()).pipe(res);
      return;
    }
    headers['Content-Length'] = String(stat.size);
    res.writeHead(200, headers);
    stream.pipe(res);
  });
}

function resolveWithin(root: string, pathname: string): string | null {
  const file = path.normalize(path.join(root, pathname));
  return file.startsWith(root) ? file : null;
}

export function createServer(): http.Server {
  const indexHtml = path.join(config.distDir, 'index.html');
  return http.createServer(async (req, res) => {
    const url = new URL(req.url || '/', `http://${req.headers.host || 'localhost'}`);
    if (url.pathname.startsWith('/api/')) return handleApiRequest(req, res, url.pathname, url.searchParams);

    let pathname: string;
    try {
      pathname = decodeURIComponent(url.pathname);
    } catch {
      res.writeHead(400).end('Bad request');
      return;
    }
    if (pathname.endsWith('.html')) {
      const clean = pathname === '/index.html' ? '/' : pathname.slice(0, -5);
      res.writeHead(301, {Location: clean + (url.search || ''), 'Cache-Control': 'no-store'});
      return res.end();
    }
    if (!fs.existsSync(indexHtml)) {
      res.writeHead(503, {'Content-Type': 'text/plain; charset=utf-8', 'Cache-Control': 'no-store'});
      return res.end('Build missing. Run "npm run build" before starting the server.');
    }
    const gzip = /\bgzip\b/.test(String(req.headers['accept-encoding'] || ''));
    const spa = () => sendFile(res, indexHtml, () => res.writeHead(404).end('Not found'), 'no-store', gzip);
    if (pathname === '/') return spa();
    // The tile pack lives outside public/ so a build does not copy it into dist/.
    if (pathname.startsWith('/assets/map/')) {
      const tile = resolveWithin(config.tilesDir, pathname.slice('/assets/map'.length));
      if (!tile) return res.writeHead(403).end('Forbidden');
      return sendFile(res, tile, () => res.writeHead(404).end('Not found'), IMMUTABLE);
    }
    const distFile = resolveWithin(config.distDir, pathname);
    const publicFile = resolveWithin(config.publicDir, pathname);
    if (!distFile || !publicFile) return res.writeHead(403).end('Forbidden');
    sendFile(res, distFile, () => sendFile(res, publicFile, spa, STATIC, gzip), pathname.startsWith('/assets/') ? IMMUTABLE : 'no-store', gzip);
  });
}

const isMain = !!process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) {
  ready()
    .then(() => {
      createServer().listen(config.port, config.host || undefined, () => {
        console.log(`Red Moon Pub server on http://${config.host || 'localhost'}:${config.port} · ${config.databaseUrl ? 'PostgreSQL' : 'embedded PGlite'}${config.serverless ? ' · function mode' : ''}`);
      });
    })
    .catch((error) => {
      console.error('Red Moon database initialization failed:', error);
      process.exit(1);
    });
}
