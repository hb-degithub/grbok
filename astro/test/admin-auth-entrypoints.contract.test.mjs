import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const source = async (path) => readFile(new URL(path, import.meta.url), 'utf8');

test('supported browser login entry points revoke old admin state and never restore native OTP or registration bypasses', async () => {
  const password = await source('../src/components/auth/PasswordLoginForm.tsx');
  const pocketbase = await source('../src/hooks/usePocketBase.ts');
  assert.match(password, /runAfterAdminCredentialRevoked\([\s\S]{0,500}authWithPassword/);
  assert.match(password, /MFA_UNSUPPORTED/);
  assert.doesNotMatch(password, /requestOTP|authWithOTP/);
  assert.match(pocketbase, /runAfterAdminCredentialRevoked\([\s\S]{0,500}verifyReaderOtp/);
  assert.match(pocketbase, /registerReaderRequest\(data\)/);
  assert.match(pocketbase, /requestVerificationRequest\(email\)/);
  assert.doesNotMatch(pocketbase, /collection\('users'\)\.(?:create|requestVerification|requestOTP|authWithOTP)/);
});

test('both logout hooks await server revoke instead of directly clearing auth', async () => {
  const admin = await source('../src/hooks/useAdminAuth.ts');
  const publicStatus = await source('../src/hooks/useAuthStatus.ts');
  assert.match(admin, /await revokeCurrentAdminCredential\(pb,/);
  assert.match(publicStatus, /await revokeCurrentAdminCredential\(pb,/);
  assert.doesNotMatch(admin, /finally\s*{[\s\S]*authStore\.clear\(\)/);
  assert.doesNotMatch(publicStatus, /const logout[\s\S]*authStore\.clear\(\)/);
});

test('recovery code is route-scoped and cleared on terminal status or bind result', async () => {
  const headers = await source('../src/lib/admin-step-up.ts');
  const totp = await source('../src/lib/admin-totp.ts');
  assert.match(headers, /isAdminRecoveryHeaderPath\(requestUrl\.pathname\)/);
  assert.doesNotMatch(headers, /if \(recoveryCode\) headers\.set\('X-Admin-Recovery-Code'/);
  // TOTP 时代(Passkey 已下线):状态为终态时清恢复码;绑定成功落 step-up 后清恢复码
  assert.match(totp, /shouldClearRecoveryCodeAfterStatus\(result\.status\)/);
  assert.match(totp, /saveAdminStepUp\(result\.credential, result\.expiresAt\);\s*\n?\s*clearAdminRecoveryCode\(\)/);
});
