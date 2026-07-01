import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from '../src/server.mjs';

const config = {
  internalSecret: 'internal-secret-32-chars-long!!!',
  hashSecret: 'hash-secret-32-chars-long!!!!!!',
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
    await new Promise((resolve) => {
      server.listen(0, '127.0.0.1', () => {
        const { port } = server.address();
        baseUrl = `http://127.0.0.1:${port}`;
        resolve();
      });
    });
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
});
