/**
 * Object storage for uploaded DJ audio.
 *
 * On a VPS or on Render the files are written to `public/assets/dj-music/` and
 * served by the same Node process. That does not work on Vercel: a function has
 * a read-only filesystem apart from `/tmp`, and `/tmp` is thrown away when the
 * instance is recycled.
 *
 * So when Supabase credentials are present, uploads go to a Supabase Storage
 * bucket instead and the stored URL becomes an absolute public URL. Everything
 * else in the application keeps working unchanged, because the club state only
 * ever holds a URL string.
 *
 * This talks to the Storage REST API with `fetch` on purpose — pulling in
 * `@supabase/supabase-js` for three HTTP calls would add a dependency to the
 * serverless bundle for nothing.
 */

const SUPABASE_URL = String(process.env.SUPABASE_URL || '').replace(/\/+$/, '');
// The service role key bypasses row level security. It must never reach the
// browser: it is read here, server side only, and is not exposed by any route.
const SERVICE_KEY = String(process.env.SUPABASE_SERVICE_ROLE_KEY || '');
const BUCKET = String(process.env.SUPABASE_BUCKET || 'dj-music');

/** True when uploads should go to the bucket rather than to the local disk. */
function bucketStorageEnabled(){
  return !!(SUPABASE_URL && SERVICE_KEY);
}

function bucketPublicUrl(objectPath){
  return `${SUPABASE_URL}/storage/v1/object/public/${BUCKET}/${encodeURI(objectPath)}`;
}

/**
 * Uploads one object and returns its public URL.
 *
 * @param {string} objectPath key inside the bucket, e.g. "track_ab12_song.mp3"
 * @param {Buffer} data      file contents
 * @param {string} contentType
 */
async function bucketUpload(objectPath, data, contentType = 'application/octet-stream'){
  if(!bucketStorageEnabled()) throw new Error('Object storage is not configured.');

  const response = await fetch(`${SUPABASE_URL}/storage/v1/object/${BUCKET}/${encodeURI(objectPath)}`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${SERVICE_KEY}`,
      'Content-Type': contentType,
      'Cache-Control': 'public, max-age=31536000, immutable',
      'x-upsert': 'true'
    },
    body: data
  });

  if(!response.ok){
    const detail = await response.text().catch(() => '');
    throw new Error(`Storage upload failed (${response.status}): ${detail.slice(0, 200)}`);
  }

  return bucketPublicUrl(objectPath);
}

/** Deletes one object. A missing object is not an error. */
async function bucketDelete(objectPath){
  if(!bucketStorageEnabled()) return;
  await fetch(`${SUPABASE_URL}/storage/v1/object/${BUCKET}/${encodeURI(objectPath)}`, {
    method: 'DELETE',
    headers: {Authorization: `Bearer ${SERVICE_KEY}`}
  }).catch(() => {});
}

/**
 * Recovers the bucket key from a stored URL, or null when the URL points
 * somewhere else (a local `assets/dj-music/...` path, or an external link).
 */
function bucketKeyFromUrl(url){
  const raw = String(url || '');
  const prefix = `${SUPABASE_URL}/storage/v1/object/public/${BUCKET}/`;
  if(!SUPABASE_URL || !raw.startsWith(prefix)) return null;
  return decodeURI(raw.slice(prefix.length));
}

const AUDIO_CONTENT_TYPES = {
  '.mp3': 'audio/mpeg',
  '.wav': 'audio/wav',
  '.ogg': 'audio/ogg',
  '.m4a': 'audio/mp4',
  '.aac': 'audio/aac',
  '.webm': 'audio/webm'
};

module.exports = {
  AUDIO_CONTENT_TYPES,
  BUCKET,
  bucketDelete,
  bucketKeyFromUrl,
  bucketPublicUrl,
  bucketStorageEnabled,
  bucketUpload
};
