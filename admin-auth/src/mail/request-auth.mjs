import { createHash, createHmac, timingSafeEqual } from 'node:crypto';

const timestampPattern = /^\d+$/;
const noncePattern = /^[A-Za-z0-9_-]{16,128}$/;
const signaturePattern = /^[a-fA-F0-9]{64}$/;

export function canonicalMailRequest(input) {
  const bodyHash = createHash('sha256').update(input.rawBody).digest('hex');
  return [
    input.timestamp,
    input.nonce,
    String(input.method).toUpperCase(),
    input.path,
    bodyHash,
  ].join('\n');
}

export function signMailRequest(input, secret) {
  return createHmac('sha256', secret).update(canonicalMailRequest(input)).digest('hex');
}

export function createMailRequestVerifier({
  secret,
  nowSeconds = () => Math.floor(Date.now() / 1000),
  maxSkewSeconds = 60,
  nonceTtlSeconds = 120,
  maxNonces = 5000,
} = {}) {
  const nonces = new Map();

  return function verifyMailRequest(input) {
    if (hasMissingValue(input)) {
      return failure('missing');
    }

    if (!timestampPattern.test(input.timestamp)) {
      return failure('timestamp');
    }
    const timestamp = Number(input.timestamp);
    const now = Number(nowSeconds());
    if (!Number.isSafeInteger(timestamp) || Math.abs(now - timestamp) > maxSkewSeconds) {
      return failure('timestamp');
    }

    if (!noncePattern.test(input.nonce)) {
      return failure('nonce');
    }
    if (!signaturePattern.test(input.signature)) {
      return failure('signature');
    }

    const actual = Buffer.from(input.signature, 'hex');
    const expected = Buffer.from(signMailRequest(input, secret), 'hex');
    if (actual.length !== expected.length || !timingSafeEqual(actual, expected)) {
      return failure('signature');
    }

    for (const [nonce, expiresAt] of nonces) {
      if (expiresAt <= now) {
        nonces.delete(nonce);
      }
    }
    if (nonces.has(input.nonce)) {
      return failure('replay');
    }
    while (nonces.size >= maxNonces) {
      nonces.delete(nonces.keys().next().value);
    }
    nonces.set(input.nonce, now + nonceTtlSeconds);

    return { ok: true };
  };
}

function hasMissingValue(input) {
  if (!input || typeof input !== 'object' || !Buffer.isBuffer(input.rawBody)) {
    return true;
  }
  return ['method', 'path', 'timestamp', 'nonce', 'signature']
    .some((property) => typeof input[property] !== 'string' || input[property].length === 0);
}

function failure(reason) {
  return { ok: false, reason };
}
