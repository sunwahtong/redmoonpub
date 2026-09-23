/**
 * Shared API + formatting helpers.
 *
 * The legacy frontend re-implemented fetch/escape/format logic in every script
 * (site.js, v56-public.js, menu.js, staff.js ...). Everything lives here now.
 */
import {liveBus} from './live';

export class ApiError extends Error {
  constructor(message: string, public status: number) {
    super(message);
    this.name = 'ApiError';
  }
}

async function request<T>(url: string, init?: RequestInit): Promise<T> {
  const res = await fetch(url, {
    cache: 'no-store',
    ...init,
    headers: {'Content-Type': 'application/json', ...(init?.headers || {})}
  });

  let data: any = {};
  try {
    data = await res.json();
  } catch {
    /* empty or non-JSON body */
  }

  if (!res.ok) throw new ApiError(data?.error || 'A kérés nem teljesíthető.', res.status);
  return data as T;
}

export function apiGet<T>(url: string, signal?: AbortSignal): Promise<T> {
  return request<T>(url, {method: 'GET', signal});
}

/** Requests that only observe (heartbeats, presence) must not trigger page-wide refreshes. */
const QUIET = [/\/api\/presence\/heartbeat$/, /\/api\/club\/listener$/, /\/api\/dj\/player-sync$/, /\/read$/];

export async function apiSend<T>(
  url: string,
  method: 'POST' | 'PUT' | 'PATCH' | 'DELETE',
  body?: unknown,
  headers?: Record<string, string>
): Promise<T> {
  const result = await request<T>(url, {method, headers, body: body === undefined ? undefined : JSON.stringify(body)});
  if (!QUIET.some((pattern) => pattern.test(url))) liveBus.emit({topic: 'mutation', event: method, payload: {url}});
  return result;
}

/* ------------------------------------------------------------------ */
/* Media                                                               */
/* ------------------------------------------------------------------ */

const CLOUD = String(import.meta.env.VITE_CLOUDINARY_CLOUD_NAME || '').trim();
const FOLDER = String(import.meta.env.VITE_CLOUDINARY_FOLDER || 'redmoon').replace(/^\/+|\/+$/g, '');
const AUDIO = /\.(mp3|wav|ogg|m4a|aac|webm)$/i;

/**
 * Resolves a stored media reference to something the browser can load.
 *
 * Relative paths ("assets/menu/drinks/x.png") are anchored to the site root;
 * on a nested route they would otherwise resolve against the current path.
 * With Cloudinary configured (VITE_CLOUDINARY_CLOUD_NAME) the site's own
 * pictures and the background music are served from there instead — after
 * `npm run media:upload` mirrored public/assets to the account — with
 * automatic format and quality. Uploads already carry absolute URLs.
 */
export function assetUrl(path: string): string {
  const raw = String(path || '').trim();
  if (!raw) return '';
  if (/^(https?:)?\/\//.test(raw) || raw.startsWith('data:') || raw.startsWith('blob:')) return raw;
  const local = raw.startsWith('/') ? raw : `/${raw}`;
  if (!CLOUD || !local.startsWith('/assets/') || local.startsWith('/assets/map/') || local.startsWith('/assets/uploads/')) return local;
  const key = local.slice(1);
  return AUDIO.test(key)
    ? `https://res.cloudinary.com/${CLOUD}/video/upload/${FOLDER}/${key}`
    : `https://res.cloudinary.com/${CLOUD}/image/upload/f_auto,q_auto/${FOLDER}/${key}`;
}

/** Whether the site's own pictures come from Cloudinary. */
export const mediaFromCloudinary = !!CLOUD;

/* ------------------------------------------------------------------ */
/* Visitors                                                            */
/* ------------------------------------------------------------------ */

const VISITOR_TOKEN_KEY = 'rm-visitor-token';

/**
 * Stable per-browser id. The server hashes it together with the client IP so a
 * visitor can leave (and later edit) exactly one review without the raw token
 * ever being stored.
 */
export function getVisitorToken(): string {
  let token = localStorage.getItem(VISITOR_TOKEN_KEY);
  if (!token) {
    token = `v_${Math.random().toString(36).slice(2)}${Date.now().toString(36)}`;
    localStorage.setItem(VISITOR_TOKEN_KEY, token);
  }
  return token;
}

/* ------------------------------------------------------------------ */
/* Formatting                                                          */
/* ------------------------------------------------------------------ */

const hufFormatter = new Intl.NumberFormat('hu-HU');
const dateFormatter = new Intl.DateTimeFormat('hu-HU', {year: 'numeric', month: 'long', day: 'numeric'});
const timeFormatter = new Intl.DateTimeFormat('hu-HU', {hour: '2-digit', minute: '2-digit'});
const weekdayFormatter = new Intl.DateTimeFormat('hu-HU', {weekday: 'long'});

export const formatHuf = (value: number): string => `${hufFormatter.format(Number(value) || 0)} Ft`;
export const formatDate = (value: string | number | Date): string => dateFormatter.format(new Date(value));
export const formatTime = (value: string | number | Date): string => timeFormatter.format(new Date(value));
export const formatWeekday = (value: string | number | Date): string => weekdayFormatter.format(new Date(value));

/** "most", "3 perce", "2 órája" — for feeds and threads. */
export function formatAgo(value: string | number | Date): string {
  const diff = Date.now() - new Date(value).getTime();
  if (!Number.isFinite(diff) || diff < 45000) return 'most';
  const minutes = Math.round(diff / 60000);
  if (minutes < 60) return `${minutes} perce`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours} órája`;
  const days = Math.round(hours / 24);
  return `${days} napja`;
}
