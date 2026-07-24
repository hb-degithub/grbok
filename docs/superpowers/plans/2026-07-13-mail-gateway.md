# Provider-Neutral Mail Gateway Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Extend the existing `admin-auth` service with a secure HMAC-authenticated SMTP gateway and stdin-only operations CLI that work with Aliyun and any standard SMTP provider.

**Architecture:** Mail configuration, SMTP transport, validation, stable errors, HTTP routing, and CLI handling live in focused modules under `admin-auth/src/mail`. The existing WebAuthn server delegates `/internal/mail/*` to a separate handler before its legacy `X-Internal-Secret` routing, so SMTP failure never changes `/health` or admin authentication behavior. Unit tests inject fake transports; one local integration test sends only to Mailpit.

**Tech Stack:** Node.js 22, Node built-in test runner, Nodemailer 9.0.3, SMTP with TLS 1.2+, Mailpit 1.30.0, PowerShell 7, Docker Compose.

## Global Constraints

- Keep existing WebAuthn, session, rate-limit, `/health`, host `0.0.0.0`, and internal port `8787` behavior intact.
- Use exact gateway routes `POST /internal/mail/send`, `POST /internal/mail/verify`, and `GET /internal/mail/status`.
- Authenticate mail routes only with `X-Mail-Timestamp`, `X-Mail-Nonce`, and `X-Mail-Signature`; `X-Internal-Secret` alone must not authorize them.
- Canonical HMAC input is `{timestamp}\n{nonce}\n{METHOD}\n{path}\n{sha256(rawBody)}`.
- Reject timestamps outside 60 seconds and reject nonce replay from a bounded in-memory cache.
- Allow exactly one recipient, one fixed environment sender, no cc/bcc, no attachments, and no caller headers.
- Subject is at most 255 characters and contains no CR/LF; HTML is at most 256 KiB; required text is at most 128 KiB.
- Never log bodies, addresses, SMTP responses, credentials, signatures, nonces, or stack traces.
- `/health` remains `200 {"status":"ok"}` when SMTP is missing or unreachable.
- Generic `SMTP_*` values take precedence over legacy Aliyun aliases.
- Production permits only implicit TLS or STARTTLS with minimum TLS 1.2.
- `MAIL_LOCAL_TEST_MODE=true` is valid only for loopback SMTP and requires a non-empty exact-address `MAIL_TEST_RECIPIENT_ALLOWLIST`.
- Every task follows red-green-refactor and ends with a focused commit.

---

## File Map

Create:
- `admin-auth/src/mail/constants.mjs` - categories, limits, and stable error names.
- `admin-auth/src/mail/config.mjs` - generic/legacy env resolution, TLS policy, local-test policy, redacted status.
- `admin-auth/src/mail/errors.mjs` - `MailError` and SMTP error classification.
- `admin-auth/src/mail/request-auth.mjs` - canonical HMAC, constant-time verification, skew and replay checks.
- `admin-auth/src/mail/validation.mjs` - strict request and operations-event validation.
- `admin-auth/src/mail/transport.mjs` - Nodemailer adapter with fixed sender and sanitized logging.
- `admin-auth/src/mail/service.mjs` - send, verify, and status orchestration.
- `admin-auth/src/mail/http.mjs` - raw-body HTTP handler and stable JSON responses.
- `admin-auth/src/mail/cli.mjs` - stdin operations-alert sender.
- `admin-auth/test/mail/config.test.mjs`
- `admin-auth/test/mail/errors.test.mjs`
- `admin-auth/test/mail/request-auth.test.mjs`
- `admin-auth/test/mail/validation.test.mjs`
- `admin-auth/test/mail/transport.test.mjs`
- `admin-auth/test/mail/service.test.mjs`
- `admin-auth/test/mail/http.test.mjs`
- `admin-auth/test/mail/cli.test.mjs`
- `admin-auth/test/mail/mailpit.integration.test.mjs`
- `scripts/test-mail-gateway-local.ps1`
- `scripts/check-mail-config.ps1`

Modify:
- `admin-auth/package.json` - add Nodemailer and `mail:cli` script.
- `admin-auth/package-lock.json` - lock Nodemailer 9.0.3.
- `admin-auth/src/config.mjs` - expose mail-independent admin config unchanged and mail dependencies to startup.
- `admin-auth/src/server.mjs` - delegate only `/internal/mail/*` to the mail handler.
- `admin-auth/test/server.test.mjs` - prove mail failure isolation and existing route compatibility.
- `admin-auth/Dockerfile` - retain current unprivileged image and make CLI source available.
- `docker-compose.yml` - move SMTP variables to `admin-auth`; add PocketBase gateway flags without SMTP credentials.
- `docker-compose.local.yml` - mirror the boundary for local compose users.
- `.env.example` - replace the mail section with UTF-8 generic names and legacy alias notes.
- `scripts/sensitive-check.ps1` - scan all new mail sources/config surfaces.
- `scripts/pre-deploy-check.ps1` - run the mail config check and Node tests.

---

### Task 1: Lock The Mail Dependency And Constants

**Files:**
- Modify: `admin-auth/package.json`
- Modify: `admin-auth/package-lock.json`
- Create: `admin-auth/src/mail/constants.mjs`
- Test: `admin-auth/test/mail/validation.test.mjs`

**Interfaces:**
- Consumes: Node 22 ESM.
- Produces: `MAIL_CATEGORIES`, `MAIL_ERROR_CODES`, `MAIL_LIMITS`, `isMailCategory(value)`.

- [ ] **Step 1: Write the failing constants test**

Add the first test to `admin-auth/test/mail/validation.test.mjs`:

```js
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { MAIL_CATEGORIES, MAIL_ERROR_CODES, MAIL_LIMITS, isMailCategory } from '../../src/mail/constants.mjs';

describe('mail constants', () => {
  it('locks the public categories, errors, and byte limits', () => {
    assert.deepEqual(MAIL_CATEGORIES, [
      'account_verification', 'account_password_reset', 'account_email_change',
      'reader_otp', 'comment_new', 'comment_approved', 'comment_reply',
      'admin_test', 'ops_alert',
    ]);
    assert.deepEqual(MAIL_ERROR_CODES, [
      'MAIL_NOT_CONFIGURED', 'SMTP_AUTH', 'SMTP_CONNECTION', 'SMTP_TIMEOUT',
      'RECIPIENT_TEMPORARY', 'RECIPIENT_PERMANENT', 'PAYLOAD_INVALID',
      'RATE_LIMITED', 'INTERNAL_ERROR',
    ]);
    assert.deepEqual(MAIL_LIMITS, { subjectChars: 255, htmlBytes: 262144, textBytes: 131072, rawBodyBytes: 401408 });
    assert.equal(isMailCategory('reader_otp'), true);
    assert.equal(isMailCategory('marketing'), false);
  });
});
```

- [ ] **Step 2: Run the test and prove the missing module failure**

Run:

```powershell
Set-Location admin-auth
node --test test/mail/validation.test.mjs
```

Expected: fail with `ERR_MODULE_NOT_FOUND` for `src/mail/constants.mjs`.

- [ ] **Step 3: Add the dependency and constants**

Run:

```powershell
npm install --save-exact nodemailer@9.0.3
```

Add this script to `package.json` without changing existing scripts:

```json
{
  "mail:cli": "node src/mail/cli.mjs"
}
```

Implement `constants.mjs` with frozen arrays and limits exactly matching the test. `isMailCategory` returns `MAIL_CATEGORIES.includes(String(value || ''))`.

- [ ] **Step 4: Run the focused test**

Run `node --test test/mail/validation.test.mjs`.

Expected: one passing test and zero failures.

- [ ] **Step 5: Commit**

```powershell
git add admin-auth/package.json admin-auth/package-lock.json admin-auth/src/mail/constants.mjs admin-auth/test/mail/validation.test.mjs
git commit -m "feat(mail): lock gateway contracts"
```

---

### Task 2: Parse SMTP Configuration Without Leaking Credentials

**Files:**
- Create: `admin-auth/src/mail/config.mjs`
- Create: `admin-auth/test/mail/config.test.mjs`

**Interfaces:**
- Consumes: a string-keyed environment object.
- Produces: `createMailConfig(source)`, `redactMailStatus(config, state, now)`.

The internal `MailConfig` shape is fixed:

```ts
interface MailConfig {
  configured: boolean;
  host: string;
  port: number;
  username: string;
  password: string;
  fromAddress: string;
  fromName: string;
  fromDomain: string;
  tlsMode: 'implicit' | 'starttls' | 'auto';
  secure: boolean;
  requireTLS: boolean;
  connectionTimeoutMs: number;
  socketTimeoutMs: number;
  providerLabel: string;
  alertRecipients: string[];
  siteUrl: string;
  localTestMode: boolean;
  testRecipientAllowlist: string[];
}
```

- [ ] **Step 1: Write failing configuration tests**

Cover these exact cases in `config.test.mjs`:

```js
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { createMailConfig, redactMailStatus } from '../../src/mail/config.mjs';

const generic = {
  SMTP_HOST: 'smtp.example.net', SMTP_PORT: '587', SMTP_USERNAME: 'user', SMTP_PASSWORD: 'secret',
  SMTP_FROM_ADDRESS: 'noreply@example.net', SMTP_FROM_NAME: 'Blog', SMTP_TLS_MODE: 'auto',
  SMTP_CONNECTION_TIMEOUT_MS: '8000', SMTP_SOCKET_TIMEOUT_MS: '15000',
  MAIL_PROVIDER_LABEL: 'Generic SMTP', PUBLIC_SITE_URL: 'https://hlydwz.com',
  MAIL_ALERT_RECIPIENTS: 'ops1@example.net,ops2@example.net',
};

describe('createMailConfig', () => {
  it('prefers generic values and maps auto:587 to STARTTLS', () => {
    const config = createMailConfig({ ...generic, ALIYUN_SMTP_HOST: 'ignored.aliyun.com' });
    assert.equal(config.host, 'smtp.example.net');
    assert.equal(config.secure, false);
    assert.equal(config.requireTLS, true);
    assert.equal(config.configured, true);
  });

  it('maps auto:465 to implicit TLS and reads legacy aliases', () => {
    const config = createMailConfig({
      ALIYUN_SMTP_HOST: 'smtpdm.aliyun.com', ALIYUN_SMTP_PORT: '465',
      ALIYUN_SMTP_USER: 'mailer@example.com', ALIYUN_SMTP_PASSWORD: 'secret',
      ALIYUN_FROM_EMAIL: 'noreply@example.com', ALIYUN_FROM_NAME: 'Blog',
      SMTP_TLS_MODE: 'auto', PUBLIC_SITE_URL: 'https://hlydwz.com',
    });
    assert.equal(config.secure, true);
    assert.equal(config.requireTLS, false);
    assert.equal(config.host, 'smtpdm.aliyun.com');
  });

  it('allows unauthenticated loopback only in local test mode', () => {
    const config = createMailConfig({
      SMTP_HOST: '127.0.0.1', SMTP_PORT: '1125', SMTP_FROM_ADDRESS: 'noreply@example.local',
      SMTP_FROM_NAME: 'Local Blog', SMTP_TLS_MODE: 'auto', MAIL_LOCAL_TEST_MODE: 'true',
      MAIL_TEST_RECIPIENT_ALLOWLIST: 'reader@example.local', PUBLIC_SITE_URL: 'http://127.0.0.1:4321',
    });
    assert.equal(config.configured, true);
    assert.equal(config.localTestMode, true);
  });

  it('returns only redacted status fields', () => {
    const config = createMailConfig(generic);
    const status = redactMailStatus(config, { lastVerify: 'ok' }, new Date('2026-07-13T00:00:00Z'));
    assert.deepEqual(Object.keys(status).sort(), ['checkedAt', 'configured', 'fromDomain', 'lastVerify', 'port', 'providerLabel', 'tlsMode'].sort());
    assert.equal(JSON.stringify(status).includes('smtp.example.net'), false);
    assert.equal(JSON.stringify(status).includes('user'), false);
    assert.equal(JSON.stringify(status).includes('secret'), false);
  });
});
```

Also test invalid ports, `SMTP_TLS_MODE`, mismatched username/password, timeout clamps (`1000..30000` connection, `3000..120000` socket), non-HTTPS production site URL, empty local allowlist, and non-loopback local mode.

- [ ] **Step 2: Run and prove failure**

Run `node --test test/mail/config.test.mjs` from `admin-auth`.

Expected: `ERR_MODULE_NOT_FOUND`.

- [ ] **Step 3: Implement deterministic config parsing**

Use generic-first lookup for each pair:

```js
const aliases = {
  SMTP_HOST: 'ALIYUN_SMTP_HOST', SMTP_PORT: 'ALIYUN_SMTP_PORT',
  SMTP_USERNAME: 'ALIYUN_SMTP_USER', SMTP_PASSWORD: 'ALIYUN_SMTP_PASSWORD',
  SMTP_FROM_ADDRESS: 'ALIYUN_FROM_EMAIL', SMTP_FROM_NAME: 'ALIYUN_FROM_NAME',
};

function value(source, name) {
  const primary = String(source[name] || '').trim();
  return primary || String(source[aliases[name]] || '').trim();
}
```

Set `configured=false` instead of throwing when all SMTP values are absent. Throw sanitized startup configuration errors for partial or unsafe configurations. `redactMailStatus` must construct a new object and never spread `config`.

- [ ] **Step 4: Run the focused tests**

Run `node --test test/mail/config.test.mjs`.

Expected: all configuration cases pass.

- [ ] **Step 5: Commit**

```powershell
git add admin-auth/src/mail/config.mjs admin-auth/test/mail/config.test.mjs
git commit -m "feat(mail): parse provider neutral smtp config"
```

---

### Task 3: Implement Canonical HMAC And Replay Protection

**Files:**
- Create: `admin-auth/src/mail/request-auth.mjs`
- Create: `admin-auth/test/mail/request-auth.test.mjs`

**Interfaces:**
- Produces: `canonicalMailRequest(input)`, `signMailRequest(input, secret)`, `createMailRequestVerifier(options)`.

```ts
interface VerifyInput {
  method: string;
  path: string;
  rawBody: Buffer;
  timestamp: string;
  nonce: string;
  signature: string;
}

type VerifyResult = { ok: true } | { ok: false; reason: 'missing' | 'timestamp' | 'nonce' | 'signature' | 'replay' };
```

- [ ] **Step 1: Write failing cryptographic tests**

Use a fixed secret and cross-runtime vector:

```js
const vector = {
  method: 'POST', path: '/internal/mail/send', timestamp: '1783872000', nonce: '0123456789abcdef0123456789abcdef',
  rawBody: Buffer.from('{"requestId":"req_1"}', 'utf8'),
};
assert.equal(
  canonicalMailRequest(vector),
  '1783872000\n0123456789abcdef0123456789abcdef\nPOST\n/internal/mail/send\n' +
    createHash('sha256').update(vector.rawBody).digest('hex')
);
assert.equal(signMailRequest(vector, '0123456789abcdef0123456789abcdef'),
  createHmac('sha256', '0123456789abcdef0123456789abcdef').update(canonicalMailRequest(vector)).digest('hex'));
```

Test missing headers, malformed timestamp, 61-second skew, nonce outside `[16,128]` safe characters, wrong-length signature, wrong signature, first-use pass, replay fail, expiry reuse pass, and cache cap eviction.

- [ ] **Step 2: Run and prove failure**

Run `node --test test/mail/request-auth.test.mjs`.

Expected: module missing.

- [ ] **Step 3: Implement HMAC verification**

Use `createHash`, `createHmac`, and `timingSafeEqual` from `node:crypto`. Compare decoded signature buffers only after exact 64-hex validation. `createMailRequestVerifier` receives injectable `nowSeconds`, `maxSkewSeconds=60`, `nonceTtlSeconds=120`, and `maxNonces=5000` for deterministic tests.

Record a nonce only after the timestamp and signature both pass. Cleanup expired entries before cap eviction.

- [ ] **Step 4: Run the tests**

Expected: all HMAC/skew/replay tests pass.

- [ ] **Step 5: Commit**

```powershell
git add admin-auth/src/mail/request-auth.mjs admin-auth/test/mail/request-auth.test.mjs
git commit -m "security(mail): authenticate gateway requests"
```

---

### Task 4: Validate Payloads And Classify SMTP Errors

**Files:**
- Modify: `admin-auth/src/mail/constants.mjs`
- Create: `admin-auth/src/mail/validation.mjs`
- Create: `admin-auth/src/mail/errors.mjs`
- Modify: `admin-auth/test/mail/validation.test.mjs`
- Create: `admin-auth/test/mail/errors.test.mjs`

**Interfaces:**
- Produces: `validateMailPayload(value, config)`, `validateOpsEvent(value)`, `MailError`, `classifySmtpError(error)`.

- [ ] **Step 1: Add failing strict-validation tests**

Use this valid fixture:

```js
const valid = {
  requestId: 'req_01J00000000000000000000000',
  messageId: 'msg_01J00000000000000000000000',
  category: 'reader_otp',
  to: 'reader@example.local',
  subject: '登录验证码',
  html: '<p>验证码 123456</p>',
  text: '验证码 123456',
};
```

Assert rejection of missing/extra keys, multiple recipients, display-name syntax, newline subject, unknown category, invalid IDs, empty text, byte overflows with multibyte UTF-8, caller `from`, headers, attachments, cc/bcc, and a local recipient outside the exact allowlist.

For operations events accept only:

```js
{
  eventId: 'ops_01J00000000000000000000000',
  check: 'public_health',
  state: 'firing',
  observedAt: '2026-07-13T00:00:00.000Z',
  summary: 'Public health endpoint failed',
}
```

Allowed checks are `container_caddy`, `container_pocketbase`, `container_admin_auth`, `public_health`, `backup_age`, and `disk_usage`; allowed states are `firing` and `recovered`; summary max is 500 characters.

- [ ] **Step 2: Add failing SMTP classification tests**

Test this exact mapping:

```js
[
  [{ code: 'EAUTH' }, ['SMTP_AUTH', false]],
  [{ code: 'ETIMEDOUT' }, ['SMTP_TIMEOUT', true]],
  [{ code: 'ECONNECTION' }, ['SMTP_CONNECTION', true]],
  [{ responseCode: 421 }, ['RATE_LIMITED', true]],
  [{ responseCode: 450 }, ['RECIPIENT_TEMPORARY', true]],
  [{ responseCode: 550 }, ['RECIPIENT_PERMANENT', false]],
  [{ code: 'UNKNOWN' }, ['INTERNAL_ERROR', true]],
].forEach(([error, expected]) => {
  const classified = classifySmtpError(error);
  assert.deepEqual([classified.code, classified.retryable], expected);
});
```

- [ ] **Step 3: Run and prove both failures**

Run:

```powershell
node --test test/mail/validation.test.mjs test/mail/errors.test.mjs
```

Expected: missing exports/modules.

- [ ] **Step 4: Implement validation and stable errors**

`MailError` contains only `code`, `retryable`, and a fixed public message. Preserve the original SMTP exception only as a non-enumerable `cause`; never serialize it. Validate string byte sizes with `Buffer.byteLength(value, 'utf8')`.

Validate both `requestId` and `messageId` with `/^[A-Za-z][A-Za-z0-9_-]{19,127}$/`; angle brackets, at-signs, dots, whitespace, and control characters are invalid at this layer. Normalize the recipient to lowercase after validation. Return a new payload object containing exactly the seven contract keys.

- [ ] **Step 5: Run tests and commit**

Expected: both files pass.

```powershell
git add admin-auth/src/mail/constants.mjs admin-auth/src/mail/validation.mjs admin-auth/src/mail/errors.mjs admin-auth/test/mail/validation.test.mjs admin-auth/test/mail/errors.test.mjs
git commit -m "security(mail): validate payloads and classify failures"
```

---

### Task 5: Build The Nodemailer Transport And Service

**Files:**
- Create: `admin-auth/src/mail/transport.mjs`
- Create: `admin-auth/src/mail/service.mjs`
- Create: `admin-auth/test/mail/transport.test.mjs`
- Create: `admin-auth/test/mail/service.test.mjs`

**Interfaces:**
- Produces: `createMailTransport({ config, nodemailer, logger })` and `createMailService({ config, transport, clock, logger })`.

`MailService` exposes:

```ts
interface MailService {
  send(payload: MailGatewayRequest): Promise<MailGatewaySuccess>;
  verify(): Promise<{ ok: true; verifiedAt: string }>;
  status(): { configured: boolean; providerLabel: string; port: number; tlsMode: string; fromDomain: string; lastVerify: string; checkedAt: string };
  sendOpsEvent(event: OpsEvent): Promise<{ sent: number }>;
}
```

- [ ] **Step 1: Write failing transport tests with a fake Nodemailer adapter**

Assert the adapter receives:

```js
assert.deepEqual(options, {
  host: 'smtp.example.net',
  port: 587,
  secure: false,
  requireTLS: true,
  auth: { user: 'user', pass: 'secret' },
  connectionTimeout: 8000,
  greetingTimeout: 8000,
  socketTimeout: 15000,
  tls: { minVersion: 'TLSv1.2', servername: 'smtp.example.net' },
});
```

Assert `sendMail` always receives the environment `from`, one `to`, generated stable `messageId`, subject/html/text, and no spread of caller data. Capture the logger and assert its JSON contains request ID, category, duration, and result but not recipient, content, host, username, password, or SMTP response.

- [ ] **Step 2: Write failing service tests**

Cover configured send, missing config, verify success/failure state, transport error classification, fixed operations templates, one send per `MAIL_ALERT_RECIPIENTS` address, and no failure propagation into unrelated service state.

- [ ] **Step 3: Run and prove failure**

Run `node --test test/mail/transport.test.mjs test/mail/service.test.mjs`.

Expected: missing modules.

- [ ] **Step 4: Implement the transport**

Construct the stable SMTP Message-ID as:

```js
const local = payload.messageId.replace(/[^A-Za-z0-9._-]/g, '_').slice(0, 120);
const messageId = `<${local}@${config.fromDomain}>`;
```

For local mode omit `auth`, set `secure=false`, `requireTLS=false`, and only permit loopback as already validated by config. Do not enable Nodemailer debug/logger flags.

- [ ] **Step 5: Implement the service**

Render operations alerts in code from the validated event. The subject is `[博客告警] {check} {state}`; both HTML and text include check, state, observed time, and escaped summary. Do not accept caller-provided template or recipient.

Store only the last verify status in process memory as `never`, `ok`, or an allowed stable error code. `status()` delegates to `redactMailStatus`.

- [ ] **Step 6: Run focused tests and commit**

Expected: all transport/service tests pass.

```powershell
git add admin-auth/src/mail/transport.mjs admin-auth/src/mail/service.mjs admin-auth/test/mail/transport.test.mjs admin-auth/test/mail/service.test.mjs
git commit -m "feat(mail): add smtp transport service"
```

---

### Task 6: Add HMAC-Protected HTTP Routes Without Breaking WebAuthn

**Files:**
- Create: `admin-auth/src/mail/http.mjs`
- Create: `admin-auth/test/mail/http.test.mjs`
- Modify: `admin-auth/src/server.mjs`
- Modify: `admin-auth/test/server.test.mjs`
- Modify: `admin-auth/src/config.mjs`

**Interfaces:**
- Consumes: `createMailRequestVerifier`, `validateMailPayload`, `MailService`.
- Produces: `createMailHttpHandler({ verifier, service, config })` whose `handle(req, res, url)` returns `true` only for `/internal/mail/*`.

- [ ] **Step 1: Write failing route tests**

Cover:
- unsigned request returns `401` before JSON parsing;
- malformed signed JSON returns `400 PAYLOAD_INVALID`;
- valid signed send returns `200` success DTO;
- replay returns `401`;
- `X-Internal-Secret` without HMAC returns `401`;
- GET status signs empty body and returns only redacted fields;
- verify uses POST and no body fields;
- wrong method returns `405`;
- unknown `/internal/mail/*` returns `404`;
- raw body over 401408 bytes returns `413 PAYLOAD_INVALID`;
- all responses have `Cache-Control: no-store` and `X-Content-Type-Options: nosniff`.

- [ ] **Step 2: Add a failing regression test to `server.test.mjs`**

Instantiate `createServer({ config, webauthnService, mailHttpHandler })` with a fake handler and assert:

```js
assert.equal((await fetch(`${baseUrl}/health`)).status, 200);
assert.equal((await fetch(`${baseUrl}/internal/mail/status`)).status, 418);
assert.equal((await fetch(`${baseUrl}/internal/webauthn/registration/options`, webauthnRequest)).status, 200);
```

Then use a throwing mail service and reassert `/health` and WebAuthn remain `200`.

- [ ] **Step 3: Run and prove failures**

Run `node --test test/mail/http.test.mjs test/server.test.mjs`.

Expected: missing handler/injection behavior.

- [ ] **Step 4: Implement the raw-body handler**

Verify headers against the exact raw `Buffer` before `JSON.parse`. Map authentication failures to generic `401 {"ok":false,"error":{"code":"INTERNAL_ERROR","retryable":false}}` so the response does not reveal skew, signature, or replay details.

Map `MailError` codes to status: payload `400`, not configured `503`, rate limited `429`, permanent recipient `422`, other SMTP `503`, internal `500`.

- [ ] **Step 5: Integrate with `server.mjs`**

Immediately after `/health` handling and before the existing generic `/internal/` secret check, add:

```js
if (url.pathname.startsWith('/internal/mail/')) {
  const handled = await mailHttpHandler.handle(req, res, url);
  if (handled) return;
}
```

`startServer()` constructs mail config/service/handler once. Missing SMTP config must not throw. Keep existing `createConfig()` admin-secret validation unchanged.

- [ ] **Step 6: Run the complete Node test suite**

Run `npm test` from `admin-auth`.

Expected: all original 23 tests plus new mail tests pass with zero failures.

- [ ] **Step 7: Commit**

```powershell
git add admin-auth/src/config.mjs admin-auth/src/server.mjs admin-auth/src/mail/http.mjs admin-auth/test/server.test.mjs admin-auth/test/mail/http.test.mjs
git commit -m "feat(mail): expose signed internal gateway api"
```

---

### Task 7: Add The Stdin-Only Operations CLI

**Files:**
- Create: `admin-auth/src/mail/cli.mjs`
- Create: `admin-auth/test/mail/cli.test.mjs`
- Modify: `admin-auth/package.json`

**Interfaces:**
- Consumes: one validated operations event from stdin, max 65536 bytes.
- Produces: exit `0` and `{"ok":true,"sent":N}` or exit `1` and a stable non-sensitive error line.

- [ ] **Step 1: Write failing CLI tests**

Export `runMailCli({ stdin, stdout, stderr, argv, service })` for tests. Assert:
- a valid event calls `service.sendOpsEvent` once;
- empty/malformed/oversized input exits `1`;
- any positional argument exits `1` so bodies cannot be passed in process arguments;
- stdout/stderr never contain summary text, recipients, or injected SMTP error messages;
- service errors print only an allowed stable code.

- [ ] **Step 2: Run and prove failure**

Run `node --test test/mail/cli.test.mjs`.

Expected: module missing.

- [ ] **Step 3: Implement and wire the CLI**

When executed directly, create the mail config/transport/service and read stdin to EOF with the 64 KiB cap. Output this success shape only:

```json
{"ok":true,"sent":2}
```

Do not call the HTTP gateway and do not require `MAIL_INTERNAL_SECRET`; the CLI is already inside the `admin-auth` container and uses the same SMTP service directly.

- [ ] **Step 4: Run tests and commit**

```powershell
node --test test/mail/cli.test.mjs
git add admin-auth/src/mail/cli.mjs admin-auth/test/mail/cli.test.mjs admin-auth/package.json
git commit -m "feat(mail): add stdin operations alert cli"
```

---

### Task 8: Enforce The Compose Credential Boundary

**Files:**
- Modify: `docker-compose.yml`
- Modify: `docker-compose.local.yml`
- Modify: `.env.example`
- Create: `scripts/check-mail-config.ps1`
- Modify: `scripts/sensitive-check.ps1`
- Modify: `scripts/pre-deploy-check.ps1`

**Interfaces:**
- Produces: SMTP variables only under `admin-auth`; gateway URL/hash secret/flags under PocketBase.

- [ ] **Step 1: Write the failing static configuration check**

`check-mail-config.ps1` must parse each compose file as text and fail unless:
- `admin-auth` contains all generic SMTP variables, `MAIL_INTERNAL_SECRET`, `PUBLIC_SITE_URL`, `MAIL_PROVIDER_LABEL`, and `MAIL_ALERT_RECIPIENTS`;
- `pocketbase` contains `MAIL_INTERNAL_SECRET`, `MAIL_HASH_SECRET`, `MAIL_GATEWAY_INTERNAL_URL`, `MAIL_GATEWAY_ENABLED`, `MAIL_ACCOUNT_ENABLED`, `MAIL_OTP_ENABLED`, and `PUBLIC_SITE_URL`;
- the PocketBase service block contains no `SMTP_` or `ALIYUN_` variable;
- no `ports:` mapping exists in the `admin-auth` block;
- `.env.example` sets all three feature flags to `false` and contains no real-looking credential.

Expected failure before edits.

- [ ] **Step 2: Move the variables**

Use these compose environment entries for `admin-auth`:

```yaml
- SMTP_HOST=${SMTP_HOST:-}
- SMTP_PORT=${SMTP_PORT:-}
- SMTP_USERNAME=${SMTP_USERNAME:-}
- SMTP_PASSWORD=${SMTP_PASSWORD:-}
- SMTP_FROM_ADDRESS=${SMTP_FROM_ADDRESS:-}
- SMTP_FROM_NAME=${SMTP_FROM_NAME:-}
- SMTP_TLS_MODE=${SMTP_TLS_MODE:-auto}
- SMTP_CONNECTION_TIMEOUT_MS=${SMTP_CONNECTION_TIMEOUT_MS:-10000}
- SMTP_SOCKET_TIMEOUT_MS=${SMTP_SOCKET_TIMEOUT_MS:-30000}
- MAIL_PROVIDER_LABEL=${MAIL_PROVIDER_LABEL:-Standard SMTP}
- MAIL_ALERT_RECIPIENTS=${MAIL_ALERT_RECIPIENTS:-}
- MAIL_INTERNAL_SECRET=${MAIL_INTERNAL_SECRET}
- PUBLIC_SITE_URL=${PUBLIC_SITE_URL:-https://hlydwz.com}
- ALIYUN_SMTP_HOST=${ALIYUN_SMTP_HOST:-}
- ALIYUN_SMTP_PORT=${ALIYUN_SMTP_PORT:-}
- ALIYUN_SMTP_USER=${ALIYUN_SMTP_USER:-}
- ALIYUN_SMTP_PASSWORD=${ALIYUN_SMTP_PASSWORD:-}
- ALIYUN_FROM_EMAIL=${ALIYUN_FROM_EMAIL:-}
- ALIYUN_FROM_NAME=${ALIYUN_FROM_NAME:-}
```

Use these for PocketBase:

```yaml
- MAIL_INTERNAL_SECRET=${MAIL_INTERNAL_SECRET}
- MAIL_HASH_SECRET=${MAIL_HASH_SECRET}
- MAIL_GATEWAY_INTERNAL_URL=http://admin-auth:8787
- MAIL_GATEWAY_ENABLED=${MAIL_GATEWAY_ENABLED:-false}
- MAIL_ACCOUNT_ENABLED=${MAIL_ACCOUNT_ENABLED:-false}
- MAIL_OTP_ENABLED=${MAIL_OTP_ENABLED:-false}
- PUBLIC_SITE_URL=${PUBLIC_SITE_URL:-https://hlydwz.com}
```

Do not alter the existing Caddy localhost port binding.

- [ ] **Step 3: Rewrite only the mail section of `.env.example` as valid UTF-8**

Document generic variables first, legacy aliases second, three false feature flags, `MAIL_INTERNAL_SECRET`, and `MAIL_HASH_SECRET`. Example secrets must use `REPLACE_WITH_...`; password must remain `your_smtp_password_here`.

- [ ] **Step 4: Extend secret scanning**

Scan committed/staged files for `SMTP_PASSWORD`, `ALIYUN_SMTP_PASSWORD`, `MAIL_INTERNAL_SECRET`, and `MAIL_HASH_SECRET` assigned to long literal values. Add every `admin-auth/src/mail/*.mjs`, `pb_hooks/lib/mail*.js`, compose file, ops file, and mail plan runtime file to the inspected surfaces.

- [ ] **Step 5: Run static checks**

Run:

```powershell
pwsh -File scripts/check-mail-config.ps1
pwsh -File scripts/sensitive-check.ps1
```

Expected: both exit `0`; sensitive check reports zero findings.

- [ ] **Step 6: Commit only intended files**

Before staging, inspect `git diff -- docker-compose.yml` and preserve the pre-existing localhost bind. Stage the whole compose file because the mail boundary and localhost bind are both intended production hardening changes; do not stage obsolete design drafts.

```powershell
git add docker-compose.yml docker-compose.local.yml .env.example scripts/check-mail-config.ps1 scripts/sensitive-check.ps1 scripts/pre-deploy-check.ps1
git commit -m "security(mail): isolate smtp credentials in gateway"
```

---

### Task 9: Prove The Gateway Against Local Mailpit

**Files:**
- Create: `admin-auth/test/mail/mailpit.integration.test.mjs`
- Create: `scripts/test-mail-gateway-local.ps1`

**Interfaces:**
- Consumes: Mailpit `127.0.0.1:1125` and API `http://127.0.0.1:8125/api/v1/messages`.
- Produces: `tmp/mail-evidence/gateway.json`.

- [ ] **Step 1: Write the integration test before the launcher**

The Node test reads `MAIL_GATEWAY_TEST_URL` and `MAIL_INTERNAL_SECRET`, signs requests with `signMailRequest`, and asserts:
1. `/health` is `200`;
2. unsigned send is `401`;
3. signed send to `reader@example.local` is `200`;
4. replay is `401`;
5. signed send to `outside@example.net` is `400`;
6. Mailpit contains exactly one message with expected UTF-8 subject, HTML, text, and fixed sender;
7. signed verify succeeds;
8. after Mailpit stops, `/health` stays `200` and send returns stable `SMTP_CONNECTION` or `SMTP_TIMEOUT` without raw SMTP text.

Skip the file unless `MAILPIT_INTEGRATION=1`; a skip is not accepted by the phase gate.

- [ ] **Step 2: Run directly and observe the expected connection failure**

Run:

```powershell
Set-Location admin-auth
$env:MAILPIT_INTEGRATION='1'
node --test test/mail/mailpit.integration.test.mjs
```

Expected: fail because Mailpit and the gateway launcher are not running.

- [ ] **Step 3: Implement the PowerShell launcher with jobs**

Use `Start-Job` rather than `Start-Process`; the current machine has a `Path`/`PATH` collision in `Start-Process`. The script must:
- reject a Mailpit path outside `C:\tmp` unless explicitly supplied;
- prove ports 1125, 8125, and 18787 are free;
- clear `tmp/mail-gateway-e2e`;
- start Mailpit with `--smtp 127.0.0.1:1125 --listen 127.0.0.1:8125`;
- start `node admin-auth/src/server.mjs` on `127.0.0.1:18787` with local-test config and allowlist `reader@example.local`;
- wait with bounded retries;
- run the integration test;
- stop/remove both jobs in `finally`;
- prove all three ports are closed;
- write the evidence JSON without secrets.

- [ ] **Step 4: Run the local integration gate**

Run:

```powershell
pwsh -File scripts/test-mail-gateway-local.ps1 -MailpitPath 'C:\tmp\mailpit-v1.30.0\mailpit.exe'
```

Expected final line:

```text
PASS mail gateway local integration: signed send, replay rejection, allowlist, verify, health isolation
```

- [ ] **Step 5: Run all Node regressions**

Run `npm test` from `admin-auth` with integration mode unset.

Expected: zero failures and one intentional integration skip.

- [ ] **Step 6: Commit**

```powershell
git add admin-auth/test/mail/mailpit.integration.test.mjs scripts/test-mail-gateway-local.ps1
git commit -m "test(mail): prove gateway with local mailpit"
```

---

## Self-Review

- Spec coverage: generic and Aliyun config, TLS, HMAC, replay, strict payloads, fixed sender, stable errors, redacted logs/status, verify route, health isolation, stdin CLI, Compose credential boundary, Mailpit, and recipient allowlist are assigned to explicit tasks.
- Placeholder scan: every test has concrete inputs and expected outcomes; every route, export, variable, command, port, and commit is named.
- Type consistency: `MailCategory`, error codes, gateway payload fields, config fields, route paths, HMAC canonical form, and evidence keys match the roadmap.
- Regression boundary: `server.mjs` delegates mail routes before legacy internal-secret handling while all non-mail behavior remains under existing tests.
