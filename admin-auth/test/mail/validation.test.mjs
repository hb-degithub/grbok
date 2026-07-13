import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { MAIL_CATEGORIES, MAIL_ERROR_CODES, MAIL_LIMITS, isMailCategory } from '../../src/mail/constants.mjs';

describe('mail constants', () => {
  it('locks the public categories, errors, and byte limits', () => {
    assert.deepEqual(MAIL_CATEGORIES, [
      'account_verification', 'account_password_reset', 'account_email_change',
      'reader_otp', 'comment_new', 'comment_approved', 'comment_reply',
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
