/**
 * Vercel serverless entry point for the whole API.
 *
 * Every `/api/...` request is rewritten here by vercel.json, so there is one
 * function rather than one per route: each separate function would be its
 * own cold start and its own database connection.
 */
import type {IncomingMessage, ServerResponse} from 'node:http';
import {handleApiRequest} from '../server/index.ts';

type VercelRequest = IncomingMessage & {body?: unknown; rmParsedBody?: unknown};

export default async function handler(req: VercelRequest, res: ServerResponse): Promise<void> {
  const raw = req.url && req.url.startsWith('/') ? req.url : `/api${req.url || ''}`;
  const url = new URL(raw, `https://${req.headers.host || 'localhost'}`);

  if (!url.pathname.startsWith('/api/')) {
    res.statusCode = 404;
    res.setHeader('Content-Type', 'application/json; charset=utf-8');
    res.end(JSON.stringify({error: 'API útvonal nem található'}));
    return;
  }

  // Vercel pre-parses JSON bodies into `req.body`, which drains the stream.
  // Hand the parsed body over so the server never waits on an empty stream.
  if (req.body !== undefined && req.method !== 'GET' && req.method !== 'HEAD') {
    req.rmParsedBody = req.body;
  }

  await handleApiRequest(req, res, url.pathname, url.searchParams);
}
