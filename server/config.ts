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

export const config = Object.freeze({
  root: ROOT,
  publicDir: path.join(ROOT, 'public'),
  distDir: path.join(ROOT, 'dist'),
  migrationsDir: path.join(ROOT, 'supabase', 'migrations'),

  port: Number(process.env.PORT || 3000),
  production: process.env.NODE_ENV === 'production' || !!process.env.VERCEL,
  /** One short-lived invocation per request (Vercel), or a long-lived process. */
  serverless: !!process.env.VERCEL || bool(process.env.RM_SERVERLESS),

  /** PostgreSQL connection string. Empty means the embedded local database. */
  databaseUrl: String(process.env.DATABASE_URL || '').trim(),
  databaseSsl: String(process.env.DB_SSLMODE || '').toLowerCase() !== 'disable',
  /** Where the embedded database keeps its files when DATABASE_URL is empty. */
  localDataDir: path.join(ROOT, 'data', 'pglite'),

  /** Supabase Storage, used for DJ audio and uploaded images. */
  supabaseUrl: String(process.env.SUPABASE_URL || '').replace(/\/+$/, ''),
  supabaseServiceKey: String(process.env.SUPABASE_SERVICE_ROLE_KEY || ''),
  musicBucket: String(process.env.SUPABASE_BUCKET || 'dj-music'),
  mediaBucket: String(process.env.SUPABASE_MEDIA_BUCKET || 'media'),

  /** First owner, created once while no owner account exists. */
  ownerUsername: String(process.env.OWNER_USERNAME || '').trim(),
  ownerPassword: String(process.env.OWNER_PASSWORD || ''),
  ownerName: String(process.env.OWNER_NAME || 'Red Moon Owner').trim() || 'Red Moon Owner',

  /** Sessions: idle timeout and absolute lifetime. */
  sessionIdleMs: 12 * 60 * 60 * 1000,
  sessionMaxMs: 3 * 24 * 60 * 60 * 1000,
  /** Login throttling window and limits. */
  loginWindowMs: 15 * 60 * 1000,
  loginMaxPerUser: 8,
  loginMaxPerIp: 40,

  /** Largest JSON body accepted, in bytes. Avatars have their own limit. */
  maxJsonBytes: 1024 * 1024,
  maxAvatarBytes: 700 * 1024,
  maxAudioBytes: 80 * 1024 * 1024
});
