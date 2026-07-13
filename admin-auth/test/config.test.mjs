import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { createConfig } from '../src/config.mjs';

describe('createConfig', () => {
  it('includes a default relying party name', () => {
    const previousInternalSecret = process.env.ADMIN_AUTH_INTERNAL_SECRET;
    const previousHashSecret = process.env.ADMIN_AUTH_HASH_SECRET;
    const previousRpName = process.env.ADMIN_AUTH_RP_NAME;
    const previousNodeEnv = process.env.NODE_ENV;
    const previousMailInternalSecret = process.env.MAIL_INTERNAL_SECRET;

    process.env.NODE_ENV = 'production';
    process.env.ADMIN_AUTH_INTERNAL_SECRET = 'i'.repeat(32);
    process.env.ADMIN_AUTH_HASH_SECRET = 'h'.repeat(32);
    process.env.MAIL_INTERNAL_SECRET = 'm'.repeat(32);
    delete process.env.ADMIN_AUTH_RP_NAME;

    try {
      const config = createConfig();
      assert.equal(config.rpName, '个人博客');
    } finally {
      restoreEnv('ADMIN_AUTH_INTERNAL_SECRET', previousInternalSecret);
      restoreEnv('ADMIN_AUTH_HASH_SECRET', previousHashSecret);
      restoreEnv('ADMIN_AUTH_RP_NAME', previousRpName);
      restoreEnv('NODE_ENV', previousNodeEnv);
      restoreEnv('MAIL_INTERNAL_SECRET', previousMailInternalSecret);
    }
  });

  it('rejects non-production mode', () => {
    const previousNodeEnv = process.env.NODE_ENV;
    process.env.NODE_ENV = 'development';

    try {
      assert.throws(() => createConfig(), /NODE_ENV=production/);
    } finally {
      restoreEnv('NODE_ENV', previousNodeEnv);
    }
  });
});

function restoreEnv(key, value) {
  if (value === undefined) {
    delete process.env[key];
    return;
  }

  process.env[key] = value;
}

it('exposes and validates the independent mail HMAC secret', () => {
  const previous = Object.fromEntries([
    'NODE_ENV', 'ADMIN_AUTH_INTERNAL_SECRET', 'ADMIN_AUTH_HASH_SECRET', 'MAIL_INTERNAL_SECRET',
  ].map((key) => [key, process.env[key]]));
  process.env.NODE_ENV = 'production';
  process.env.ADMIN_AUTH_INTERNAL_SECRET = 'i'.repeat(32);
  process.env.ADMIN_AUTH_HASH_SECRET = 'h'.repeat(32);
  process.env.MAIL_INTERNAL_SECRET = 'm'.repeat(32);

  try {
    assert.equal(createConfig().mailInternalSecret, 'm'.repeat(32));
    process.env.MAIL_INTERNAL_SECRET = 'too-short';
    assert.throws(() => createConfig(), /MAIL_INTERNAL_SECRET must be at least 32 characters/);
  } finally {
    for (const [key, value] of Object.entries(previous)) restoreEnv(key, value);
  }
});
