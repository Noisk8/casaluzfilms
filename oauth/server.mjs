import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto';
import { createServer } from 'node:http';
import { pathToFileURL } from 'node:url';

const STATE_MAX_AGE_MS = 10 * 60 * 1000;
const ALLOWED_SCOPES = new Set(['repo', 'public_repo', 'user', 'read:user']);

function requiredEnv(env, name) {
  const value = env[name]?.trim();
  if (!value) throw new Error(`Missing required environment variable: ${name}`);
  return value;
}

function parseConfig(env) {
  const publicUrl = new URL(requiredEnv(env, 'OAUTH_PUBLIC_URL'));
  if (publicUrl.protocol !== 'https:' || publicUrl.pathname !== '/' || publicUrl.search || publicUrl.hash) {
    throw new Error('OAUTH_PUBLIC_URL must be an HTTPS origin without a path');
  }

  const allowedOrigins = requiredEnv(env, 'ALLOWED_SITE_ORIGINS')
    .split(',')
    .map((origin) => {
      const url = new URL(origin.trim());
      if (url.protocol !== 'https:' || url.origin !== origin.trim()) {
        throw new Error('ALLOWED_SITE_ORIGINS must contain exact HTTPS origins');
      }
      return url.origin;
    });
  if (allowedOrigins.length === 0) throw new Error('ALLOWED_SITE_ORIGINS cannot be empty');

  const stateSecret = requiredEnv(env, 'STATE_SECRET');
  if (Buffer.byteLength(stateSecret) < 32) {
    throw new Error('STATE_SECRET must contain at least 32 bytes');
  }

  return {
    clientId: requiredEnv(env, 'GITHUB_CLIENT_ID'),
    clientSecret: requiredEnv(env, 'GITHUB_CLIENT_SECRET'),
    publicUrl: publicUrl.origin,
    allowedOrigins,
    stateSecret,
  };
}

function signState(payload, secret) {
  const encoded = Buffer.from(JSON.stringify(payload)).toString('base64url');
  const signature = createHmac('sha256', secret).update(encoded).digest('base64url');
  return `${encoded}.${signature}`;
}

function verifyState(state, secret, allowedOrigins, now = Date.now()) {
  if (typeof state !== 'string' || state.length > 2048) return null;
  const [encoded, signature, extra] = state.split('.');
  if (!encoded || !signature || extra) return null;

  const expected = createHmac('sha256', secret).update(encoded).digest();
  let received;
  try {
    received = Buffer.from(signature, 'base64url');
  } catch {
    return null;
  }
  if (received.length !== expected.length || !timingSafeEqual(received, expected)) return null;

  try {
    const payload = JSON.parse(Buffer.from(encoded, 'base64url').toString());
    if (
      typeof payload.origin !== 'string'
      || !allowedOrigins.includes(payload.origin)
      || !Number.isSafeInteger(payload.createdAt)
      || now - payload.createdAt > STATE_MAX_AGE_MS
      || payload.createdAt > now + 30_000
    ) return null;
    return payload;
  } catch {
    return null;
  }
}

function safeEqual(left, right) {
  const leftBuffer = Buffer.from(left);
  const rightBuffer = Buffer.from(right);
  return leftBuffer.length === rightBuffer.length && timingSafeEqual(leftBuffer, rightBuffer);
}

function parseCookies(cookieHeader) {
  return Object.fromEntries(
    (cookieHeader ?? '').split(';').map((part) => {
      const separator = part.indexOf('=');
      if (separator < 0) return ['', ''];
      return [part.slice(0, separator).trim(), part.slice(separator + 1).trim()];
    }).filter(([name]) => name),
  );
}

function jsonResponse(status, payload) {
  return new Response(JSON.stringify(payload), {
    status,
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      'Cache-Control': 'no-store',
      'X-Content-Type-Options': 'nosniff',
    },
  });
}

function popupResponse(status, origin, message) {
  const serializedMessage = JSON.stringify(message).replaceAll('<', '\\u003c');
  const nonce = randomBytes(18).toString('base64url');
  const html = `<!doctype html>
<html lang="en">
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width">
<title>Decap CMS authorization</title></head>
<body><p>${status === 'success' ? 'Authorization complete. You may close this window.' : 'Authorization failed. You may close this window.'}</p>
<script nonce="${nonce}">
(() => {
  const expectedOrigin = ${JSON.stringify(origin)};
  const responseMessage = ${serializedMessage};
  const opener = window.opener;
  if (!opener) return;
  const onHandshake = (event) => {
    if (event.origin !== expectedOrigin || event.data !== 'authorizing:github') return;
    window.removeEventListener('message', onHandshake);
    opener.postMessage(responseMessage, expectedOrigin);
  };
  window.addEventListener('message', onHandshake);
  opener.postMessage('authorizing:github', expectedOrigin);
})();
</script></body></html>`;

  return new Response(html, {
    status: 200,
    headers: {
      'Content-Type': 'text/html; charset=utf-8',
      'Cache-Control': 'no-store',
      'Content-Security-Policy': `default-src 'none'; script-src 'nonce-${nonce}'; base-uri 'none'; frame-ancestors 'none'`,
      'Referrer-Policy': 'no-referrer',
      'X-Content-Type-Options': 'nosniff',
    },
  });
}

function getSiteOrigin(siteId, allowedOrigins) {
  if (!siteId || siteId.length > 253) return null;
  return allowedOrigins.find((origin) => new URL(origin).host.toLowerCase() === siteId.toLowerCase()) ?? null;
}

function parseScopes(requested) {
  if (!requested) return ['repo', 'user'];
  const scopes = requested.split(/[ ,]+/).filter(Boolean);
  if (scopes.length === 0 || scopes.some((scope) => !ALLOWED_SCOPES.has(scope))) return null;
  return [...new Set(scopes)];
}

export function createHandler({ env, fetchImpl = fetch, now = Date.now }) {
  const config = parseConfig(env);

  return async function handle(request) {
    const url = new URL(request.url);
    if (url.pathname === '/healthz' && request.method === 'GET') {
      return jsonResponse(200, { status: 'ok' });
    }
    if (url.pathname === '/auth') {
      if (request.method !== 'GET') return jsonResponse(405, { error: 'Method not allowed' });
      if (url.searchParams.get('provider') !== 'github') {
        return jsonResponse(400, { error: 'Unsupported OAuth provider' });
      }

      const siteOrigin = getSiteOrigin(url.searchParams.get('site_id'), config.allowedOrigins);
      if (!siteOrigin) return jsonResponse(403, { error: 'Unapproved site origin' });
      const scopes = parseScopes(url.searchParams.get('scope'));
      if (!scopes) return jsonResponse(400, { error: 'Unsupported OAuth scope' });

      const nonce = randomBytes(32).toString('base64url');
      const state = signState({
        origin: siteOrigin,
        createdAt: now(),
        nonce,
      }, config.stateSecret);
      const authorizeUrl = new URL('https://github.com/login/oauth/authorize');
      authorizeUrl.searchParams.set('client_id', config.clientId);
      authorizeUrl.searchParams.set('redirect_uri', `${config.publicUrl}/callback`);
      authorizeUrl.searchParams.set('scope', scopes.join(' '));
      authorizeUrl.searchParams.set('state', state);
      return new Response(null, {
        status: 302,
        headers: {
          Location: authorizeUrl.toString(),
          'Set-Cookie': `decap_oauth_state=${nonce}; Path=/callback; Max-Age=600; Secure; HttpOnly; SameSite=None`,
          'Cache-Control': 'no-store',
          'Referrer-Policy': 'no-referrer',
        },
      });
    }

    if (url.pathname === '/callback') {
      if (request.method !== 'GET') return jsonResponse(405, { error: 'Method not allowed' });
      const state = verifyState(
        url.searchParams.get('state'),
        config.stateSecret,
        config.allowedOrigins,
        now(),
      );
      const cookieNonce = parseCookies(request.headers.get('cookie')).decap_oauth_state;
      if (!state || !cookieNonce || !safeEqual(state.nonce, cookieNonce)) {
        return jsonResponse(400, { error: 'Invalid or expired OAuth state' });
      }
      const clearStateCookie = 'decap_oauth_state=; Path=/callback; Max-Age=0; Secure; HttpOnly; SameSite=None';

      const code = url.searchParams.get('code');
      if (!code || code.length > 4096 || url.searchParams.has('error')) {
        const response = popupResponse('error', state.origin, 'authorization:github:error:{"message":"GitHub authorization was not completed"}');
        response.headers.set('Set-Cookie', clearStateCookie);
        return response;
      }

      let tokenResponse;
      try {
        tokenResponse = await fetchImpl('https://github.com/login/oauth/access_token', {
          method: 'POST',
          headers: {
            Accept: 'application/json',
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            client_id: config.clientId,
            client_secret: config.clientSecret,
            code,
            redirect_uri: `${config.publicUrl}/callback`,
          }),
          signal: AbortSignal.timeout(10_000),
        });
      } catch {
        const response = popupResponse('error', state.origin, 'authorization:github:error:{"message":"Could not contact GitHub"}');
        response.headers.set('Set-Cookie', clearStateCookie);
        return response;
      }

      if (!tokenResponse.ok) {
        const response = popupResponse('error', state.origin, 'authorization:github:error:{"message":"GitHub rejected the authorization request"}');
        response.headers.set('Set-Cookie', clearStateCookie);
        return response;
      }
      let tokenData;
      try {
        tokenData = await tokenResponse.json();
      } catch {
        const response = popupResponse('error', state.origin, 'authorization:github:error:{"message":"GitHub returned an invalid response"}');
        response.headers.set('Set-Cookie', clearStateCookie);
        return response;
      }
      if (typeof tokenData.access_token !== 'string' || !tokenData.access_token) {
        const response = popupResponse('error', state.origin, 'authorization:github:error:{"message":"GitHub did not return an access token"}');
        response.headers.set('Set-Cookie', clearStateCookie);
        return response;
      }

      const response = popupResponse(
        'success',
        state.origin,
        `authorization:github:success:${JSON.stringify({ token: tokenData.access_token })}`,
      );
      response.headers.set('Set-Cookie', clearStateCookie);
      return response;
    }

    return jsonResponse(404, { error: 'Not found' });
  };
}

function start() {
  const env = process.env;
  const handler = createHandler({ env });
  const port = Number(env.PORT ?? 8080);
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    throw new Error('PORT must be a valid TCP port');
  }
  const server = createServer((request, response) => {
    const incoming = new Request(new URL(request.url, config.publicUrl), {
      method: request.method,
      headers: request.headers,
    });
    void handler(incoming).then(async (result) => {
      response.writeHead(result.status, Object.fromEntries(result.headers));
      response.end(await result.arrayBuffer());
    }).catch((error) => {
      console.error('OAuth request failed:', error.message);
      response.writeHead(500, { 'Content-Type': 'application/json; charset=utf-8' });
      response.end('{"error":"Internal server error"}');
    });
  });
  server.listen(port, '0.0.0.0', () => {
    console.log(`Decap OAuth proxy listening on port ${port}`);
  });
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  start();
}
