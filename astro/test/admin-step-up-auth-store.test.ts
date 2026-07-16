import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { transform } from 'esbuild';

async function loadAdminStepUpModule() {
  let source = await readFile(new URL('../src/lib/admin-step-up.ts', import.meta.url), 'utf8');
  source = source
    .replace("import type PocketBase from 'pocketbase';", '')
    .replace("import { getBrowserFingerprint } from './security';", "const getBrowserFingerprint = async () => 'fixture-fingerprint';")
    .replace(
      "import { isAdminRecoveryHeaderPath } from './admin-recovery-header';",
      "const isAdminRecoveryHeaderPath = () => true;",
    );
  const compiled = await transform(source, { loader: 'ts', format: 'esm', target: 'es2022' });
  const url = `data:text/javascript;base64,${Buffer.from(compiled.code).toString('base64')}`;
  return import(url);
}

const adminStepUpModule = loadAdminStepUpModule();

const STEP_UP_KEY = 'blog.admin.step-up.v1';
const CLIENT_SESSION_KEY = 'blog.admin.client-session.v1';
const RECOVERY_CODE_KEY = 'blog.admin.recovery-code.v1';

class MemoryStorage {
  private readonly values = new Map<string, string>();

  getItem(key: string) { return this.values.get(key) ?? null; }
  setItem(key: string, value: string) { this.values.set(key, value); }
  removeItem(key: string) { this.values.delete(key); }
}

async function fixture(initialUserId = 'old-user') {
  const { installAdminStepUpHeaders } = await adminStepUpModule;
  const storage = new MemoryStorage();
  Object.assign(globalThis, { window: { sessionStorage: storage }, sessionStorage: storage });
  storage.setItem(STEP_UP_KEY, JSON.stringify({ credential: 'old-step-up', expiresAt: '2099-01-01T00:00:00.000Z' }));
  storage.setItem(CLIENT_SESSION_KEY, 'old-client-session');
  storage.setItem(RECOVERY_CODE_KEY, 'old-recovery-code');

  let listener: ((token: string, record: { id?: string } | null) => void) | undefined;
  let fireImmediately: boolean | undefined;
  const authStore = {
    token: 'old-token',
    record: { id: initialUserId } as { id?: string } | null,
    onChange(callback: typeof listener, fire = true) {
      listener = callback;
      fireImmediately = fire;
      return () => {};
    },
  };
  const pb = {
    baseUrl: 'https://example.test',
    authStore,
    beforeSend: undefined,
  };
  installAdminStepUpHeaders(pb as never);
  return {
    storage,
    authStore,
    emit: (token: string, record: { id?: string } | null) => listener?.(token, record),
    fireImmediately: () => fireImmediately,
  };
}

function assertAdminSessionCleared(storage: MemoryStorage) {
  assert.equal(storage.getItem(STEP_UP_KEY), null);
  assert.equal(storage.getItem(CLIENT_SESSION_KEY), null);
  assert.equal(storage.getItem(RECOVERY_CODE_KEY), null);
}

test('external authStore clear invalidates tab-local step-up, client session, and recovery code', async () => {
  const current = await fixture();
  assert.equal(current.fireImmediately(), false);
  current.authStore.token = '';
  current.authStore.record = null;
  current.emit('', null);
  assertAdminSessionCleared(current.storage);
});

test('external user switch invalidates old tab-local admin credentials', async () => {
  const current = await fixture();
  current.authStore.token = 'new-token';
  current.authStore.record = { id: 'new-user' };
  current.emit('new-token', { id: 'new-user' });
  assertAdminSessionCleared(current.storage);
});

test('same-user auth refresh retains the current tab step-up binding', async () => {
  const current = await fixture();
  current.authStore.token = 'refreshed-token';
  current.emit('refreshed-token', { id: 'old-user' });
  assert.equal(current.storage.getItem(CLIENT_SESSION_KEY), 'old-client-session');
  assert.equal(current.storage.getItem(RECOVERY_CODE_KEY), 'old-recovery-code');
  assert.match(current.storage.getItem(STEP_UP_KEY) || '', /old-step-up/);
});
