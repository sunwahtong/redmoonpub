/**
 * Runtime configuration, read once from the environment.
 *
 * Every knob the backend has lives here, so a deployment can be understood by
 * reading one file. Nothing else in `server/` touches `process.env`.
 */
import 'dotenv/config';
import path from 'node:path';
import {fileURLToPath} from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

const bool = (value: unknown): boolean => ['1', 'true', 'yes', 'on'].includes(String(value || '').trim().toLowerCase());
const text = (value: unknown): string => String(value || '').trim();

export const config = Object.freeze({
  root: ROOT,
  publicDir: path.join(ROOT, 'public'),
  distDir: path.join(ROOT, 'dist'),
  /** The map tile pack, kept out of public/ so a build does not copy 300 MB into dist. */
  tilesDir: path.join(ROOT, 'map-tiles'),
  migrationsDir: path.join(ROOT, 'supabase', 'migrations'),

  port: Number(process.env.PORT || 3000),
  production: process.env.NODE_ENV === 'production' || !!process.env.VERCEL,
  /** One short-lived invocation per request (Vercel), or a long-lived process. */
  serverless: !!process.env.VERCEL || bool(process.env.RM_SERVERLESS),

  /** Where the browser loads map tiles from; empty means this server's /assets/map. Read here for the CSP. */
  tileBase: text(process.env.VITE_MAP_TILE_BASE),

  /** PostgreSQL connection string. Empty means the embedded local database. */
  databaseUrl: text(process.env.DATABASE_URL),
  databaseSsl: text(process.env.DB_SSLMODE).toLowerCase() !== 'disable',
  /** Where the embedded database keeps its files when DATABASE_URL is empty. */
  localDataDir: path.join(ROOT, 'data', 'pglite'),

  /**
   * Supabase Realtime, used to push changes to open browsers. The publishable
   * key (sb_publishable_…) is enough for public broadcast channels; the secret
   * key (sb_secret_…) is used instead when present. The legacy anon /
   * service_role JWT names still work as a fallback.
   */
  supabaseUrl: text(process.env.SUPABASE_URL).replace(/\/+$/, ''),
  supabasePublishableKey: text(process.env.SUPABASE_PUBLISHABLE_KEY) || text(process.env.SUPABASE_ANON_KEY),
  supabaseSecretKey: text(process.env.SUPABASE_SECRET_KEY) || text(process.env.SUPABASE_SERVICE_ROLE_KEY),

  /**
   * Cloudinary holds every uploaded picture and audio file (gallery, event
   * covers, product images, DJ tracks). Without it, uploads land on the local
   * disk under public/assets/uploads — fine for development, not for Vercel.
   */
  cloudinaryCloudName: text(process.env.CLOUDINARY_CLOUD_NAME),
  cloudinaryApiKey: text(process.env.CLOUDINARY_API_KEY),
  cloudinaryApiSecret: text(process.env.CLOUDINARY_API_SECRET),
  cloudinaryFolder: text(process.env.CLOUDINARY_FOLDER) || 'redmoon',

  /** First owner, created once while no owner account exists. */
  ownerUsername: text(process.env.OWNER_USERNAME),
  ownerPassword: String(process.env.OWNER_PASSWORD || ''),
  ownerName: text(process.env.OWNER_NAME) || 'Red Moon Owner',

  /** Sessions: idle timeout and absolute lifetime. */
  sessionIdleMs: 12 * 60 * 60 * 1000,
  sessionMaxMs: 3 * 24 * 60 * 60 * 1000,
  /** Login throttling window and limits. */
  loginWindowMs: 15 * 60 * 1000,
  loginMaxPerUser: 8,
  loginMaxPerIp: 40,

  /** Largest JSON body accepted, in bytes. Avatars and signatures have their own limits. */
  maxJsonBytes: 1024 * 1024,
  maxAvatarBytes: 700 * 1024,
  maxSignatureBytes: 260 * 1024,
  maxAudioBytes: 80 * 1024 * 1024,
  maxImageBytes: 12 * 1024 * 1024
});
