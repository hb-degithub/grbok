import assert from 'node:assert/strict';
import test from 'node:test';
import {
  ADMIN_CREDENTIAL_REVOKE_FAILED,
  revokeCurrentAdminCredential,
  runAfterAdminCredentialRevoked,
} from '../src/lib/admin-auth-lifecycle.ts';

function client(sendImpl: () => Promise<unknown>) {
  const observed: string[] = [];
  const authStore = {
    token: 'old-token',
    record: { id: 'old-user' },
    clear() {
      observed.push('auth-clear');
      this.token = '';
      this.record = null as unknown as { id: string };
    },
  };
  return {
    observed,
    pb: {
      authStore,
      async send(path: string, options: { method: string }) {
        observed.push(`send:${path}:${options.method}:${authStore.token}`);
        return sendImpl();
      },
    },
  };
}

test('successful server revoke clears local step-up and auth only after confirmation', async () => {
  const fixture = client(async () => ({ revoked: true }));
  await revokeCurrentAdminCredential(fixture.pb, () => fixture.observed.push('step-up-clear'));
  assert.deepEqual(fixture.observed, [
    'send:/api/blog-admin/step-up/revoke:POST:old-token',
    'step-up-clear',
    'auth-clear',
  ]);
});

test('401 or 403 is an explicit server confirmation that the credential is invalid', async () => {
  for (const status of [401, 403]) {
    const fixture = client(async () => { throw { status }; });
    await revokeCurrentAdminCredential(fixture.pb, () => fixture.observed.push('step-up-clear'));
    assert.deepEqual(fixture.observed.slice(-2), ['step-up-clear', 'auth-clear']);
  }
});

test('network and 5xx failures retain every local credential and throw a stable error', async () => {
  for (const failure of [new Error('offline'), { status: 500, message: 'audit failed' }]) {
    const fixture = client(async () => { throw failure; });
    await assert.rejects(
      revokeCurrentAdminCredential(fixture.pb, () => fixture.observed.push('step-up-clear')),
      (error: unknown) => {
        assert.equal((error as { code?: string }).code, ADMIN_CREDENTIAL_REVOKE_FAILED);
        return true;
      },
    );
    assert.equal(fixture.pb.authStore.token, 'old-token');
    assert.equal(fixture.pb.authStore.record?.id, 'old-user');
    assert.equal(fixture.observed.includes('step-up-clear'), false);
    assert.equal(fixture.observed.includes('auth-clear'), false);
  }
});

test('a login operation starts only after the old token and step-up were revoked', async () => {
  const fixture = client(async () => ({ revoked: true }));
  const result = await runAfterAdminCredentialRevoked(
    fixture.pb,
    () => fixture.observed.push('step-up-clear'),
    async () => {
      fixture.observed.push(`login:${fixture.pb.authStore.token || 'empty'}`);
      return 'new-session';
    },
  );
  assert.equal(result, 'new-session');
  assert.deepEqual(fixture.observed, [
    'send:/api/blog-admin/step-up/revoke:POST:old-token',
    'step-up-clear',
    'auth-clear',
    'login:empty',
  ]);
});
