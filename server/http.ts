/**
 * HTTP plumbing shared by every route: responses, body parsing, cookies,
 * client address, the same-origin check, and a small path router.
 */
import crypto from 'node:crypto';
import type {ServerResponse} from 'node:http';
import type {ZodType} from 'zod';
import {config} from './config.ts';
import type {Handler, Request} from './types.ts';

export class HttpError extends Error {
  status: number;
  extra: Record<string, unknown>;
  constructor(status: number, message: string, extra: Record<string, unknown> = {}) {
    super(message);
    this.status = status;
    this.extra = extra;
  }
}

export const bad = (message: string, extra?: Record<string, unknown>) => new HttpError(400, message, extra);
export const unauthorized = (message = 'Bejelentkezés szükséges') => new HttpError(401, message);
export const forbidden = (message = 'Nincs jogosultságod ehhez a művelethez') => new HttpError(403, message);
export const notFound = (message = 'Nem található') => new HttpError(404, message);
export const conflict = (message: string, extra?: Record<string, unknown>) => new HttpError(409, message, extra);
export const tooMany = (message: string, extra?: Record<string, unknown>) => new HttpError(429, message, extra);

export interface Reply {
  __status: number;
  body: unknown;
}

/** Marks a handler result with a non-200 status. */
export const reply = (status: number, body: unknown): Reply => ({__status: status, body});
export const created = (body: unknown): Reply => reply(201, body);

const SECURITY_HEADERS = {
  'Cache-Control': 'no-store',
  'X-Content-Type-Options': 'nosniff',
  'X-Frame-Options': 'DENY',
  'Referrer-Policy': 'same-origin',
  'Permissions-Policy': 'camera=(), microphone=(), geolocation=()'
};

export function json(res: ServerResponse, status: number, body: unknown): void {
  const payload = JSON.stringify(body);
  res.writeHead(status, {
    ...SECURITY_HEADERS,
    'Content-Type': 'application/json; charset=utf-8',
    'Content-Length': Buffer.byteLength(payload)
  });
  res.end(payload);
}

export type Body = Record<string, any>;

/**
 * Reads a JSON body. A serverless platform may have consumed the stream and
 * handed the parsed body over already; use that when present.
 */
export function readJson(req: Request, limit = config.maxJsonBytes): Promise<Body> {
  if (req.rmParsedBody !== undefined) {
    const parsed = req.rmParsedBody;
    if (parsed === null || parsed === '') return Promise.resolve({});
    if (typeof parsed === 'string') {
      try {
        return Promise.resolve(JSON.parse(parsed));
      } catch {
        return Promise.reject(bad('Érvénytelen JSON.'));
      }
    }
    if (Buffer.isBuffer(parsed)) {
      try {
        const text = parsed.toString('utf8');
        return Promise.resolve(text ? JSON.parse(text) : {});
      } catch {
        return Promise.reject(bad('Érvénytelen JSON.'));
      }
    }
    return Promise.resolve(typeof parsed === 'object' ? (parsed as Body) : {});
  }

  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    let size = 0;
    req.on('data', (chunk: Buffer) => {
      size += chunk.length;
      if (size > limit) {
        reject(new HttpError(413, 'A kérés túl nagy.'));
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on('end', () => {
      const text = Buffer.concat(chunks).toString('utf8');
      if (!text.trim()) return resolve({});
      try {
        const value = JSON.parse(text);
        resolve(value && typeof value === 'object' ? value : {});
      } catch {
        reject(bad('Érvénytelen JSON.'));
      }
    });
    req.on('error', reject);
  });
}

/** Reads a raw body (uploads) up to `limit` bytes. */
export function readRaw(req: Request, limit: number): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    let size = 0;
    req.on('data', (chunk: Buffer) => {
      size += chunk.length;
      if (size > limit) {
        reject(new HttpError(413, 'A fájl túl nagy.'));
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on('end', () => resolve(Buffer.concat(chunks)));
    req.on('error', reject);
  });
}

export function parseCookies(req: Request): Record<string, string> {
  const out: Record<string, string> = {};
  for (const part of String(req.headers.cookie || '').split(';')) {
    const index = part.indexOf('=');
    if (index <= 0) continue;
    const key = part.slice(0, index).trim();
    try {
      out[key] = decodeURIComponent(part.slice(index + 1).trim());
    } catch {
      out[key] = '';
    }
  }
  return out;
}

export function isSecure(req: Request): boolean {
  const proto = String(req.headers['x-forwarded-proto'] || '').split(',')[0].trim();
  if (proto) return proto === 'https';
  return !!(req.socket as {encrypted?: boolean})?.encrypted || config.production;
}

export function setCookie(
  res: ServerResponse,
  name: string,
  value: string,
  {maxAge, secure, path = '/', sameSite = 'Lax'}: {maxAge?: number; secure?: boolean; path?: string; sameSite?: 'Lax' | 'Strict' | 'None'} = {}
): void {
  const parts = [`${name}=${encodeURIComponent(value)}`, 'HttpOnly', `SameSite=${sameSite}`, `Path=${path}`];
  if (typeof maxAge === 'number') parts.push(`Max-Age=${Math.max(0, Math.floor(maxAge))}`);
  if (secure) parts.push('Secure');
  const existing = res.getHeader('Set-Cookie');
  const list = existing ? (Array.isArray(existing) ? existing : [String(existing)]) : [];
  res.setHeader('Set-Cookie', [...list, parts.join('; ')]);
}

export function clientIp(req: Request): string {
  const raw = String(
    req.headers['cf-connecting-ip'] ||
      req.headers['true-client-ip'] ||
      req.headers['x-real-ip'] ||
      req.headers['x-forwarded-for'] ||
      req.socket?.remoteAddress ||
      ''
  )
    .split(',')[0]
    .trim();
  const ip = raw.replace(/^::ffff:/, '').replace(/^\[|\]$/g, '');
  return ip || 'unknown';
}

/**
 * Cross-site request check for state-changing calls.
 *
 * The session cookie is SameSite=Lax, which already stops a foreign page from
 * riding it on a POST. This is the second lock: a browser that sends
 * `Sec-Fetch-Site` must say the request is same-origin, and one that sends
 * `Origin` must name this host.
 */
export function assertSameOrigin(req: Request): void {
  const fetchSite = String(req.headers['sec-fetch-site'] || '').toLowerCase();
  if (fetchSite && fetchSite !== 'same-origin' && fetchSite !== 'none') {
    throw forbidden('Cross-site kérés elutasítva.');
  }
  const origin = String(req.headers.origin || '');
  if (!origin || origin === 'null') return;
  const host = String(req.headers['x-forwarded-host'] || req.headers.host || '').split(',')[0].trim().toLowerCase();
  let originHost = '';
  try {
    originHost = new URL(origin).host.toLowerCase();
  } catch {
    throw forbidden('Érvénytelen Origin fejléc.');
  }
  if (originHost !== host) throw forbidden('Cross-site kérés elutasítva.');
}

export const sha256 = (value: unknown): string => crypto.createHash('sha256').update(String(value)).digest('hex');

/**
 * Ties an anonymous action to one browser on one connection.
 * The raw token never leaves the visitor's machine and is never stored.
 */
export function visitorFingerprint(req: Request, token: unknown): string {
  return sha256(`${clientIp(req)}|${String(token || '').trim().slice(0, 200)}`);
}

/**
 * Short code a guest can read out at the door. No vowels, so four random
 * characters never spell a word; no 0/O or 1/I, which are misheard by phone.
 */
export function shortCode(prefix = 'RM-'): string {
  const alphabet = 'BCDFGHJKLMNPQRSTVWXYZ23456789';
  let code = '';
  for (let i = 0; i < 4; i += 1) code += alphabet[crypto.randomInt(alphabet.length)];
  return `${prefix}${code}`;
}

/* ------------------------------------------------------------------ */
/* Router                                                              */
/* ------------------------------------------------------------------ */

interface Route {
  method: string;
  regex: RegExp;
  keys: string[];
  handler: Handler;
}

export type Match = {handler: Handler; params: Record<string, string>} | {methodNotAllowed: true} | null;

function compile(pattern: string): {regex: RegExp; keys: string[]} {
  const keys: string[] = [];
  const source = pattern
    .split('/')
    .map((segment) => {
      if (segment.startsWith(':')) {
        keys.push(segment.slice(1));
        return '([^/]+)';
      }
      return segment.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    })
    .join('/');
  return {regex: new RegExp(`^${source}$`), keys};
}

export interface Router {
  get(pattern: string, handler: Handler): void;
  post(pattern: string, handler: Handler): void;
  put(pattern: string, handler: Handler): void;
  patch(pattern: string, handler: Handler): void;
  delete(pattern: string, handler: Handler): void;
  match(method: string, pathname: string): Match;
}

export function createRouter(): Router {
  const routes: Route[] = [];
  const add = (method: string, pattern: string, handler: Handler) => {
    const {regex, keys} = compile(pattern);
    routes.push({method, regex, keys, handler});
  };
  return {
    get: (pattern, handler) => add('GET', pattern, handler),
    post: (pattern, handler) => add('POST', pattern, handler),
    put: (pattern, handler) => add('PUT', pattern, handler),
    patch: (pattern, handler) => add('PATCH', pattern, handler),
    delete: (pattern, handler) => add('DELETE', pattern, handler),
    match(method, pathname) {
      let pathMatched = false;
      for (const route of routes) {
        const hit = route.regex.exec(pathname);
        if (!hit) continue;
        pathMatched = true;
        if (route.method !== method) continue;
        const params: Record<string, string> = {};
        route.keys.forEach((key, index) => {
          try {
            params[key] = decodeURIComponent(hit[index + 1]);
          } catch {
            params[key] = hit[index + 1];
          }
        });
        return {handler: route.handler, params};
      }
      return pathMatched ? {methodNotAllowed: true} : null;
    }
  };
}

/** Parses a body against a zod schema, turning the first issue into a 400. */
export function parse<T>(schema: ZodType<T>, body: unknown): T {
  const result = schema.safeParse(body);
  if (!result.success) {
    const issue = result.error.issues[0];
    throw bad(issue?.message || 'Érvénytelen adat.', {field: issue?.path?.join('.') || undefined});
  }
  return result.data;
}

/** Hungarian staff phone: +38-76 plus seven digits, stored as bare digits. */
export function normalizePhone(raw: unknown): string {
  const digits = String(raw || '').replace(/\D/g, '');
  if (/^\d{7}$/.test(digits)) return `3876${digits}`;
  if (/^76\d{7}$/.test(digits)) return `38${digits}`;
  if (/^3876\d{7}$/.test(digits)) return digits;
  return '';
}

export function formatPhone(raw: unknown): string {
  const digits = String(raw || '').replace(/\D/g, '');
  if (!/^3876\d{7}$/.test(digits)) return '';
  const local = digits.slice(4);
  return `+38-76-${local.slice(0, 3)}-${local.slice(3)}`;
}

/** Local calendar day key, YYYY-MM-DD. */
export function dayKey(value: string | number | Date): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '';
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

export const iso = (value: unknown): string | null => (value ? new Date(value as string).toISOString() : null);
