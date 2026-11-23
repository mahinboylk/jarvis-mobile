#!/usr/bin/env node
/**
 * Jarvis key proxy (GAP-G3).
 *
 * Keeps the Groq / Fish Audio credentials on the server so a release build
 * carries no secret. Zero dependencies: Node's `http` + the global `fetch`.
 *
 * Read `proxy/README.md` before deploying — in particular the allow-list and
 * the "client key wins" rules, which are the whole security story here.
 */

import { createServer } from 'node:http';

const PORT = Number(process.env.PORT ?? 8787);
const HOST = process.env.HOST ?? '0.0.0.0';
const ALLOWED_ORIGIN = process.env.ALLOWED_ORIGIN ?? '*';

const GROQ_KEY = (process.env.GROQ_API_KEY ?? '').trim();
const FISH_KEY = (process.env.FISH_AUDIO_API_KEY ?? '').trim();

/**
 * The complete list of proxied routes. Anything absent is a 404 — this is what
 * stops the proxy from being an open relay.
 *
 * `upstream` is absolute; `auth` names the server key to substitute when the
 * client sends none.
 */
const ROUTES = {
  'POST /groq/audio/transcriptions': {
    upstream: 'https://api.groq.com/openai/v1/audio/transcriptions',
    auth: 'groq',
    contentType: null, // multipart — forward the client's boundary verbatim
  },
  'POST /groq/chat/completions': {
    upstream: 'https://api.groq.com/openai/v1/chat/completions',
    auth: 'groq',
    contentType: 'application/json',
  },
  'POST /fish/tts': {
    upstream: 'https://api.fish.audio/v1/tts',
    auth: 'fish',
    contentType: 'application/json',
  },
  'GET /fish/wallet/self/api-credit': {
    upstream: 'https://api.fish.audio/wallet/self/api-credit',
    auth: 'fish',
    contentType: null,
  },
};

const KEY_FOR = { groq: GROQ_KEY, fish: FISH_KEY };

const corsHeaders = {
  'Access-Control-Allow-Origin': ALLOWED_ORIGIN,
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Authorization, Content-Type',
  'Access-Control-Max-Age': '86400',
};

const sendJson = (res, status, body) => {
  const payload = JSON.stringify(body);
  res.writeHead(status, {
    ...corsHeaders,
    'Content-Type': 'application/json',
    'Content-Length': Buffer.byteLength(payload),
  });
  res.end(payload);
};

const readBody = (req) =>
  new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    req.on('data', (chunk) => {
      size += chunk.length;
      // 24 MB: the app caps image payloads far below this, and Groq itself
      // rejects >20 MB, so anything larger is a client bug or an attack.
      if (size > 24 * 1024 * 1024) {
        reject(new Error('payload too large'));
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on('end', () => resolve(Buffer.concat(chunks)));
    req.on('error', reject);
  });

const server = createServer(async (req, res) => {
  const url = new URL(req.url ?? '/', `http://${req.headers.host ?? 'localhost'}`);

  if (req.method === 'OPTIONS') {
    res.writeHead(204, corsHeaders);
    res.end();
    return;
  }

  if (url.pathname === '/health' || url.pathname === '/' || url.pathname === '/index.html') {
    // Never echo the keys — only whether they are present.
    sendJson(res, 200, {
      ok: true,
      service: 'jarvis-proxy',
      routes: Object.keys(ROUTES),
      keys: { groq: GROQ_KEY.length > 0, fish: FISH_KEY.length > 0 },
    });
    return;
  }

  const route = ROUTES[`${req.method} ${url.pathname}`];
  if (!route) {
    sendJson(res, 404, {
      error: 'not_found',
      message: `${req.method} ${url.pathname} is not a proxied route.`,
    });
    return;
  }

  // A client-supplied key always wins, so an in-app pasted key keeps working.
  const clientAuth = req.headers.authorization ?? '';
  const serverKey = KEY_FOR[route.auth] ?? '';
  const authorization = clientAuth || (serverKey ? `Bearer ${serverKey}` : '');

  if (!authorization) {
    sendJson(res, 401, {
      error: 'no_credentials',
      message: `No ${route.auth} API key available — set it on the proxy or paste one in the app.`,
    });
    return;
  }

  let body;
  if (req.method !== 'GET' && req.method !== 'HEAD') {
    try {
      body = await readBody(req);
    } catch (error) {
      sendJson(res, 413, { error: 'payload_too_large', message: String(error?.message ?? error) });
      return;
    }
  }

  const upstreamUrl = `${route.upstream}${url.search ?? ''}`;
  const headers = { Authorization: authorization, Accept: '*/*' };
  // Multipart uploads must keep the client's boundary, so only override the
  // content type for routes that have a fixed one.
  if (route.contentType) headers['Content-Type'] = route.contentType;
  else if (req.headers['content-type']) headers['Content-Type'] = req.headers['content-type'];

  let upstream;
  try {
    upstream = await fetch(upstreamUrl, {
      method: req.method,
      headers,
      ...(body && body.length > 0 ? { body } : {}),
      redirect: 'follow',
    });
  } catch (error) {
    sendJson(res, 502, {
      error: 'upstream_unreachable',
      message: String(error?.message ?? error),
    });
    return;
  }

  // Pass status through, plus the headers the app actually reads (rate limits
  // for GAP-D4, content type for the audio bytes), then stream the body
  // straight out so SSE token streaming is never buffered.
  const passthrough = {
    ...corsHeaders,
    'Content-Type': upstream.headers.get('content-type') ?? 'application/octet-stream',
  };
  for (const name of [
    'retry-after',
    'x-ratelimit-remaining-requests',
    'x-ratelimit-limit-requests',
    'x-ratelimit-remaining-tokens',
    'x-ratelimit-limit-tokens',
    'x-ratelimit-reset-requests',
  ]) {
    const value = upstream.headers.get(name);
    if (value) passthrough[name] = value;
  }

  res.writeHead(upstream.status, passthrough);

  if (!upstream.body) {
    res.end();
    return;
  }

  try {
    for await (const chunk of upstream.body) res.write(chunk);
    res.end();
  } catch (error) {
    console.warn('jarvis-proxy: stream aborted', error);
    res.end();
  }
});

server.listen(PORT, HOST, () => {
  console.log(`jarvis proxy listening on http://${HOST}:${PORT}`);
  console.log(`  groq key: ${GROQ_KEY ? 'configured' : 'MISSING'}`);
  console.log(`  fish key: ${FISH_KEY ? 'configured' : 'not set (client key required)'}`);
  console.log(`  routes:   ${Object.keys(ROUTES).join(', ')}`);
});