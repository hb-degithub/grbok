import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { createHash, createHmac } from 'node:crypto';
import {
  canonicalMailRequest,
  createMailRequestVerifier,
  signMailRequest,
} from '../../src/mail/request-auth.mjs';

const secret = '0123456789abcdef0123456789abcdef';
const vector = {
  method: 'POST',
  path: '/internal/mail/send',
  timestamp: '1783872000',
  nonce: '0123456789abcdef0123456789abcdef',
  rawBody: Buffer.from('{"requestId":"req_1"}', 'utf8'),
};

describe('canonicalMailRequest', () => {
  it('matches the fixed cross-runtime SHA-256 and HMAC-SHA256 vector', () => {
    const bodyHash = createHash('sha256').update(vector.rawBody).digest('hex');
    const expectedCanonical =
      '1783872000\n0123456789abcdef0123456789abcdef\nPOST\n/internal/mail/send\n' +
      'f325f10b3aaf0e4e98896237f3673856f6942d1fa76c74af6628828afd5747d9';

    assert.equal(bodyHash, 'f325f10b3aaf0e4e98896237f3673856f6942d1fa76c74af6628828afd5747d9');
    assert.equal(canonicalMailRequest(vector), expectedCanonical);
    assert.equal(
      signMailRequest(vector, secret),
      'd214f62e6d24d1ba323e3a10609639e35bf29c079a454e2fd3e5c3d89b9ba4a0',
    );
    assert.equal(
      signMailRequest(vector, secret),
      createHmac('sha256', secret).update(expectedCanonical).digest('hex'),
    );
  });

  it('normalizes the method to uppercase', () => {
    assert.equal(
      canonicalMailRequest({ ...vector, method: 'post' }).split('\n')[2],
      'POST',
    );
  });
});

describe('createMailRequestVerifier', () => {
  it('rejects invalid positive-integer replay cache options at construction', () => {
    const invalidValues = [0, -1, Number.NaN, Number.POSITIVE_INFINITY, 1.5, 2 ** 53];

    for (const option of ['nonceTtlSeconds', 'maxNonces']) {
      for (const value of invalidValues) {
        assert.throws(
          () => verifierWithClock(() => 1783872000, { [option]: value }),
          {
            name: 'RangeError',
            message: option + ' must be a finite safe integer greater than 0',
          },
        );
      }
    }
  });

  it('rejects invalid non-negative integer skew values at construction', () => {
    for (const maxSkewSeconds of [-1, Number.NaN, Number.POSITIVE_INFINITY, 1.5, 2 ** 53]) {
      assert.throws(
        () => verifierWithClock(() => 1783872000, { maxSkewSeconds }),
        {
          name: 'RangeError',
          message: 'maxSkewSeconds must be a finite safe integer greater than or equal to 0',
        },
      );
    }

    assert.doesNotThrow(() => verifierWithClock(() => 1783872000, { maxSkewSeconds: 0 }));
  });

  it('requires nowSeconds to be a function at construction', () => {
    for (const nowSeconds of [undefined, null, 1783872000, '1783872000']) {
      assert.throws(
        () => createMailRequestVerifier({ secret, nowSeconds }),
        { name: 'TypeError', message: 'nowSeconds must be a function' },
      );
    }
  });

  it('rejects non-finite, non-integer, and unsafe nowSeconds results', () => {
    for (const now of [Number.NaN, Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY, 1.5, 2 ** 53]) {
      const verify = verifierWithClock(() => now);

      assert.throws(
        () => verify(signedInput(vector)),
        { name: 'RangeError', message: 'nowSeconds must return a finite safe integer' },
      );
    }
  });

  it('validates the nowSeconds result on every verification', () => {
    const clockValues = [1783872000, Number.NaN];
    const verify = verifierWithClock(() => clockValues.shift());

    assert.deepEqual(verify(signedInput(vector)), { ok: true });
    assert.throws(
      () => verify(signedInput({ ...vector, nonce: 'nonce_second_clock_read' })),
      { name: 'RangeError', message: 'nowSeconds must return a finite safe integer' },
    );
  });

  it('rejects each missing required value', () => {
    const verify = verifierAt(1783872000);
    const valid = signedInput(vector);

    for (const property of ['method', 'path', 'rawBody', 'timestamp', 'nonce', 'signature']) {
      assert.deepEqual(verify({ ...valid, [property]: undefined }), { ok: false, reason: 'missing' });
    }
    for (const property of ['method', 'path', 'timestamp', 'nonce', 'signature']) {
      assert.deepEqual(verify({ ...valid, [property]: '' }), { ok: false, reason: 'missing' });
    }
  });

  it('rejects malformed Unix-second timestamps', () => {
    const verify = verifierAt(1783872000);

    for (const timestamp of ['1783872000.0', '+1783872000', ' 1783872000', '1783872000 ', '-1', 'abc']) {
      assert.deepEqual(
        verify(signedInput({ ...vector, timestamp })),
        { ok: false, reason: 'timestamp' },
      );
    }
  });

  it('accepts 60-second skew and rejects 61-second skew in either direction', () => {
    const now = 1783872000;
    const verify = verifierAt(now);

    for (const timestamp of [String(now - 60), String(now + 60)]) {
      assert.deepEqual(
        verify(signedInput({ ...vector, timestamp, nonce: `nonce_${timestamp}` })),
        { ok: true },
      );
    }
    for (const timestamp of [String(now - 61), String(now + 61)]) {
      assert.deepEqual(
        verify(signedInput({ ...vector, timestamp, nonce: `nonce_${timestamp}` })),
        { ok: false, reason: 'timestamp' },
      );
    }
  });

  it('accepts only 16 through 128 URL-safe nonce characters', () => {
    const verify = verifierAt(1783872000);

    for (const nonce of ['a'.repeat(16), 'A0_-'.repeat(32)]) {
      assert.deepEqual(verify(signedInput({ ...vector, nonce })), { ok: true });
    }
    for (const nonce of [
      'a'.repeat(15),
      'a'.repeat(129),
      'unsafe.nonce.value',
      'unsafe/nonce/value',
      'unsafe nonce value',
      'unsafe\nnonce_value',
      'nonce_安全字符_123456',
    ]) {
      assert.deepEqual(
        verify(signedInput({ ...vector, nonce })),
        { ok: false, reason: 'nonce' },
      );
    }
  });

  it('rejects non-64-hex signatures before constant-time comparison can throw', () => {
    const verify = verifierAt(1783872000);

    for (const signature of ['a'.repeat(62), 'a'.repeat(66), 'g'.repeat(64), '00'.repeat(31) + 'zz']) {
      assert.doesNotThrow(() => verify({ ...vector, signature }));
      assert.deepEqual(verify({ ...vector, signature }), { ok: false, reason: 'signature' });
    }
  });

  it('rejects a wrong well-formed signature', () => {
    const verify = verifierAt(1783872000);

    assert.deepEqual(
      verify({ ...vector, signature: '0'.repeat(64) }),
      { ok: false, reason: 'signature' },
    );
  });

  it('passes a nonce once and rejects its authenticated replay', () => {
    const verify = verifierAt(1783872000);
    const input = signedInput(vector);

    assert.deepEqual(verify(input), { ok: true });
    assert.deepEqual(verify(input), { ok: false, reason: 'replay' });
  });

  it('does not record a nonce when timestamp or signature validation fails', () => {
    const now = 1783872000;
    const verify = verifierAt(now);
    const timestampNonce = 'timestamp_failure_nonce';
    const signatureNonce = 'signature_failure_nonce';

    assert.deepEqual(
      verify(signedInput({ ...vector, timestamp: String(now - 61), nonce: timestampNonce })),
      { ok: false, reason: 'timestamp' },
    );
    assert.deepEqual(
      verify(signedInput({ ...vector, nonce: signatureNonce, signature: '0'.repeat(64) }, false)),
      { ok: false, reason: 'signature' },
    );
    assert.deepEqual(
      verify(signedInput({ ...vector, timestamp: String(now), nonce: timestampNonce })),
      { ok: true },
    );
    assert.deepEqual(verify(signedInput({ ...vector, nonce: signatureNonce })), { ok: true });
  });

  it('allows nonce reuse once its TTL expires', () => {
    let now = 1783872000;
    const verify = verifierWithClock(() => now, { nonceTtlSeconds: 120 });
    const input = () => signedInput({ ...vector, timestamp: String(now) });

    assert.deepEqual(verify(input()), { ok: true });
    now += 119;
    assert.deepEqual(verify(input()), { ok: false, reason: 'replay' });
    now += 1;
    assert.deepEqual(verify(input()), { ok: true });
  });

  it('evicts the oldest nonce when the cache reaches its cap', () => {
    let now = 1783872000;
    const verify = verifierWithClock(() => now, { nonceTtlSeconds: 120, maxNonces: 2 });

    assert.deepEqual(verify(signedAt(now, 'nonce_cache_entry_a')), { ok: true });
    now += 1;
    assert.deepEqual(verify(signedAt(now, 'nonce_cache_entry_b')), { ok: true });
    now += 1;
    assert.deepEqual(verify(signedAt(now, 'nonce_cache_entry_c')), { ok: true });
    now += 1;
    assert.deepEqual(verify(signedAt(now, 'nonce_cache_entry_a')), { ok: true });
  });

  it('cleans expired nonces before deciding whether cap eviction is needed', () => {
    let now = 1783872000;
    const verify = verifierWithClock(() => now, { nonceTtlSeconds: 2, maxNonces: 2 });

    assert.deepEqual(verify(signedAt(now, 'nonce_cleanup_old_a')), { ok: true });
    now += 1;
    assert.deepEqual(verify(signedAt(now, 'nonce_cleanup_live_b')), { ok: true });
    now += 1;
    assert.deepEqual(verify(signedAt(now, 'nonce_cleanup_new_c')), { ok: true });
    assert.deepEqual(
      verify(signedAt(now, 'nonce_cleanup_live_b')),
      { ok: false, reason: 'replay' },
    );
  });
});

function verifierAt(now) {
  return verifierWithClock(() => now);
}

function verifierWithClock(nowSeconds, overrides = {}) {
  return createMailRequestVerifier({ secret, nowSeconds, ...overrides });
}

function signedAt(timestamp, nonce) {
  return signedInput({ ...vector, timestamp: String(timestamp), nonce });
}

function signedInput(input, replaceSignature = true) {
  const candidate = { ...input };
  if (replaceSignature || !candidate.signature) {
    candidate.signature = signMailRequest(candidate, secret);
  }
  return candidate;
}
