import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { createMailTransport } from '../../src/mail/transport.mjs';

const baseConfig = Object.freeze({
  configured: true,
  host: 'smtp.example.net',
  port: 587,
  secure: false,
  requireTLS: true,
  username: 'user',
  password: 'secret',
  fromAddress: 'noreply@example.net',
  fromName: 'Blog',
  fromDomain: 'example.net',
  connectionTimeoutMs: 8000,
  socketTimeoutMs: 15000,
  localTestMode: false,
});

const payload = Object.freeze({
  requestId: 'req_01J00000000000000000000000',
  messageId: 'msg_01J00000000000000000000000',
  category: 'reader_otp',
  to: 'reader@example.local',
  subject: '登录验证码',
  html: '<p>验证码 123456</p>',
  text: '验证码 123456',
});

function setup(config = baseConfig, sendResult = { response: '250 queued', messageId: '<provider-id>' }) {
  const calls = { options: null, messages: [], logs: [] };
  const smtp = {
    async sendMail(message) {
      calls.messages.push(message);
      return sendResult;
    },
    async verify() { return true; },
  };
  const nodemailer = {
    createTransport(options) {
      calls.options = options;
      return smtp;
    },
  };
  const transport = createMailTransport({
    config,
    nodemailer,
    logger: (entry) => calls.logs.push(entry),
    clock: () => 125,
  });
  return { calls, smtp, transport };
}

describe('createMailTransport', () => {
  it('constructs the exact authenticated TLS transport options', () => {
    const { calls } = setup();
    assert.deepEqual(calls.options, {
      host: 'smtp.example.net', port: 587, secure: false, requireTLS: true,
      auth: { user: 'user', pass: 'secret' },
      connectionTimeout: 8000, greetingTimeout: 8000, socketTimeout: 15000,
      tls: { minVersion: 'TLSv1.2', servername: 'smtp.example.net' },
    });
    assert.equal('debug' in calls.options, false);
    assert.equal('logger' in calls.options, false);
  });

  it('omits auth and TLS requirements for validated local mode', () => {
    const { calls } = setup({
      ...baseConfig, host: '127.0.0.1', port: 1125, username: '', password: '',
      secure: true, requireTLS: true, localTestMode: true,
    });
    assert.deepEqual(calls.options, {
      host: '127.0.0.1', port: 1125, secure: false, requireTLS: false,
      connectionTimeout: 8000, greetingTimeout: 8000, socketTimeout: 15000,
      tls: { minVersion: 'TLSv1.2', servername: '127.0.0.1' },
    });
  });

  it('builds a fixed envelope and never spreads caller-controlled fields', async () => {
    const { calls, transport } = setup();
    await transport.send({ ...payload, from: 'attacker@example.org', headers: { Bcc: 'x@example.org' } });
    assert.deepEqual(calls.messages, [{
      from: { name: 'Blog', address: 'noreply@example.net' },
      to: 'reader@example.local',
      messageId: '<msg_01J00000000000000000000000@example.net>',
      subject: '登录验证码', html: '<p>验证码 123456</p>', text: '验证码 123456',
    }]);
  });

  it('does not turn a completed SMTP send into failure when duration timing throws', async () => {
    let clockCalls = 0;
    const { smtp } = setup();
    const originalSendMail = smtp.sendMail;
    const timedTransport = createMailTransport({
      config: baseConfig,
      nodemailer: { createTransport: () => ({ ...smtp, sendMail: originalSendMail }) },
      logger: () => {},
      clock: () => {
        clockCalls += 1;
        if (clockCalls > 1) throw new Error('clock unavailable');
        return 100;
      },
    });

    const result = await timedTransport.send(payload);
    assert.deepEqual(result, { response: '250 queued', messageId: '<provider-id>' });
    assert.equal(clockCalls, 2);
  });

  it('does not turn a completed SMTP send into failure when logging throws', async () => {
    const nodemailer = {
      createTransport() {
        return { async sendMail() { return { response: '250 queued' }; }, async verify() { return true; } };
      },
    };
    const transport = createMailTransport({
      config: baseConfig, nodemailer, clock: () => 125,
      logger: () => { throw new Error('logger unavailable'); },
    });
    await assert.doesNotReject(transport.send(payload));
  });
  it('logs only stable metadata on success and failure', async () => {
    const { calls, transport } = setup();
    await transport.send(payload);
    assert.deepEqual(calls.logs, [{
      requestId: payload.requestId, category: payload.category, duration: 0, result: 'ok',
    }]);

    const failure = Object.assign(new Error('raw SMTP response secret'), { response: '550 reader@example.local' });
    const failed = setup(baseConfig);
    failed.smtp.sendMail = async () => { throw failure; };
    await assert.rejects(failed.transport.send(payload), (error) => error === failure);
    assert.deepEqual(failed.calls.logs, [{
      requestId: payload.requestId, category: payload.category, duration: 0, result: 'error',
    }]);
    const serialized = JSON.stringify(failed.calls.logs);
    for (const secret of ['reader@example.local', '验证码', 'smtp.example.net', 'user', 'secret', '550']) {
      assert.equal(serialized.includes(secret), false);
    }
  });
});
