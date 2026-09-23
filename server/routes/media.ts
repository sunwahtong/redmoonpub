/**
 * Uploads: a signed Cloudinary upload for the browser, or the local fallback.
 *
 * The API never receives a picture on Vercel. It signs, the browser uploads,
 * the feature endpoint (gallery, event, product, booth) receives the URL and
 * checks it points into our Cloudinary account before storing it.
 */
import {z} from 'zod';
import {capabilitiesOf, requireUser} from '../auth.ts';
import {bad, forbidden, parse, readJson, readRaw, type Router} from '../http.ts';
import {cloudinaryEnabled, extensionOf, firstFilePart, localStoreAllowed, mimeFor, sanitizeFilename, signUpload, storeLocal, type MediaKind, type MediaPurpose} from '../media.ts';
import {config} from '../config.ts';
import type {SessionUser} from '../types.ts';

/** What the browser may upload directly. Signatures are stored by the server itself. */
const PURPOSES = ['gallery', 'event', 'product', 'house', 'dj-music', 'avatar'] as const satisfies readonly MediaPurpose[];
type Purpose = (typeof PURPOSES)[number];

const signBody = z.object({
  kind: z.enum(['image', 'audio']),
  purpose: z.enum(PURPOSES),
  filename: z.string().trim().min(1).max(200),
  size: z.coerce.number().int().min(1)
});

/** Who may upload what. */
function allow(user: SessionUser, purpose: Purpose): void {
  const caps = capabilitiesOf(user);
  if (purpose === 'gallery' || purpose === 'house' || purpose === 'event') {
    if (!caps.owner) throw forbidden('Ehhez tulajdonosi jog kell.');
  } else if (purpose === 'product') {
    if (!caps.manager) throw forbidden('Ehhez manager jog kell.');
  } else if (purpose === 'dj-music') {
    if (!caps.dj) throw forbidden('Ehhez DJ jogosultság kell.');
  }
}

function check(kind: MediaKind, filename: string, size: number): string {
  const ext = extensionOf(filename);
  const mime = mimeFor(kind, ext);
  if (!mime) throw bad(kind === 'audio' ? 'Csak MP3, WAV, OGG, M4A, AAC vagy WEBM hangfájl tölthető fel.' : 'PNG, JPG, WebP, GIF vagy AVIF képet válassz.');
  if (size > (kind === 'audio' ? config.maxAudioBytes : config.maxImageBytes)) {
    throw bad(kind === 'audio' ? 'A hangfájl legfeljebb 80 MB lehet.' : 'A kép legfeljebb 12 MB lehet.');
  }
  return mime;
}

export function registerMediaRoutes(router: Router): void {
  router.post('/api/media/sign', async ({req, user}) => {
    const me = requireUser({user});
    const body = parse(signBody, await readJson(req));
    allow(me, body.purpose);
    const contentType = check(body.kind, body.filename, body.size);
    if (!cloudinaryEnabled()) {
      if (!localStoreAllowed()) throw bad('A médiatár (Cloudinary) nincs beállítva, ezért nem lehet feltölteni.');
      return {provider: 'local', contentType};
    }
    return {...signUpload(body.kind, body.purpose, body.filename), contentType};
  });

  /** Local development only: the file is written under public/assets/uploads. */
  router.post('/api/media/upload', async ({req, user, query}) => {
    const me = requireUser({user});
    if (cloudinaryEnabled() || !localStoreAllowed()) throw bad('Használd a közvetlen feltöltést.');
    const kind = (query.get('kind') === 'audio' ? 'audio' : 'image') as MediaKind;
    const purpose = String(query.get('purpose') || 'gallery') as Purpose;
    if (!PURPOSES.includes(purpose)) throw bad('Ismeretlen cél.');
    allow(me, purpose);
    const buffer = await readRaw(req, kind === 'audio' ? config.maxAudioBytes : config.maxImageBytes);
    const part = firstFilePart(String(req.headers['content-type'] || ''), buffer);
    if (!part) throw bad('Fájl nem található a feltöltésben.');
    check(kind, part.filename, part.data.length);
    const stored = storeLocal(kind, purpose, sanitizeFilename(part.filename), part.data);
    return {provider: 'local', url: stored.url, publicId: stored.publicId, size: part.data.length};
  });

}
