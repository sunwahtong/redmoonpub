/**
 * Answers for the reads every open page polls.
 *
 * One long-lived process serves every browser, so without this each poll
 * from each tab was its own round of database reads — and the database's
 * egress is the free tier's scarcest resource. An answer is kept for a few
 * seconds and dropped on every broadcast, i.e. after every write another
 * browser might see: the pages that refetch on the push hit the database
 * once and the rest read that answer.
 *
 * A serverless instance skips this: it could not hear another instance's
 * broadcasts, so its memory would go stale.
 */
import {config} from './config.ts';

interface Entry {
  expires: number;
  value: Promise<unknown>;
}

const entries = new Map<string, Entry>();

/** The value under `key`, computed at most once per `ttlMs` or until the next broadcast. Concurrent callers share one computation. */
export function cached<T>(key: string, ttlMs: number, compute: () => Promise<T>): Promise<T> {
  if (config.serverless) return compute();
  const now = Date.now();
  const hit = entries.get(key);
  if (hit && hit.expires > now) return hit.value as Promise<T>;
  const value = compute();
  const entry: Entry = {expires: now + ttlMs, value};
  entries.set(key, entry);
  value.catch(() => {
    if (entries.get(key) === entry) entries.delete(key);
  });
  return value;
}

/** Forgets every answer. `broadcast` calls it, so a push is never answered from before the write. */
export function invalidate(): void {
  entries.clear();
}
