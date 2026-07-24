import assert from 'node:assert/strict';
import test from 'node:test';
import { createStepUpCredential, verifyStepUpCredential } from '../src/step-up-policy.mjs';

const binding = {
  userId: 'abcdefghijklmno',
  clientSession: 'client-session-value',
  fingerprint: 'fingerprint-value',
  ip: '203.0.113.8',
  userAgent: 'test-agent',
};

test('issues v1 selector secret and stores hashes only', () => {
  const issued = createStepUpCredential(binding, {
    hashSecret: '0123456789abcdef0123456789abcdef',
    sessionTtlSeconds: 900,
    nowMs: 1_750_000_000_000,
  });

  assert.match(issued.credential, /^v1\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/);
  assert.equal('secret' in issued.record, false);
  assert.equal(
    verifyStepUpCredential(
      issued.record,
      { ...binding, credential: issued.credential },
      '0123456789abcdef0123456789abcdef',
      1_750_000_001_000,
    ),
    true,
  );
});

for (const key of ['clientSession', 'fingerprint', 'ip', 'userAgent']) {
  test(`rejects changed ${key}`, () => {
    const secret = '0123456789abcdef0123456789abcdef';
    const issued = createStepUpCredential(binding, {
      hashSecret: secret,
      sessionTtlSeconds: 900,
      nowMs: 1_750_000_000_000,
    });

    assert.equal(
      verifyStepUpCredential(
        issued.record,
        { ...binding, [key]: 'changed', credential: issued.credential },
        secret,
        1_750_000_001_000,
      ),
      false,
    );
  });
}
