import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { createConfig } from '../src/config.mjs';

describe('createConfig', () => {
  it('includes a default relying party name', () => {
    const previousInternalSecret = process.env.ADMIN_AUTH_INTERNAL_SECRET;
    const previousHashSecret = process.env.ADMIN_AUTH_HASH_SECRET;
    const previousRpName = process.env.ADMIN_AUTH_RP_NAME;

    process.env.ADMIN_AUTH_INTERNAL_SECRET = 'i'.repeat(32);
    process.env.ADMIN_AUTH_HASH_SECRET = 'h'.repeat(32);
    delete process.env.ADMIN_AUTH_RP_NAME;

    try {
      const config = createConfig();
      assert.equal(config.rpName, '个人博客');
    } finally {
      restoreEnv('ADMIN_AUTH_INTERNAL_SECRET', previousInternalSecret);
      restoreEnv('ADMIN_AUTH_HASH_SECRET', previousHashSecret);
      restoreEnv('ADMIN_AUTH_RP_NAME', previousRpName);
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
