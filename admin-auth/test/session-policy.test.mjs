import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { hashBinding, createVerifiedSessionRecord, isVerifiedSessionValid } from '../src/session-policy.mjs';

const hashSecret = 'a'.repeat(32);
const policy = { hashSecret, sessionTtlSeconds: 900 };

describe('hashBinding', () => {
  it('produces stable HMAC hex strings', () => {
    const a = hashBinding('same', hashSecret);
    const b = hashBinding('same', hashSecret);
    assert.equal(a, b);
    assert.match(a, /^[0-9a-f]{64}$/);
  });

  it('does not include plaintext in output', () => {
    const out = hashBinding('super-secret-token', hashSecret);
    assert.equal(out.includes('super-secret-token'), false);
    assert.equal(out.includes(hashSecret), false);
  });
});

describe('createVerifiedSessionRecord', () => {
  it('includes required fields', () => {
    const record = createVerifiedSessionRecord({
      userId: 'user123',
      token: 'token',
      fingerprint: 'fp',
      ip: '127.0.0.1',
      userAgent: 'Mozilla/5.0',
    }, policy);

    assert.equal(record.user_id, 'user123');
    assert.equal(typeof record.token_hash, 'string');
    assert.equal(typeof record.fingerprint_hash, 'string');
    assert.equal(typeof record.ip_hash, 'string');
    assert.equal(typeof record.user_agent_hash, 'string');
    assert.ok(record.verified_at);
    assert.ok(record.expires_at);
    assert.equal(record.revoked_at, null);
  });

  it('expires after the configured TTL', () => {
    const now = Date.now();
    const record = createVerifiedSessionRecord({
      userId: 'user123',
      token: 'token',
      fingerprint: 'fp',
      ip: '127.0.0.1',
      userAgent: 'UA',
    }, policy);

    const expires = new Date(record.expires_at).getTime();
    const expected = now + 900 * 1000;
    assert.ok(expires >= expected - 1000 && expires <= expected + 1000);
  });
});

describe('isVerifiedSessionValid', () => {
  it('accepts matching bindings', () => {
    const inputs = {
      userId: 'user123',
      token: 'token',
      fingerprint: 'fp',
      ip: '127.0.0.1',
      userAgent: 'UA',
    };
    const record = createVerifiedSessionRecord(inputs, policy);
    assert.equal(isVerifiedSessionValid(record, inputs, hashSecret), true);
  });

  it('rejects mismatched token', () => {
    const inputs = {
      userId: 'user123',
      token: 'token',
      fingerprint: 'fp',
      ip: '127.0.0.1',
      userAgent: 'UA',
    };
    const record = createVerifiedSessionRecord(inputs, policy);
    assert.equal(isVerifiedSessionValid(record, { ...inputs, token: 'other' }, hashSecret), false);
  });

  it('rejects expired sessions', () => {
    const inputs = {
      userId: 'user123',
      token: 'token',
      fingerprint: 'fp',
      ip: '127.0.0.1',
      userAgent: 'UA',
    };
    const shortPolicy = { hashSecret, sessionTtlSeconds: -1 };
    const record = createVerifiedSessionRecord(inputs, shortPolicy);
    assert.equal(isVerifiedSessionValid(record, inputs, hashSecret), false);
  });

  it('rejects revoked sessions', () => {
    const inputs = {
      userId: 'user123',
      token: 'token',
      fingerprint: 'fp',
      ip: '127.0.0.1',
      userAgent: 'UA',
    };
    const record = createVerifiedSessionRecord(inputs, policy);
    record.revoked_at = new Date().toISOString();
    assert.equal(isVerifiedSessionValid(record, inputs, hashSecret), false);
  });
});
