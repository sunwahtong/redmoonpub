import type {CSSProperties} from 'react';
import {apiSend, assetUrl} from './api';

/**
 * Browser side of an upload.
 *
 * Asks the API to sign, sends the file straight to Cloudinary, and returns
 * what the feature endpoint needs to store. Locally (no Cloudinary) the file
 * goes to the API's multipart fallback instead; callers cannot tell.
 */
export type MediaKind = 'image' | 'audio';
/** What the browser may upload directly; signatures are stored by the server. */
export type MediaPurpose = 'gallery' | 'event' | 'product' | 'house' | 'dj-music' | 'avatar';

export interface UploadedMedia {
  url: string;
  publicId: string;
  width: number;
  height: number;
  size: number;
  duration: number;
}

interface SignResponse {
  provider: 'cloudinary' | 'local';
  uploadUrl?: string;
  fields?: Record<string, string>;
  publicId?: string;
  resourceType?: 'image' | 'video';
  contentType: string;
}

export async function uploadMedia(kind: MediaKind, purpose: MediaPurpose, file: File, onProgress?: (fraction: number) => void): Promise<UploadedMedia> {
  const signed = await apiSend<SignResponse>('/api/media/sign', 'POST', {kind, purpose, filename: file.name, size: file.size});

  if (signed.provider === 'local') {
    const body = new FormData();
    body.append('file', file);
    const response = await fetch(`/api/media/upload?kind=${kind}&purpose=${purpose}`, {method: 'POST', body});
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(payload.error || 'A feltöltés nem sikerült.');
    const dims = kind === 'image' ? await imageSize(file) : {width: 0, height: 0};
    onProgress?.(1);
    return {url: payload.url, publicId: payload.publicId, width: dims.width, height: dims.height, size: file.size, duration: 0};
  }

  const body = new FormData();
  for (const [key, value] of Object.entries(signed.fields || {})) body.append(key, value);
  body.append('file', file);

  const result = await new Promise<Record<string, unknown>>((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open('POST', signed.uploadUrl as string);
    xhr.upload.onprogress = (event) => {
      if (event.lengthComputable) onProgress?.(event.loaded / event.total);
    };
    xhr.onload = () => {
      let payload: Record<string, unknown> = {};
      try {
        payload = JSON.parse(xhr.responseText);
      } catch {
        /* not JSON */
      }
      if (xhr.status >= 200 && xhr.status < 300) resolve(payload);
      else reject(new Error(String((payload as {error?: {message?: string}}).error?.message || `A médiatár elutasította a fájlt (${xhr.status}).`)));
    };
    xhr.onerror = () => reject(new Error('A feltöltés megszakadt.'));
    xhr.send(body);
  });

  return {
    url: String(result.secure_url || result.url || ''),
    publicId: String(result.public_id || signed.publicId || ''),
    width: Number(result.width) || 0,
    height: Number(result.height) || 0,
    size: Number(result.bytes) || file.size,
    duration: Number(result.duration) || 0
  };
}

function imageSize(file: File): Promise<{width: number; height: number}> {
  return new Promise((resolve) => {
    const url = URL.createObjectURL(file);
    const image = new Image();
    image.onload = () => {
      resolve({width: image.naturalWidth, height: image.naturalHeight});
      URL.revokeObjectURL(url);
    };
    image.onerror = () => {
      resolve({width: 0, height: 0});
      URL.revokeObjectURL(url);
    };
    image.src = url;
  });
}

/**
 * The few pictures referenced from stylesheets (hero, loader, page heroes)
 * are handed over as CSS variables at boot, so they follow the same
 * Cloudinary switch as everything else.
 */
export function installMediaVariables(): void {
  const root = document.documentElement.style;
  root.setProperty('--rm-img-cinematic', `url("${assetUrl('/assets/red-moon-cinematic-v27.webp')}")`);
  root.setProperty('--rm-img-cinematic-alt', `url("${assetUrl('/assets/red-moon-cinematic.png')}")`);
}

/** Inline style for a background picture that follows the media switch. */
export const backgroundImage = (path: string): CSSProperties => ({backgroundImage: `url("${assetUrl(path)}")`});
