/**
 * Uploaded media: pictures and audio.
 *
 * Production keeps everything on Cloudinary. The browser asks the API for a
 * signed upload (this file computes the signature with the API secret, which
 * never leaves the server), sends the file straight to Cloudinary, and then
 * registers the finished asset with the feature that wanted it. Nothing large
 * ever passes through a serverless function.
 *
 * Without Cloudinary credentials — local development — the same flow ends in
 * a multipart POST to this server, which writes the file under
 * public/assets/uploads/. The frontend does not care which.
 */
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import {config} from './config.ts';
import {bad} from './http.ts';
import {signatureImageData} from '../shared/signature.ts';

export type MediaKind = 'image' | 'audio';

/** Where an asset belongs; also its folder in the store. */
export type MediaPurpose = 'gallery' | 'event' | 'product' | 'house' | 'dj-music' | 'avatar' | 'signature';

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
  '.gif': 'image/gif',
  '.avif': 'image/avif'
};

export const cloudinaryEnabled = (): boolean => !!(config.cloudinaryCloudName && config.cloudinaryApiKey && config.cloudinaryApiSecret);

/**
 * Disk is only a store for the embedded local database: a hosted database
 * must never reference files that exist on one developer's machine, and a
 * serverless function has no disk at all.
 */
export const localStoreAllowed = (): boolean => !config.serverless && !config.databaseUrl;

export const mediaProvider = (): 'cloudinary' | 'local' => (cloudinaryEnabled() ? 'cloudinary' : 'local');

const NO_STORE = 'A médiatár (Cloudinary) nincs beállítva, ezért a fájl nem menthető.';

/** Cloudinary keeps audio under its "video" resource type. */
export const resourceTypeOf = (kind: MediaKind): 'image' | 'video' => (kind === 'audio' ? 'video' : 'image');

export function sanitizeFilename(name: unknown): string {
  let clean = String(name || 'file')
    .normalize('NFKC')
    .replace(/[^a-zA-Z0-9._ -]+/g, '_')
    .trim();
  if (!clean) clean = 'file';
  return clean.slice(0, 100);
}

export function extensionOf(filename: string): string {
  return path.extname(String(filename || '')).toLowerCase();
}

export function mimeFor(kind: MediaKind, ext: string): string | null {
  return (kind === 'audio' ? AUDIO_TYPES : IMAGE_TYPES)[ext] || null;
}

/** Cloudinary's signature: SHA-1 over the sorted parameters plus the secret. */
function sign(params: Record<string, string | number>): string {
  const serialized = Object.keys(params)
    .sort()
    .map((key) => `${key}=${params[key]}`)
    .join('&');
  return crypto.createHash('sha1').update(`${serialized}${config.cloudinaryApiSecret}`).digest('hex');
}

export interface SignedUpload {
  provider: 'cloudinary';
  uploadUrl: string;
  /** Form fields the browser must send alongside the file. */
  fields: Record<string, string>;
  publicId: string;
  resourceType: 'image' | 'video';
}

/**
 * A one-off signed upload for the browser. `purpose` becomes the folder under
 * the configured root, so the account stays navigable.
 */
export function signUpload(kind: MediaKind, purpose: MediaPurpose, filename: string): SignedUpload {
  const base = sanitizeFilename(filename).replace(/\.[^.]+$/, '').replace(/[^a-zA-Z0-9_-]+/g, '_').slice(0, 60) || 'file';
  const folder = `${config.cloudinaryFolder}/${purpose}`;
  const publicId = `${base}_${crypto.randomBytes(5).toString('hex')}`;
  const timestamp = Math.floor(Date.now() / 1000);
  const params: Record<string, string | number> = {folder, public_id: publicId, timestamp};
  const signature = sign(params);
  return {
    provider: 'cloudinary',
    uploadUrl: `https://api.cloudinary.com/v1_1/${config.cloudinaryCloudName}/${resourceTypeOf(kind)}/upload`,
    fields: {api_key: config.cloudinaryApiKey, timestamp: String(timestamp), signature, folder, public_id: publicId},
    publicId: `${folder}/${publicId}`,
    resourceType: resourceTypeOf(kind)
  };
}

export interface StoredMedia {
  url: string;
  publicId: string;
}

/**
 * Stores bytes the server itself holds — signatures it drew, and the one-time
 * move of pictures that used to live in the database. Cloudinary when it is
 * configured, disk otherwise; on Vercel there is no disk, so the caller gets
 * a clear error instead.
 */
export async function storeMedia(kind: MediaKind, purpose: MediaPurpose, filename: string, data: Buffer, contentType: string): Promise<StoredMedia> {
  if (!cloudinaryEnabled()) {
    if (!localStoreAllowed()) throw bad(NO_STORE);
    return storeLocal(kind, purpose, filename, data);
  }
  const signed = signUpload(kind, purpose, filename);
  const form = new FormData();
  for (const [key, value] of Object.entries(signed.fields)) form.append(key, value);
  form.append('file', new Blob([data as Uint8Array<ArrayBuffer>], {type: contentType}), sanitizeFilename(filename));
  const response = await fetch(signed.uploadUrl, {method: 'POST', body: form, signal: AbortSignal.timeout(20000)});
  const payload = (await response.json().catch(() => ({}))) as {secure_url?: string; public_id?: string; error?: {message?: string}};
  if (!response.ok || !payload.secure_url) throw bad(payload.error?.message || `A médiatár elutasította a fájlt (${response.status}).`);
  return {url: payload.secure_url, publicId: payload.public_id || signed.publicId};
}

/**
 * A signature goes to the store as what it is: the SVG of a drawn or
 * generated one, or the PNG an uploaded one wraps (SVG sanitising in the
 * store would otherwise strip the embedded picture).
 */
export async function storeSignature(username: string, svg: string): Promise<StoredMedia> {
  const embedded = signatureImageData(svg);
  const base = sanitizeFilename(username).replace(/\s+/g, '_') || 'signature';
  if (embedded) {
    const bytes = Buffer.from(embedded.slice(embedded.indexOf(',') + 1), 'base64');
    return storeMedia('image', 'signature', `${base}-signature.png`, bytes, 'image/png');
  }
  return storeMedia('image', 'signature', `${base}-signature.svg`, Buffer.from(svg, 'utf8'), 'image/svg+xml');
}

/**
 * Whether a URL + public id pair names an asset of ours for this purpose, so
 * the reference can be stored and the asset later removed with `destroyMedia`.
 */
export function ownsMedia(url: string, publicId: string, kind: MediaKind, purpose: MediaPurpose): boolean {
  const link = String(url || '').trim();
  const id = String(publicId || '').trim();
  if (!link || !id || link.includes('..')) return false;
  if (cloudinaryEnabled()) return isOurCloudinaryUrl(link, kind) && id.startsWith(`${config.cloudinaryFolder}/${purpose}/`) && link.includes(`/${id}`);
  return link.startsWith(`/assets/uploads/${kind}/${purpose}/`) && id === `local:${link.slice(1)}`;
}

/**
 * A picture reference from the console: either one of the site's own files
 * under /assets (no public id) or an upload of ours for this purpose.
 */
export function acceptImage(url: string, publicId: string, purpose: MediaPurpose): void {
  const link = String(url || '').trim();
  if (!link) return;
  if (!publicId && (link.startsWith('/assets/') || link.startsWith('assets/')) && !link.includes('..') && !link.startsWith('/assets/uploads/')) return;
  if (ownsMedia(link, publicId, 'image', purpose)) return;
  throw bad('A kép csak a ház médiatárából jöhet: tölts fel egyet.');
}

/** True when the URL points into this account, so a stored reference can be trusted. */
export function isOurCloudinaryUrl(url: string, kind: MediaKind): boolean {
  if (!cloudinaryEnabled()) return false;
  const prefix = `https://res.cloudinary.com/${config.cloudinaryCloudName}/${resourceTypeOf(kind)}/upload/`;
  return String(url || '').startsWith(prefix);
}

/** Removes an asset. Never throws: a stray file is not worth a failed request. */
export async function destroyMedia(publicId: string | null | undefined, kind: MediaKind): Promise<void> {
  const id = String(publicId || '').trim();
  if (!id) return;
  if (id.startsWith('local:')) {
    try {
      fs.unlinkSync(path.join(config.publicDir, id.slice(6)));
    } catch {
      /* already gone */
    }
    return;
  }
  if (!cloudinaryEnabled()) return;
  try {
    const timestamp = Math.floor(Date.now() / 1000);
    const params = {public_id: id, timestamp};
    const body = new URLSearchParams({...params, timestamp: String(timestamp), api_key: config.cloudinaryApiKey, signature: sign(params)});
    await fetch(`https://api.cloudinary.com/v1_1/${config.cloudinaryCloudName}/${resourceTypeOf(kind)}/destroy`, {
      method: 'POST',
      body,
      signal: AbortSignal.timeout(6000)
    });
  } catch (error) {
    console.warn('[media] destroy failed:', (error as Error).message);
  }
}

/** Local fallback: writes the bytes under public/assets/uploads and returns the site path. */
export function storeLocal(kind: MediaKind, purpose: MediaPurpose, filename: string, data: Buffer): StoredMedia {
  const safe = `${Date.now().toString(36)}_${crypto.randomBytes(4).toString('hex')}_${sanitizeFilename(filename)}`;
  const relative = path.posix.join('assets', 'uploads', kind, purpose, safe);
  const target = path.join(config.publicDir, relative);
  fs.mkdirSync(path.dirname(target), {recursive: true});
  fs.writeFileSync(target, data);
  return {url: `/${relative}`, publicId: `local:${relative}`};
}

/**
 * Minimal multipart parser for the local fallback: returns the first file
 * part. Cloudinary handles real uploads, so this only ever sees one file.
 */
export function firstFilePart(contentType: string, buffer: Buffer): {filename: string; data: Buffer} | null {
  const match = String(contentType || '').match(/boundary=(?:"([^"]+)"|([^;]+))/i);
  if (!match) return null;
  const boundary = Buffer.from(`--${match[1] || match[2]}`);
  let cursor = 0;
  while (cursor < buffer.length) {
    const start = buffer.indexOf(Buffer.from('Content-Disposition:'), cursor);
    if (start < 0) return null;
    const headerEnd = buffer.indexOf(Buffer.from('\r\n\r\n'), start);
    if (headerEnd < 0) return null;
    const header = buffer.subarray(start, headerEnd).toString('utf8');
    const dataStart = headerEnd + 4;
    const end = buffer.indexOf(Buffer.concat([Buffer.from('\r\n'), boundary]), dataStart);
    if (end < 0) return null;
    const filename = header.match(/filename="([^"]*)"/i)?.[1];
    if (filename) return {filename: sanitizeFilename(filename), data: buffer.subarray(dataStart, end)};
    cursor = end + boundary.length;
  }
  return null;
}
