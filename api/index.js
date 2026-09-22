/**
 * Vercel serverless entry point for the whole API.
 *
 * Every `/api/...` request is rewritten here by vercel.json, so there is one
 * function rather than one per route. That matters: each separate function is
 * its own cold start and its own database connection, and this API shares one
 * state blob, so splitting it would multiply both for no gain.
 *
 * The request handling itself lives in server.cjs and is identical to the VPS
 * and Render deployments. Only the state lifecycle differs, and server.cjs
 * handles that itself when it detects the serverless runtime.
 */
import app from '../server.cjs';

export default async function handler(req, res) {
  // `req.url` keeps the original path through a rewrite, so `/api/club/state`
  // arrives intact. The fallback covers a direct invocation of the function.
  const raw = req.url && req.url.startsWith('/') ? req.url : `/api${req.url || ''}`;
  const url = new URL(raw, `https://${req.headers.host || 'localhost'}`);

  if (!url.pathname.startsWith('/api/')) {
    res.statusCode = 404;
    res.setHeader('Content-Type', 'application/json; charset=utf-8');
    res.end(JSON.stringify({error: 'API útvonal nem található'}));
    return;
  }

  // server.cjs reads the request body off the stream itself. Vercel pre-parses
  // JSON and form bodies into `req.body`, which drains that stream — a later
  // `readBody()` would then wait for data that never arrives and the function
  // would time out. Hand the already-parsed body over instead.
  // Multipart uploads are not pre-parsed, so the DJ upload stream is untouched.
  if (req.body !== undefined && req.method !== 'GET' && req.method !== 'HEAD') {
    req.rmParsedBody = req.body;
  }

  await app.handleApiRequest(req, res, url.pathname, url.searchParams);
}
