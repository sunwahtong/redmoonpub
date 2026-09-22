/**
 * What kind of backend is answering.
 *
 * The same server code runs as one long-lived process (VPS, Render) and as
 * serverless functions (Vercel). A long-lived process can hold a Server-Sent
 * Events stream open; a function cannot — it would be billed for the whole
 * stream and killed anyway, and a broadcast from one invocation never reaches a
 * listener held by another.
 *
 * So the backend states its own capabilities on /api/health and the frontend
 * follows. This is asked once per page load and shared by every consumer.
 */
export interface RuntimeInfo {
  runtime: 'server' | 'function';
  realtime: 'sse' | 'poll';
  storage: 'disk' | 'bucket';
  database: 'postgres' | 'file';
}

const FALLBACK: RuntimeInfo = {runtime: 'server', realtime: 'sse', storage: 'disk', database: 'file'};

let cached: Promise<RuntimeInfo> | null = null;

export function getRuntimeInfo(): Promise<RuntimeInfo> {
  if (cached) return cached;

  cached = fetch('/api/health', {cache: 'no-store'})
    .then((response) => (response.ok ? response.json() : null))
    .then(
      (data): RuntimeInfo => ({
        runtime: data?.runtime === 'function' ? 'function' : 'server',
        realtime: data?.realtime === 'poll' ? 'poll' : 'sse',
        storage: data?.storage === 'bucket' ? 'bucket' : 'disk',
        database: data?.database === 'postgres' ? 'postgres' : 'file'
      })
    )
    // An unreachable health endpoint must not disable the live club page.
    // Assume streaming: if the stream then fails, EventSource reports it.
    .catch(() => FALLBACK);

  return cached;
}
