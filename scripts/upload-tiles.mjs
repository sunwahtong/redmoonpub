/**
 * Uploads the GTA V map tile pack to a public Supabase Storage bucket.
 *
 * Why: the pack is 438 MB across 4102 files. Serving it from the VPS is fine,
 * but shipping it through a Vercel deployment is not — it would be re-uploaded
 * on every deploy and would push the build well past any sensible limit. The
 * tiles never change, so they are uploaded once and the frontend is pointed at
 * the bucket with VITE_MAP_TILE_BASE.
 *
 * Run once, from a machine that has the tile pack:
 *
 *   SUPABASE_URL=https://xxxx.supabase.co \
 *   SUPABASE_SECRET_KEY=sb_secret_... \
 *   npm run tiles:upload
 *
 * It is safe to re-run: existing objects are skipped unless --force is passed,
 * so an interrupted upload can simply be started again.
 *
 * Flags:
 *   --force     re-upload objects that already exist
 *   --bucket=x  target bucket (default: map-tiles)
 *   --style=x   upload only one style folder, repeatable
 *   --dry-run   list what would happen, upload nothing
 */
import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import {fileURLToPath} from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const TILE_ROOT = path.join(ROOT, 'map-tiles');

const args = process.argv.slice(2);
const flag = (name) => args.includes(`--${name}`);
const value = (name, fallback) => {
  const hit = args.find((a) => a.startsWith(`--${name}=`));
  return hit ? hit.slice(name.length + 3) : fallback;
};

const SUPABASE_URL = String(process.env.SUPABASE_URL || '').replace(/\/+$/, '');
const SERVICE_KEY = String(process.env.SUPABASE_SECRET_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY || '');
const BUCKET = value('bucket', process.env.SUPABASE_TILE_BUCKET || 'map-tiles');
const FORCE = flag('force');
const DRY_RUN = flag('dry-run');
const CONCURRENCY = Number(value('concurrency', '12'));

const styleFilter = args.filter((a) => a.startsWith('--style=')).map((a) => a.slice(8));
const STYLES = styleFilter.length ? styleFilter : ['styleAtlas', 'styleGrid', 'styleSatelite'];

const CONTENT_TYPES = {
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.png': 'image/png',
  '.webp': 'image/webp'
};

function fail(message) {
  console.error(`\n  ${message}\n`);
  process.exit(1);
}

if (!SUPABASE_URL || !SERVICE_KEY) {
  fail('Set SUPABASE_URL and SUPABASE_SECRET_KEY before running this script.');
}
if (!fs.existsSync(TILE_ROOT)) {
  fail(`Tile pack not found at ${TILE_ROOT}`);
}

/** Every file under a directory, as paths relative to TILE_ROOT. */
function collect(dir, out = []) {
  for (const entry of fs.readdirSync(dir, {withFileTypes: true})) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) collect(full, out);
    else if (CONTENT_TYPES[path.extname(entry.name).toLowerCase()]) {
      out.push(path.relative(TILE_ROOT, full).split(path.sep).join('/'));
    }
  }
  return out;
}

async function ensureBucket() {
  const existing = await fetch(`${SUPABASE_URL}/storage/v1/bucket/${BUCKET}`, {
    headers: {Authorization: `Bearer ${SERVICE_KEY}`, apikey: SERVICE_KEY}
  });
  if (existing.ok) return 'exists';

  const created = await fetch(`${SUPABASE_URL}/storage/v1/bucket`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${SERVICE_KEY}`,
      apikey: SERVICE_KEY,
      'Content-Type': 'application/json'
    },
    // Public: tiles are static artwork and the map loads thousands of them.
    // Signing every one would be pointless work and slow the map down.
    body: JSON.stringify({id: BUCKET, name: BUCKET, public: true})
  });
  if (!created.ok) fail(`Could not create bucket "${BUCKET}": ${await created.text()}`);
  return 'created';
}

async function uploadOne(key) {
  const body = fs.readFileSync(path.join(TILE_ROOT, key));
  const contentType = CONTENT_TYPES[path.extname(key).toLowerCase()] || 'application/octet-stream';

  const response = await fetch(`${SUPABASE_URL}/storage/v1/object/${BUCKET}/${encodeURI(key)}`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${SERVICE_KEY}`,
      apikey: SERVICE_KEY,
      'Content-Type': contentType,
      'Cache-Control': 'public, max-age=31536000, immutable',
      'x-upsert': FORCE ? 'true' : 'false'
    },
    body
  });

  // 409 means the object is already there, which is the normal case on a re-run.
  if (response.status === 409 && !FORCE) return 'skipped';
  if (!response.ok) throw new Error(`${response.status} ${(await response.text()).slice(0, 160)}`);
  return 'uploaded';
}

/** Runs `worker` over `items` with a fixed number of parallel workers. */
async function pool(items, limit, worker) {
  let index = 0;
  const runners = Array.from({length: Math.max(1, limit)}, async () => {
    while (index < items.length) {
      const item = items[index++];
      await worker(item, index);
    }
  });
  await Promise.all(runners);
}

const files = STYLES.flatMap((style) => {
  const dir = path.join(TILE_ROOT, style);
  if (!fs.existsSync(dir)) {
    console.warn(`  skipping ${style}: not present`);
    return [];
  }
  return collect(dir);
});

const totalBytes = files.reduce((sum, key) => sum + fs.statSync(path.join(TILE_ROOT, key)).size, 0);

console.log(`\n  Bucket   ${BUCKET}`);
console.log(`  Styles   ${STYLES.join(', ')}`);
console.log(`  Files    ${files.length} (${(totalBytes / 1024 / 1024).toFixed(1)} MB)`);
console.log(`  Mode     ${DRY_RUN ? 'dry run' : FORCE ? 'overwrite' : 'skip existing'}\n`);

if (DRY_RUN) {
  console.log(`  Would upload to ${SUPABASE_URL}/storage/v1/object/public/${BUCKET}/...\n`);
  process.exit(0);
}

const state = await ensureBucket();
console.log(`  Bucket ${state}.\n`);

let uploaded = 0;
let skipped = 0;
const failures = [];

await pool(files, CONCURRENCY, async (key, done) => {
  try {
    const result = await uploadOne(key);
    if (result === 'uploaded') uploaded++;
    else skipped++;
  } catch (error) {
    failures.push({key, error: error.message});
  }
  if (done % 200 === 0 || done === files.length) {
    process.stdout.write(`\r  ${done}/${files.length}  uploaded ${uploaded}  skipped ${skipped}  failed ${failures.length}   `);
  }
});

console.log('\n');

if (failures.length) {
  console.error(`  ${failures.length} file(s) failed. First few:`);
  for (const failure of failures.slice(0, 5)) console.error(`    ${failure.key}: ${failure.error}`);
  console.error('\n  Re-run the command; finished files are skipped.\n');
  process.exit(1);
}

console.log(`  Done. Set this in Vercel:\n`);
console.log(`    VITE_MAP_TILE_BASE=${SUPABASE_URL}/storage/v1/object/public/${BUCKET}\n`);
