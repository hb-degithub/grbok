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

export function createMailRequestVerifier(options = {}) {
  if (!options || typeof options !== 'object' || Array.isArray(options)) {
    throw new TypeError('options must be an object');
  }

  const { secret } = options;
  const nowSeconds = optionOrDefault(options, 'nowSeconds', () => Math.floor(Date.now() / 1000));
  const maxSkewSeconds = optionOrDefault(options, 'maxSkewSeconds', 60);
  const nonceTtlSeconds = optionOrDefault(options, 'nonceTtlSeconds', 120);
  const maxNonces = optionOrDefault(options, 'maxNonces', 5000);

  if (typeof nowSeconds !== 'function') {
    throw new TypeError('nowSeconds must be a function');
  }
  assertNonNegativeSafeInteger('maxSkewSeconds', maxSkewSeconds);
  assertPositiveSafeInteger('nonceTtlSeconds', nonceTtlSeconds);
  assertPositiveSafeInteger('maxNonces', maxNonces);

  const nonces = new Map();

  return function verifyMailRequest(input) {
    if (hasMissingValue(input)) {
      return failure('missing');
    }

    if (!timestampPattern.test(input.timestamp)) {
      return failure('timestamp');
    }
    const timestamp = Number(input.timestamp);
    const now = nowSeconds();
    if (!Number.isSafeInteger(now)) {
      throw new RangeError('nowSeconds must return a finite safe integer');
    }
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
    const expiresAt = now + nonceTtlSeconds;
    if (!Number.isSafeInteger(expiresAt)) {
      throw new RangeError('nonce expiry must be a finite safe integer');
    }
    nonces.set(input.nonce, expiresAt);

    return { ok: true };
  };
}

function optionOrDefault(options, name, defaultValue) {
  return Object.prototype.hasOwnProperty.call(options, name) ? options[name] : defaultValue;
}

function assertNonNegativeSafeInteger(name, value) {
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new RangeError(name + ' must be a finite safe integer greater than or equal to 0');
  }
}

function assertPositiveSafeInteger(name, value) {
  if (!Number.isSafeInteger(value) || value <= 0) {
    throw new RangeError(name + ' must be a finite safe integer greater than 0');
  }
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
