import { env } from 'node:process';

export function createConfig() {
  const secret = env.ADMIN_AUTH_INTERNAL_SECRET;
  if (!secret || secret.length < 32) {
    throw new Error('ADMIN_AUTH_INTERNAL_SECRET must be at least 32 characters');
  }

  const hashSecret = env.ADMIN_AUTH_HASH_SECRET;
  if (!hashSecret || hashSecret.length < 32) {
    throw new Error('ADMIN_AUTH_HASH_SECRET must be at least 32 characters');
  }

  return {
    internalSecret: secret,
    hashSecret,
    rpName: env.ADMIN_AUTH_RP_NAME || '个人博客',
    rpId: env.ADMIN_AUTH_RP_ID || 'localhost',
    origin: env.ADMIN_AUTH_ORIGIN || 'http://localhost',
    sessionTtlSeconds: parseInt(env.ADMIN_AUTH_SESSION_TTL_SECONDS || '900', 10),
  };
}
