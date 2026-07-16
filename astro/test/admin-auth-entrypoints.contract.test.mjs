import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const source = async (path) => readFile(new URL(path, import.meta.url), 'utf8');

test('every browser login entry point revokes the previous admin credential first', async () => {
  const password = await source('../src/components/auth/PasswordLoginForm.tsx');
  const pocketbase = await source('../src/hooks/usePocketBase.ts');
  assert.match(password, /runAfterAdminCredentialRevoked\([\s\S]{0,500}authWithOTP/);
  assert.match(password, /runAfterAdminCredentialRevoked\([\s\S]{0,500}authWithPassword/);
  assert.match(pocketbase, /runAfterAdminCredentialRevoked\([\s\S]{0,500}authWithOTP/);
  assert.match(pocketbase, /runAfterAdminCredentialRevoked\([\s\S]{0,500}authWithPassword/);
});

test('both logout hooks await server revoke instead of directly clearing auth', async () => {
  const admin = await source('../src/hooks/useAdminAuth.ts');
  const publicStatus = await source('../src/hooks/useAuthStatus.ts');
  assert.match(admin, /await revokeCurrentAdminCredential\(pb,/);
  assert.match(publicStatus, /await revokeCurrentAdminCredential\(pb,/);
  assert.doesNotMatch(admin, /finally\s*{[\s\S]*authStore\.clear\(\)/);
  assert.doesNotMatch(publicStatus, /const logout[\s\S]*authStore\.clear\(\)/);
});

test('recovery code is route-scoped and cleared on terminal status or registration result', async () => {
  const headers = await source('../src/lib/admin-step-up.ts');
  const passkeys = await source('../src/lib/admin-passkey.ts');
  assert.match(headers, /isAdminRecoveryHeaderPath\(requestUrl\.pathname\)/);
  assert.doesNotMatch(headers, /if \(recoveryCode\) headers\.set\('X-Admin-Recovery-Code'/);
  assert.match(passkeys, /shouldClearRecoveryCodeAfterStatus\(result\.status\)/);
  assert.match(passkeys, /shouldClearRecoveryCodeAfterRequestError\(error\)/);
  assert.match(passkeys, /if \(result\.verified\) clearAdminRecoveryCode\(\)/);
});
