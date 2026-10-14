import assert from 'node:assert/strict';
import { createHmac } from 'node:crypto';
import { createServer } from 'node:http';
import { after, before, test } from 'node:test';
import { createHandler } from './server.mjs';

const env = {
  GITHUB_CLIENT_ID: 'test-client-id',
  GITHUB_CLIENT_SECRET: 'test-client-secret',
  OAUTH_PUBLIC_URL: 'https://oauth.example.com',
  ALLOWED_SITE_ORIGINS: 'https://films.example.com',
  STATE_SECRET: '0123456789abcdef0123456789abcdef',
};

let server;
let baseUrl;

before(async () => {
  server = createServer(async (request, response) => {
    const result = await createHandler({
      env,
      fetchImpl: async (_url, options) => {
        assert.equal(options.method, 'POST');
        return Response.json({ access_token: 'gho-test-token' });
      },
    })(request);
    response.writeHead(result.status, Object.fromEntries(result.headers));
    response.end(await result.arrayBuffer());
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  baseUrl = `http://127.0.0.1:${server.address().port}`;
});

after(async () => {
  await new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
});

test('health endpoint reports ready without exposing configuration', async () => {
  const response = await fetch(`${baseUrl}/healthz`);
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { status: 'ok' });
});

test('auth rejects an origin not on the explicit allowlist', async () => {
  const response = await fetch(`${baseUrl}/auth?provider=github&site_id=attacker.example`, {
    redirect: 'manual',
  });
  assert.equal(response.status, 403);
});

test('auth redirects to GitHub with signed state and expected callback', async () => {
  const response = await fetch(
    `${baseUrl}/auth?provider=github&site_id=films.example.com&scope=repo%20user`,
    { redirect: 'manual' },
  );
  assert.equal(response.status, 302);
  const authorization = new URL(response.headers.get('location'));
  assert.equal(authorization.origin, 'https://github.com');
  assert.equal(authorization.searchParams.get('client_id'), env.GITHUB_CLIENT_ID);
  assert.equal(authorization.searchParams.get('redirect_uri'), `${env.OAUTH_PUBLIC_URL}/callback`);
  assert.equal(authorization.searchParams.get('scope'), 'repo user');

  const [payload, signature] = authorization.searchParams.get('state').split('.');
  const expectedSignature = createHmac('sha256', env.STATE_SECRET).update(payload).digest('base64url');
  assert.equal(signature, expectedSignature);
  assert.equal(JSON.parse(Buffer.from(payload, 'base64url')).origin, 'https://films.example.com');
});

test('callback rejects a modified state before exchanging a code', async () => {
  const response = await fetch(`${baseUrl}/callback?provider=github&code=code&state=forged.state`);
  assert.equal(response.status, 400);
  assert.match(await response.text(), /Invalid or expired OAuth state/);
});

test('callback sends the token only to the signed, allowlisted origin', async () => {
  const handler = createHandler({ env });
  const auth = await handler(new Request('https://oauth.example.com/auth?provider=github&site_id=films.example.com'));
  const authorization = new URL(auth.headers.get('location'));
  const response = await fetch(
    `${baseUrl}/callback?provider=github&code=auth-code&state=${encodeURIComponent(authorization.searchParams.get('state'))}`,
  );
  assert.equal(response.status, 200);
  const html = await response.text();
  assert.match(html, /expectedOrigin = "https:\/\/films\.example\.com"/);
  assert.match(html, /authorization:github:success/);
  assert.doesNotMatch(html, /postMessage\([^;]+, ['"]\*['"]\)/);
  assert.match(response.headers.get('content-security-policy'), /script-src 'nonce-/);
});

test('OAuth service refuses weak or missing production secrets', () => {
  assert.throws(
    () => createHandler({ env: { ...env, STATE_SECRET: 'weak' } }),
    /STATE_SECRET must contain at least 32 bytes/,
  );
});
