/**
 * Push notifications to open browsers, over Supabase Realtime broadcast.
 *
 * A serverless backend cannot hold a stream open, so instead every mutation
 * that somebody else might be looking at posts one small message to a public
 * channel through Realtime's REST endpoint. Browsers subscribe to the same
 * channels (see src/lib/realtime.ts) and refetch what changed. Payloads carry
 * ids and kinds, never content: whatever a client sees, it still fetches
 * through the API with its own permissions.
 *
 * Without SUPABASE_URL and a key (local development) this is a no-op and the
 * frontend falls back to its polling intervals. The publishable key is enough;
 * the secret key is used when configured.
 */
import {config} from './config.ts';
import {invalidate} from './cache.ts';

export type Topic = 'house' | 'club' | 'reservations' | 'events' | 'content' | 'staff';

const TIMEOUT_MS = 2500;

export const realtimeEnabled = (): boolean => !!(config.supabaseUrl && (config.supabaseSecretKey || config.supabasePublishableKey));

/**
 * Sends one broadcast and waits for it (briefly), so a function invocation
 * does not end before the message left. Failures are logged, never thrown:
 * a missed push only means the next poll catches up.
 */
export async function broadcast(topic: Topic, event: string, payload: Record<string, unknown> = {}): Promise<void> {
  // Every browser refetches on the push; none of them may get the answer from before the write.
  invalidate();
  if (!realtimeEnabled()) return;
  const key = config.supabaseSecretKey || config.supabasePublishableKey;
  try {
    const response = await fetch(`${config.supabaseUrl}/realtime/v1/api/broadcast`, {
      method: 'POST',
      // The new key formats go in `apikey` alone; a legacy JWT is also accepted there.
      headers: {apikey: key, 'Content-Type': 'application/json'},
      body: JSON.stringify({messages: [{topic: `rm:${topic}`, event, payload: {...payload, at: Date.now()}}]}),
      signal: AbortSignal.timeout(TIMEOUT_MS)
    });
    if (!response.ok) console.warn(`[realtime] broadcast ${topic}/${event} → ${response.status}`);
  } catch (error) {
    console.warn(`[realtime] broadcast ${topic}/${event} failed:`, (error as Error).message);
  }
}
