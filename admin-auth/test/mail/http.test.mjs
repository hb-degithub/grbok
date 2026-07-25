import { after, before, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { createMailHttpHandler } from '../../src/mail/http.mjs';
import { MailError } from '../../src/mail/errors.mjs';
import { createMailRequestVerifier, signMailRequest } from '../../src/mail/request-auth.mjs';
import { MAIL_LIMITS } from '../../src/mail/constants.mjs';

const secret = 'mail-internal-secret-32-characters-long';
const now = 1783872000;
const success = { ok: true, requestId: 'RequestIdentifier00001', messageId: 'MessageIdentifier00001', acceptedAt: '2026-07-13T00:00:00.000Z' };
const payload = {
  requestId: 'RequestIdentifier00001', messageId: 'MessageIdentifier00001', category: 'admin_test',
  to: 'reader@example.net', subject: 'Test', html: '<p>Test</p>', text: 'Test',
};
let sequence = 0;

function service(overrides = {}) {
  return {
    send: async () => success,
    verify: async () => ({ ok: true, verifiedAt: '2026-07-13T00:00:00.000Z' }),
    status: () => ({ configured: true, providerLabel: 'SMTP', port: 587, tlsMode: 'starttls', fromDomain: 'example.net', lastVerify: 'never', checkedAt: '2026-07-13T00:00:00.000Z' }),
    ...overrides,
  };
}

async function listen(mailService = service(), config = {}) {
  const verifier = createMailRequestVerifier({ secret, nowSeconds: () => now });
  const handler = createMailHttpHandler({ verifier, service: mailService, config });
  const server = createServer(async (req, res) => {
    const url = new URL(req.url, `http://${req.headers.host}`);
    if (!(await handler.handle(req, res, url))) res.writeHead(404).end();
  });
  let port;
  do {
    await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
    port = server.address().port;
    if (port <= 10080) await new Promise((resolve) => server.close(resolve));
  } while (port <= 10080);
  return { baseUrl: `http://127.0.0.1:${port}`, close: () => new Promise((resolve) => server.close(resolve)) };
}

function signed(path, { method = 'POST', rawBody = Buffer.alloc(0), nonce } = {}) {
  const timestamp = String(now);
  const actualNonce = nonce || `nonce_http_test_${String(++sequence).padStart(6, '0')}`;
  return {
    method,
    headers: {
      'Content-Type': 'application/json',
      'X-Mail-Timestamp': timestamp,
      'X-Mail-Nonce': actualNonce,
      'X-Mail-Signature': signMailRequest({ method, path, timestamp, nonce: actualNonce, rawBody }, secret),
    },
    ...(method === 'GET' || method === 'HEAD' ? {} : { body: rawBody }),
  };
}

async function body(response) {
  assert.equal(response.headers.get('cache-control'), 'no-store');
  assert.equal(response.headers.get('x-content-type-options'), 'nosniff');
  return response.json();
}

const authFailure = { ok: false, error: { code: 'INTERNAL_ERROR', retryable: false } };
const payloadFailure = { ok: false, error: { code: 'PAYLOAD_INVALID', retryable: false } };

describe('createMailHttpHandler', () => {
  let app;
  before(async () => { app = await listen(); });
  after(async () => { await app.close(); });

  it('returns false only outside /internal/mail/*', async () => {
    const handler = createMailHttpHandler({
      verifier: createMailRequestVerifier({ secret, nowSeconds: () => now }), service: service(), config: {},
    });
    assert.equal(await handler.handle({}, {}, new URL('http://localhost/internal/webauthn/test')), false);
  });

  it('contains hostile request-stream failures inside a stable 500 response', async () => {
    const hostile = new Proxy({}, {
      get() { throw new Error('stream secret'); },
    });
    const handler = createMailHttpHandler({ verifier: () => ({ ok: true }), service: service(), config: {} });
    let status;
    let data = '';
    const req = {
      method: 'POST', headers: {},
      async *[Symbol.asyncIterator]() { throw hostile; },
    };
    const res = { writeHead(value) { status = value; }, end(value) { data += value; } };

    assert.equal(await handler.handle(req, res, new URL('http://localhost/internal/mail/send')), true);
    assert.equal(status, 500);
    assert.deepEqual(JSON.parse(data), authFailure);
  });

  it('maps a hostile verifier result to the same generic 401 response', async () => {
    const hostileResult = new Proxy({}, {
      get() { throw new Error('authentication reason secret'); },
    });
    const handler = createMailHttpHandler({ verifier: () => hostileResult, service: service(), config: {} });
    let status;
    let data = '';
    const req = { method: 'POST', headers: {}, async *[Symbol.asyncIterator]() {} };
    const res = { writeHead(value) { status = value; }, end(value) { data += value; } };

    assert.equal(await handler.handle(req, res, new URL('http://localhost/internal/mail/send')), true);
    assert.equal(status, 401);
    assert.deepEqual(JSON.parse(data), authFailure);
  });

  it('maps verifier exceptions to the same generic 401 response', async () => {
    const handler = createMailHttpHandler({
      verifier: () => { throw new Error('clock secret'); }, service: service(), config: {},
    });
    let status;
    let data = '';
    const req = {
      method: 'POST', headers: {},
      async *[Symbol.asyncIterator]() { yield Buffer.from('{'); },
    };
    const res = {
      writeHead(value) { status = value; },
      end(value) { data += value; },
    };

    assert.equal(await handler.handle(req, res, new URL('http://localhost/internal/mail/send')), true);
    assert.equal(status, 401);
    assert.deepEqual(JSON.parse(data), authFailure);
  });

  it('authenticates before JSON parsing and ignores X-Internal-Secret', async () => {
    for (const headers of [{ 'Content-Type': 'application/json' }, { 'X-Internal-Secret': 'internal-secret-32-chars-long!!!' }]) {
      const response = await fetch(`${app.baseUrl}/internal/mail/send`, { method: 'POST', headers, body: '{' });
      assert.equal(response.status, 401);
      assert.deepEqual(await body(response), authFailure);
    }
  });

  it('returns 400 PAYLOAD_INVALID for malformed signed JSON', async () => {
    const rawBody = Buffer.from('{');
    const response = await fetch(`${app.baseUrl}/internal/mail/send`, signed('/internal/mail/send', { rawBody }));
    assert.equal(response.status, 400);
    assert.deepEqual(await body(response), payloadFailure);
  });

  it('validates payloads before reporting an unconfigured mail service', async () => {
    let sendCalls = 0;
    const isolated = await listen(service({
      send: async () => {
        sendCalls += 1;
        throw new MailError('MAIL_NOT_CONFIGURED', false);
      },
    }), { configured: false });
    try {
      const rawBody = Buffer.from('{"unexpected":true}');
      const response = await fetch(`${isolated.baseUrl}/internal/mail/send`, signed('/internal/mail/send', { rawBody }));
      assert.equal(response.status, 400);
      assert.deepEqual(await body(response), payloadFailure);
      assert.equal(sendCalls, 0);
    } finally { await isolated.close(); }
  });

  it('passes only the normalized seven-field payload to the service', async () => {
    let received;
    const isolated = await listen(service({
      send: async (value) => {
        received = value;
        return success;
      },
    }));
    try {
      const rawBody = Buffer.from(JSON.stringify({ ...payload, to: 'Reader@Example.NET' }));
      const response = await fetch(`${isolated.baseUrl}/internal/mail/send`, signed('/internal/mail/send', { rawBody }));
      assert.equal(response.status, 200);
      await body(response);
      assert.deepEqual(received, { ...payload, to: 'reader@example.net' });
      assert.deepEqual(Object.keys(received).sort(), [
        'category', 'html', 'messageId', 'requestId', 'subject', 'text', 'to',
      ]);
    } finally { await isolated.close(); }
  });

  it('sends valid JSON signed over its exact raw bytes', async () => {
    const rawBody = Buffer.from(JSON.stringify(payload, null, 2));
    const response = await fetch(`${app.baseUrl}/internal/mail/send`, signed('/internal/mail/send', { rawBody }));
    assert.equal(response.status, 200);
    assert.deepEqual(await body(response), success);
  });

  it('rejects replay without exposing the reason', async () => {
    const rawBody = Buffer.from(JSON.stringify(payload));
    const request = signed('/internal/mail/send', { rawBody, nonce: 'nonce_replay_http_000001' });
    const first = await fetch(`${app.baseUrl}/internal/mail/send`, request);
    assert.equal(first.status, 200);
    await body(first);
    const replay = await fetch(`${app.baseUrl}/internal/mail/send`, request);
    assert.equal(replay.status, 401);
    assert.deepEqual(await body(replay), authFailure);
  });

  it('signs an empty GET status body and returns only redacted fields', async () => {
    const response = await fetch(`${app.baseUrl}/internal/mail/status`, signed('/internal/mail/status', { method: 'GET' }));
    assert.equal(response.status, 200);
    const result = await body(response);
    assert.deepEqual(Object.keys(result).sort(), ['checkedAt', 'configured', 'fromDomain', 'lastVerify', 'port', 'providerLabel', 'tlsMode'].sort());
  });

  it('verify accepts an empty body or a signed smtp override only', async () => {
    let calls = 0;
    let seenOverride = null;
    const isolated = await listen(service({ verify: async (override) => { calls++; seenOverride = override; return { ok: true, verifiedAt: '2026-07-13T00:00:00.000Z' }; } }));
    try {
      const empty = await fetch(`${isolated.baseUrl}/internal/mail/verify`, signed('/internal/mail/verify'));
      assert.equal(empty.status, 200);
      await body(empty);
      assert.equal(seenOverride, null);

      // 非空 body 但缺少 smtp 键 → 400
      const fields = await fetch(`${isolated.baseUrl}/internal/mail/verify`, signed('/internal/mail/verify', { rawBody: Buffer.from('{}') }));
      assert.equal(fields.status, 400);
      assert.deepEqual(await body(fields), payloadFailure);

      // 非法 smtp override → 400
      const badSmtp = JSON.stringify({ smtp: { host: 'bad host!', port: 465, username: 'u', password: 'p', fromAddress: 'noreply@mail.example.net', fromName: 'Blog', tlsMode: 'auto' } });
      const invalidSmtp = await fetch(`${isolated.baseUrl}/internal/mail/verify`, signed('/internal/mail/verify', { rawBody: Buffer.from(badSmtp) }));
      assert.equal(invalidSmtp.status, 400);
      assert.deepEqual(await body(invalidSmtp), payloadFailure);

      // 合法 smtp override → 200，override 透传给 service
      const goodSmtp = JSON.stringify({ smtp: { host: 'smtpdm.aliyun.com', port: 465, username: 'noreply@mail.example.net', password: 'secret-pass', fromAddress: 'noreply@mail.example.net', fromName: 'Blog', tlsMode: 'auto' } });
      const validSmtp = await fetch(`${isolated.baseUrl}/internal/mail/verify`, signed('/internal/mail/verify', { rawBody: Buffer.from(goodSmtp) }));
      assert.equal(validSmtp.status, 200);
      await body(validSmtp);
      assert.deepEqual(seenOverride, { host: 'smtpdm.aliyun.com', port: 465, username: 'noreply@mail.example.net', password: 'secret-pass', fromAddress: 'noreply@mail.example.net', fromName: 'Blog', tlsMode: 'auto' });
      assert.equal(calls, 2);
    } finally { await isolated.close(); }
  });

  it('send separates a signed smtp override from the mail payload', async () => {
    let seenPayload = null;
    let seenOverride = null;
    const isolated = await listen(service({
      send: async (mail, override) => { seenPayload = mail; seenOverride = override; return success; },
    }));
    try {
      const envelope = JSON.stringify({
        ...payload,
        smtp: { host: 'smtpdm.aliyun.com', port: 465, username: 'noreply@mail.example.net', password: 'secret-pass', fromAddress: 'noreply@mail.example.net', fromName: 'Blog', tlsMode: 'implicit' },
      });
      const response = await fetch(`${isolated.baseUrl}/internal/mail/send`, signed('/internal/mail/send', { rawBody: Buffer.from(envelope) }));
      assert.equal(response.status, 200);
      await body(response);
      assert.deepEqual(Object.keys(seenPayload).sort(), ['category', 'html', 'messageId', 'requestId', 'subject', 'text', 'to'].sort());
      assert.deepEqual(seenOverride, { host: 'smtpdm.aliyun.com', port: 465, username: 'noreply@mail.example.net', password: 'secret-pass', fromAddress: 'noreply@mail.example.net', fromName: 'Blog', tlsMode: 'implicit' });
    } finally { await isolated.close(); }
  });

  it('returns 405 for a signed wrong method and 404 for a signed unknown route', async () => {
    const wrong = await fetch(`${app.baseUrl}/internal/mail/send`, signed('/internal/mail/send', { method: 'GET' }));
    assert.equal(wrong.status, 405);
    assert.equal(wrong.headers.get('allow'), 'POST');
    await body(wrong);
    const unknown = await fetch(`${app.baseUrl}/internal/mail/unknown`, signed('/internal/mail/unknown'));
    assert.equal(unknown.status, 404);
    await body(unknown);
  });

  it('rejects raw bodies over the exact gateway limit', async () => {
    const rawBody = Buffer.alloc(MAIL_LIMITS.rawBodyBytes + 1, 0x78);
    const response = await fetch(`${app.baseUrl}/internal/mail/send`, signed('/internal/mail/send', { rawBody }));
    assert.equal(response.status, 413);
    assert.deepEqual(await body(response), payloadFailure);
  });

  it('maps MailError codes to stable statuses and redacted bodies', async () => {
    const cases = [
      ['PAYLOAD_INVALID', false, 400], ['MAIL_NOT_CONFIGURED', false, 503], ['RATE_LIMITED', true, 429],
      ['RECIPIENT_PERMANENT', false, 422], ['SMTP_AUTH', false, 503], ['SMTP_CONNECTION', true, 503],
      ['SMTP_TIMEOUT', true, 503], ['RECIPIENT_TEMPORARY', true, 503], ['INTERNAL_ERROR', true, 500],
    ];
    for (const [code, retryable, status] of cases) {
      const isolated = await listen(service({ send: async () => { throw new MailError(code, retryable, new Error('provider secret')); } }));
      try {
        const rawBody = Buffer.from(JSON.stringify(payload));
        const response = await fetch(`${isolated.baseUrl}/internal/mail/send`, signed('/internal/mail/send', { rawBody }));
        assert.equal(response.status, status, code);
        assert.deepEqual(await body(response), { ok: false, error: { code, retryable } });
      } finally { await isolated.close(); }
    }
  });

  it('rejects a mutated non-contract MailError code', async () => {
    const mutated = new MailError('SMTP_CONNECTION', true);
    mutated.code = 'PROVIDER_SECRET_CODE';
    const isolated = await listen(service({ send: async () => { throw mutated; } }));
    try {
      const rawBody = Buffer.from(JSON.stringify(payload));
      const response = await fetch(`${isolated.baseUrl}/internal/mail/send`, signed('/internal/mail/send', { rawBody }));
      assert.equal(response.status, 500);
      assert.deepEqual(await body(response), authFailure);
    } finally { await isolated.close(); }
  });

  it('contains hostile fields on a thrown MailError inside a stable 500 response', async () => {
    const hostile = new MailError('SMTP_CONNECTION', true);
    Object.defineProperty(hostile, 'code', {
      configurable: true,
      get() { throw new Error('code secret'); },
    });
    const isolated = await listen(service({ send: async () => { throw hostile; } }));
    try {
      const rawBody = Buffer.from(JSON.stringify(payload));
      const response = await fetch(`${isolated.baseUrl}/internal/mail/send`, signed('/internal/mail/send', { rawBody }));
      assert.equal(response.status, 500);
      assert.deepEqual(await body(response), authFailure);
    } finally { await isolated.close(); }
  });

  it('contains hostile thrown proxies inside a stable 500 response', async () => {
    const hostile = new Proxy({}, {
      getPrototypeOf() { throw new Error('prototype secret'); },
    });
    const rawBody = Buffer.from(JSON.stringify(payload));
    const request = signed('/internal/mail/send', { rawBody });
    const chunks = [];
    let responseStatus;
    let responseHeaders;
    const req = {
      method: request.method,
      headers: Object.fromEntries(Object.entries(request.headers).map(([key, value]) => [key.toLowerCase(), value])),
      async *[Symbol.asyncIterator]() { yield rawBody; },
    };
    const res = {
      writeHead(status, headers) { responseStatus = status; responseHeaders = headers; },
      end(chunk) { chunks.push(chunk); },
    };
    const handler = createMailHttpHandler({
      verifier: createMailRequestVerifier({ secret, nowSeconds: () => now }),
      service: service({ send: async () => { throw hostile; } }),
      config: {},
    });

    assert.equal(await handler.handle(req, res, new URL('http://localhost/internal/mail/send')), true);
    assert.equal(responseStatus, 500);
    assert.equal(responseHeaders['Cache-Control'], 'no-store');
    assert.deepEqual(JSON.parse(chunks.join('')), authFailure);
  });

  it('maps unexpected failures to a stable 500', async () => {
    const isolated = await listen(service({ send: async () => { throw new Error('unexpected secret'); } }));
    try {
      const rawBody = Buffer.from(JSON.stringify(payload));
      const response = await fetch(`${isolated.baseUrl}/internal/mail/send`, signed('/internal/mail/send', { rawBody }));
      assert.equal(response.status, 500);
      assert.deepEqual(await body(response), authFailure);
    } finally { await isolated.close(); }
  });
});
