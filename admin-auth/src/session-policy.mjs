import { createHmac, timingSafeEqual } from 'node:crypto';

export function hashBinding(value, secret) {
  return createHmac('sha256', secret).update(value).digest('hex');
}

export function createVerifiedSessionRecord({ userId, token, fingerprint, ip, userAgent }, { hashSecret, sessionTtlSeconds }) {
  const now = new Date();
  const expiresAt = new Date(now.getTime() + sessionTtlSeconds * 1000);

  return {
    user_id: userId,
    token_hash: hashBinding(token, hashSecret),
    fingerprint_hash: hashBinding(fingerprint, hashSecret),
    ip_hash: hashBinding(ip, hashSecret),
    user_agent_hash: hashBinding(userAgent, hashSecret),
    verified_at: now.toISOString(),
    expires_at: expiresAt.toISOString(),
    revoked_at: null,
  };
}

export function isVerifiedSessionValid(record, { token, fingerprint, ip, userAgent }, hashSecret) {
  if (!record) return false;
  if (record.revoked_at) return false;
  if (new Date(record.expires_at) <= new Date()) return false;

  const expectedHashes = [
    record.token_hash,
    record.fingerprint_hash,
    record.ip_hash,
    record.user_agent_hash,
  ];
  const actualHashes = [
    hashBinding(token, hashSecret),
    hashBinding(fingerprint, hashSecret),
    hashBinding(ip, hashSecret),
    hashBinding(userAgent, hashSecret),
  ];

  for (let i = 0; i < expectedHashes.length; i++) {
    const expected = expectedHashes[i];
    const actual = actualHashes[i];
    if (expected.length !== actual.length) return false;
    if (!timingSafeEqual(Buffer.from(expected, 'hex'), Buffer.from(actual, 'hex'))) return false;
  }

  return true;
}
