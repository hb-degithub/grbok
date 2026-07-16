import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { MAIL_CATEGORIES, MAIL_ERROR_CODES, MAIL_LIMITS, isMailCategory } from '../../src/mail/constants.mjs';
import { validateMailPayload, validateOpsEvent } from '../../src/mail/validation.mjs';

const valid = Object.freeze({
  requestId: 'req_01J00000000000000000000000',
  messageId: 'msg_01J00000000000000000000000',
  category: 'reader_otp',
  to: 'Reader@Example.Local',
  subject: '\u767b\u5f55\u9a8c\u8bc1\u7801',
  html: '<p>\u9a8c\u8bc1\u7801 123456</p>',
  text: '\u9a8c\u8bc1\u7801 123456',
});
const config = Object.freeze({ localTestMode: false, testRecipientAllowlist: [] });
const localConfig = Object.freeze({ localTestMode: true, testRecipientAllowlist: ['reader@example.local'] });

describe('mail constants', () => {
  it('locks the public categories, errors, and byte limits', () => {
    assert.deepEqual(MAIL_CATEGORIES, [
      'account_verification', 'account_password_reset', 'account_email_change',
      'reader_otp', 'comment_new', 'comment_approved', 'comment_reply',
      'comment_notification', 'account_retention_notice',
      'admin_test', 'ops_alert',
    ]);
    assert.deepEqual(MAIL_ERROR_CODES, [
      'MAIL_NOT_CONFIGURED', 'SMTP_AUTH', 'SMTP_CONNECTION', 'SMTP_TIMEOUT',
      'RECIPIENT_TEMPORARY', 'RECIPIENT_PERMANENT', 'PAYLOAD_INVALID',
      'RATE_LIMITED', 'INTERNAL_ERROR',
    ]);
    assert.deepEqual(MAIL_LIMITS, { subjectChars: 255, htmlBytes: 262144, textBytes: 131072, rawBodyBytes: 401408 });
    assert.equal(isMailCategory('reader_otp'), true);
    assert.equal(isMailCategory('marketing'), false);
  });
});

describe('validateMailPayload', () => {
  it('returns exactly the seven normalized contract keys', () => {
    assert.deepEqual(validateMailPayload(valid, config), { ...valid, to: 'reader@example.local' });
  });

  it('rejects missing, extra, and caller-controlled envelope fields', () => {
    const bad = [
      (({ text, ...rest }) => rest)(valid),
      { ...valid, extra: true }, { ...valid, from: 'x@example.local' },
      { ...valid, headers: {} }, { ...valid, attachments: [] },
      { ...valid, cc: 'x@example.local' }, { ...valid, bcc: 'x@example.local' },
    ];
    for (const value of bad) assert.throws(() => validateMailPayload(value, config), /PAYLOAD_INVALID/);
  });

  it('rejects unsafe recipients, subjects, categories, ids, and empty text', () => {
    const changes = [
      { to: 'a@example.local,b@example.local' }, { to: 'Reader <reader@example.local>' },
      { subject: 'hello\r\nBcc: bad@example.local' }, { category: 'marketing' },
      { requestId: 'bad.id' }, { messageId: 'bad@id' }, { text: '' },
    ];
    for (const change of changes) assert.throws(() => validateMailPayload({ ...valid, ...change }, config), /PAYLOAD_INVALID/);
  });

  it('uses UTF-8 byte limits and the subject character limit', () => {
    assert.throws(() => validateMailPayload({ ...valid, subject: 'a'.repeat(256) }, config), /PAYLOAD_INVALID/);
    assert.throws(() => validateMailPayload({ ...valid, html: '\u754c'.repeat(Math.floor(262144 / 3) + 1) }, config), /PAYLOAD_INVALID/);
    assert.throws(() => validateMailPayload({ ...valid, text: '\u754c'.repeat(Math.floor(131072 / 3) + 1) }, config), /PAYLOAD_INVALID/);
  });

  it('enforces an exact local-test recipient allowlist', () => {
    assert.equal(validateMailPayload(valid, localConfig).to, 'reader@example.local');
    assert.equal(validateMailPayload(valid, { ...localConfig, testRecipientAllowlist: ['Reader@Example.Local'] }).to, 'reader@example.local');
    assert.throws(() => validateMailPayload({ ...valid, to: 'other@example.local' }, localConfig), /PAYLOAD_INVALID/);
  });
});

describe('validateOpsEvent', () => {
  const event = Object.freeze({
    eventId: 'ops_01J00000000000000000000000', check: 'public_health', state: 'firing',
    observedAt: '2026-07-13T00:00:00.000Z', summary: 'Public health endpoint failed',
  });
  it('accepts only the exact operations event contract', () => {
    assert.deepEqual(validateOpsEvent(event), event);
    for (const check of ['container_caddy', 'container_pocketbase', 'container_admin_auth', 'public_health', 'backup_age', 'disk_usage']) {
      assert.equal(validateOpsEvent({ ...event, check }).check, check);
    }
    for (const state of ['firing', 'recovered']) assert.equal(validateOpsEvent({ ...event, state }).state, state);
  });
  it('rejects unknown, malformed, extra, and oversized event values', () => {
    const bad = [
      { ...event, check: 'unknown' }, { ...event, state: 'pending' },
      { ...event, observedAt: 'yesterday' }, { ...event, observedAt: '2026-07-13T00:00:00.000Zjunk' },
      { ...event, summary: '' }, { ...event, summary: 'a'.repeat(501) },
      { ...event, eventId: 'bad.event' }, { ...event, extra: true },
    ];
    for (const value of bad) assert.throws(() => validateOpsEvent(value), /PAYLOAD_INVALID/);
  });
});
