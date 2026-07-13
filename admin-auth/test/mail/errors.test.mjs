import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { MailError, classifySmtpError } from '../../src/mail/errors.mjs';

describe('MailError', () => {
  it('exposes only stable public fields and hides its cause', () => {
    const cause = new Error('smtp.example secret response');
    const error = new MailError('SMTP_AUTH', false, cause);
    const unknown = new MailError('__proto__', false, cause);
    assert.deepEqual({ ...error }, {
      code: 'SMTP_AUTH', retryable: false, message: 'SMTP authentication failed',
    });
    assert.equal(error.cause, cause);
    assert.equal(Object.keys(error).includes('cause'), false);
    assert.doesNotMatch(JSON.stringify(error), /secret|smtp\.example/);
  });
});

describe('classifySmtpError', () => {
  it('falls back to INTERNAL_ERROR when response code coercion is hostile', () => {
    const cases = [
      { responseCode: Symbol('smtp') },
      { responseCode: { valueOf() { throw new Error('provider getter secret'); } } },
      Object.defineProperty({}, 'code', { get() { throw new Error('provider code secret'); } }),
    ];
    for (const input of cases) {
      const classified = classifySmtpError(input);
      assert.deepEqual([classified.code, classified.retryable], ['INTERNAL_ERROR', true]);
      assert.equal(classified.cause, input);
    }
  });

  it('maps provider errors to stable codes and retry policy', () => {
    const cases = [
      [{ code: 'EAUTH' }, ['SMTP_AUTH', false]],
      [{ code: 'ETIMEDOUT' }, ['SMTP_TIMEOUT', true]],
      [{ code: 'ECONNECTION' }, ['SMTP_CONNECTION', true]],
      [{ responseCode: 421 }, ['RATE_LIMITED', true]],
      [{ responseCode: 450 }, ['RECIPIENT_TEMPORARY', true]],
      [{ responseCode: 550 }, ['RECIPIENT_PERMANENT', false]],
      [{ code: 'UNKNOWN' }, ['INTERNAL_ERROR', true]],
    ];
    for (const [input, expected] of cases) {
      const classified = classifySmtpError(input);
      assert.deepEqual([classified.code, classified.retryable], expected);
      assert.equal(classified.cause, input);
    }
  });
});
