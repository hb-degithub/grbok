# Security Rate Limits, Registration, and Mail Routing Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add durable exact rolling limits, close registration and account-mail bypasses, preserve anti-enumeration responses, and deliver trustworthy client IPs to PocketBase.

**Architecture:** A private SQLite policy/bucket module performs atomic all-or-none consumption for every protected action. Public registration and account-mail operations move behind dedicated facades, all real mail leaves through the signed gateway/outbox, and OpenResty/Caddy normalize the client IP chain before PocketBase calls `e.realIP()`.

**Tech Stack:** PocketBase 0.22.21 JS hooks/migrations, SQLite transactions, Astro 6/React 19, OpenResty/Nginx, Caddy, Node `admin-auth` mail gateway, PowerShell temporary-PocketBase harnesses.

## Global Constraints

- Exact account-mail defaults: email `2/900s`, IP `5/900s`, global `30/60s`.
- Registration defaults: IP `3/3600s`, IPv6 `/64` `10/3600s`, global `20/60s`.
- Use exact rolling windows, not fixed windows.
- Check all relevant buckets in one transaction; any full bucket means zero bucket writes and no business action.
- Rejected requests do not append events, extend expiry, create logs, or create OTP challenges.
- Bucket keys are HMACs; never store raw email or raw IP.
- Public valid account-mail requests return uniform `202 MAIL_REQUEST_ACCEPTED` with a random 128-bit `referenceId`; invalid syntax returns `400 INVALID_REQUEST`.
- Unknown/noneligible identities consume allowed public quotas before identity lookup but never create persistent decoy data.
- Registration limiter failure returns `503 REGISTRATION_UNAVAILABLE` and creates no account.
- No direct PocketBase SMTP or public native registration/account-mail request path may remain.
- Policy writes require Agent A's `requireAdminStepUp()` and transaction-coupled audit.
- Do not edit historical migrations.
- PocketBase 0.22.21 compatibility is mandatory.

---

### Task 1: Create private policy and bucket schema

**Files:**
- Create: `pb_migrations/20260716110000_create_security_rate_limits.pb.js`
- Create: `pb_hooks/lib/security_policy_store.js`
- Create: `tests/security-rate/policy_fixture.pb.js`
- Create: `scripts/test-security-rate-local.ps1`

**Interfaces:**
- Produces `getRatePolicySet(dao)` and `replaceRatePolicySet(txDao, input)`.
- Produces fixed policy keys used by all tracks.

- [ ] **Step 1: Write a failing schema/policy fixture**

Assert private rules, unique `(policy, subject_hash)`, expiry index, strict defaults, and rejection of zero/negative/unknown/out-of-range policies:

```js
assertPolicy('account_mail_email', 2, 900);
assertPolicy('account_mail_ip', 5, 900);
assertPolicy('account_mail_global', 30, 60);
assertReject({ key: 'account_mail_email', limit: 0, windowSeconds: 900 }, 'POLICY_OUT_OF_SAFE_RANGE');
assertReject({ key: 'custom_expression', limit: 1, windowSeconds: 60 }, 'POLICY_OUT_OF_SAFE_RANGE');
```

Run: `powershell.exe -NoProfile -File scripts/test-security-rate-local.ps1 -Fixture policy`

Expected: FAIL because the collections and module do not exist.

- [ ] **Step 2: Create the additive schema and seed defaults**

`security_rate_policies` fields: `key`, `limit`, `window_seconds`, `version`, `updated_by`, `updated_at`. `security_rate_buckets` fields: `policy`, `subject_hash`, `events_json`, `expires_at`. Set all API rules to `null`.

Seed exact fixed keys:

```js
const DEFAULTS = {
  account_mail_email: [2, 900], account_mail_ip: [5, 900], account_mail_global: [30, 60],
  registration_ip: [3, 3600], registration_ipv6_64: [10, 3600], registration_global: [20, 60],
  admin_test_actor: [3, 3600], admin_test_global: [10, 86400],
  admin_security_write: [5, 3600],
  comment_notification: [60, 60], account_retention_notice: [10, 60], outbound_global: [60, 60],
};
```

- [ ] **Step 3: Implement safe range and CAS storage**

```js
function replaceRatePolicySet(txDao, input) {
  const current = getRatePolicySet(txDao);
  if (current.version !== input.expectedVersion) throw coded('POLICY_VERSION_CONFLICT');
  const normalized = validateExactPolicySet(input.policies);
  saveAllInTransaction(txDao, normalized, current.version + 1, input.actorId, input.now);
  return { version: current.version + 1, policies: normalized };
}
```

Hard bounds match the approved spec and must be encoded in a constant map, not read from the request.

- [ ] **Step 4: Validate fixture and migration**

Run: `powershell.exe -NoProfile -File scripts/test-security-rate-local.ps1 -Fixture policy`

Expected: PASS.

Run: `bash scripts/verify-pocketbase-migrations-linux.sh`

Expected: fresh and upgrade paths PASS.

- [ ] **Step 5: Commit**

```powershell
git add pb_migrations/20260716110000_create_security_rate_limits.pb.js pb_hooks/lib/security_policy_store.js tests/security-rate/policy_fixture.pb.js scripts/test-security-rate-local.ps1
git commit -m "feat(security): add durable rate policy schema"
```

### Task 2: Implement exact rolling buckets with concurrency tests

**Files:**
- Create: `pb_hooks/lib/security_rate_limit.js`
- Create: `tests/security-rate/rate_fixture.pb.js`
- Modify: `scripts/test-security-rate-local.ps1`

**Interfaces:**
- Produces `consume(txDao, { nowMs, entries })`, `normalizeEmail`, `normalizeIp`, and `ipv6Prefix64`.

- [ ] **Step 1: Write failing boundary, corruption, and concurrency tests**

```js
const result = rateLimit.consume(txDao, {
  nowMs,
  entries: [
    { policyKey: 'account_mail_email', subject: normalizedEmail },
    { policyKey: 'account_mail_ip', subject: normalizedIp },
    { policyKey: 'account_mail_global', subject: 'v1' },
  ],
});
assertEqual(result.allowed, expected);
```

The harness sends 20 concurrent requests to an empty bucket and asserts exactly 2 email successes, at most 5 IP successes, and no partial writes after an injected save failure. Add exact boundary `timestamp === now-window` expiry, restart persistence, malformed JSON, >300 elements, >16 KiB, noninteger, unsorted, and future-time cases.

Run: `powershell.exe -NoProfile -File scripts/test-security-rate-local.ps1 -Fixture rate`

Expected: FAIL because `security_rate_limit.js` is missing.

- [ ] **Step 2: Implement strict parsing and pruning**

```js
function parseEvents(raw, nowMs) {
  if (typeof raw !== 'string' || raw.length > 16384) throw unavailable();
  const values = JSON.parse(raw || '[]');
  if (!Array.isArray(values) || values.length > 300) throw unavailable();
  let previous = -1;
  for (const value of values) {
    if (!Number.isSafeInteger(value) || value < previous || value > nowMs + 5000) throw unavailable();
    previous = value;
  }
  return values;
}
```

- [ ] **Step 3: Implement all-or-none consumption inside caller transaction**

```js
function consume(txDao, input) {
  const prepared = input.entries.map((entry) => loadAndPrune(txDao, entry, input.nowMs));
  const limited = prepared.find((item) => item.events.length >= item.policy.limit);
  if (limited) return { allowed: false, limitedBy: limited.policy.key, retryAfterSeconds: retryAfter(limited, input.nowMs) };
  for (const item of prepared) saveBucket(txDao, item, input.nowMs);
  return { allowed: true, limitedBy: null, retryAfterSeconds: 0 };
}
```

First-create unique conflicts retry within the same transaction using a fresh read; persistent conflicts or SQLite busy throw `RateLimitUnavailableError`.

- [ ] **Step 4: Run rate fixture twice, including restart phase**

Run: `powershell.exe -NoProfile -File scripts/test-security-rate-local.ps1 -Fixture rate -RestartPocketBase`

Expected: PASS; quotas remain consumed after restart.

- [ ] **Step 5: Commit**

```powershell
git add pb_hooks/lib/security_rate_limit.js tests/security-rate/rate_fixture.pb.js scripts/test-security-rate-local.ps1
git commit -m "feat(security): enforce exact rolling SQLite limits"
```

### Task 3: Minimize delivery logs and rewrite account-mail/OTP flow

**Files:**
- Create: `pb_migrations/20260716111000_minimize_mail_delivery_logs.pb.js`
- Create: `pb_hooks/lib/public_errors.js`
- Create: `astro/src/pages/help/mail-errors.astro`
- Modify: `pb_hooks/lib/mail_logs.js:3-105`
- Modify: `pb_hooks/lib/auth_facade.js:140-496`
- Modify: `pb_hooks/lib/auth_otp.js:11-311`
- Modify: `pb_hooks/blog_auth.pb.js:4-85`
- Create: `tests/security-rate/account_mail_fixture.pb.js`

**Interfaces:**
- Produces minimal `mailLogs.delivery({ event_id, category, source_kind, result, duration_ms, attempt, error_class })`.
- Produces public response helpers with random 128-bit `referenceId` and minimum 350ms completion.

- [ ] **Step 1: Write failing public parity and zero-write tests**

Test existing, missing, noneligible, email-limited, IP-limited, global-limited, SQLite unavailable, and gateway failure. For valid public requests assert status, keys, code, message byte length, and elapsed time are equal; assert no delivery log/challenge is written for missing/noneligible/limited/unavailable cases. OTP returns a fake random challenge ID without persisting it.

- [ ] **Step 2: Add the minimal log migration**

Create the final fields `event_id`, `category`, `source_kind`, `result`, `duration_ms`, `attempt`, `error_class`, `archive_batch_id`, `created`. Migrate historical rows to random `event_id` and fixed enum summaries, clear old sensitive values, then remove `source_record_id`, `recipient_masked`, `recipient_hash`, `request_ip_hash`, `rate_limited`, and `decoy` fields in the new migration only.

- [ ] **Step 3: Replace log-based reservations with bucket consumption**

```js
const limit = $app.runInTransaction((txDao) => rateLimit.consume(txDao, {
  nowMs,
  entries: accountMailEntries(normalizedEmail, normalizedIp),
}));
if (!limit.allowed) return publicErrors.accepted(startedAt, referenceId);
```

Only after an eligible identity and real gateway attempt call `mailLogs.delivery()`. Remove `rateCount`, reservation logs, decoy logs, and rate-limited log updates.

- [ ] **Step 4: Make OTP fake challenges ephemeral**

Create `auth_otp_challenges` only after all buckets allow and the user is an eligible verified reader. Otherwise generate a random response challenge ID in memory, return the same `202`, and let verification naturally return the existing uniform invalid-code result.

- [ ] **Step 5: Publish stable user-facing error references**

Create `/help/mail-errors` with anchors for `INVALID_REQUEST`, `MAIL_REQUEST_ACCEPTED`, `REQUEST_RATE_LIMITED`, `EMAIL_RATE_LIMITED`, `IP_RATE_LIMITED`, `GLOBAL_RATE_LIMITED`, `INVALID_REGISTRATION`, `REGISTRATION_RATE_LIMITED`, and `REGISTRATION_UNAVAILABLE`. Each entry states the safe user action and intentionally does not reveal account existence, current counts, internal provider details, or security implementation.

- [ ] **Step 6: Run account-mail fixture and syntax checks**

Run: `powershell.exe -NoProfile -File scripts/test-security-rate-local.ps1 -Fixture account_mail`

Expected: parity, quota sharing, fake challenge, zero-write, and log minimization tests PASS.

Run: `Get-ChildItem pb_hooks,pb_migrations -Recurse -File -Include *.js | ForEach-Object { node --check $_.FullName }`

Expected: exit 0 for every file.

- [ ] **Step 7: Commit**

```powershell
git add pb_migrations/20260716111000_minimize_mail_delivery_logs.pb.js pb_hooks/lib/public_errors.js pb_hooks/lib/mail_logs.js pb_hooks/lib/auth_facade.js pb_hooks/lib/auth_otp.js pb_hooks/blog_auth.pb.js tests/security-rate/account_mail_fixture.pb.js astro/src/pages/help/mail-errors.astro
git commit -m "fix(mail): stop persistent writes for rejected requests"
```

### Task 4: Add the durable registration facade

**Files:**
- Create: `pb_hooks/lib/registration_facade.js`
- Create: `pb_hooks/blog_register.pb.js`
- Create: `pb_hooks/lib/registration_mode.js`
- Create: `tests/security-rate/registration_fixture.pb.js`
- Modify: `scripts/test-security-rate-local.ps1`
- Modify: `astro/src/hooks/usePocketBase.ts:80-100`
- Create: `astro/src/lib/blog-auth-client.ts`
- Modify: `astro/src/components/auth/RegisterForm.tsx:37-90`
- Modify: `astro/src/components/effects/WelcomeOverlay.tsx:110-168`
- Modify: `astro/src/components/admin/AdminEmailVerificationRequired.tsx:18`
- Modify: `astro/src/components/auth/EmailVerificationBanner.tsx:29`
- Modify: `astro/src/components/comments/CommentForm.tsx:97`

**Interfaces:**
- Produces `POST /api/blog-auth/register`.
- Produces `getRegistrationMode` and `replaceRegistrationMode` for Agent A's admin API.
- Calls Agent C's `accountRetention.initializeNewUser(txDao, userRecord, nowMs)` in the user-create transaction.

```js
getRegistrationMode(dao) // => { mode: 'open' | 'invite_only', version: number }
replaceRegistrationMode(txDao, { expectedVersion, mode, actorId, referenceId, now })
// => { mode: 'open' | 'invite_only', version: number }
```

- [ ] **Step 1: Write failing registration tests**

Cover IP fourth request/hour, IPv6 `/64` eleventh request/hour, global 21st/minute, concurrent requests, restart persistence, duplicate identity uniform `202`, store failure `503` with zero user creation, and successful user creation with suppressed automatic mail when account-mail quota is full.

- [ ] **Step 2: Implement the server facade**

```js
function register(ctx) {
  const input = parseRegistration(ctx);
  const ip = requireTrustedIp(ctx.realIP());
  const referenceId = publicErrors.referenceId();
  const result = $app.runInTransaction((txDao) => {
    consumeRegistrationLimits(txDao, ip, Date.now());
    enforceRegistrationMode(txDao, input.inviteCode);
    const user = createReader(txDao, input);
    accountRetention.initializeNewUser(txDao, user, Date.now());
    return user;
  });
  requestInitialVerificationWithinMailLimits(result, ip);
  return publicErrors.registrationSubmitted(referenceId);
}
```

Do not expose whether the email already exists. Do not perform automatic password login after a generic `202`; show the verification-pending state.

- [ ] **Step 3: Switch every frontend caller to one typed client**

```ts
export async function registerReader(input: RegisterInput): Promise<AcceptedResponse> {
  return getPocketBase().send('/api/blog-auth/register', { method: 'POST', body: input });
}
export async function requestVerification(email: string): Promise<AcceptedResponse> {
  return getPocketBase().send('/api/blog-auth/verification/request', { method: 'POST', body: { email } });
}
```

Replace all direct `users.create()` and `requestVerification()` SDK calls found in the mapped components.

- [ ] **Step 4: Run fixture and Astro build**

Run: `powershell.exe -NoProfile -File scripts/test-security-rate-local.ps1 -Fixture registration -RestartPocketBase`

Expected: PASS.

Run: `Push-Location astro; npm run build; Pop-Location`

Expected: PASS.

- [ ] **Step 5: Commit**

```powershell
git add pb_hooks/lib/registration_facade.js pb_hooks/blog_register.pb.js pb_hooks/lib/registration_mode.js tests/security-rate/registration_fixture.pb.js scripts/test-security-rate-local.ps1 astro/src/lib/blog-auth-client.ts astro/src/hooks/usePocketBase.ts astro/src/components/auth/RegisterForm.tsx astro/src/components/effects/WelcomeOverlay.tsx astro/src/components/admin/AdminEmailVerificationRequired.tsx astro/src/components/auth/EmailVerificationBanner.tsx astro/src/components/comments/CommentForm.tsx
git commit -m "feat(auth): route registration through durable facade"
```

### Task 5: Route comments and all real delivery through the gateway

**Files:**
- Create: `pb_migrations/20260716112000_create_mail_outbox.pb.js`
- Create: `pb_hooks/lib/mail_outbox.js`
- Create: `pb_hooks/mail_outbox.pb.js`
- Modify: `pb_hooks/send_email_comment.pb.js:20-69`
- Modify: `admin-auth/src/mail/constants.mjs`
- Modify: `admin-auth/test/mail/service.test.mjs`
- Create: `tests/security-rate/outbox_fixture.pb.js`

**Interfaces:**
- Produces `mailOutbox.enqueue(txDao, input) -> { queued, outboxId }` for comments and Agent C retention notices.

- [ ] **Step 1: Write failing no-direct-SMTP and outbox tests**

Assert comment creation commits even when SMTP is down, one event creates at most one outbox row per recipient, quota denial creates no outbox/log, worker leases atomically, sends through `mail_gateway.send`, and records only the minimal sent/failed log.

- [ ] **Step 2: Add private outbox schema**

Use statuses `pending`, `processing`, `retry`, `sent`, `failed`, `cancelled`; add unique `dedupe_key`, lease expiry, attempt, next-attempt, category, encrypted/necessary recipient delivery fields, and minimal template variables. The outbox is online operational data and must not be included in the audit archive.

- [ ] **Step 3: Replace direct comment SMTP**

`send_email_comment.pb.js` may only call `mailOutbox.enqueue()` after the comment transaction. Remove `MailerMessage` and `$app.newMailClient().send()`.

- [ ] **Step 4: Implement the worker and gateway result mapping**

Use stable Message-ID/dedupe, bounded batch size, stale lease recovery, the existing gateway HMAC, and stable error classes. Permanent recipient errors fail; transient errors use the existing approved backoff schedule.

- [ ] **Step 5: Run outbox, Node mail, and static bypass checks**

Run: `powershell.exe -NoProfile -File scripts/test-security-rate-local.ps1 -Fixture outbox`

Expected: PASS.

Run: `Push-Location admin-auth; npm test; Pop-Location`

Expected: PASS.

Run: `Select-String -LiteralPath pb_hooks/send_email_comment.pb.js -Pattern 'newMailClient|MailerMessage'`

Expected: no matches.

- [ ] **Step 6: Commit**

```powershell
git add pb_migrations/20260716112000_create_mail_outbox.pb.js pb_hooks/lib/mail_outbox.js pb_hooks/mail_outbox.pb.js pb_hooks/send_email_comment.pb.js admin-auth/src/mail/constants.mjs admin-auth/test/mail/service.test.mjs tests/security-rate/outbox_fixture.pb.js
git commit -m "fix(mail): route comment delivery through outbox"
```

### Task 6: Expose safe policy and registration-mode admin APIs

**Files:**
- Create: `pb_hooks/security_policy_admin.pb.js`
- Create: `tests/security-rate/admin_policy_fixture.pb.js`
- Create: `astro/src/lib/admin-security-policy.ts`
- Create: `astro/src/components/admin/SecurityRatePolicyForm.tsx`
- Modify: `astro/src/components/admin/SecurityAudit.tsx`

**Interfaces:**
- Consumes Agent A `requireAdminStepUp()` and `writeSecurityAudit()`.
- Produces GET/PUT rate-policy and registration-mode APIs with CAS.

- [ ] **Step 1: Write failing role/network/step-up/CAS tests**

Assert reader/admin/nontrusted-IP/missing-step-up are 403, invalid bounds are 422, stale version is 409, valid update increments exactly once, changes do not clear buckets, and the audit is in the same transaction.
Also assert the sixth successful write attempt within one hour is rejected as `429 ADMIN_OPERATION_RATE_LIMITED` by `admin_security_write`.

- [ ] **Step 2: Implement the protected routes**

```js
const security = requireAdminStepUp(c, { requireSuperAdmin: true, requireTrustedAdminIp: true, actionCode: 'RATE_POLICY_UPDATED' });
const result = $app.runInTransaction((txDao) => {
  const operationLimit = rateLimit.consume(txDao, { nowMs: Date.now(), entries: [{ policyKey: 'admin_security_write', subject: security.actorId }] });
  if (!operationLimit.allowed) throw apiRateLimited('ADMIN_OPERATION_RATE_LIMITED', operationLimit.retryAfterSeconds);
  const updated = policyStore.replaceRatePolicySet(txDao, { expectedVersion: body.version, policies: body.policies, actorId: security.actorId, now: new Date() });
  writeSecurityAudit(txDao, security, { actionCode: 'RATE_POLICY_UPDATED', targetType: 'security_rate_policy', targetId: 'global', before, after: updated, version: updated.version });
  return updated;
});
```

- [ ] **Step 3: Add the constrained admin UI**

Render fixed policy rows only, numeric min/max hints from the server DTO, current version, detailed stable errors, and a separate open/invite-only switch. Do not render SMTP credentials or permit custom policy names.

- [ ] **Step 4: Run fixture and build**

Run: `powershell.exe -NoProfile -File scripts/test-security-rate-local.ps1 -Fixture admin_policy`

Expected: PASS.

Run: `Push-Location astro; npm run build; Pop-Location`

Expected: PASS.

- [ ] **Step 5: Commit**

```powershell
git add pb_hooks/security_policy_admin.pb.js tests/security-rate/admin_policy_fixture.pb.js astro/src/lib/admin-security-policy.ts astro/src/components/admin/SecurityRatePolicyForm.tsx astro/src/components/admin/SecurityAudit.tsx
git commit -m "feat(admin): manage bounded security rate policies"
```

### Task 7: Correct the OpenResty, Caddy, and PocketBase IP chain

**Files:**
- Modify: `docs/openresty-login-rate-limit.conf:20-126`
- Modify: `Caddyfile:1-109`
- Modify: `Caddyfile.local:40-61`
- Modify: `pb_hooks/login_security.pb.js:33-47`
- Replace: `pb_hooks/registration_rate_limit.pb.js`
- Create: `scripts/check-real-ip-chain.ps1`

- [ ] **Step 1: Write static checks before config edits**

The checker fails on `{remote_host}`, `$proxy_add_x_forwarded_for`, production header fallback, missing facade locations, or a publicly forwarded archive route. It requires `X-Real-IP $remote_addr`, `X-Forwarded-For $remote_addr`, Caddy `{client_ip}`, and the exact auth/register facade paths.

Run: `powershell.exe -NoProfile -File scripts/check-real-ip-chain.ps1`

Expected: FAIL on current config.

- [ ] **Step 2: Normalize at OpenResty**

For each public proxy location use:

```nginx
proxy_set_header X-Real-IP $remote_addr;
proxy_set_header X-Forwarded-For $remote_addr;
```

Point registration to `/api/blog-auth/register`; add exact account-mail/OTP short-burst locations. Deny `/api/blog-internal/mail-archive/` at the public OpenResty layer.

- [ ] **Step 3: Trust only OpenResty in Caddy**

Configure the deployed OpenResty peer CIDR/IP via the approved environment/template mechanism, set `client_ip_headers X-Forwarded-For X-Real-IP`, and replace upstream headers with:

```caddy
header_up X-Real-IP {client_ip}
header_up X-Forwarded-For {client_ip}
```

Add `X-Admin-Step-Up`, `X-Admin-Session`, and `X-Browser-Fingerprint` to the exact CORS allow-header list for trusted site origins.

- [ ] **Step 4: Remove PocketBase header fallback**

`login_security.pb.js` and registration code read only the framework real IP. Agent C owns `validate_comment.pb.js` and must remove its header fallback while adding the trusted `author_user` relation. Missing IP fails closed according to the endpoint contract.

- [ ] **Step 5: Run static and black-box checks**

Run: `powershell.exe -NoProfile -File scripts/check-real-ip-chain.ps1`

Expected: PASS.

Run the harness with two source IP namespaces/containers and a forged XFF. Expected: two distinct bucket hashes; forged XFF does not change either; Docker gateway is not used as the shared subject.

- [ ] **Step 6: Commit**

```powershell
git add docs/openresty-login-rate-limit.conf Caddyfile Caddyfile.local pb_hooks/login_security.pb.js pb_hooks/registration_rate_limit.pb.js scripts/check-real-ip-chain.ps1
git commit -m "fix(proxy): preserve trustworthy client IPs"
```

### Task 8: Perform the second-stage native endpoint cutover

**Files:**
- Create: `pb_migrations/20260716130000_close_native_auth_entrypoints.pb.js`
- Modify: `Caddyfile`
- Modify: `Caddyfile.local`
- Modify: `docs/openresty-login-rate-limit.conf`
- Create: `scripts/check-auth-facade-cutover.ps1`

- [ ] **Step 1: Write the cutover checker**

Require the dedicated registration and mail facade health routes to exist, `users.createRule = null` in the cutover migration, native request-password-reset/request-verification/request-email-change denied, native users create denied, and token-confirmation routes still allowed.

- [ ] **Step 2: Add only the cutover migration**

Set `users.createRule = null`; do not alter reader self-update/view rules and do not remove token confirmation endpoints. The down migration restores the exact prior anonymous-reader expression for emergency rollback, but deployment documentation must not use rollback to reopen mail bypasses.

- [ ] **Step 3: Run facade health and cutover checks against a temporary DB**

Run: `powershell.exe -NoProfile -File scripts/check-auth-facade-cutover.ps1`

Expected: PASS only after the new facade tests have passed.

- [ ] **Step 4: Run full track verification**

```powershell
powershell.exe -NoProfile -File scripts/test-security-rate-local.ps1 -All
powershell.exe -NoProfile -File scripts/check-real-ip-chain.ps1
powershell.exe -NoProfile -File scripts/check-auth-facade-cutover.ps1
Push-Location admin-auth
npm test
Pop-Location
Push-Location astro
npm run build
Pop-Location
bash scripts/verify-pocketbase-migrations-linux.sh
```

Expected: every command exits 0.

- [ ] **Step 5: Commit**

```powershell
git add pb_migrations/20260716130000_close_native_auth_entrypoints.pb.js Caddyfile Caddyfile.local docs/openresty-login-rate-limit.conf scripts/check-auth-facade-cutover.ps1
git commit -m "fix(auth): close native registration and mail bypasses"
```
