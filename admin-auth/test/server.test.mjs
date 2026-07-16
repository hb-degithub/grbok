import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { get as httpGet } from 'node:http';
import { createServer, startServer } from '../src/server.mjs';
import { createMailHttpHandler } from '../src/mail/http.mjs';

async function listenOnFetchSafePort(server) {
  let port;
  do {
    await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
    port = server.address().port;
    if (port <= 10080) await new Promise((resolve) => server.close(resolve));
  } while (port <= 10080);
  return `http://127.0.0.1:${port}`;
}

function getJsonDirect(url) {
  return new Promise((resolve, reject) => {
    const request = httpGet(url, (response) => {
      const chunks = [];
      response.on('data', (chunk) => chunks.push(chunk));
      response.on('end', () => {
        try {
          resolve({
            status: response.statusCode,
            body: JSON.parse(Buffer.concat(chunks).toString('utf8')),
          });
        } catch (error) {
          reject(error);
        }
      });
    });
    request.on('error', reject);
  });
}

const config = {
  internalSecret: 'internal-secret-32-chars-long!!!',
  hashSecret: 'hash-secret-32-chars-long!!!!!!',
  mailInternalSecret: 'mail-secret-32-chars-long!!!!!!!!',
  rpName: 'Blog',
  rpId: 'hlydwz.com',
  origin: 'https://hlydwz.com',
  sessionTtlSeconds: 900,
};

describe('server', () => {
  let server;
  let baseUrl;
  let calls = [];

  before(async () => {
    const webauthnService = {
      registrationOptions: async ({ userId, userName, challenge }) => {
        calls.push({ method: 'registrationOptions', args: { userId, userName, challenge } });
        return { challenge, user: { id: userId, name: userName } };
      },
      verifyRegistration: async ({ response, expectedChallenge }) => {
        calls.push({ method: 'verifyRegistration', args: { response, expectedChallenge } });
        return { verified: true, registrationInfo: { credential: { id: 'cred-id', publicKey: new Uint8Array([1, 2, 3]) } } };
      },
      authenticationOptions: async ({ challenge, allowCredentials }) => {
        calls.push({ method: 'authenticationOptions', args: { challenge, allowCredentials } });
        return { challenge, allowCredentials };
      },
      verifyAuthentication: async ({ response, expectedChallenge, authenticator }) => {
        calls.push({ method: 'verifyAuthentication', args: { response, expectedChallenge, authenticator } });
        return { verified: true, authenticationInfo: {} };
      },
    };

    server = createServer({ config, webauthnService });
    baseUrl = await listenOnFetchSafePort(server);
  });

  after(async () => {
    await new Promise((resolve) => server.close(resolve));
  });

  it('GET /health returns ok', async () => {
    const res = await fetch(`${baseUrl}/health`);
    assert.equal(res.status, 200);
    const body = await res.json();
    assert.equal(body.status, 'ok');
  });

  it('rejects missing internal secret', async () => {
    const res = await fetch(`${baseUrl}/internal/webauthn/registration/options`, { method: 'POST' });
    assert.equal(res.status, 403);
  });

  it('rejects invalid internal secret', async () => {
    const res = await fetch(`${baseUrl}/internal/webauthn/registration/options`, {
      method: 'POST',
      headers: { 'X-Internal-Secret': 'wrong', 'Content-Type': 'application/json' },
      body: JSON.stringify({}),
    });
    assert.equal(res.status, 403);
  });

  it('rejects request bodies larger than 1 MiB', async () => {
    const res = await fetch(`${baseUrl}/internal/webauthn/registration/options`, {
      method: 'POST',
      headers: { 'X-Internal-Secret': config.internalSecret, 'Content-Type': 'application/json' },
      body: JSON.stringify({ payload: 'x'.repeat(1024 * 1024) }),
    });
    assert.equal(res.status, 413);
    assert.deepEqual(await res.json(), { error: 'Request body too large' });
  });

  it('POST /internal/webauthn/registration/options forwards to service', async () => {
    calls.length = 0;
    const res = await fetch(`${baseUrl}/internal/webauthn/registration/options`, {
      method: 'POST',
      headers: { 'X-Internal-Secret': config.internalSecret, 'Content-Type': 'application/json' },
      body: JSON.stringify({ userId: 'u1', userName: 'a@b.com', challenge: 'c1' }),
    });
    assert.equal(res.status, 200);
    const body = await res.json();
    assert.equal(body.challenge, 'c1');
    assert.equal(calls[0].method, 'registrationOptions');
  });

  it('POST /internal/webauthn/authentication/verify creates verified session record', async () => {
    calls.length = 0;
    const res = await fetch(`${baseUrl}/internal/webauthn/authentication/verify`, {
      method: 'POST',
      headers: { 'X-Internal-Secret': config.internalSecret, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        response: { id: 'cred' },
        expectedChallenge: 'c2',
        authenticator: { id: 'cred' },
        userId: 'u1',
        token: 'tok',
        fingerprint: 'fp',
        ip: '127.0.0.1',
        userAgent: 'UA',
      }),
    });
    assert.equal(res.status, 200);
    const body = await res.json();
    assert.equal(body.verified, true);
    assert.equal(body.session.user_id, 'u1');
    assert.equal(typeof body.session.token_hash, 'string');
    assert.equal(typeof body.session.fingerprint_hash, 'string');
    assert.equal(calls[0].method, 'verifyAuthentication');
  });
  it('POST /internal/session/verify validates binding hashes', async () => {
    calls.length = 0;
    const res = await fetch(`${baseUrl}/internal/session/verify`, {
      method: 'POST',
      headers: { 'X-Internal-Secret': config.internalSecret, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        record: {
          token_hash: 'wrong',
          fingerprint_hash: 'wrong',
          ip_hash: 'wrong',
          user_agent_hash: 'wrong',
          expires_at: new Date(Date.now() + 10000).toISOString(),
          revoked_at: null,
        },
        token: 'tok',
        fingerprint: 'fp',
        ip: '127.0.0.1',
        userAgent: 'UA',
      }),
    });
    assert.equal(res.status, 200);
    const body = await res.json();
    assert.equal(body.verified, false);
  });

  it('POST /internal/session/verify accepts valid bindings', async () => {
    calls.length = 0;
    const { createVerifiedSessionRecord } = await import('../src/session-policy.mjs');
    const inputs = { userId: 'u1', token: 'tok', fingerprint: 'fp', ip: '127.0.0.1', userAgent: 'UA' };
    const record = createVerifiedSessionRecord(inputs, { hashSecret: config.hashSecret, sessionTtlSeconds: 900 });
    const res = await fetch(`${baseUrl}/internal/session/verify`, {
      method: 'POST',
      headers: { 'X-Internal-Secret': config.internalSecret, 'Content-Type': 'application/json' },
      body: JSON.stringify({ record, ...inputs }),
    });
    assert.equal(res.status, 200);
    const body = await res.json();
    assert.equal(body.verified, true);
  });

  it('POST /internal/step-up/issue issues a server-TTL credential with hashes only', async () => {
    const res = await fetch(`${baseUrl}/internal/step-up/issue`, {
      method: 'POST',
      headers: { 'X-Internal-Secret': config.internalSecret, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        userId: 'u1',
        clientSession: 'client-session',
        fingerprint: 'fp',
        ip: '127.0.0.1',
        userAgent: 'UA',
        sessionTtlSeconds: 86400,
      }),
    });

    assert.equal(res.status, 200);
    const body = await res.json();
    assert.match(body.credential, /^v1\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/);
    assert.equal(body.record.user, 'u1');
    assert.equal('secret' in body.record, false);
    const ttlMs = Date.parse(body.record.expires_at) - Date.parse(body.record.verified_at);
    assert.equal(ttlMs, config.sessionTtlSeconds * 1000);
  });

  it('POST /internal/step-up/verify returns only the verification result', async () => {
    const issuedResponse = await fetch(`${baseUrl}/internal/step-up/issue`, {
      method: 'POST',
      headers: { 'X-Internal-Secret': config.internalSecret, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        userId: 'u1',
        clientSession: 'client-session',
        fingerprint: 'fp',
        ip: '127.0.0.1',
        userAgent: 'UA',
      }),
    });
    const issued = await issuedResponse.json();

    const res = await fetch(`${baseUrl}/internal/step-up/verify`, {
      method: 'POST',
      headers: { 'X-Internal-Secret': config.internalSecret, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        record: issued.record,
        userId: 'u1',
        credential: issued.credential,
        clientSession: 'client-session',
        fingerprint: 'fp',
        ip: '127.0.0.1',
        userAgent: 'UA',
      }),
    });

    assert.equal(res.status, 200);
    assert.deepEqual(await res.json(), { verified: true });
  });

  it('rejects invalid step-up issue input with a stable response', async () => {
    const res = await fetch(`${baseUrl}/internal/step-up/issue`, {
      method: 'POST',
      headers: { 'X-Internal-Secret': config.internalSecret, 'Content-Type': 'application/json' },
      body: JSON.stringify({ userId: 'u1' }),
    });

    assert.equal(res.status, 400);
    assert.deepEqual(await res.json(), { error: 'Invalid request' });
  });

});

it('delegates mail routes before legacy auth without affecting health or WebAuthn', async () => {
  const webauthnService = { registrationOptions: async ({ challenge }) => ({ challenge }) };
  const mailHttpHandler = {
    async handle(req, res, url) {
      assert.equal(url.pathname, '/internal/mail/status');
      res.writeHead(418, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' });
      res.end('{"mail":true}');
      return true;
    },
  };
  const isolated = createServer({ config, webauthnService, mailHttpHandler });
  const url = await listenOnFetchSafePort(isolated);
  try {
    assert.equal((await fetch(`${url}/health`)).status, 200);
    for (let index = 0; index < 31; index += 1) {
      assert.equal((await fetch(`${url}/internal/mail/status`)).status, 418);
    }
    const response = await fetch(`${url}/internal/webauthn/registration/options`, {
      method: 'POST', headers: { 'X-Internal-Secret': config.internalSecret, 'Content-Type': 'application/json' },
      body: JSON.stringify({ challenge: 'still-works' }),
    });
    assert.equal(response.status, 200);
    assert.deepEqual(await response.json(), { challenge: 'still-works' });
  } finally { await new Promise((resolve) => isolated.close(resolve)); }

  const throwingMailHandler = createMailHttpHandler({
    verifier: () => ({ ok: true }),
    service: {
      status() { throw new Error('mail status unavailable'); },
    },
    config: {},
  });
  const isolatedFromMail = createServer({ config, webauthnService, mailHttpHandler: throwingMailHandler });
  const isolatedUrl = await listenOnFetchSafePort(isolatedFromMail);
  try {
    assert.equal((await fetch(`${isolatedUrl}/internal/mail/status`)).status, 500);
    assert.equal((await fetch(`${isolatedUrl}/health`)).status, 200);
    const response = await fetch(`${isolatedUrl}/internal/webauthn/registration/options`, {
      method: 'POST', headers: { 'X-Internal-Secret': config.internalSecret, 'Content-Type': 'application/json' },
      body: JSON.stringify({ challenge: 'mail-isolated' }),
    });
    assert.equal(response.status, 200);
    assert.deepEqual(await response.json(), { challenge: 'mail-isolated' });
  } finally { await new Promise((resolve) => isolatedFromMail.close(resolve)); }
});

it('contains hostile top-level handler errors in a stable 500 response', async () => {
  const hostile = new Proxy({}, {
    get() { throw new Error('top-level secret'); },
  });
  const isolated = createServer({
    config,
    webauthnService: {},
    mailHttpHandler: { async handle() { throw hostile; } },
    logger: { error() {} },
  });
  const requestHandler = isolated.listeners('request')[0];
  let status;
  let data = '';
  const req = {
    method: 'GET',
    url: '/internal/mail/status',
    headers: { host: 'localhost' },
    socket: { remoteAddress: '127.0.0.1' },
  };
  const res = {
    headersSent: false,
    writableEnded: false,
    writeHead(value) { status = value; this.headersSent = true; },
    end(value) { data += value; this.writableEnded = true; },
  };

  await requestHandler(req, res);
  assert.equal(status, 500);
  assert.deepEqual(JSON.parse(data), { error: 'Internal server error' });
});

it('starts without SMTP configuration and keeps health available', async () => {
  const smtpKeys = [
    'SMTP_HOST', 'SMTP_PORT', 'SMTP_USERNAME', 'SMTP_PASSWORD', 'SMTP_FROM_ADDRESS', 'SMTP_FROM_NAME',
    'SMTP_TLS_MODE', 'SMTP_CONNECTION_TIMEOUT_MS', 'SMTP_SOCKET_TIMEOUT_MS',
    'ALIYUN_SMTP_HOST', 'ALIYUN_SMTP_PORT', 'ALIYUN_SMTP_USER', 'ALIYUN_SMTP_PASSWORD',
    'ALIYUN_FROM_EMAIL', 'ALIYUN_FROM_NAME', 'MAIL_LOCAL_TEST_MODE', 'MAIL_PROVIDER_LABEL',
    'MAIL_ALERT_RECIPIENTS', 'MAIL_TEST_RECIPIENT_ALLOWLIST', 'PUBLIC_SITE_URL',
  ];
  const previous = Object.fromEntries(smtpKeys.map((key) => [key, process.env[key]]));
  for (const key of smtpKeys) delete process.env[key];

  const isolated = startServer({ config, adapter: {}, host: '127.0.0.1', port: 0 });
  try {
    if (!isolated.listening) await new Promise((resolve) => isolated.once('listening', resolve));
    const response = await getJsonDirect(`http://127.0.0.1:${isolated.address().port}/health`);
    assert.equal(response.status, 200);
    assert.deepEqual(response.body, { status: 'ok' });
  } finally {
    await new Promise((resolve) => isolated.close(resolve));
    for (const [key, value] of Object.entries(previous)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  }
});
