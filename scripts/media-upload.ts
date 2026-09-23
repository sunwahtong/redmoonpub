/**
 * Mirrors the site's own media (public/assets, minus the map tiles) to
 * Cloudinary, keeping the same paths, so the site can serve every picture
 * and the background music from there with no code change.
 *
 *   CLOUDINARY_CLOUD_NAME=… CLOUDINARY_API_KEY=… CLOUDINARY_API_SECRET=… npm run media:upload
 *
 * Afterwards set VITE_CLOUDINARY_CLOUD_NAME (and VITE_CLOUDINARY_FOLDER if
 * you changed it) and rebuild. Re-running only uploads what changed.
 *
 * Options:
 *   --dry      list what would be uploaded
 *   --force    upload even if the asset already exists
 */
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import {config} from '../server/config.ts';

const ROOT = config.root;
const ASSETS = path.join(ROOT, 'public', 'assets');
const SKIP_DIRS = new Set(['map', 'uploads', 'dj-music']);
/** Not part of the site (leftovers kept in the repository), so never mirrored. */
const SKIP_FILES = new Set(['gtav-map-hires.png']);
/** Cloudinary's free plan refuses single files above 10 MB; nothing the site shows is that large. */
const MAX_BYTES = 10 * 1024 * 1024;
const IMAGE = /\.(png|jpe?g|webp|gif|avif)$/i;
const AUDIO = /\.(mp3|wav|ogg|m4a|aac)$/i;

const args = new Set(process.argv.slice(2));
const dry = args.has('--dry');
const force = args.has('--force');

if (!config.cloudinaryCloudName || !config.cloudinaryApiKey || !config.cloudinaryApiSecret) {
  console.error('Cloudinary is not configured. Set CLOUDINARY_CLOUD_NAME, CLOUDINARY_API_KEY and CLOUDINARY_API_SECRET (see .env.example).');
  process.exit(1);
}

function walk(dir: string, out: string[] = []): string[] {
  for (const entry of fs.readdirSync(dir, {withFileTypes: true})) {
    if (entry.isDirectory()) {
      if (!SKIP_DIRS.has(entry.name)) walk(path.join(dir, entry.name), out);
    } else if ((IMAGE.test(entry.name) || AUDIO.test(entry.name)) && !SKIP_FILES.has(entry.name)) {
      const full = path.join(dir, entry.name);
      if (fs.statSync(full).size > MAX_BYTES) console.log(`  · ${path.relative(ASSETS, full)}: over 10 MB, skipped (not shown by the site)`);
      else out.push(full);
    }
  }
  return out;
}

const sign = (params: Record<string, string | number>) =>
  crypto
    .createHash('sha1')
    .update(
      Object.keys(params)
        .sort()
        .map((key) => `${key}=${params[key]}`)
        .join('&') + config.cloudinaryApiSecret
    )
    .digest('hex');

async function exists(publicId: string, resourceType: 'image' | 'video'): Promise<boolean> {
  const auth = Buffer.from(`${config.cloudinaryApiKey}:${config.cloudinaryApiSecret}`).toString('base64');
  const response = await fetch(`https://api.cloudinary.com/v1_1/${config.cloudinaryCloudName}/resources/${resourceType}/upload/${encodeURIComponent(publicId)}`, {
    headers: {Authorization: `Basic ${auth}`}
  });
  return response.ok;
}

async function upload(file: string): Promise<void> {
  const relative = path.relative(path.join(ROOT, 'public'), file).split(path.sep).join('/');
  const resourceType = AUDIO.test(file) ? 'video' : 'image';
  const publicId = `${config.cloudinaryFolder}/${relative.replace(/\.[^.]+$/, '')}`;
  if (!force && (await exists(publicId, resourceType))) {
    console.log(`  = ${relative} (already there)`);
    return;
  }
  if (dry) {
    console.log(`  + ${relative} → ${publicId}`);
    return;
  }
  const timestamp = Math.floor(Date.now() / 1000);
  const params = {public_id: publicId, timestamp, overwrite: 'true', invalidate: 'true'};
  const body = new FormData();
  body.append('file', new Blob([fs.readFileSync(file)]), path.basename(file));
  body.append('api_key', config.cloudinaryApiKey);
  body.append('timestamp', String(timestamp));
  body.append('public_id', publicId);
  body.append('overwrite', 'true');
  body.append('invalidate', 'true');
  body.append('signature', sign(params));
  const response = await fetch(`https://api.cloudinary.com/v1_1/${config.cloudinaryCloudName}/${resourceType}/upload`, {method: 'POST', body});
  if (!response.ok) throw new Error(`${relative}: ${response.status} ${(await response.text()).slice(0, 200)}`);
  console.log(`  ↑ ${relative}`);
}

const files = walk(ASSETS);
console.log(`${files.length} file(s) under public/assets (map tiles and uploads skipped)${dry ? ' — dry run' : ''}`);
let failed = 0;
for (const file of files) {
  try {
    await upload(file);
  } catch (error) {
    failed += 1;
    console.error(`  ✗ ${(error as Error).message}`);
  }
}
console.log(failed ? `\n${failed} failed.` : `\nDone. Now set VITE_CLOUDINARY_CLOUD_NAME=${config.cloudinaryCloudName} and rebuild.`);
process.exit(failed ? 1 : 0);
