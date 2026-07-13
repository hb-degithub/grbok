import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { createMailService } from '../../src/mail/service.mjs';
import { MailError } from '../../src/mail/errors.mjs';

const config = Object.freeze({
  configured: true, port: 587, fromDomain: 'example.net', tlsMode: 'auto',
  providerLabel: 'Generic SMTP', alertRecipients: ['ops1@example.net', 'ops2@example.net'],
  localTestMode: false, testRecipientAllowlist: [],
});
const payload = Object.freeze({
  requestId: 'req_01J00000000000000000000000', messageId: 'msg_01J00000000000000000000000',
  category: 'reader_otp', to: 'reader@example.local', subject: '登录验证码',
  html: '<p>验证码 123456</p>', text: '验证码 123456',
});
const event = Object.freeze({
  eventId: 'ops_01J00000000000000000000000', check: 'public_health', state: 'firing',
  observedAt: '2026-07-13T00:00:00.000Z', summary: '<script>alert("x")</script> & failed',
});
const fixedNow = new Date('2026-07-13T01:02:03.000Z');

function setup({ currentConfig = config, sendError, verifyError } = {}) {
  const calls = { sends: [], verify: 0, logs: [] };
  const transport = {
    async send(value) {
      calls.sends.push(value);
      if (sendError) throw sendError;
      return { accepted: ['private provider response'] };
    },
    async verify() {
      calls.verify += 1;
      if (verifyError) throw verifyError;
      return true;
    },
  };
  const service = createMailService({
    config: currentConfig,
    transport,
    clock: () => new Date(fixedNow),
    logger: (entry) => calls.logs.push(entry),
  });
  return { calls, service };
}

describe('createMailService', () => {
  it('validates and sends configured payloads with a stable non-provider result', async () => {
    const { calls, service } = setup();
    assert.deepEqual(await service.send(payload), {
      ok: true, requestId: payload.requestId, messageId: payload.messageId, acceptedAt: fixedNow.toISOString(),
    });
    assert.deepEqual(calls.sends, [payload]);
  });

  it('does not call transport when the success timestamp cannot be created', async () => {
    const calls = { sends: 0 };
    const service = createMailService({
      config,
      transport: {
        async send() { calls.sends += 1; },
        async verify() { return true; },
      },
      clock: () => { throw new Error('clock unavailable'); },
    });

    await assert.rejects(service.send(payload), (error) => error.code === 'INTERNAL_ERROR');
    assert.equal(calls.sends, 0);
  });

  it('returns stable MAIL_NOT_CONFIGURED without calling transport', async () => {
    const { calls, service } = setup({ currentConfig: { ...config, configured: false } });
    await assert.rejects(service.send(payload), (error) => {
      assert.ok(error instanceof MailError);
      assert.deepEqual([error.code, error.retryable], ['MAIL_NOT_CONFIGURED', false]);
      return true;
    });
    assert.equal(calls.sends.length, 0);
    await assert.rejects(service.verify(), (error) => error.code === 'MAIL_NOT_CONFIGURED');
    assert.equal(calls.verify, 0);
  });

  it('classifies transport failures without leaking provider errors', async () => {
    const raw = Object.assign(new Error('550 reader@example.local'), { responseCode: 550, response: 'secret' });
    const { service } = setup({ sendError: raw });
    await assert.rejects(service.send(payload), (error) => {
      assert.ok(error instanceof MailError);
      assert.deepEqual([error.code, error.retryable], ['RECIPIENT_PERMANENT', false]);
      assert.equal(JSON.stringify(error).includes('reader@example.local'), false);
      return true;
    });
  });

  it('tracks only stable verify state and delegates redacted status', async () => {
    const success = setup();
    assert.equal(success.service.status().lastVerify, 'never');
    assert.deepEqual(await success.service.verify(), { ok: true, verifiedAt: fixedNow.toISOString() });
    assert.equal(success.service.status().lastVerify, 'ok');
    assert.deepEqual(Object.keys(success.service.status()).sort(),
      ['checkedAt', 'configured', 'fromDomain', 'lastVerify', 'port', 'providerLabel', 'tlsMode'].sort());

    const failed = setup({ verifyError: Object.assign(new Error('auth secret'), { code: 'EAUTH' }) });
    await assert.rejects(failed.service.verify(), (error) => error.code === 'SMTP_AUTH');
    assert.equal(failed.service.status().lastVerify, 'SMTP_AUTH');
    assert.equal(JSON.stringify(failed.service.status()).includes('auth secret'), false);
  });

  it('renders fixed escaped operations templates and sends one message per configured address', async () => {
    const { calls, service } = setup();
    assert.deepEqual(await service.sendOpsEvent(event), { sent: 2 });
    assert.equal(calls.sends.length, 2);
    assert.deepEqual(calls.sends.map((item) => item.to), ['ops1@example.net', 'ops2@example.net']);
    for (const [index, sent] of calls.sends.entries()) {
      assert.equal(sent.requestId, event.eventId);
      assert.equal(sent.messageId, `${event.eventId}_${index + 1}`);
      assert.equal(sent.category, 'ops_alert');
      assert.equal(sent.subject, '[博客告警] public_health firing');
      assert.match(sent.html, /public_health/);
      assert.match(sent.html, /firing/);
      assert.match(sent.html, /2026-07-13T00:00:00.000Z/);
      assert.match(sent.html, /&lt;script&gt;alert\(&quot;x&quot;\)&lt;\/script&gt; &amp; failed/);
      assert.equal(sent.html.includes('<script>'), false);
      assert.match(sent.text, /<script>alert\("x"\)<\/script> & failed/);
    }
  });

  it('derives a valid distinct message ID from a maximum-length operations event ID', async () => {
    const { calls, service } = setup();
    const maximumEventId = 'o' + 'x'.repeat(127);
    await service.sendOpsEvent({ ...event, eventId: maximumEventId });
    assert.equal(calls.sends.length, 2);
    assert.equal(calls.sends[0].messageId.length <= 128, true);
    assert.equal(calls.sends[1].messageId.length <= 128, true);
    assert.notEqual(calls.sends[0].messageId, calls.sends[1].messageId);
  });
  it('rejects invalid operations events and does not accept caller recipients or templates', async () => {
    const { calls, service } = setup();
    await assert.rejects(service.sendOpsEvent({ ...event, to: 'attacker@example.org' }), (error) => error.code === 'PAYLOAD_INVALID');
    await assert.rejects(service.sendOpsEvent({ ...event, html: '<b>caller</b>' }), (error) => error.code === 'PAYLOAD_INVALID');
    assert.equal(calls.sends.length, 0);
  });
});
