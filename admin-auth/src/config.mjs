import { env } from 'node:process';

export function createConfig() {
  // Fail fast in development mode: stack traces and Verbose errors leak
  // internals, and the dev runtime is slower. Production is the only mode
  // this service should run in.
  if (env.NODE_ENV && env.NODE_ENV !== 'production') {
    throw new Error(`admin-auth must run with NODE_ENV=production (got "${env.NODE_ENV}")`);
  }

  const secret = env.ADMIN_AUTH_INTERNAL_SECRET;
  if (!secret || secret.length < 32) {
    throw new Error('ADMIN_AUTH_INTERNAL_SECRET must be at least 32 characters');
  }

  const hashSecret = env.ADMIN_AUTH_HASH_SECRET;
  if (!hashSecret || hashSecret.length < 32) {
    throw new Error('ADMIN_AUTH_HASH_SECRET must be at least 32 characters');
  }

  const rpId = env.ADMIN_AUTH_RP_ID || 'localhost';
  const origin = env.ADMIN_AUTH_ORIGIN || 'http://localhost';
  if (env.NODE_ENV === 'production' && !origin.startsWith('https://') && rpId !== 'localhost') {
    throw new Error('ADMIN_AUTH_ORIGIN must use HTTPS in production');
  }

  return {
    internalSecret: secret,
    hashSecret,
    rpName: env.ADMIN_AUTH_RP_NAME || '个人博客',
    rpId,
    origin,
    sessionTtlSeconds: Math.min(Math.max(parseInt(env.ADMIN_AUTH_SESSION_TTL_SECONDS || '900', 10), 60), 3600),
  };
}
