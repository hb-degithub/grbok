import test from 'node:test';
import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { access, writeFile } from 'node:fs/promises';
import { env } from 'node:process';
import { signMailRequest } from '../../src/mail/request-auth.mjs';

const integrationEnabled = env.MAILPIT_INTEGRATION === '1';
const successRecipient = 'reader@example.local';
const outsideRecipient = 'outside@example.net';
const subject = '网关 Mailpit 集成测试 ✓';
const html = '<p>网关 HTML 正文 ✓</p>';
const text = '网关纯文本正文 ✓';

const payload = Object.freeze({
  requestId: 'MailpitRequestIdentifier0001',
  messageId: 'MailpitMessageIdentifier0001',
  category: 'admin_test',
  to: successRecipient,
  subject,
  html,
  text,
});

const authFailure = Object.freeze({
  ok: false,
  error: Object.freeze({ code: 'INTERNAL_ERROR', retryable: false }),
});

const payloadFailure = Object.freeze({
  ok: false,
  error: Object.freeze({ code: 'PAYLOAD_INVALID', retryable: false }),
});

test('rejects non-canonical local integration URLs before any request', () => {
  assert.equal(
    assertCanonicalLoopbackUrl('http://127.0.0.1:18787', { path: '', label: 'gateway', expectedPort: 18787 }),
    'http://127.0.0.1:18787',
  );
  assert.equal(
    assertCanonicalLoopbackUrl('http://127.0.0.1:8125/api/v1', { path: '/api/v1', label: 'Mailpit API', expectedPort: 8125 }),
    'http://127.0.0.1:8125/api/v1',
  );

  for (const invalidUrl of [
    'http://localhost:18787',
    'http://[::1]:18787',
    'https://127.0.0.1:18787',
    'http://user@127.0.0.1:18787',
    'http://127.0.0.1:18787/?query=1',
    'http://127.0.0.1:18787/#fragment',
    'http://127.0.0.1:18787/unexpected',
    'http://example.test:18787',
    'http://127.0.0.1:0',
  ]) {
    assert.throws(
      () => assertCanonicalLoopbackUrl(invalidUrl, { path: '', label: 'gateway', expectedPort: 18787 }),
      /must be exactly/,
      invalidUrl,
    );
  }
});

test('proves the signed gateway against local Mailpit', {
  skip: !integrationEnabled,
  timeout: 60_000,
}, async () => {
  const gatewayPort = parseLauncherPort(env.MAIL_GATEWAY_TEST_PORT || '18787', 'MAIL_GATEWAY_TEST_PORT');
  const mailpitApiPort = parseLauncherPort(env.MAILPIT_API_PORT || '8125', 'MAILPIT_API_PORT');
  const gatewayUrl = assertCanonicalLoopbackUrl(
    env.MAIL_GATEWAY_TEST_URL || `http://127.0.0.1:${gatewayPort}`,
    { path: '', label: 'MAIL_GATEWAY_TEST_URL', expectedPort: gatewayPort },
  );
  const mailpitApiUrl = assertCanonicalLoopbackUrl(
    env.MAILPIT_API_URL || `http://127.0.0.1:${mailpitApiPort}/api/v1`,
    { path: '/api/v1', label: 'MAILPIT_API_URL', expectedPort: mailpitApiPort },
  );
  const secret = env.MAIL_INTERNAL_SECRET;

  const health = await fetchJson(`${gatewayUrl}/health`);
  assert.equal(health.response.status, 200);
  assert.deepEqual(health.json, { status: 'ok' });
  assert.ok(secret, 'MAIL_INTERNAL_SECRET is required when Mailpit integration is enabled');

  const initialMessages = await fetchJson(`${mailpitApiUrl}/messages`);
  assert.equal(initialMessages.response.status, 200);
  assert.equal(initialMessages.json.total, 0);
  assert.equal(initialMessages.json.messages?.length, 0);

  const rawBody = Buffer.from(JSON.stringify(payload));
  const unsigned = await fetchJson(`${gatewayUrl}/internal/mail/send`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: rawBody,
  });
  assert.equal(unsigned.response.status, 401);
  assertMailResponseHeaders(unsigned.response);
  assert.deepEqual(unsigned.json, authFailure);

  const replayNonce = 'mailpit_replay_nonce_000001';
  const signedSend = signedRequest('/internal/mail/send', {
    secret,
    rawBody,
    nonce: replayNonce,
  });
  const sent = await fetchJson(`${gatewayUrl}/internal/mail/send`, signedSend);
  assert.equal(sent.response.status, 200);
  assertMailResponseHeaders(sent.response);
  assert.deepEqual(Object.keys(sent.json).sort(), ['acceptedAt', 'messageId', 'ok', 'requestId']);
  assert.equal(sent.json.ok, true);
  assert.equal(sent.json.requestId, payload.requestId);
  assert.equal(sent.json.messageId, payload.messageId);
  assertCanonicalTimestamp(sent.json.acceptedAt);

  const replay = await fetchJson(`${gatewayUrl}/internal/mail/send`, signedSend);
  assert.equal(replay.response.status, 401);
  assertMailResponseHeaders(replay.response);
  assert.deepEqual(replay.json, authFailure);

  const outsidePayload = {
    ...payload,
    requestId: 'MailpitRequestIdentifier0002',
    messageId: 'MailpitMessageIdentifier0002',
    to: outsideRecipient,
  };
  const outsideRawBody = Buffer.from(JSON.stringify(outsidePayload));
  const outside = await fetchJson(`${gatewayUrl}/internal/mail/send`, signedRequest('/internal/mail/send', {
    secret,
    rawBody: outsideRawBody,
  }));
  assert.equal(outside.response.status, 400);
  assertMailResponseHeaders(outside.response);
  assert.deepEqual(outside.json, payloadFailure);

  const messages = await waitForMailpitMessages(mailpitApiUrl, 1);
  assert.equal(messages.total, 1);
  assert.equal(messages.messages.length, 1);
  const summary = messages.messages[0];
  assert.equal(summary.Subject, subject);
  assert.deepEqual(summary.From, { Name: 'Mail Gateway Integration', Address: 'gateway@example.local' });
  assert.deepEqual(summary.To, [{ Name: '', Address: successRecipient }]);

  const detail = await fetchJson(`${mailpitApiUrl}/message/${encodeURIComponent(summary.ID)}`);
  assert.equal(detail.response.status, 200);
  assert.equal(detail.json.Subject, subject);
  assert.equal(detail.json.Text, text);
  assert.equal(detail.json.HTML, html);
  assert.equal(detail.json.MessageID, `${payload.messageId}@example.local`);
  assert.deepEqual(detail.json.From, { Name: 'Mail Gateway Integration', Address: 'gateway@example.local' });
  assert.deepEqual(detail.json.To, [{ Name: '', Address: successRecipient }]);

  const verified = await fetchJson(`${gatewayUrl}/internal/mail/verify`, signedRequest('/internal/mail/verify', {
    secret,
    rawBody: Buffer.alloc(0),
  }));
  assert.equal(verified.response.status, 200);
  assertMailResponseHeaders(verified.response);
  assert.deepEqual(Object.keys(verified.json).sort(), ['ok', 'verifiedAt']);
  assert.equal(verified.json.ok, true);
  assertCanonicalTimestamp(verified.json.verifiedAt);

  const stopRequestFile = requireEnvironment('MAILPIT_STOP_REQUEST_FILE');
  const stopAckFile = requireEnvironment('MAILPIT_STOP_ACK_FILE');
  await writeFile(stopRequestFile, 'stop\n', { encoding: 'utf8', flag: 'wx' });
  await waitForFile(stopAckFile, 15_000);

  const healthAfterStop = await fetchJson(`${gatewayUrl}/health`);
  assert.equal(healthAfterStop.response.status, 200);
  assert.deepEqual(healthAfterStop.json, { status: 'ok' });

  const failedPayload = {
    ...payload,
    requestId: 'MailpitRequestIdentifier0003',
    messageId: 'MailpitMessageIdentifier0003',
  };
  const failedRawBody = Buffer.from(JSON.stringify(failedPayload));
  const failed = await fetchJson(`${gatewayUrl}/internal/mail/send`, signedRequest('/internal/mail/send', {
    secret,
    rawBody: failedRawBody,
  }));
  assert.equal(failed.response.status, 503);
  assertMailResponseHeaders(failed.response);
  assert.equal(failed.json.ok, false);
  assert.ok(['SMTP_CONNECTION', 'SMTP_TIMEOUT'].includes(failed.json.error?.code));
  assert.equal(failed.json.error?.retryable, true);
  assert.deepEqual(Object.keys(failed.json).sort(), ['error', 'ok']);
  assert.deepEqual(Object.keys(failed.json.error).sort(), ['code', 'retryable']);
  assert.doesNotMatch(failed.rawText, /127\.0\.0\.1|1125|ECONNREFUSED|connectex|SMTP server/i);
});

function parseLauncherPort(rawPort, label) {
  assert.match(String(rawPort), /^[1-9]\d{0,4}$/, `${label} must be a valid launcher port`);
  const port = Number(rawPort);
  assert.ok(port <= 65535, `${label} must be a valid launcher port`);
  return port;
}

function assertCanonicalLoopbackUrl(rawUrl, { path, label, expectedPort }) {
  assert.equal(typeof rawUrl, 'string', `${label} must be exactly a canonical loopback URL`);
  const expected = `http://127.0.0.1:${expectedPort}${path}`;

  let parsed;
  try {
    parsed = new URL(rawUrl);
  } catch {
    assert.fail(`${label} must be exactly ${expected}`);
  }

  assert.equal(rawUrl, expected, `${label} must be exactly ${expected}`);
  assert.equal(parsed.protocol, 'http:', `${label} must be exactly ${expected}`);
  assert.equal(parsed.hostname, '127.0.0.1', `${label} must be exactly ${expected}`);
  assert.equal(parsed.port, String(expectedPort), `${label} must be exactly ${expected}`);
  assert.equal(parsed.username, '', `${label} must be exactly ${expected}`);
  assert.equal(parsed.password, '', `${label} must be exactly ${expected}`);
  assert.equal(parsed.search, '', `${label} must be exactly ${expected}`);
  assert.equal(parsed.hash, '', `${label} must be exactly ${expected}`);
  assert.equal(parsed.pathname, path || '/', `${label} must be exactly ${expected}`);
  return expected;
}
function assertMailResponseHeaders(response) {
  assert.equal(response.headers.get('cache-control'), 'no-store');
  assert.equal(response.headers.get('x-content-type-options'), 'nosniff');
}
function signedRequest(path, { secret, rawBody, nonce = randomNonce(), method = 'POST' }) {
  const timestamp = String(Math.floor(Date.now() / 1000));
  const signature = signMailRequest({ method, path, timestamp, nonce, rawBody }, secret);
  return {
    method,
    headers: {
      'Content-Type': 'application/json',
      'X-Mail-Timestamp': timestamp,
      'X-Mail-Nonce': nonce,
      'X-Mail-Signature': signature,
    },
    body: rawBody,
  };
}

function randomNonce() {
  return randomBytes(18).toString('base64url');
}

async function fetchJson(url, options) {
  const response = await fetch(url, {
    ...options,
    signal: AbortSignal.timeout(5_000),
  });
  const rawText = await response.text();
  let json;
  try {
    json = JSON.parse(rawText);
  } catch (error) {
    assert.fail(`expected JSON from ${url}: ${error.message}`);
  }
  return { response, rawText, json };
}

async function waitForMailpitMessages(mailpitApiUrl, expectedCount) {
  const deadline = Date.now() + 10_000;
  let last;
  while (Date.now() < deadline) {
    last = await fetchJson(`${mailpitApiUrl}/messages`);
    assert.equal(last.response.status, 200);
    if (last.json.total === expectedCount && last.json.messages?.length === expectedCount) {
      return last.json;
    }
    if (Number(last.json.total) > expectedCount) {
      assert.fail(`expected ${expectedCount} Mailpit message, found ${last.json.total}`);
    }
    await delay(100);
  }
  assert.fail(`Mailpit message count did not reach ${expectedCount}; last=${JSON.stringify(last?.json)}`);
}

async function waitForFile(path, timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      await access(path);
      return;
    } catch {
      await delay(100);
    }
  }
  assert.fail(`timed out waiting for launcher acknowledgement: ${path}`);
}

function requireEnvironment(name) {
  const value = env[name];
  assert.ok(value, `${name} is required for Mailpit integration`);
  return value;
}

function assertCanonicalTimestamp(value) {
  assert.equal(typeof value, 'string');
  const milliseconds = Date.parse(value);
  assert.ok(Number.isFinite(milliseconds));
  assert.equal(new Date(milliseconds).toISOString(), value);
}

function delay(milliseconds) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}