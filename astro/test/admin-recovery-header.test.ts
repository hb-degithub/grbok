import assert from 'node:assert/strict';
import test from 'node:test';
import {
  isAdminRecoveryHeaderPath,
  shouldClearRecoveryCodeAfterRequestError,
  shouldClearRecoveryCodeAfterStatus,
} from '../src/lib/admin-recovery-header.ts';

test('recovery code header is limited to status and TOTP setup/confirm', () => {
  // TOTP 时代(2026-09 替代 Passkey):一次性恢复码只允许随状态查询与绑定相关请求发出
  for (const path of [
    '/api/blog-admin/step-up/status',
    '/api/blog-admin/totp/setup',
    '/api/blog-admin/totp/confirm',
  ]) {
    assert.equal(isAdminRecoveryHeaderPath(path), true, path);
  }

  for (const path of [
    '/api/blog-admin/step-up/options',
    '/api/blog-admin/step-up/verify',
    '/api/blog-admin/step-up/revoke',
    '/api/blog-admin/totp/verify',
    '/api/blog-admin/totp/revoke',
    '/api/blog-admin/passkeys',
    '/api/blog-admin/passkeys/registration/options',
    '/api/collections/settings/records',
    '/api/collections/users/auth-refresh',
  ]) {
    assert.equal(isAdminRecoveryHeaderPath(path), false, path);
  }
});

test('only an active recovery status retains the one-time recovery code', () => {
  assert.equal(shouldClearRecoveryCodeAfterStatus('recovery_reenroll'), false);
  for (const status of ['expired', 'binding_changed', 'verified', 'bootstrap_required']) {
    assert.equal(shouldClearRecoveryCodeAfterStatus(status), true, status);
  }
});

test('server rejection clears an invalid or expired recovery code without consuming it on transient failures', () => {
  assert.equal(shouldClearRecoveryCodeAfterRequestError({ status: 401 }), true);
  assert.equal(shouldClearRecoveryCodeAfterRequestError({ response: { status: 403 } }), true);
  assert.equal(shouldClearRecoveryCodeAfterRequestError({ status: 500 }), false);
  assert.equal(shouldClearRecoveryCodeAfterRequestError(new Error('offline')), false);
});
