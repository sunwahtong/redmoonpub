/**
 * One-time move of pictures that earlier versions kept inline in the
 * database — profile pictures as data: URLs, signatures as SVG text — into
 * the media store. Runs once per process after the seed and is safe to
 * repeat: it only touches rows that still hold inline data.
 */
import {cloudinaryEnabled, localStoreAllowed, storeMedia, storeSignature} from './media.ts';
import type {Db} from './types.ts';

const EXTENSION: Record<string, string> = {'image/png': '.png', 'image/jpeg': '.jpg', 'image/webp': '.webp'};

interface InlineRow {
  id: string;
  username: string;
  avatar: string;
  signature_svg: string | null;
}

export async function migrateInlineMedia(db: Db): Promise<void> {
  const {rows} = await db.query<InlineRow>(
    `select id, username, avatar, signature_svg from public.staff_accounts
      where avatar like 'data:%' or (signature_svg is not null and signature_url = '')`
  );
  if (!rows.length) return;
  if (!cloudinaryEnabled() && !localStoreAllowed()) {
    console.warn(`[media] ${rows.length} account(s) still hold inline pictures; they move to Cloudinary once CLOUDINARY_* is set.`);
    return;
  }
  for (const row of rows) {
    try {
      if (row.avatar.startsWith('data:')) {
        const match = row.avatar.match(/^data:(image\/(?:png|jpeg|webp));base64,([A-Za-z0-9+/=]+)$/);
        if (match) {
          const stored = await storeMedia('image', 'avatar', `${row.username}${EXTENSION[match[1]]}`, Buffer.from(match[2], 'base64'), match[1]);
          await db.query('update public.staff_accounts set avatar = $2, avatar_public_id = $3 where id = $1', [row.id, stored.url, stored.publicId]);
        } else {
          await db.query(`update public.staff_accounts set avatar = '' where id = $1`, [row.id]);
        }
      }
      if (row.signature_svg) {
        const stored = await storeSignature(row.username, row.signature_svg);
        await db.query('update public.staff_accounts set signature_url = $2, signature_public_id = $3, signature_svg = null where id = $1', [row.id, stored.url, stored.publicId]);
      }
      console.log(`[media] moved the inline pictures of "${row.username}" to the media store`);
    } catch (error) {
      console.warn(`[media] could not move the inline pictures of "${row.username}":`, (error as Error).message);
    }
  }
}
