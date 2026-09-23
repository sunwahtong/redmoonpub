/**
 * Supabase Storage, spoken to directly over its REST API.
 *
 * Large uploads (DJ audio, up to 80 MB) never pass through the API server:
 * the browser asks for a signed upload URL, sends the file straight to the
 * bucket, then registers the finished object. A Vercel function accepts at
 * most a few megabytes per request, and proxying audio through it would be
 * slow and pointless anyway.
 *
 * The service role key bypasses every storage policy. It is read here, server
 * side only, and never leaves this process.
 */
import {config} from './config.ts';

export const AUDIO_TYPES: Record<string, string> = {
  '.mp3': 'audio/mpeg',
  '.wav': 'audio/wav',
  '.ogg': 'audio/ogg',
  '.m4a': 'audio/mp4',
  '.aac': 'audio/aac',
  '.webm': 'audio/webm'
};

export const IMAGE_TYPES: Record<string, string> = {
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.gif': 'image/gif'
};

export const storageEnabled = (): boolean => !!(config.supabaseUrl && config.supabaseServiceKey);

const headers = () => ({Authorization: `Bearer ${config.supabaseServiceKey}`, apikey: config.supabaseServiceKey});

export function publicUrl(bucket: string, key: string): string {
  return `${config.supabaseUrl}/storage/v1/object/public/${bucket}/${encodeURI(key)}`;
}

/** Recovers the object key from a public URL of ours, or null. */
export function keyFromUrl(bucket: string, url: string): string | null {
  const prefix = `${config.supabaseUrl}/storage/v1/object/public/${bucket}/`;
  const raw = String(url || '');
  if (!config.supabaseUrl || !raw.startsWith(prefix)) return null;
  try {
    return decodeURI(raw.slice(prefix.length));
  } catch {
    return null;
  }
}

export interface SignedUpload {
  url: string;
  token: string;
  key: string;
  publicUrl: string;
}

/** A one-off URL the browser may PUT one object to. Valid for two hours. */
export async function createSignedUpload(bucket: string, key: string): Promise<SignedUpload> {
  const response = await fetch(`${config.supabaseUrl}/storage/v1/object/upload/sign/${bucket}/${encodeURI(key)}`, {
    method: 'POST',
    headers: {...headers(), 'Content-Type': 'application/json'},
    body: JSON.stringify({})
  });
  if (!response.ok) {
    const detail = await response.text().catch(() => '');
    throw new Error(`Signed upload failed (${response.status}): ${detail.slice(0, 200)}`);
  }
  const data = (await response.json()) as {url?: string; token?: string};
  // The API answers with a relative path; the browser needs an absolute one.
  const url = String(data.url || '').startsWith('http') ? String(data.url) : `${config.supabaseUrl}/storage/v1${data.url}`;
  return {url, token: String(data.token || ''), key, publicUrl: publicUrl(bucket, key)};
}

/** Confirms an object exists and reports its size. */
export async function statObject(bucket: string, key: string): Promise<{size: number; contentType: string} | null> {
  const response = await fetch(`${config.supabaseUrl}/storage/v1/object/info/${bucket}/${encodeURI(key)}`, {headers: headers()});
  if (!response.ok) return null;
  const data = (await response.json().catch(() => null)) as {size?: number; contentType?: string; metadata?: {size?: number; mimetype?: string}} | null;
  if (!data) return null;
  return {size: Number(data.size ?? data.metadata?.size ?? 0), contentType: data.contentType || data.metadata?.mimetype || ''};
}

export async function uploadObject(bucket: string, key: string, data: Buffer, contentType = 'application/octet-stream'): Promise<string> {
  const response = await fetch(`${config.supabaseUrl}/storage/v1/object/${bucket}/${encodeURI(key)}`, {
    method: 'POST',
    headers: {...headers(), 'Content-Type': contentType, 'Cache-Control': 'public, max-age=31536000, immutable', 'x-upsert': 'true'},
    body: new Uint8Array(data)
  });
  if (!response.ok) {
    const detail = await response.text().catch(() => '');
    throw new Error(`Storage upload failed (${response.status}): ${detail.slice(0, 200)}`);
  }
  return publicUrl(bucket, key);
}

export async function deleteObject(bucket: string, key: string | null): Promise<void> {
  if (!storageEnabled() || !key) return;
  await fetch(`${config.supabaseUrl}/storage/v1/object/${bucket}/${encodeURI(key)}`, {method: 'DELETE', headers: headers()}).catch(() => {});
}

export function sanitizeFilename(name: unknown): string {
  let clean = String(name || 'file')
    .normalize('NFKC')
    .replace(/[^a-zA-Z0-9._ -]+/g, '_')
    .trim();
  if (!clean) clean = 'file';
  return clean.slice(0, 100);
}
