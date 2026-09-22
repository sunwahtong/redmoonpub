/**
 * Shared API + formatting helpers.
 *
 * The legacy frontend re-implemented fetch/escape/format logic in every script
 * (site.js, v56-public.js, menu.js, staff.js ...). Everything lives here now.
 */

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

export function apiSend<T>(
  url: string,
  method: 'POST' | 'PUT' | 'PATCH' | 'DELETE',
  body?: unknown,
  headers?: Record<string, string>
): Promise<T> {
  return request<T>(url, {method, headers, body: body === undefined ? undefined : JSON.stringify(body)});
}

/**
 * The API stores image paths relative ("assets/menu/drinks/x.png"). On a nested
 * route those resolve against the current path instead of the site root, so the
 * image silently 404s. Always anchor them to the root.
 */
export function assetUrl(path: string): string {
  const raw = String(path || '').trim();
  if (!raw) return '';
  if (/^(https?:)?\/\//.test(raw) || raw.startsWith('data:')) return raw;
  return raw.startsWith('/') ? raw : `/${raw}`;
}

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

const hufFormatter = new Intl.NumberFormat('hu-HU');
const dateFormatter = new Intl.DateTimeFormat('hu-HU', {year: 'numeric', month: 'long', day: 'numeric'});
const timeFormatter = new Intl.DateTimeFormat('hu-HU', {hour: '2-digit', minute: '2-digit'});
const weekdayFormatter = new Intl.DateTimeFormat('hu-HU', {weekday: 'long'});

export const formatHuf = (value: number): string => `${hufFormatter.format(Number(value) || 0)} Ft`;
export const formatDate = (value: string | number | Date): string => dateFormatter.format(new Date(value));
export const formatTime = (value: string | number | Date): string => timeFormatter.format(new Date(value));
export const formatWeekday = (value: string | number | Date): string => weekdayFormatter.format(new Date(value));
