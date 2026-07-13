import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { createMailConfig, redactMailStatus } from '../../src/mail/config.mjs';

const generic = {
  SMTP_HOST: 'smtp.example.net', SMTP_PORT: '587', SMTP_USERNAME: 'user', SMTP_PASSWORD: 'secret',
  SMTP_FROM_ADDRESS: 'noreply@example.net', SMTP_FROM_NAME: 'Blog', SMTP_TLS_MODE: 'auto',
  SMTP_CONNECTION_TIMEOUT_MS: '8000', SMTP_SOCKET_TIMEOUT_MS: '15000',
  MAIL_PROVIDER_LABEL: 'Generic SMTP', PUBLIC_SITE_URL: 'https://hlydwz.com',
  MAIL_ALERT_RECIPIENTS: 'ops1@example.net,ops2@example.net',
};

const aliasConflicts = [
  { property: 'host', genericName: 'SMTP_HOST', legacyName: 'ALIYUN_SMTP_HOST', legacyValue: 'legacy.example.net', expected: 'smtp.example.net' },
  { property: 'port', genericName: 'SMTP_PORT', legacyName: 'ALIYUN_SMTP_PORT', legacyValue: '465', expected: 587 },
  { property: 'username', genericName: 'SMTP_USERNAME', legacyName: 'ALIYUN_SMTP_USER', legacyValue: 'legacy-user', expected: 'user' },
  { property: 'password', genericName: 'SMTP_PASSWORD', legacyName: 'ALIYUN_SMTP_PASSWORD', legacyValue: 'legacy-secret', expected: 'secret' },
  { property: 'fromAddress', genericName: 'SMTP_FROM_ADDRESS', legacyName: 'ALIYUN_FROM_EMAIL', legacyValue: 'legacy@example.net', expected: 'noreply@example.net' },
  { property: 'fromName', genericName: 'SMTP_FROM_NAME', legacyName: 'ALIYUN_FROM_NAME', legacyValue: 'Legacy Blog', expected: 'Blog' },
];

describe('createMailConfig', () => {
  for (const conflict of aliasConflicts) {
    it(`prefers ${conflict.genericName} over ${conflict.legacyName}`, () => {
      const config = createMailConfig({ ...generic, [conflict.legacyName]: conflict.legacyValue });

      assert.equal(config[conflict.property], conflict.expected);
    });
  }

  it('maps auto:587 to STARTTLS', () => {
    const config = createMailConfig(generic);

    assert.equal(config.secure, false);
    assert.equal(config.requireTLS, true);
    assert.equal(config.configured, true);
  });

  it('maps auto:465 to implicit TLS and reads legacy aliases', () => {
    const config = createMailConfig({
      ALIYUN_SMTP_HOST: 'smtpdm.aliyun.com', ALIYUN_SMTP_PORT: '465',
      ALIYUN_SMTP_USER: 'mailer@example.com', ALIYUN_SMTP_PASSWORD: 'secret',
      ALIYUN_FROM_EMAIL: 'noreply@example.com', ALIYUN_FROM_NAME: 'Blog',
      SMTP_TLS_MODE: 'auto', PUBLIC_SITE_URL: 'https://hlydwz.com',
    });

    assert.equal(config.secure, true);
    assert.equal(config.requireTLS, false);
    assert.equal(config.host, 'smtpdm.aliyun.com');
  });

  for (const tls of [
    { mode: 'implicit', port: '587', secure: true, requireTLS: false },
    { mode: 'starttls', port: '465', secure: false, requireTLS: true },
  ]) {
    it(`maps explicit ${tls.mode} TLS flags`, () => {
      const config = createMailConfig({ ...generic, SMTP_TLS_MODE: tls.mode, SMTP_PORT: tls.port });

      assert.equal(config.secure, tls.secure);
      assert.equal(config.requireTLS, tls.requireTLS);
    });
  }

  for (const host of ['127.0.0.1', '127.42.0.7', '127.255.255.255', 'localhost', '::1']) {
    it(`allows unauthenticated loopback ${host} only in local test mode`, () => {
      const config = createMailConfig({
        SMTP_HOST: host, SMTP_PORT: '1125', SMTP_FROM_ADDRESS: 'noreply@example.local',
        SMTP_FROM_NAME: 'Local Blog', SMTP_TLS_MODE: 'auto', MAIL_LOCAL_TEST_MODE: 'true',
        MAIL_TEST_RECIPIENT_ALLOWLIST: 'reader@example.local', PUBLIC_SITE_URL: 'http://127.0.0.1:4321',
      });

      assert.equal(config.configured, true);
      assert.equal(config.localTestMode, true);
      assert.deepEqual(config.testRecipientAllowlist, ['reader@example.local']);
    });
  }

  it('returns an unconfigured shape when SMTP and site URL values are absent', () => {
    const config = createMailConfig({ PUBLIC_SITE_URL: '   ' });

    assert.equal(config.configured, false);
    assert.equal(config.host, '');
    assert.equal(config.port, 0);
    assert.equal(config.siteUrl, '');
  });

  it('accepts safe site URLs without SMTP values', () => {
    const config = createMailConfig({ PUBLIC_SITE_URL: 'https://hlydwz.com' });

    assert.equal(config.configured, false);
    assert.equal(config.siteUrl, 'https://hlydwz.com');
  });

  it('rejects malformed site URLs without SMTP values', () => {
    assertInvalidConfig({ PUBLIC_SITE_URL: 'not-a-url' });
  });

  it('rejects non-HTTPS site URLs in production without SMTP values', () => {
    assertInvalidConfig({ NODE_ENV: 'production', PUBLIC_SITE_URL: 'http://hlydwz.com' });
  });

  it('clamps connection and socket timeouts to their safe ranges', () => {
    const minimum = createMailConfig({
      ...generic, SMTP_CONNECTION_TIMEOUT_MS: '1', SMTP_SOCKET_TIMEOUT_MS: '1',
    });
    const maximum = createMailConfig({
      ...generic, SMTP_CONNECTION_TIMEOUT_MS: '999999', SMTP_SOCKET_TIMEOUT_MS: '999999',
    });

    assert.deepEqual(
      [minimum.connectionTimeoutMs, minimum.socketTimeoutMs],
      [1000, 3000],
    );
    assert.deepEqual(
      [maximum.connectionTimeoutMs, maximum.socketTimeoutMs],
      [30000, 120000],
    );
  });

  it('uses only exact, non-empty alert and local allowlist addresses', () => {
    const config = createMailConfig({
      ...generic,
      MAIL_ALERT_RECIPIENTS: ' ops@example.net , ,alerts@example.net ',
      MAIL_LOCAL_TEST_MODE: 'true',
      SMTP_HOST: 'localhost', SMTP_USERNAME: '', SMTP_PASSWORD: '',
      MAIL_TEST_RECIPIENT_ALLOWLIST: ' reader@example.local , reader@example.local ',
      PUBLIC_SITE_URL: 'http://localhost:4321',
    });

    assert.deepEqual(config.alertRecipients, ['ops@example.net', 'alerts@example.net']);
    assert.deepEqual(config.testRecipientAllowlist, ['reader@example.local']);
  });

  for (const port of ['', '0', '65536', '587.5', 'abc']) {
    it(`rejects invalid SMTP port ${JSON.stringify(port)}`, () => {
      assertInvalidConfig({ ...generic, SMTP_PORT: port });
    });
  }

  it('rejects unsupported TLS modes', () => {
    assertInvalidConfig({ ...generic, SMTP_TLS_MODE: 'opportunistic' });
  });

  it('rejects unsupported TLS modes without SMTP values', () => {
    assertInvalidConfig({ SMTP_TLS_MODE: 'opportunistic' });
  });

  it('rejects malformed local test mode values', () => {
    assertInvalidConfig({ ...generic, MAIL_LOCAL_TEST_MODE: 'maybe' });
  });

  it('rejects unpaired SMTP credentials outside local test mode', () => {
    assertInvalidConfig({ ...generic, SMTP_PASSWORD: '' });
    assertInvalidConfig({ ...generic, SMTP_USERNAME: '' });
  });

  it('rejects unauthenticated non-loopback SMTP', () => {
    assertInvalidConfig({ ...generic, SMTP_USERNAME: '', SMTP_PASSWORD: '' });
  });

  it('rejects non-HTTPS site URLs in production', () => {
    assertInvalidConfig({ ...generic, NODE_ENV: 'production', PUBLIC_SITE_URL: 'http://hlydwz.com' });
  });

  it('rejects local test mode without an allowlist', () => {
    assertInvalidConfig({
      ...generic, MAIL_LOCAL_TEST_MODE: 'true', SMTP_HOST: '127.0.0.1',
      SMTP_USERNAME: '', SMTP_PASSWORD: '', MAIL_TEST_RECIPIENT_ALLOWLIST: '',
      PUBLIC_SITE_URL: 'http://127.0.0.1:4321',
    });
  });

  it('rejects local test mode without SMTP values', () => {
    assertInvalidConfig({ MAIL_LOCAL_TEST_MODE: 'true' });
  });

  it('rejects non-loopback SMTP in local test mode', () => {
    assertInvalidConfig({
      ...generic, MAIL_LOCAL_TEST_MODE: 'true', MAIL_TEST_RECIPIENT_ALLOWLIST: 'reader@example.local',
    });
  });

  for (const host of ['127.0.0.256', '127.999.999.999']) {
    it(`rejects invalid numeric loopback host ${host}`, () => {
      assertInvalidConfig({
        ...generic, MAIL_LOCAL_TEST_MODE: 'true', SMTP_HOST: host,
        SMTP_USERNAME: '', SMTP_PASSWORD: '',
        MAIL_TEST_RECIPIENT_ALLOWLIST: 'reader@example.local',
      });
    });
  }

  it('rejects malformed timeout values', () => {
    assertInvalidConfig({ ...generic, SMTP_CONNECTION_TIMEOUT_MS: 'fast' });
    assertInvalidConfig({ ...generic, SMTP_SOCKET_TIMEOUT_MS: 'slow' });
  });
});

describe('redactMailStatus', () => {
  it('returns only redacted status fields in a new object', () => {
    const config = createMailConfig(generic);
    const status = redactMailStatus(config, { lastVerify: 'ok' }, new Date('2026-07-13T00:00:00Z'));

    assert.notEqual(status, config);
    assert.deepEqual(
      Object.keys(status).sort(),
      ['checkedAt', 'configured', 'fromDomain', 'lastVerify', 'port', 'providerLabel', 'tlsMode'].sort(),
    );
    assert.equal(JSON.stringify(status).includes('smtp.example.net'), false);
    assert.equal(JSON.stringify(status).includes('user'), false);
    assert.equal(JSON.stringify(status).includes('secret'), false);
  });
});

function assertInvalidConfig(source) {
  let error;
  try {
    createMailConfig(source);
  } catch (caught) {
    error = caught;
  }

  assert.ok(error instanceof Error, 'expected createMailConfig to throw an Error');
  const serialized = JSON.stringify({
    name: error.name,
    message: error.message,
    cause: error.cause,
    properties: Object.fromEntries(Object.getOwnPropertyNames(error).map((name) => [name, error[name]])),
  });

  assert.equal(error.name, 'Error');
  assert.equal(error.message, 'Invalid mail startup configuration');
  assert.equal(error.cause, undefined);
  for (const secret of ['smtp.example.net', 'user', 'secret', 'hlydwz.com', 'ops1@example.net']) {
    assert.equal(serialized.includes(secret), false);
  }
}
