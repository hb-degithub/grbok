# Account Mail And Reader OTP Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Route PocketBase account mail through the internal provider-neutral gateway, expose enumeration-resistant account-mail facades, and replace unsupported native OTP calls with a secure reader-only custom email OTP flow.

**Architecture:** PocketBase owns templates, one-time challenges, rate limits, and delivery metadata while `admin-auth` remains the only SMTP credential holder. PocketBase Mailer Before hooks render structured templates and synchronously call the HMAC gateway without persisting account tokens. Public request facades keep identical responses for real and decoy identities; the React login flow consumes a custom challenge ID and stores the PocketBase auth response returned after atomic verification.

**Tech Stack:** PocketBase 0.22.21 JavaScript hooks and migrations, Goja CommonJS modules, HMAC-SHA256, Astro 6, React 19, PocketBase JS SDK 0.27, PowerShell 7, Mailpit 1.30.0.

## Global Constraints

- Complete and verify `2026-07-13-mail-gateway.md` before this plan; PocketBase never receives SMTP host, username, password, or sender credentials.
- Run every integration test on this computer first; do not change the production server in this plan.
- Require `require(__hooks + '/lib/...')` inside every `routerAdd`, record hook, Mailer hook, and cron callback because PocketBase 0.22.21 executes callback source in another VM.
- Never persist or log verification, password-reset, email-change, or OTP plaintext tokens/codes.
- Collection API rules for `mail_templates`, `mail_delivery_logs`, and `auth_otp_challenges` remain `null`; browser code never reads them directly.
- Account request facades always return `202 {"accepted":true,"message":"如果该账户可用，我们会发送邮件。"}` for validly shaped eligible, unknown, state-ineligible, feature-disabled, and rate-limited requests; account verification/reset/email-change remain available to every user role, while only OTP is reader-restricted.
- Every validly shaped account-mail or OTP request takes at least 350 ms before returning; malformed JSON, invalid email syntax, and oversized bodies may fail immediately with `400`.
- Password-reset, verification, and email-change facades share persistent limits of email hash 3 per 15 minutes, IP hash 5 per 15 minutes, and global 30 per minute across all three categories.
- Reader OTP is available only to an existing verified user whose exact role is `reader`; admin-capable roles continue to use password plus Passkey.
- OTP codes are six decimal digits, expire after 10 minutes, permit five verification attempts, are single-use, and invalidate every other active challenge for the same user after success.
- OTP request limits are email hash 3 per 15 minutes, IP hash 5 per 15 minutes, and global 30 per minute; real, decoy, and rate-limited requests consume equivalent persistent challenge records.
- `MAIL_GATEWAY_ENABLED` is the PocketBase master send switch, `MAIL_ACCOUNT_ENABLED` controls account forwarding, and `MAIL_OTP_ENABLED` controls OTP; disabled account hooks still return `false`, while disabled request routes keep their common decoy response and send nothing.
- Gateway signing follows `timestamp + "\n" + nonce + "\n" + method + "\n" + path + "\n" + sha256(rawBody)` with a 60-second skew window.
- Template content is structured JSON only; no arbitrary administrator-authored HTML is rendered.
- Keep PocketBase confirm endpoints public, but block direct public access to built-in request-password-reset, request-verification, and request-email-change endpoints at Caddy.
- Every task follows red-green-refactor and ends with a focused commit.

---

## File Map

Create:
- `pb_migrations/20260713090000_create_mail_account_foundation.pb.js` - private templates, delivery logs, and OTP challenges plus four built-in template versions.
- `pb_hooks/lib/mail_crypto.js` - hashes, HMAC request signing, masking, constant-time comparison, and request IDs.
- `pb_hooks/lib/mail_gateway.js` - strict internal gateway client and stable error mapping.
- `pb_hooks/lib/mail_templates.js` - structured template loading, variable validation, HTML escaping, and text/HTML rendering.
- `pb_hooks/lib/mail_logs.js` - body-free delivery and rate-limit metadata writes.
- `pb_hooks/lib/auth_facade.js` - request parsing, identity lookup, decoy response, built-in local request forwarding, and account-mail link helpers.
- `pb_hooks/lib/auth_otp.js` - persistent request limits, OTP challenge lifecycle, atomic verification, and cleanup.
- `pb_hooks/account_mail.pb.js` - account Mailer Before hooks and registration verification trigger.
- `pb_hooks/blog_auth.pb.js` - five public account/OTP facade routes and hourly cleanup.
- `tests/mail-local/account_fixture.pb.js` - isolated users and deterministic integration assertions.
- `scripts/test-mail-account-local.ps1` - starts Mailpit, gateway, and isolated PocketBase and runs the fixture.
- `astro/src/components/auth/ForgotPasswordForm.tsx`
- `astro/src/components/auth/ResetPasswordForm.tsx`
- `astro/src/components/auth/ChangeEmailForm.tsx`
- `astro/src/components/auth/EmailChangeResult.tsx`
- `astro/src/pages/forgot-password.astro`
- `astro/src/pages/reset-password.astro`
- `astro/src/pages/change-email.astro`
- `astro/src/pages/confirm-email-change.astro`
- `astro/scripts/test-account-mail-ui.mjs` - Playwright route and accessibility smoke checks.

Modify:
- `pb_hooks/email_verification.pb.js` - remove unsupported DAO call and full-address logging; registration sending moves to `account_mail.pb.js`.
- `pb_hooks/otp_rate_limit.pb.js` - remove unsupported native OTP hooks; persistent custom OTP lives in `blog_auth.pb.js`.
- `pb_hooks/configure_smtp.pb.js` - delete because SMTP credentials leave PocketBase.
- `astro/src/hooks/usePocketBase.ts` - expose facade methods and custom OTP auth storage.
- `astro/src/components/auth/MagicLinkForm.tsx` - replace native SDK OTP with challenge request/verify.
- `astro/src/components/auth/PasswordLoginForm.tsx` - remove native email MFA branch and preserve Passkey transition.
- `astro/src/components/auth/AuthStatusControl.tsx` - expose change-email action for authenticated users.
- `astro/src/components/auth/AuthPage.tsx` - add forgot-password navigation without changing the existing visual shell.
- `astro/package.json` - add the local UI smoke command.
- `Caddyfile` - deny three direct built-in account-mail request paths while preserving confirm paths.
- `scripts/sensitive-check.ps1` - scan hook, migration, test, and built assets for secret/token leakage.
- `scripts/pre-deploy-check.ps1` - include account-mail local/static checks without contacting production.

Delete:
- `pb_hooks/configure_smtp.pb.js`
- `pb_hooks/otp_rate_limit.pb.js`
- `pb_hooks/email_verification.pb.js` after equivalent behavior is proven in `account_mail.pb.js`.

---

### Task 1: Create Private Account-Mail Collections And Seed Templates

**Files:**
- Create: `pb_migrations/20260713090000_create_mail_account_foundation.pb.js`
- Test: `tests/mail-local/account_fixture.pb.js`

**Interfaces:**
- Consumes: PocketBase 0.22.21 migration APIs and existing `users` auth collection.
- Produces: private collections `mail_templates`, `mail_delivery_logs`, `auth_otp_challenges`; current template keys `account_verification`, `account_password_reset`, `account_email_change`, `reader_otp`.

The collection contract is fixed:

```ts
interface MailTemplateRecord {
  key: string;
  name: string;
  category: string;
  version: number;
  is_current: boolean;
  subject_template: string;
  content_json: string;
  variables_json: string;
  required_variables_json: string;
  builtin: boolean;
}

interface MailDeliveryLogRecord {
  request_id: string;
  category: string;
  source_collection: string;
  source_record_id: string;
  recipient_masked: string;
  recipient_hash: string;
  request_ip_hash: string;
  result: 'accepted' | 'sent' | 'failed' | 'suppressed' | 'rate_limited' | 'decoy';
  duration_ms: number;
  attempt: number;
  error_class: string;
}

interface AuthOtpChallengeRecord {
  challenge_id: string;
  user: string;
  email_hash: string;
  ip_hash: string;
  code_hash: string;
  expires_at: string;
  attempts: number;
  consumed_at: string;
}
```

- [ ] **Step 1: Write a failing schema probe**

Add `assertAccountFoundation()` to the fixture:

```js
function assertAccountFoundation() {
  const expected = {
    mail_templates: ['key', 'name', 'category', 'version', 'is_current', 'subject_template', 'content_json', 'variables_json', 'required_variables_json', 'builtin'],
    mail_delivery_logs: ['request_id', 'category', 'source_collection', 'source_record_id', 'recipient_masked', 'recipient_hash', 'request_ip_hash', 'result', 'duration_ms', 'attempt', 'error_class'],
    auth_otp_challenges: ['challenge_id', 'user', 'email_hash', 'ip_hash', 'code_hash', 'expires_at', 'attempts', 'consumed_at'],
  };
  for (const name of Object.keys(expected)) {
    const collection = $app.dao().findCollectionByNameOrId(name);
    if (collection.listRule !== null || collection.viewRule !== null || collection.createRule !== null || collection.updateRule !== null || collection.deleteRule !== null) {
      throw new Error(name + ' must be private');
    }
    const fields = collection.schema.fields().map((field) => field.name);
    for (const field of expected[name]) if (fields.indexOf(field) === -1) throw new Error(name + ' missing ' + field);
  }
  const templates = $app.dao().findRecordsByFilter('mail_templates', 'is_current = true', 'key', 20, 0);
  const keys = templates.map((record) => record.getString('key')).sort();
  const wanted = ['account_email_change', 'account_password_reset', 'account_verification', 'reader_otp'];
  if (JSON.stringify(keys) !== JSON.stringify(wanted)) throw new Error('unexpected template keys: ' + JSON.stringify(keys));
}
```

- [ ] **Step 2: Run the isolated migration probe and prove failure**

Run:

```powershell
& .\pb_local\pb\pocketbase.exe migrate up --dir .\tmp\mail-account-red\pb_data --migrationsDir .\pb_migrations
```

Expected before the migration exists: the fixture startup fails with `collection mail_templates not found`.

- [ ] **Step 3: Implement the migration with exact schema controls**

Create all three base collections with `listRule`, `viewRule`, `createRule`, `updateRule`, and `deleteRule` set to `null`. Add unique indexes:

```js
mailTemplates.indexes = [
  'CREATE UNIQUE INDEX idx_mail_templates_key_version ON mail_templates (key, version)',
  'CREATE UNIQUE INDEX idx_mail_templates_one_current ON mail_templates (key) WHERE is_current = TRUE',
];
deliveryLogs.indexes = [
  'CREATE UNIQUE INDEX idx_mail_delivery_logs_request_id ON mail_delivery_logs (request_id)',
  'CREATE INDEX idx_mail_delivery_logs_created_category ON mail_delivery_logs (created, category)',
  'CREATE INDEX idx_mail_delivery_logs_recipient_hash ON mail_delivery_logs (recipient_hash, created)',
];
otpChallenges.indexes = [
  'CREATE UNIQUE INDEX idx_auth_otp_challenge_id ON auth_otp_challenges (challenge_id)',
  'CREATE INDEX idx_auth_otp_email_created ON auth_otp_challenges (email_hash, created)',
  'CREATE INDEX idx_auth_otp_ip_created ON auth_otp_challenges (ip_hash, created)',
  'CREATE INDEX idx_auth_otp_user_active ON auth_otp_challenges (user, consumed_at, expires_at)',
];
```

Use required text/select/number/bool/date/relation fields according to the interfaces. `user` is a single optional cascade-delete relation to `users`; `consumed_at` is optional. Seed each template as version `1`, current and built in, with this exact structured content model:

```js
const seeds = [
  ['account_verification', '验证邮箱', 'account_verification', '验证你的邮箱', ['displayName', 'actionUrl', 'expiresMinutes'], ['displayName', 'actionUrl']],
  ['account_password_reset', '重置密码', 'account_password_reset', '重置你的密码', ['displayName', 'actionUrl', 'expiresMinutes'], ['displayName', 'actionUrl']],
  ['account_email_change', '确认新邮箱', 'account_email_change', '确认修改邮箱', ['displayName', 'newEmailMasked', 'actionUrl', 'expiresMinutes'], ['displayName', 'newEmailMasked', 'actionUrl']],
  ['reader_otp', '读者登录验证码', 'reader_otp', '你的登录验证码', ['displayName', 'code', 'expiresMinutes'], ['displayName', 'code']],
];

const content = {
  preheader: '{{subject}}',
  title: '{{subject}}',
  paragraphs: ['你好，{{displayName}}。', '请使用下方按钮或验证码完成操作；若非本人操作，请忽略此邮件。'],
  action: { label: '继续', urlVariable: 'actionUrl' },
  footer: '此邮件由 hlydwz.com 自动发送，请勿回复。',
};
```

For `reader_otp`, set `action` to `null` and use `paragraphs: ['你好，{{displayName}}。', '你的验证码是 {{code}}，10 分钟内有效。']`. The rollback deletes the three collections in reverse dependency order.

- [ ] **Step 4: Run migration and schema assertions**

Run the migration against a fresh `tmp/mail-account-green/pb_data`, start PocketBase on `127.0.0.1:18092`, invoke the fixture route, then stop the process.

Expected: fixture returns `200 {"schema":"ok","templates":4}` and SQLite contains no public API rules for the three collections.

- [ ] **Step 5: Commit**

```powershell
git add pb_migrations/20260713090000_create_mail_account_foundation.pb.js tests/mail-local/account_fixture.pb.js
git commit -m "feat(mail): add private account mail storage"
```

---

### Task 2: Add PocketBase Mail Cryptography And Gateway Client

**Files:**
- Create: `pb_hooks/lib/mail_crypto.js`
- Create: `pb_hooks/lib/mail_gateway.js`
- Modify: `tests/mail-local/account_fixture.pb.js`

**Interfaces:**
- Consumes: `MAIL_GATEWAY_INTERNAL_URL`, `MAIL_INTERNAL_SECRET`, `MAIL_HASH_SECRET`.
- Produces:
  - `mailCrypto.requestId(prefix): string`
  - `mailCrypto.hashPrivate(scope, value): string`
  - `mailCrypto.maskEmail(address): string`
  - `mailCrypto.sign(method, path, rawBody, timestamp, nonce): string`
  - `mailCrypto.equal(left, right): boolean`
  - `mailGateway.send(message): { ok: true, requestId: string }`
  - `mailGateway.status(): object`

- [ ] **Step 1: Add a failing CommonJS probe route**

Inside the fixture callback, require the modules at callback execution time:

```js
routerAdd('GET', '/api/test/mail-account/crypto', function (e) {
  const crypto = require(__hooks + '/lib/mail_crypto.js');
  const signature = crypto.sign('POST', '/internal/mail/send', '{}', '1720828800', 'nonce-123');
  return e.json(200, {
    idShape: /^acct_[A-Za-z0-9_-]{20,}$/.test(crypto.requestId('acct')),
    masked: crypto.maskEmail('reader@example.com'),
    hashLength: crypto.hashPrivate('email', 'reader@example.com').length,
    signatureLength: signature.length,
  });
});
```

Expected contract: `idShape=true`, `masked=r****r@example.com`, `hashLength=64`, `signatureLength=64`.

- [ ] **Step 2: Run against PocketBase and prove `require` target is missing**

Expected: request returns `500` and logs contain `Cannot find module .../lib/mail_crypto.js`.

- [ ] **Step 3: Implement exact cryptographic rules**

Export a plain CommonJS object:

```js
module.exports = {
  requestId,
  hashPrivate,
  maskEmail,
  sign,
  equal,
};
```

Use these formulas:

```js
function hashPrivate(scope, value) {
  const secret = String($os.getenv('MAIL_HASH_SECRET') || '').trim();
  if (secret.length < 32) throw new Error('MAIL_HASH_SECRET is not configured');
  return $security.hs256(String(scope) + ':' + String(value).trim().toLowerCase(), secret);
}

function sign(method, path, rawBody, timestamp, nonce) {
  const secret = String($os.getenv('MAIL_INTERNAL_SECRET') || '').trim();
  if (secret.length < 32) throw new Error('MAIL_INTERNAL_SECRET is not configured');
  const canonical = [timestamp, nonce, String(method).toUpperCase(), path, $security.sha256(rawBody)].join('\n');
  return $security.hs256(canonical, secret);
}
```

`requestId(prefix)` is `prefix + '_' + $security.randomStringWithAlphabet(26, 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789_-')`. `equal` delegates to `$security.equal` and rejects non-string input. `maskEmail` validates one `@`, keeps at most the first and last local-part characters, and returns `invalid` for malformed input.

- [ ] **Step 4: Implement the gateway client with sanitized errors**

`send(message)` first requires `MAIL_GATEWAY_ENABLED=true`, then serializes once, signs those exact bytes, posts to `${MAIL_GATEWAY_INTERNAL_URL}/internal/mail/send`, and accepts only a `2xx` response containing `{ok:true}`. Set `Content-Type`, all three HMAC headers, and a 12-second timeout. When the switch is false, throw the same sanitized `MAIL_NOT_CONFIGURED` class without making a request. On failure throw an error whose public properties are only:

```js
{ name: 'MailGatewayError', code: 'SMTP_TIMEOUT', retryable: true, statusCode: 503 }
```

Map absent/malformed gateway replies to `INTERNAL_ERROR`; never attach `res.raw`, message body, recipient, or signature. `status()` signs an empty GET body and returns only redacted JSON.

- [ ] **Step 5: Run fixture and static leak checks**

Run the probe and:

```powershell
Select-String -Path pb_hooks\lib\mail_crypto.js,pb_hooks\lib\mail_gateway.js -Pattern 'console\.(log|error).*body|console\.(log|error).*email|rawBody.*console|MAIL_INTERNAL_SECRET.*console'
```

Expected: probe contract passes and `Select-String` returns no matches.

- [ ] **Step 6: Commit**

```powershell
git add pb_hooks/lib/mail_crypto.js pb_hooks/lib/mail_gateway.js tests/mail-local/account_fixture.pb.js
git commit -m "feat(mail): sign PocketBase gateway requests"
```

---

### Task 3: Render Structured Templates And Write Body-Free Delivery Logs

**Files:**
- Create: `pb_hooks/lib/mail_templates.js`
- Create: `pb_hooks/lib/mail_logs.js`
- Modify: `tests/mail-local/account_fixture.pb.js`

**Interfaces:**
- Consumes: current `mail_templates` records and a string-keyed variable object.
- Produces:
  - `templates.render(key, variables): { category, subject, html, text, version }`
  - `templates.escapeHtml(value): string`
  - `logs.delivery(input): void`
  - `logs.rateCount(field, hash, sinceIso): number`

- [ ] **Step 1: Add failing rendering and log-shape assertions**

Use a fixture route that renders `reader_otp` with `{displayName:'<Reader>', code:'123456', expiresMinutes:'10', subject:'你的登录验证码'}` and writes one fake sent log. Assert:

```js
if (rendered.html.indexOf('&lt;Reader&gt;') === -1) throw new Error('display name was not escaped');
if (rendered.html.indexOf('<Reader>') !== -1) throw new Error('raw HTML leaked');
if (rendered.text.indexOf('123456') === -1) throw new Error('text alternative missing code');
if (rendered.subject !== '你的登录验证码') throw new Error('subject mismatch');
const saved = $app.dao().findFirstRecordByData('mail_delivery_logs', 'request_id', 'fixture_log_1');
for (const forbidden of ['html', 'text', 'body', 'token', 'code', 'recipient']) {
  if (saved.get(forbidden)) throw new Error('forbidden log field: ' + forbidden);
}
```

- [ ] **Step 2: Run and prove missing modules fail**

Expected: fixture route returns `500` with a module-not-found error before implementation.

- [ ] **Step 3: Implement strict structured rendering**

`render` must:

1. Find exactly one `key = {:key} && is_current = true` record.
2. Parse `content_json`, `variables_json`, and `required_variables_json` as arrays/object.
3. Reject variable names not declared by `variables_json`.
4. Reject missing values declared by `required_variables_json`.
5. Replace only `/{{([A-Za-z][A-Za-z0-9_]*)}}/g`; HTML-escape replacements in HTML and use plain normalized text in text output.
6. Render a fixed table-based email shell with inline CSS, UTF-8 meta, title, paragraphs, optional action button, and footer.
7. Parse `PUBLIC_SITE_URL` once and require every `action.urlVariable` to have the exact same origin. Production requires `https:`; local `http:` is allowed only when both configured and action hosts are exactly `localhost` or `127.0.0.1`.
8. Include the escaped action URL as copyable visible text below every action button and in the plain-text alternative.
9. Emit no script, iframe, form, third-party font, remote image, tracking pixel, or external stylesheet; template text cannot introduce markup because every variable and administrator field is escaped.
10. Enforce gateway limits: subject 255 chars, HTML 262144 bytes, text 131072 bytes.

The module returns no database record object and never exposes template collection APIs.

- [ ] **Step 4: Implement delivery logs with an explicit allowlist**

Use this only accepted input shape:

```js
const allowed = [
  'request_id', 'category', 'source_collection', 'source_record_id',
  'recipient_masked', 'recipient_hash', 'request_ip_hash', 'result',
  'duration_ms', 'attempt', 'error_class',
];
```

Reject unknown keys. Clamp `duration_ms` to `0..120000` and `attempt` to `0..100`. The module never accepts `html`, `text`, `body`, `token`, `code`, a plaintext IP, or a plaintext recipient. `rateCount` accepts only `recipient_hash` or `request_ip_hash` as the field parameter and uses bound filter parameters.

- [ ] **Step 5: Run fixture and inspect the isolated SQLite schema**

Expected: render/log route returns `200`, raw HTML is absent, and a query over `pragma_table_info('mail_delivery_logs')` has no content/token/code column.

- [ ] **Step 6: Commit**

```powershell
git add pb_hooks/lib/mail_templates.js pb_hooks/lib/mail_logs.js tests/mail-local/account_fixture.pb.js
git commit -m "feat(mail): render safe account templates"
```

---

### Task 4: Intercept PocketBase Account Mail Without Persisting Tokens

**Files:**
- Create: `pb_hooks/account_mail.pb.js`
- Delete: `pb_hooks/configure_smtp.pb.js`
- Delete: `pb_hooks/email_verification.pb.js`
- Modify: `tests/mail-local/account_fixture.pb.js`

**Interfaces:**
- Consumes: PocketBase Mailer Before hook event `e.message`, `e.record`, and ephemeral `e.meta.token` / `e.meta.newEmail`.
- Produces: gateway messages for `account_verification`, `account_password_reset`, and `account_email_change`; `false` from every intercepted callback so the default SMTP sender never runs.

- [ ] **Step 1: Add failing account-mail fixture cases**

The fixture creates verified/unverified readers and verified/unverified admin-capable users, invokes PocketBase verification/reset/change-email mail helpers, and queries Mailpit. Assert each eligible role receives the applicable message exactly once, correct category metadata reaches the gateway, default PocketBase sending never runs, and links use the following paths:

```text
/verify-email?token=
/reset-password?token=
/confirm-email-change?token=
```

Then scan the isolated SQLite database and PocketBase logs for the exact captured token strings; each scan must return zero matches.

- [ ] **Step 2: Run with the gateway and prove default account mail is not integrated**

Expected before this hook: account helpers either use PocketBase SMTP/default behavior or produce no gateway message, so the fixture fails `expected gateway category account_verification`.

- [ ] **Step 3: Implement three Mailer Before callbacks**

Use an IIFE entry file, but require modules inside each callback:

```js
(function () {
  onMailerBeforeRecordVerificationSend(function (e) {
    const account = require(__hooks + '/lib/auth_facade.js');
    account.forwardAccountMail('account_verification', e);
    return false;
  });

  onMailerBeforeRecordPasswordResetSend(function (e) {
    const account = require(__hooks + '/lib/auth_facade.js');
    account.forwardAccountMail('account_password_reset', e);
    return false;
  });

  onMailerBeforeRecordChangeEmailSend(function (e) {
    const account = require(__hooks + '/lib/auth_facade.js');
    account.forwardAccountMail('account_email_change', e);
    return false;
  });
})();
```

`forwardAccountMail` copies the token to a local variable, constructs one URL, renders and sends synchronously, writes a body-free delivery log, then lets local variables leave scope. It validates `PUBLIC_SITE_URL` and produces exactly:

```js
const pathByCategory = {
  account_verification: '/verify-email?token=',
  account_password_reset: '/reset-password?token=',
  account_email_change: '/confirm-email-change?token=',
};
```

Before rendering/sending, require both `MAIL_GATEWAY_ENABLED=true` and `MAIL_ACCOUNT_ENABLED=true`. For every actual send, generate `requestId = mailCrypto.requestId('req')` and `messageId = mailCrypto.requestId('msg')`, both satisfying the gateway ID regex; delivery logs use that request ID. When either switch is false or any send fails, log only `[account-mail] category=<category> result=<stable-code>` and still return control to the hook that returns `false`; this prevents a credential-bearing default SMTP fallback.

- [ ] **Step 4: Replace registration auto-send correctly**

In the same entry file add `onRecordAfterCreateRequest` for `users`. Require `auth_facade.js` inside the callback and call its `requestVerificationFor(record)` whenever an email exists and the record is not verified, regardless of role. That function calls `$mails.sendRecordVerification($app, record)`; it does not call `$app.dao().requestVerification`.

- [ ] **Step 5: Delete legacy SMTP hooks and rerun fixture**

Delete `configure_smtp.pb.js` and `email_verification.pb.js`. Run:

```powershell
Get-ChildItem pb_hooks -File | Select-String -Pattern 'newMailClient\(\)|SmtpConfig|ALIYUN_SMTP_PASSWORD|requestVerification\('
```

Expected: no direct SMTP construction, no SMTP password references, and no unsupported DAO request helper.

- [ ] **Step 6: Commit**

```powershell
git add pb_hooks/account_mail.pb.js pb_hooks/lib/auth_facade.js tests/mail-local/account_fixture.pb.js
git rm pb_hooks/configure_smtp.pb.js pb_hooks/email_verification.pb.js
git commit -m "feat(mail): route account mail through gateway"
```

---

### Task 5: Add Enumeration-Resistant Account Request Facades

**Files:**
- Create: `pb_hooks/blog_auth.pb.js`
- Modify: `pb_hooks/lib/auth_facade.js`
- Modify: `tests/mail-local/account_fixture.pb.js`
- Modify: `Caddyfile`

**Interfaces:**
- Consumes: JSON `{email:string}` or `{newEmail:string}`, optional authenticated bearer token for change-email.
- Produces:
  - `POST /api/blog-auth/password-reset/request`
  - `POST /api/blog-auth/verification/request`
  - `POST /api/blog-auth/email-change/request`
  - common `202` response.

- [ ] **Step 1: Add failing real/decoy response parity tests**

For password reset, prove both an existing reader and existing super-admin trigger their own token flow while an unknown address does not. For verification, prove unverified reader and unverified admin-capable accounts trigger mail while already-verified and unknown accounts do not. For email change, prove authenticated reader and authenticated super-admin requests reach the token flow while an unauthenticated request does not. Compare status, sorted JSON keys, exact message, and response byte length; all validly shaped actionable and non-actionable requests return:

```json
{"accepted":true,"message":"如果该账户可用，我们会发送邮件。"}
```

Malformed JSON, a body over 4096 bytes, or syntactically invalid email returns `400 {"code":"INVALID_REQUEST"}` without echoing input. For every validly shaped case, assert elapsed time is at least 330 ms (20 ms scheduler tolerance around the 350 ms contract); compare real, decoy, feature-disabled, and rate-limited status, keys, message, and byte length. The fourth email request, sixth IP request, thirty-first global request, and any request with `MAIL_ACCOUNT_ENABLED=false` stay `202` and do not invoke the loopback token endpoint.

- [ ] **Step 2: Run and prove routes return 404**

Expected: each `/api/blog-auth/.../request` route returns `404`.

- [ ] **Step 3: Implement route callbacks with runtime module loading**

Use this exact route shape:

```js
routerAdd('POST', '/api/blog-auth/password-reset/request', function (e) {
  const startedAt = Date.now();
  const facade = require(__hooks + '/lib/auth_facade.js');
  facade.requestPasswordReset(e);
  facade.waitForMinimum(startedAt, 350);
  return e.json(202, facade.acceptedResponse());
}, $apis.bodyLimit(4096));
```

Repeat with `requestVerification` and `requestEmailChange`. Each helper normalizes an email using trim plus lowercase for lookup/hashing, computes email/IP HMACs before identity lookup, and applies the shared persistent limits against `mail_delivery_logs` rows for all three account categories. Every valid request writes one body-free request record with result `accepted`, `decoy`, or `rate_limited`; a limited request skips token generation but returns the common `202`. Eligible requests alone forward to the PocketBase loopback API. Unknown and ineligible identities follow the same hashing, limit, log, and `waitForMinimum` path. `waitForMinimum` calls PocketBase's proven global `sleep(Math.max(0, minimumMs - (Date.now() - startedAt)))`.

- [ ] **Step 4: Forward to built-in loopback request endpoints**

Use `http://127.0.0.1:8090` plus:

```js
const builtInPaths = {
  passwordReset: '/api/collections/users/request-password-reset',
  verification: '/api/collections/users/request-verification',
  emailChange: '/api/collections/users/request-email-change',
};
```

Send JSON once with a 5000 ms timeout. Forward the incoming `Authorization` header only for email change. Never forward cookies, origin headers, client IP headers, or arbitrary headers. Treat all loopback `2xx` responses as accepted and map failures to body-free `mail_delivery_logs` while preserving the common public `202` response.

- [ ] **Step 5: Block only direct public request endpoints in Caddy**

Add an exact matcher before the PocketBase reverse proxy:

```caddyfile
@blockedAccountMailRequests path \
  /api/collections/users/request-password-reset \
  /api/collections/users/request-verification \
  /api/collections/users/request-email-change
respond @blockedAccountMailRequests 404
```

Do not block `confirm-password-reset`, `confirm-verification`, `confirm-email-change`, `/api/blog-auth/*`, or PocketBase loopback traffic.

- [ ] **Step 6: Verify parity and Caddy route scope**

Expected: fixture parity tests pass; Caddy adaptation succeeds; three request paths return 404 through Caddy; three confirm paths reach PocketBase and do not return the Caddy 404 body.

- [ ] **Step 7: Commit**

```powershell
git add pb_hooks/blog_auth.pb.js pb_hooks/lib/auth_facade.js tests/mail-local/account_fixture.pb.js Caddyfile
git commit -m "feat(auth): add account mail request facades"
```

---

### Task 6: Implement Persistent Reader OTP With Atomic Single Use

**Files:**
- Create: `pb_hooks/lib/auth_otp.js`
- Modify: `pb_hooks/blog_auth.pb.js`
- Delete: `pb_hooks/otp_rate_limit.pb.js`
- Modify: `tests/mail-local/account_fixture.pb.js`

**Interfaces:**
- Consumes:
  - request `{email:string}`
  - verify `{challengeId:string,code:string}`
- Produces:
  - `POST /api/blog-auth/otp/request` -> `202 {accepted:true,challengeId:string,expiresIn:600}`
  - `POST /api/blog-auth/otp/verify` -> PocketBase auth response or stable `400` error.

The challenge ID is public correlation data, not a credential. The database stores only:

```js
code_hash = $security.hs256('otp-code:' + challengeId + ':' + code, MAIL_HASH_SECRET)
```

- [ ] **Step 1: Add failing OTP lifecycle tests**

Fixture cases must cover:

```text
verified reader -> mail sent, verify succeeds, auth token returned
unknown email -> same 202 shape and no mail
unverified reader -> same 202 shape and no mail
admin/super_admin/author -> same 202 shape and no mail
wrong code x5 -> attempts increment and sixth request is rejected
expired challenge -> rejected
reused successful challenge -> rejected
second challenge after first succeeds -> second becomes invalid
email request 4 within 15m -> same 202 shape, decoy challenge, no fourth mail
IP request 6 within 15m -> same 202 shape, decoy challenge, no sixth mail
global request 31 within 1m -> same 202 shape, decoy challenge, no thirty-first mail
real, unknown, wrong-role, feature-disabled, and rate-limited OTP requests -> each takes at least 330 ms
two concurrent correct verifications -> exactly one auth response and one invalid-code response
```

The test reads the Mailpit message only to obtain the code; it then scans SQLite and PocketBase logs for that exact code and expects zero matches.

- [ ] **Step 2: Run and prove OTP routes are absent**

Expected: request and verify routes return `404`.

- [ ] **Step 3: Implement request limits with persistent records**

Use `auth_otp_challenges` as the sole OTP request-limit ledger. Compute email/IP hashes before identity lookup and query recent challenge counts with bound timestamps; global count includes every challenge created in the one-minute window:

```js
const limits = {
  email: { max: 3, windowMs: 15 * 60 * 1000 },
  ip: { max: 5, windowMs: 15 * 60 * 1000 },
  global: { max: 30, windowMs: 60 * 1000 },
};
```

The request helper always creates and saves a random challenge ID, including after a limit is reached or when `MAIL_OTP_ENABLED=false`. For an under-limit verified reader with both `MAIL_GATEWAY_ENABLED=true` and `MAIL_OTP_ENABLED=true`, create a random six-digit code with `$security.randomStringWithAlphabet(6, '0123456789')`, hash it, associate the user, render `reader_otp`, and send. For unknown, unverified, wrong-role, rate-limited, or feature-disabled requests, save a challenge with blank `user`, a random code hash, the same 10-minute expiry, and no SMTP call. Every path calls the same 350 ms minimum-response helper and returns the same keys with `expiresIn:600`; no OTP request path returns `429`.

- [ ] **Step 4: Implement atomic verification**

Validate challenge IDs with `/^[A-Za-z0-9_-]{20,64}$/` and codes with `/^[0-9]{6}$/`. In `$app.dao().runInTransaction`:

1. Find the challenge by bound `challenge_id`.
2. Reject consumed, expired, blank-user, or `attempts >= 5` records with one public `INVALID_OR_EXPIRED_CODE` error.
3. Increment and save `attempts` before comparing.
4. Compare expected and stored hashes with `$security.equal`.
5. Reload the user and require `verified() === true` and exact role `reader`.
6. Set `consumed_at` on the selected record.
7. Mark every other unconsumed challenge for that user consumed in the same transaction.
8. Return the user record outside the transaction through `$apis.recordAuthResponse($app, e, user, {otp:true})`.

Never reveal whether the challenge, code, user, role, or verification state caused rejection.

- [ ] **Step 5: Register routes and cleanup cron**

Add callbacks with inside-callback requires and `$apis.bodyLimit(4096)`. Add an hourly cleanup callback that deletes challenges whose `created` is older than 24 hours, in batches of at most 500 until fewer than 500 remain. The cron callback requires `auth_otp.js` inside its body.

- [ ] **Step 6: Delete unsupported native OTP hook and verify lifecycle**

Delete `otp_rate_limit.pb.js`. Run the complete fixture twice against fresh databases to prove no process-global state is required.

Expected: all lifecycle and limit cases pass; successful verify returns `record.role === 'reader'` and an auth token; code/token scans return zero matches.

- [ ] **Step 7: Commit**

```powershell
git add pb_hooks/lib/auth_otp.js pb_hooks/blog_auth.pb.js tests/mail-local/account_fixture.pb.js
git rm pb_hooks/otp_rate_limit.pb.js
git commit -m "feat(auth): add secure reader email OTP"
```

---

### Task 7: Replace Unsupported Frontend OTP And Add Account-Mail Screens

**Files:**
- Modify: `astro/src/hooks/usePocketBase.ts`
- Modify: `astro/src/components/auth/MagicLinkForm.tsx`
- Modify: `astro/src/components/auth/PasswordLoginForm.tsx`
- Modify: `astro/src/components/auth/AuthPage.tsx`
- Modify: `astro/src/components/auth/AuthStatusControl.tsx`
- Create: `astro/src/components/auth/ForgotPasswordForm.tsx`
- Create: `astro/src/components/auth/ResetPasswordForm.tsx`
- Create: `astro/src/components/auth/ChangeEmailForm.tsx`
- Create: `astro/src/components/auth/EmailChangeResult.tsx`
- Create: `astro/src/pages/forgot-password.astro`
- Create: `astro/src/pages/reset-password.astro`
- Create: `astro/src/pages/change-email.astro`
- Create: `astro/src/pages/confirm-email-change.astro`
- Create: `astro/scripts/test-account-mail-ui.mjs`
- Modify: `astro/package.json`

**Interfaces:**
- Consumes: the five `/api/blog-auth/*` routes and PocketBase confirm APIs.
- Produces these typed client methods:

```ts
type AcceptedMailResponse = { accepted: true; message: string };
type OtpRequestResponse = { accepted: true; challengeId: string; expiresIn: 600 };

requestPasswordReset(email: string): Promise<AcceptedMailResponse>;
requestVerification(email: string): Promise<AcceptedMailResponse>;
requestEmailChange(newEmail: string): Promise<AcceptedMailResponse>;
requestReaderOtp(email: string): Promise<OtpRequestResponse>;
verifyReaderOtp(challengeId: string, code: string): Promise<void>;
confirmPasswordReset(token: string, password: string, passwordConfirm: string): Promise<void>;
confirmEmailChange(token: string, password: string): Promise<void>;
```

- [ ] **Step 1: Write a failing Playwright route/UI smoke**

In `test-account-mail-ui.mjs`, start from a caller-provided `BASE_URL` and assert:

```js
const cases = [
  ['/login/', '忘记密码'],
  ['/forgot-password/', '重置密码'],
  ['/reset-password/?token=test-token', '设置新密码'],
  ['/change-email/', '修改邮箱'],
  ['/confirm-email-change/?token=test-token', '确认修改邮箱'],
];
for (const [path, text] of cases) {
  const response = await page.goto(baseUrl + path);
  if (!response || response.status() >= 400) throw new Error(path + ' did not load');
  await page.getByText(text, { exact: false }).first().waitFor();
  if ((await page.locator('body').textContent()).includes('requestOTP')) throw new Error('native OTP wording leaked');
}
```

Also capture `page.on('console')` and fail on console errors, assert no horizontal overflow at `390x844`, and verify each form has an associated visible label.

- [ ] **Step 2: Run build/smoke and prove new routes are absent**

Run `npm run build` in `astro`, start preview, and run the smoke script.

Expected before implementation: `/forgot-password/` returns `404`.

- [ ] **Step 3: Implement typed facade calls and auth storage**

In `usePocketBase.ts`, use `pb.send(path, {method:'POST', body})`. `verifyReaderOtp` must receive the PocketBase auth response and call:

```ts
pb.authStore.save(response.token, response.record);
```

Do not call `requestOTP`, `authWithOTP`, or native MFA email OTP APIs anywhere. `confirmPasswordReset` calls `pb.collection('users').confirmPasswordReset(token, password, passwordConfirm)`. `confirmEmailChange` calls `pb.collection('users').confirmEmailChange(token, password)`.

- [ ] **Step 4: Convert `MagicLinkForm` to the challenge flow**

Use states:

```ts
type OtpStage = 'request' | 'verify' | 'done';
const [stage, setStage] = useState<OtpStage>('request');
const [challengeId, setChallengeId] = useState('');
const [expiresIn, setExpiresIn] = useState(600);
```

The first submit stores `challengeId`; the second accepts exactly six digits and calls `verifyReaderOtp`. Keep the existing background and button language, enlarge neither layout nor hero typography, and show the approved generic message without disclosing account existence. After success navigate to `/`.

- [ ] **Step 5: Remove password-login native email MFA fallback**

Preserve password login and admin Passkey transition. When PocketBase returns an admin-capable record, continue to `AdminPasskeyStep`; do not present email OTP as MFA. Reader password login remains unchanged.

- [ ] **Step 6: Implement four focused account forms and pages**

Each page uses the existing auth layout/background rather than a new landing page. Behaviors:

```text
ForgotPasswordForm: email -> facade -> always approved generic success text
ResetPasswordForm: token from URL, password + confirmation -> confirmPasswordReset -> login link
ChangeEmailForm: authenticated user of any role, new email -> facade -> generic success text
EmailChangeResult: token from URL, current password -> confirmEmailChange -> refresh auth + success
```

Disable submit while pending, preserve entered non-secret email after recoverable errors, clear password fields after failure, and use `aria-live="polite"` for result text. Reject missing tokens client-side without sending a request.

- [ ] **Step 7: Wire navigation and package script**

Add `忘记密码` to `AuthPage`/password form and `修改邮箱` to `AuthStatusControl` only when authenticated. Add:

```json
{
  "test:account-mail-ui": "node scripts/test-account-mail-ui.mjs"
}
```

- [ ] **Step 8: Build and run desktop/mobile smoke**

Run:

```powershell
Set-Location astro
npm run build
$env:BASE_URL='http://127.0.0.1:4322'
npm run test:account-mail-ui
```

Expected: Astro build succeeds, five routes load, no console errors, no overflow at `390x844` or `1440x900`, and no unsupported native OTP API identifier remains under `astro/src`.

- [ ] **Step 9: Commit**

```powershell
git add astro/src/hooks/usePocketBase.ts astro/src/components/auth astro/src/pages/forgot-password.astro astro/src/pages/reset-password.astro astro/src/pages/change-email.astro astro/src/pages/confirm-email-change.astro astro/scripts/test-account-mail-ui.mjs astro/package.json
git commit -m "feat(auth): add account mail and reader OTP UI"
```

---

### Task 8: Build A Reproducible Local Account-Mail Integration Harness

**Files:**
- Create: `scripts/test-mail-account-local.ps1`
- Modify: `tests/mail-local/account_fixture.pb.js`
- Modify: `scripts/sensitive-check.ps1`
- Modify: `scripts/pre-deploy-check.ps1`

**Interfaces:**
- Consumes: `C:\tmp\mailpit-v1.30.0\mailpit.exe`, local Node/npm, `pb_local/pb/pocketbase.exe`.
- Produces: one command that proves account mail, decoy behavior, OTP limits/single-use, no secret persistence, and complete process cleanup.

- [ ] **Step 1: Write the harness preflight and failing expectation**

The script parameters are fixed:

```powershell
param(
  [string]$PocketBasePath = '.\pb_local\pb\pocketbase.exe',
  [string]$MailpitPath = 'C:\tmp\mailpit-v1.30.0\mailpit.exe',
  [int]$SmtpPort = 1125,
  [int]$MailpitUiPort = 8125,
  [int]$GatewayPort = 18787,
  [int]$PocketBasePort = 18092
)
$ErrorActionPreference = 'Stop'
```

Preflight checks both executable paths and ensures all four ports are free. It creates a unique ignored directory below `tmp/mail-account-local/<run-id>`. Before wiring the fixture, require the final response property `allPassed`; expected failure is `property allPassed not found`. The successful run also writes the roadmap-compatible non-secret evidence file `tmp/mail-evidence/account.json`.

- [ ] **Step 2: Start all three services with PowerShell jobs**

Use `Start-Job` with explicit working directories and environment objects; do not use `Start-Process`. Gateway env is loopback-only:

```powershell
function New-RunSecret {
  $bytes = New-Object byte[] 48
  $rng = [Security.Cryptography.RandomNumberGenerator]::Create()
  try { $rng.GetBytes($bytes) } finally { $rng.Dispose() }
  [Convert]::ToBase64String($bytes)
}

$mailInternalSecret = New-RunSecret
$mailHashSecret = New-RunSecret
$gatewayEnv = @{
  SMTP_HOST = '127.0.0.1'
  SMTP_PORT = '1125'
  SMTP_FROM_ADDRESS = 'noreply@example.local'
  SMTP_FROM_NAME = 'Local Blog'
  SMTP_TLS_MODE = 'auto'
  MAIL_LOCAL_TEST_MODE = 'true'
  MAIL_TEST_RECIPIENT_ALLOWLIST = 'reader@example.local,new-reader@example.local,admin@example.local'
  MAIL_INTERNAL_SECRET = $mailInternalSecret
  PUBLIC_SITE_URL = 'http://127.0.0.1:4321'
}
$pocketBaseEnv = @{
  MAIL_INTERNAL_SECRET = $mailInternalSecret
  MAIL_HASH_SECRET = $mailHashSecret
  MAIL_GATEWAY_INTERNAL_URL = 'http://127.0.0.1:18787'
  MAIL_GATEWAY_ENABLED = 'true'
  MAIL_ACCOUNT_ENABLED = 'true'
  MAIL_OTP_ENABLED = 'true'
  PUBLIC_SITE_URL = 'http://127.0.0.1:4321'
}
```

PocketBase receives only gateway URL and the two non-SMTP shared secrets. Poll Mailpit `/api/v1/info`, gateway `/health`, and PocketBase `/api/health` with 30-second bounded waits.

- [ ] **Step 3: Execute the full fixture and leak scans**

The fixture route returns:

```json
{
  "allPassed": true,
  "accountMessages": 3,
  "otpMessages": 1,
  "decoyCases": 4,
  "rateLimitCases": 3,
  "tokenLeaks": 0,
  "codeLeaks": 0
}
```

After assertions, query Mailpit only for message counts and test values. Run byte-level scans over the isolated `pb_data`, captured stdout/stderr, and generated Astro `dist` for the exact per-run account tokens, OTP code, HMAC secret, hash secret, and SMTP test recipient; only the intentionally rendered Mailpit message files may contain recipient/code/token test values. Write `tmp/mail-evidence/account.json` with the roadmap keys `phase`, `verificationDelivered`, `passwordResetDelivered`, `emailChangeDelivered`, `readerOtpAuthenticated`, `unknownOtpWasDecoy`, `adminOtpWasDecoy`, `plaintextTokenFindings`, and `plaintextOtpFindings`.

- [ ] **Step 4: Guarantee cleanup**

Wrap jobs in `try/finally`. In `finally`, stop/remove only recorded job IDs, poll all four ports until closed, and retain failed artifacts under `tmp/mail-account-local/<run-id>` while deleting successful run data. Never terminate processes by name.

- [ ] **Step 5: Add pre-deploy and sensitive checks**

Extend `sensitive-check.ps1` with exact patterns for assigned `ALIYUN_SMTP_PASSWORD`, `SMTP_PASSWORD`, `MAIL_INTERNAL_SECRET`, and `MAIL_HASH_SECRET` values plus the per-run captured test token/code values across tracked sources and `astro/dist`. Do not flag legitimate token parameter names or code-owned `preview-token`/`123456` sample literals; fail when the exact generated runtime values appear outside the isolated Mailpit message. Permit variable names in config readers but fail on assigned secret literals longer than eight characters. Extend `pre-deploy-check.ps1` to run Node gateway tests, all 13+ PocketBase hook syntax checks, Astro build, and the account harness only when `-IncludeLocalMailIntegration` is supplied.

- [ ] **Step 6: Run twice and verify no listeners remain**

Run:

```powershell
.\scripts\test-mail-account-local.ps1
.\scripts\test-mail-account-local.ps1
Get-NetTCPConnection -State Listen | Where-Object LocalPort -In 1125,8125,18787,18092
```

Expected: both runs return `allPassed=true`; final listener query is empty.

- [ ] **Step 7: Commit**

```powershell
git add scripts/test-mail-account-local.ps1 tests/mail-local/account_fixture.pb.js scripts/sensitive-check.ps1 scripts/pre-deploy-check.ps1
git commit -m "test(mail): cover account mail and reader OTP locally"
```

---

### Task 9: Run The Account-Mail Acceptance Gate

**Files:**
- Verify only; no planned source change.

**Interfaces:**
- Consumes: Tasks 1-8 and the completed gateway plan.
- Produces: local evidence suitable for starting comment Outbox work; no production deployment.

- [ ] **Step 1: Run all Node gateway tests**

Run `npm test` from `admin-auth`.

Expected: existing 23 WebAuthn tests plus all gateway tests pass; zero failures.

- [ ] **Step 2: Check every PocketBase hook and migration**

Run `node --check` for every `pb_hooks/*.pb.js`, `pb_hooks/lib/*.js`, and `pb_migrations/*.pb.js` file.

Expected: exit code `0` for every file.

- [ ] **Step 3: Run isolated account integration twice**

Run `.\scripts\test-mail-account-local.ps1` twice.

Expected each time: `allPassed=true`, three account messages, one OTP message, four decoys, all three rate-limit classes, zero token leaks, and zero code leaks.

- [ ] **Step 4: Build and smoke the frontend**

Run `npm run build` and `npm run test:account-mail-ui` from `astro` with a local preview.

Expected: all five account routes load at desktop/mobile sizes, no console errors, and no horizontal overflow.

- [ ] **Step 5: Prove credential and unsupported-API removal**

Run:

```powershell
Get-ChildItem pb_hooks,astro\src -Recurse -File | Select-String -Pattern 'requestOTP|authWithOTP|onRecordRequestOTPRequest|newMailClient\(\)|ALIYUN_SMTP_PASSWORD'
git grep -n -E 'SMTP_PASSWORD=.{8,}|MAIL_INTERNAL_SECRET=.{8,}|MAIL_HASH_SECRET=.{8,}' -- ':!*.example' ':!docs/superpowers/plans/*'
```

Expected: no matches.

- [ ] **Step 6: Record local evidence without secrets**

Append a dated section to the implementation PR description or operator notes containing test commands, pass counts, Mailpit version, PocketBase version, and the statement `production server unchanged`. Do not include recipient addresses, tokens, codes, signatures, or environment values.

- [ ] **Step 7: Commit any test-only correction separately**

If an acceptance check required a correction, commit only the corrected files with `fix(mail): satisfy account mail acceptance gate`, rerun the full gate, and leave the worktree with no account-plan changes unstaged.



---

## Self-Review

- Spec coverage: private account collections, structured templates, HMAC gateway forwarding, all three PocketBase account mails, enumeration-resistant facades, reader-only custom OTP, frontend pages, Caddy bypass prevention, local Mailpit integration, and plaintext token/code scans map to explicit tasks.
- Placeholder scan: every route, collection, field, limit, environment key, local port, command, expected result, and commit boundary is concrete; runtime secrets are generated by executable test code instead of document placeholders.
- Type consistency: the plan uses only `MAIL_INTERNAL_SECRET`, `MAIL_HASH_SECRET`, and `MAIL_GATEWAY_INTERNAL_URL`; route names, gateway categories, challenge fields, response shapes, and frontend method signatures match the roadmap and gateway plan.
- Runtime consistency: every PocketBase callback requires CommonJS modules inside the callback body, and account Mailer hooks return `false` for success, controlled failure, and disabled states.
