# Admin Step-Up and Passkey Security Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace user-wide reusable admin verification with a short-lived, browser-session-bound Passkey step-up and server-only Passkey management.

**Architecture:** Node `admin-auth` issues and verifies the cryptographic step-up envelope, while PocketBase stores only hashes and enforces the binding on every protected write. Astro keeps the one-time credential and client-session value in `sessionStorage`, installs one same-origin `beforeSend` hook, and uses dedicated Passkey APIs instead of collection CRUD.

**Tech Stack:** PocketBase 0.22.21 JS hooks/migrations, Node.js 22 ESM, `@simplewebauthn/server`, Astro 6, React 19, PocketBase JS SDK 0.27, PowerShell test harnesses.

## Global Constraints

- Do not modify historical migrations; add new timestamped migrations only.
- Step-up format is exactly `v1.<selector>.<secret>`.
- Raw step-up secret and 32-byte `X-Admin-Session` live only in browser `sessionStorage` and are never logged, persisted, placed in URLs, or stored in PocketBase authStore/localStorage.
- Every protected write validates actor, selector, secret HMAC, client-session HMAC, fingerprint, trusted real IP, User-Agent, expiry, and revocation.
- Never fall back to querying any live session by userId alone.
- Passkey/security policy writes require verified `super_admin`, trusted `ADMIN_IP`, and current step-up.
- `admin_passkeys`, `admin_passkey_state`, `admin_step_up_sessions`, and WebAuthn challenge state are server-only collections.
- Remote APIs may not revoke the last active Passkey.
- Existing users with any historical Passkey are marked bootstrapped; zero active Passkeys never reopens bootstrap.
- PocketBase 0.22.21 compatibility is mandatory; do not use APIs introduced in 0.23+.
- Production deployment and real credentials are outside this plan.

---

### Task 1: Implement Node step-up cryptography

**Files:**
- Create: `admin-auth/src/step-up-policy.mjs`
- Create: `admin-auth/test/step-up-policy.test.mjs`
- Modify: `admin-auth/src/server.mjs:93-129`
- Modify: `admin-auth/src/config.mjs:11-40`

**Interfaces:**
- Produces: `createStepUpCredential(binding, options)` and `verifyStepUpCredential(record, binding, hashSecret)`.
- Produces internal routes `POST /internal/step-up/issue` and `POST /internal/step-up/verify` protected by the existing internal request authentication boundary.

- [ ] **Step 1: Write failing issue/verify tests**

```js
import assert from 'node:assert/strict';
import test from 'node:test';
import { createStepUpCredential, verifyStepUpCredential } from '../src/step-up-policy.mjs';

const binding = {
  userId: 'abcdefghijklmno',
  clientSession: 'client-session-value',
  fingerprint: 'fingerprint-value',
  ip: '203.0.113.8',
  userAgent: 'test-agent',
};

test('issues v1 selector secret and stores hashes only', () => {
  const issued = createStepUpCredential(binding, {
    hashSecret: '0123456789abcdef0123456789abcdef',
    sessionTtlSeconds: 900,
    nowMs: 1_750_000_000_000,
  });
  assert.match(issued.credential, /^v1\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/);
  assert.equal('secret' in issued.record, false);
  assert.equal(verifyStepUpCredential(issued.record, { ...binding, credential: issued.credential }, '0123456789abcdef0123456789abcdef', 1_750_000_001_000), true);
});

for (const key of ['clientSession', 'fingerprint', 'ip', 'userAgent']) {
  test(`rejects changed ${key}`, () => {
    const secret = '0123456789abcdef0123456789abcdef';
    const issued = createStepUpCredential(binding, { hashSecret: secret, sessionTtlSeconds: 900, nowMs: 1_750_000_000_000 });
    assert.equal(verifyStepUpCredential(issued.record, { ...binding, [key]: 'changed', credential: issued.credential }, secret, 1_750_000_001_000), false);
  });
}
```

- [ ] **Step 2: Run the focused test and confirm RED**

Run: `Push-Location admin-auth; node --test test/step-up-policy.test.mjs; Pop-Location`

Expected: FAIL with `ERR_MODULE_NOT_FOUND` for `step-up-policy.mjs`.

- [ ] **Step 3: Implement the exact cryptographic contract**

```js
// admin-auth/src/step-up-policy.mjs
import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto';

const b64url = (value) => Buffer.from(value).toString('base64url');
const hmac = (secret, namespace, value) => createHmac('sha256', secret).update(`${namespace}:${value}`).digest('hex');
const equalHex = (left, right) => {
  const a = Buffer.from(String(left), 'hex');
  const b = Buffer.from(String(right), 'hex');
  return a.length === b.length && timingSafeEqual(a, b);
};

export function createStepUpCredential(binding, { hashSecret, sessionTtlSeconds, nowMs = Date.now() }) {
  const selector = b64url(randomBytes(18));
  const secret = b64url(randomBytes(32));
  return {
    credential: `v1.${selector}.${secret}`,
    record: {
      user: binding.userId,
      selector,
      secret_hmac: hmac(hashSecret, 'step-up-secret', secret),
      client_session_hmac: hmac(hashSecret, 'step-up-client-session', binding.clientSession),
      fingerprint_hash: hmac(hashSecret, 'step-up-fingerprint', binding.fingerprint),
      ip_hash: hmac(hashSecret, 'step-up-ip', binding.ip),
      user_agent_hash: hmac(hashSecret, 'step-up-ua', binding.userAgent),
      verified_at: new Date(nowMs).toISOString(),
      expires_at: new Date(nowMs + sessionTtlSeconds * 1000).toISOString(),
      revoked_at: null,
    },
  };
}

export function verifyStepUpCredential(record, binding, hashSecret, nowMs = Date.now()) {
  const parts = String(binding.credential || '').split('.');
  if (parts.length !== 3 || parts[0] !== 'v1' || parts[1] !== record.selector) return false;
  if (record.revoked_at || Date.parse(record.expires_at) <= nowMs || record.user !== binding.userId) return false;
  return equalHex(record.secret_hmac, hmac(hashSecret, 'step-up-secret', parts[2])) &&
    equalHex(record.client_session_hmac, hmac(hashSecret, 'step-up-client-session', binding.clientSession)) &&
    equalHex(record.fingerprint_hash, hmac(hashSecret, 'step-up-fingerprint', binding.fingerprint)) &&
    equalHex(record.ip_hash, hmac(hashSecret, 'step-up-ip', binding.ip)) &&
    equalHex(record.user_agent_hash, hmac(hashSecret, 'step-up-ua', binding.userAgent));
}
```

- [ ] **Step 4: Add authenticated internal routes and run all Node tests**

Run: `Push-Location admin-auth; npm test; Pop-Location`

Expected: all existing tests plus `step-up-policy.test.mjs` PASS; the existing Mailpit-only test may remain skipped outside the integration harness.

- [ ] **Step 5: Commit**

```powershell
git add admin-auth/src/step-up-policy.mjs admin-auth/test/step-up-policy.test.mjs admin-auth/src/server.mjs admin-auth/src/config.mjs
git commit -m "feat(auth): issue browser-bound admin step-up"
```

### Task 2: Add private step-up and bootstrap schema

**Files:**
- Create: `pb_migrations/20260716100000_create_admin_step_up_security.pb.js`
- Modify: `scripts/check-pb-admin-auth.ps1`

**Interfaces:**
- Produces collections `admin_step_up_sessions`, `admin_passkey_state`, and `admin_security_audits`.
- Extends `webauthn_challenges` with `binding_selector` and `client_session_hmac` and purposes `bootstrap_registration`, `add_registration`, `authentication`.

- [ ] **Step 1: Extend the schema checker first**

Add exact required collection and field assertions:

```powershell
$requiredCollections = @('admin_step_up_sessions', 'admin_passkey_state', 'admin_security_audits')
$requiredStepUpFields = @('user','selector','secret_hmac','client_session_hmac','fingerprint_hash','ip_hash','user_agent_hash','verified_at','expires_at','revoked_at')
```

Run: `powershell.exe -NoProfile -File scripts/check-pb-admin-auth.ps1`

Expected: FAIL because the new migration does not exist.

- [ ] **Step 2: Create the additive migration**

The migration must set all API rules to `null`, add unique indexes on `selector` and `admin_passkey_state.user`, add expiry indexes, set `admin_passkeys` list/view/update/delete rules to `null`, and backfill state:

```js
const historical = dao.findRecordsByFilter('admin_passkeys', 'owner != ""', '+created', 5000, 0);
const seen = {};
for (const passkey of historical) {
  const userId = passkey.get('owner');
  if (seen[userId]) continue;
  seen[userId] = true;
  const state = new Record(stateCollection);
  state.set('user', userId);
  state.set('bootstrapped_at', passkey.get('created') || new Date().toISOString());
  dao.saveRecord(state);
}
```

The down migration removes only the newly created collections/fields and restores prior Passkey rules; it must not delete Passkeys.

- [ ] **Step 3: Validate syntax and migration**

Run: `node --check pb_migrations/20260716100000_create_admin_step_up_security.pb.js`

Expected: exit 0.

Run on Linux/Docker: `bash scripts/verify-pocketbase-migrations-linux.sh`

Expected: fresh and upgrade migration paths PASS.

- [ ] **Step 4: Run the schema checker**

Run: `powershell.exe -NoProfile -File scripts/check-pb-admin-auth.ps1`

Expected: PASS and all new rules are verified as private.

- [ ] **Step 5: Commit**

```powershell
git add pb_migrations/20260716100000_create_admin_step_up_security.pb.js scripts/check-pb-admin-auth.ps1
git commit -m "feat(auth): add private admin step-up schema"
```

### Task 3: Enforce the exact step-up on every protected write

**Files:**
- Create: `pb_hooks/lib/admin_step_up.js`
- Create: `tests/admin-security/step_up_fixture.pb.js`
- Create: `scripts/test-admin-step-up.ps1`
- Modify: `pb_hooks/require_verified_session.pb.js:67-118`

**Interfaces:**
- Produces `requireAdminStepUp(ctx, options)` returning `{ actor, actorId, selector, clientSessionHmac, referenceId, clientIp }`.
- Consumes trustworthy `ctx.realIP()` supplied by the network track.

- [ ] **Step 1: Write a temporary-PocketBase failing fixture**

The fixture seeds two users and two browsers, then asserts:

```js
assertStatus(writeWith({ token: tokenB, stepUp: credentialA, clientSession: clientSessionB }), 403);
assertStatus(writeWith({ token: tokenA, stepUp: credentialA, clientSession: clientSessionA }), 200);
assertStatus(writeWith({ token: refreshedTokenA, stepUp: credentialA, clientSession: clientSessionA }), 200);
```

It must also change fingerprint, IP, UA, selector, secret, expiry, and revocation one at a time and expect `403 ADMIN_STEP_UP_REQUIRED`.

Run: `powershell.exe -NoProfile -File scripts/test-admin-step-up.ps1`

Expected: FAIL because `require_verified_session.pb.js` still accepts any live user session.

- [ ] **Step 2: Implement header parsing and exact record verification**

```js
function requireAdminStepUp(ctx, options) {
  const actor = currentActor(ctx);
  const credential = requiredHeader(ctx, 'X-Admin-Step-Up');
  const clientSession = requiredHeader(ctx, 'X-Admin-Session');
  const fingerprint = requiredHeader(ctx, 'X-Browser-Fingerprint');
  const parsed = parseCredential(credential); // exact v1 + selector + secret
  const record = findBySelector(parsed.selector); // one record only
  verifyAllBindingsOrThrow(record, actor, parsed.secret, clientSession, fingerprint, ctx.realIP(), ctx.request().header.get('User-Agent'));
  return secureContext(record, actor, ctx.realIP());
}
```

All lookup/parse/hash/binding failures map to the same `403 ADMIN_STEP_UP_REQUIRED`; logs contain only the random reference ID.

- [ ] **Step 3: Replace the userId existence gate**

Delete `hasLiveVerifiedSession(userId)` from `require_verified_session.pb.js`. For every protected create/update/delete request call `requireAdminStepUp(e.httpContext || e, { requireVerifiedEmail: true })`. Preserve the existing anonymous and reader exclusions and the intentionally permitted safe self-profile fields; role/email/security changes to self must remain protected.

- [ ] **Step 4: Run fixture and hook syntax checks**

Run: `powershell.exe -NoProfile -File scripts/test-admin-step-up.ps1`

Expected: all binding, refresh, expiry and revocation cases PASS.

Run: `Get-ChildItem pb_hooks -Recurse -File -Include *.js | ForEach-Object { node --check $_.FullName }`

Expected: all files exit 0.

- [ ] **Step 5: Commit**

```powershell
git add pb_hooks/lib/admin_step_up.js pb_hooks/require_verified_session.pb.js tests/admin-security/step_up_fixture.pb.js scripts/test-admin-step-up.ps1
git commit -m "fix(auth): bind admin writes to exact step-up"
```

### Task 4: Replace Passkey collection CRUD with dedicated APIs

**Files:**
- Create: `pb_hooks/lib/admin_security_audit.js`
- Create: `pb_hooks/admin_security.pb.js`
- Modify: `pb_hooks/admin_webauthn.pb.js:141-444`
- Modify: `tests/admin-security/step_up_fixture.pb.js`

**Interfaces:**
- Produces the `/api/blog-admin/step-up/*` and `/api/blog-admin/passkeys/*` routes defined in the design.
- Produces sanitized Passkey DTO `{ id, label, created, revokedAt, current }`.

- [ ] **Step 1: Add failing bootstrap and revoke cases**

Test exact cases: existing bootstrapped user with zero active Passkeys cannot bootstrap; concurrent bootstrap verify yields one success; add-registration verify without the initiating step-up fails; list DTO excludes `credential_id` and `public_key`; revoke-last returns `409 LAST_PASSKEY_REQUIRED`; direct collection list/update/delete returns forbidden.

- [ ] **Step 2: Split challenge purposes and bindings**

Store one unexpired challenge per user/purpose, with `binding_selector` and `client_session_hmac`. Options endpoints invalidate prior unexpired challenge for the same tuple before inserting a replacement. Verify consumes the challenge in a transaction and revalidates bootstrap state or the current step-up before saving a Passkey.

- [ ] **Step 3: Implement bootstrap and add-registration state machines**

```js
function registrationMode(dao, userId) {
  const state = findPasskeyState(dao, userId);
  return state && state.get('bootstrapped_at') ? 'add_registration' : 'bootstrap_registration';
}

function requireBootstrapContext(ctx, user) {
  requireVerifiedSuperAdmin(user);
  requireTrustedAdminIp(ctx.realIP());
  if (findPasskeyState($app.dao(), user.id)) throw apiConflict('PASSKEY_ALREADY_BOOTSTRAPPED');
}
```

Bootstrap verify atomically rechecks absence of state, saves the credential, and saves `bootstrapped_at`. Add-registration options and verify both call `requireAdminStepUp`.

- [ ] **Step 4: Implement transaction-coupled security audit**

```js
writeSecurityAudit(txDao, secureContext, {
  actionCode: 'ADMIN_PASSKEY_REVOKED',
  targetType: 'admin_passkey',
  targetId: passkey.id,
  before: { active: true, label: passkey.get('label') },
  after: { active: false, label: passkey.get('label') },
  version: 1,
});
```

If audit save fails, roll back the protected operation.

- [ ] **Step 5: Run the admin security fixture**

Run: `powershell.exe -NoProfile -File scripts/test-admin-step-up.ps1`

Expected: all bootstrap, dedicated API, last-key and direct collection denial cases PASS.

- [ ] **Step 6: Commit**

```powershell
git add pb_hooks/lib/admin_security_audit.js pb_hooks/admin_security.pb.js pb_hooks/admin_webauthn.pb.js tests/admin-security/step_up_fixture.pb.js
git commit -m "fix(auth): secure passkey bootstrap and management"
```

### Task 5: Install the browser session binding once

**Files:**
- Create: `astro/src/lib/admin-step-up.ts`
- Modify: `astro/src/lib/pocketbase.ts:15-38`
- Modify: `astro/src/lib/admin-passkey.ts:11-50`
- Modify: `astro/src/lib/security.ts:239-263`
- Modify: `astro/src/hooks/useAdminAuth.ts:35-94`
- Modify: `astro/src/types/pocketbase.ts:144-157`

**Interfaces:**
- Produces `getAdminClientSession()`, `saveAdminStepUp()`, `clearAdminStepUp()`, and `installAdminStepUpHeaders(pb)`.

- [ ] **Step 1: Add a build-time contract module**

```ts
const STEP_UP_KEY = 'blog.admin.step-up.v1';
const CLIENT_SESSION_KEY = 'blog.admin.client-session.v1';

export function getAdminClientSession(): string {
  let value = sessionStorage.getItem(CLIENT_SESSION_KEY);
  if (!value) {
    const bytes = crypto.getRandomValues(new Uint8Array(32));
    value = btoa(String.fromCharCode(...bytes)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
    sessionStorage.setItem(CLIENT_SESSION_KEY, value);
  }
  return value;
}
```

The installer checks the request URL against `new URL(pb.baseUrl).origin`; only same-origin API calls receive the step-up headers. It composes with the existing `beforeSend` once and never temporarily overwrites it per request.

- [ ] **Step 2: Persist the issued credential after verify**

`requestAdminPasskeyVerification()` sends `X-Admin-Session`, receives `{ verified, credential, expiresAt }`, calls `saveAdminStepUp()`, and returns a typed status. `fetchAdminVerificationStatus()` maps `bootstrap_required`, `verified`, `expired`, and `binding_changed`.

- [ ] **Step 3: Clear binding on logout and user switch**

Call `clearAdminStepUp({ includeClientSession: true })` before `authStore.clear()`. On authStore user ID change, clear the step-up and client session before continuing.

- [ ] **Step 4: Build Astro**

Run: `Push-Location astro; npm run build; Pop-Location`

Expected: build, Pagefind, and service-worker version injection PASS with no TypeScript errors.

- [ ] **Step 5: Commit**

```powershell
git add astro/src/lib/admin-step-up.ts astro/src/lib/pocketbase.ts astro/src/lib/admin-passkey.ts astro/src/lib/security.ts astro/src/hooks/useAdminAuth.ts astro/src/types/pocketbase.ts
git commit -m "feat(admin): bind browser requests to passkey step-up"
```

### Task 6: Move the Passkey UI to sanitized APIs

**Files:**
- Modify: `astro/src/components/admin/PasskeyManager.tsx:21-76`
- Modify: `astro/src/components/auth/AdminPasskeyStep.tsx:14-30`
- Modify: `astro/src/components/admin/AdminGuard.tsx:38-46`
- Modify: `astro/src/hooks/useAdminVerification.ts:11-37`
- Modify: `astro/src/lib/admin-passkey.ts`

**Interfaces:**
- Consumes dedicated Passkey DTOs and step-up statuses from Task 4/5.

- [ ] **Step 1: Add typed API wrappers**

```ts
export type AdminPasskeyDto = { id: string; label: string; created: string; revokedAt: string | null; current: boolean };
export const listAdminPasskeys = () => getPocketBase().send('/api/blog-admin/passkeys', { method: 'GET' }) as Promise<{ items: AdminPasskeyDto[] }>;
export const revokeAdminPasskey = (id: string) => getPocketBase().send(`/api/blog-admin/passkeys/${encodeURIComponent(id)}/revoke`, { method: 'POST' });
```

- [ ] **Step 2: Remove collection calls and sensitive credential display**

Replace `pb.collection('admin_passkeys').getList/update` with wrappers. Do not render credential IDs or public keys. Disable revoke when the DTO indicates the only active credential, while still relying on the server as authority.

- [ ] **Step 3: Render explicit bootstrap state**

`AdminGuard` routes `bootstrap_required` to a bootstrap-only UI available solely on trusted admin IP; other missing/expired states show the normal Passkey step. Binding failures clear local step-up and require a new assertion.

- [ ] **Step 4: Build and run the PocketBase fixture**

Run: `Push-Location astro; npm run build; Pop-Location`

Expected: PASS.

Run: `powershell.exe -NoProfile -File scripts/test-admin-step-up.ps1`

Expected: API DTO and direct collection denial cases PASS.

- [ ] **Step 5: Commit**

```powershell
git add astro/src/components/admin/PasskeyManager.tsx astro/src/components/auth/AdminPasskeyStep.tsx astro/src/components/admin/AdminGuard.tsx astro/src/hooks/useAdminVerification.ts astro/src/lib/admin-passkey.ts
git commit -m "refactor(admin): use dedicated passkey security APIs"
```

### Task 7: Harden local recovery and final verification

**Files:**
- Modify: `scripts/admin-recovery.ps1`
- Modify: `scripts/check-admin-recovery.ps1`
- Modify: `scripts/check-admin-routes.ps1`

- [ ] **Step 1: Add failing recovery assertions**

Require the recovery flow to revoke every `admin_step_up_sessions` row for the user and create an `ADMIN_LOCAL_RECOVERY` high-priority audit. Update the route checker to accept the actual Caddy `handle @blocked_admin_access { respond ... }` form instead of the stale literal check.

- [ ] **Step 2: Implement local-only recovery revocation**

The script must use the existing local/admin-token boundary, never accept a step-up secret as a parameter, and print only counts and a random reference ID.

- [ ] **Step 3: Run the complete track verification**

```powershell
Push-Location admin-auth
npm test
Pop-Location
powershell.exe -NoProfile -File scripts/check-pb-admin-auth.ps1
powershell.exe -NoProfile -File scripts/check-admin-recovery.ps1
powershell.exe -NoProfile -File scripts/check-admin-routes.ps1
powershell.exe -NoProfile -File scripts/test-admin-step-up.ps1
Push-Location astro
npm run build
Pop-Location
```

Expected: every command exits 0; Node suite has zero failures; Astro build succeeds; no secret-bearing output appears.

- [ ] **Step 4: Commit**

```powershell
git add scripts/admin-recovery.ps1 scripts/check-admin-recovery.ps1 scripts/check-admin-routes.ps1
git commit -m "chore(auth): verify step-up recovery boundaries"
```
