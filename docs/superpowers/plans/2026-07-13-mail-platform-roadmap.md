# Blog Mail Platform Roadmap Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Deliver a provider-neutral blog mail platform with account mail, reader OTP, durable comment notifications, super-admin mail management, host alerts, and a locally proven production rollout.

**Architecture:** The existing `admin-auth` Node service is the only SMTP boundary and exposes HMAC-authenticated internal mail routes. PocketBase 0.22.21 owns templates, account events, OTP challenges, Outbox state, permissions, and audits; Astro consumes only public auth facades and protected mail-admin DTOs. Implementation is split into four independently reviewable plans and must pass the local Mailpit gate before any production access.

**Tech Stack:** Node.js 22, Nodemailer 9.0.3, PocketBase 0.22.21 JSVM hooks and migrations, Astro 6, React 19, PowerShell 7, Mailpit 1.30.0, Python 3 standard library, Docker Compose, systemd.

## Global Constraints

- Keep PocketBase at exactly `0.22.21` and the browser PocketBase SDK at the existing `0.27.x` line.
- Reuse the existing `admin-auth` service, container name, internal port `8787`, WebAuthn routes, and `/health` behavior.
- SMTP host, username, password, and full sender address exist only in the `admin-auth` environment.
- Support Aliyun and every provider that implements authenticated standard SMTP; no provider-specific API belongs in business code.
- Accept legacy `ALIYUN_SMTP_*` names only when the corresponding generic `SMTP_*` value is absent.
- Keep account tokens and OTP plaintext in memory only; never persist them in PocketBase, Outbox, delivery logs, audit logs, browser storage, command arguments, or Git.
- Account mail, OTP, and comment notifications start disabled in production.
- Mail failures must not fail `admin-auth` health, WebAuthn, normal password login, comment persistence, or public browsing.
- Mail-admin writes require `super_admin`, verified email, a current Passkey-bound session, and the existing Caddy IP boundary.
- Local SMTP is Mailpit on `127.0.0.1:1125`; Mailpit UI/API is `127.0.0.1:8125`; port `1025` is not used.
- Local mail tests enforce an explicit recipient allowlist and cannot send to public Internet addresses.
- Production is untouched until the complete local evidence bundle passes and the user gives a new explicit approval.
- Preserve the existing unrelated `docker-compose.yml` localhost bind change and do not stage either obsolete untracked mail-design draft.
- Every behavior-bearing task starts with a failing test, proves the failure, implements the smallest behavior, proves the pass, and ends with a focused commit.

---

## Authoritative Contracts

### Internal Gateway Request

```ts
export type MailCategory =
  | 'account_verification'
  | 'account_password_reset'
  | 'account_email_change'
  | 'reader_otp'
  | 'comment_new'
  | 'comment_approved'
  | 'comment_reply'
  | 'admin_test'
  | 'ops_alert';

export interface MailGatewayRequest {
  requestId: string;
  messageId: string;
  category: MailCategory;
  to: string;
  subject: string;
  html: string;
  text: string;
}

export interface MailGatewaySuccess {
  ok: true;
  requestId: string;
  messageId: string;
  acceptedAt: string;
}

export interface MailGatewayFailure {
  ok: false;
  error: {
    code:
      | 'MAIL_NOT_CONFIGURED'
      | 'SMTP_AUTH'
      | 'SMTP_CONNECTION'
      | 'SMTP_TIMEOUT'
      | 'RECIPIENT_TEMPORARY'
      | 'RECIPIENT_PERMANENT'
      | 'PAYLOAD_INVALID'
      | 'RATE_LIMITED'
      | 'INTERNAL_ERROR';
    retryable: boolean;
  };
}
```

### HMAC Canonical Form

Both runtimes sign exactly this UTF-8 string and encode the HMAC-SHA256 digest as lowercase hexadecimal:

```text
{unixSeconds}\n{nonce}\n{UPPERCASE_METHOD}\n{path}\n{sha256HexOfRawBody}
```

Required headers are `X-Mail-Timestamp`, `X-Mail-Nonce`, and `X-Mail-Signature`. The gateway accepts at most 60 seconds of clock skew, rejects nonce reuse, and verifies the signature before parsing JSON. A GET request signs an empty byte body.

### PocketBase JSVM Rule

PocketBase 0.22 serializes every Hook and route callback into an executor VM, so callbacks cannot depend on lexical closure state. Every callback must load shared code inside its own body:

```js
routerAdd('GET', '/api/example', function (c) {
  const module = require(__hooks + '/lib/example.js');
  return c.json(200, module.handle(c));
});
```

This exact pattern was proven locally against the repository's PocketBase 0.22.21 binary. Shared files use CommonJS `module.exports`; top-level `.pb.js` entry files remain isolated IIFEs.

---

## Plan Map And Dependency Order

| Order | Plan | Independent deliverable | Depends on |
| --- | --- | --- | --- |
| 1 | `2026-07-13-mail-gateway.md` | HMAC-protected standard SMTP gateway and Mailpit integration | Existing `admin-auth` |
| 2 | `2026-07-13-account-mail-reader-otp.md` | Account facades, three account mail flows, reader-only custom OTP, account UI | Gateway contract |
| 3 | `2026-07-13-comment-outbox-mail-admin.md` | Comment Outbox, templates/rules/suppressions/logs, protected `/admin/mail` | Gateway and shared account mail foundation |
| 4 | `2026-07-13-ops-alerts-production-rollout.md` | Host alert state machine, local evidence bundle, approved production deployment | All previous plans |

The plans must be executed in this order. A later plan may consume only the interfaces listed above or explicitly produced by an earlier plan.

---

### Task 1: Complete The Internal Mail Gateway

**Files:**
- Execute: `docs/superpowers/plans/2026-07-13-mail-gateway.md`
- Verify: `admin-auth/test/mail/*.test.mjs`
- Verify: `scripts/test-mail-gateway-local.ps1`

**Interfaces:**
- Consumes: existing `createServer({ config, webauthnService })` and Node `/health`.
- Produces: `POST /internal/mail/send`, `POST /internal/mail/verify`, `GET /internal/mail/status`, `node src/mail/cli.mjs`.

- [ ] **Step 1: Execute every gateway plan checkbox in order**

Use subagent-driven development with one fresh implementer and two-stage review per task. Do not begin account work while a gateway task has an unresolved review finding.

- [ ] **Step 2: Run the gateway unit gate**

Run:

```powershell
Set-Location admin-auth
npm test
```

Expected: all existing WebAuthn/session tests and every `test/mail/*.test.mjs` test pass with zero failures.

- [ ] **Step 3: Run the Mailpit gateway gate**

Run:

```powershell
pwsh -File scripts/test-mail-gateway-local.ps1 -MailpitPath 'C:\tmp\mailpit-v1.30.0\mailpit.exe'
```

Expected final line:

```text
PASS mail gateway local integration: signed send, replay rejection, allowlist, verify, health isolation
```

- [ ] **Step 4: Record the phase gate**

Create `tmp/mail-evidence/gateway.json` through the test script with only non-secret data:

```json
{
  "phase": "gateway",
  "nodeTests": "pass",
  "mailpitMessages": 1,
  "replayRejected": true,
  "healthUnaffectedBySmtpFailure": true,
  "secretFindings": 0
}
```

Do not commit `tmp/mail-evidence` because `tmp/` is ignored.

---

### Task 2: Complete Account Mail And Reader OTP

**Files:**
- Execute: `docs/superpowers/plans/2026-07-13-account-mail-reader-otp.md`
- Verify: `scripts/test-mail-account-local.ps1`
- Verify: `astro/src/components/auth/*`

**Interfaces:**
- Consumes: signed gateway routes and the stable gateway error classes.
- Produces: `/api/blog-auth/password-reset/request`, `/api/blog-auth/verification/request`, `/api/blog-auth/email-change/request`, `/api/blog-auth/otp/request`, `/api/blog-auth/otp/verify`.

- [ ] **Step 1: Execute every account/OTP plan checkbox in order**

Keep `MAIL_ACCOUNT_ENABLED=false` and `MAIL_OTP_ENABLED=false` in committed examples until the local end-to-end task explicitly supplies process-local values.

- [ ] **Step 2: Run the isolated migration and Hook gate**

Run:

```powershell
pwsh -File scripts/test-mail-account-local.ps1 -PocketBasePath '.\pb_local\pb\pocketbase.exe' -MailpitPath 'C:\tmp\mailpit-v1.30.0\mailpit.exe'
```

Expected final line:

```text
PASS account mail local integration: verification, reset, email change, reader OTP, decoys, persistence scan
```

- [ ] **Step 3: Run frontend verification**

Run:

```powershell
Set-Location astro
npm run build
npm run check:mobile
```

Expected: both commands exit `0`; generated pages include `/forgot-password/`, `/reset-password/`, `/change-email/`, and `/confirm-email-change/`.

- [ ] **Step 4: Inspect the account evidence**

Require `tmp/mail-evidence/account.json` to contain:

```json
{
  "phase": "account",
  "verificationDelivered": true,
  "passwordResetDelivered": true,
  "emailChangeDelivered": true,
  "readerOtpAuthenticated": true,
  "unknownOtpWasDecoy": true,
  "adminOtpWasDecoy": true,
  "plaintextTokenFindings": 0,
  "plaintextOtpFindings": 0
}
```

---

### Task 3: Complete Comment Outbox And Mail Management

**Files:**
- Execute: `docs/superpowers/plans/2026-07-13-comment-outbox-mail-admin.md`
- Verify: `scripts/test-mail-outbox-local.ps1`
- Verify: `astro/src/pages/admin/mail/index.astro`

**Interfaces:**
- Consumes: `pb_hooks/lib/mail_gateway.js`, `pb_hooks/lib/mail_templates.js`, protected admin session verification.
- Produces: durable comment notifications and `/api/blog-admin/mail/*` DTO/command endpoints.

- [ ] **Step 1: Execute every Outbox/admin plan checkbox in order**

The migration-seeded `mail_rules.enabled` values remain `false`. Tests enable rules only inside the isolated test database.

- [ ] **Step 2: Run Outbox failure and recovery tests**

Run:

```powershell
pwsh -File scripts/test-mail-outbox-local.ps1 -PocketBasePath '.\pb_local\pb\pocketbase.exe' -MailpitPath 'C:\tmp\mailpit-v1.30.0\mailpit.exe'
```

Expected final line:

```text
PASS outbox local integration: recipients, dedupe, retry, suppression, admin authorization, redaction
```

- [ ] **Step 3: Build and inspect the mail-admin page**

Run:

```powershell
Set-Location astro
npm run build
npm run check:mobile
```

Expected: exit `0`; `/admin/mail/` exists; the desktop table and mobile labeled-list checks report no horizontal overflow.

- [ ] **Step 4: Inspect the Outbox evidence**

Require `tmp/mail-evidence/outbox.json` to contain:

```json
{
  "phase": "outbox-admin",
  "newCommentDelivered": true,
  "approvalDeliveredOnce": true,
  "replyDelivered": true,
  "dedupeWorked": true,
  "temporaryFailureRetried": true,
  "permanentFailureSuppressed": true,
  "nonAdminDenied": true,
  "missingPasskeyDenied": true,
  "sensitiveDtoFindings": 0
}
```

---

### Task 4: Complete Host Alerts And Local Release Gate

**Files:**
- Execute: `docs/superpowers/plans/2026-07-13-ops-alerts-production-rollout.md`
- Verify: `ops/test_hlydwz_monitor.py`
- Verify: `scripts/test-mail-platform-local.ps1`

**Interfaces:**
- Consumes: `node src/mail/cli.mjs` and all local subsystem tests.
- Produces: host monitor script, systemd units, complete local evidence, deployment/rollback procedure.

- [ ] **Step 1: Implement and unit-test the monitor without server access**

Run:

```powershell
python -m unittest ops.test_hlydwz_monitor -v
```

Expected: first-failure, cooldown, persistent failure, and recovery cases all pass.

- [ ] **Step 2: Run the complete local gate**

Run:

```powershell
pwsh -File scripts/test-mail-platform-local.ps1 -PocketBasePath '.\pb_local\pb\pocketbase.exe' -MailpitPath 'C:\tmp\mailpit-v1.30.0\mailpit.exe'
```

Expected final line:

```text
PASS complete local mail platform gate; production remains unchanged
```

- [ ] **Step 3: Review the evidence bundle**

The orchestrator must write `tmp/mail-evidence/summary.json` with this shape and all booleans true:

```json
{
  "productionTouched": false,
  "gateway": true,
  "account": true,
  "otp": true,
  "outbox": true,
  "mailAdmin": true,
  "opsMonitor": true,
  "astroBuild": true,
  "hookSyntax": true,
  "freshMigration": true,
  "existingRegression": true,
  "secretFindings": 0
}
```

- [ ] **Step 4: Stop and request production approval**

Report the exact evidence path and test counts. Do not open SSH, upload a package, edit production environment variables, or contact a real SMTP service until the user explicitly approves the production section of the rollout plan.

---

### Task 5: Execute The Approved Production Rollout

**Files:**
- Execute after approval only: production section of `docs/superpowers/plans/2026-07-13-ops-alerts-production-rollout.md`
- Verify: deployed release, three containers, site/API routes, Aliyun SMTP, alert timer.

**Interfaces:**
- Consumes: locally verified release artifact and operator-supplied production SMTP values.
- Produces: deployed platform with staged feature activation and a tested rollback route.

- [ ] **Step 1: Confirm the production approval applies to the exact commit and artifact hash**

The approval record must name the Git commit and SHA-256 from `tmp/mail-evidence/release.json`. Any code change after that evidence requires rerunning the complete local gate.

- [ ] **Step 2: Execute backup, isolated migration precheck, and disabled-feature deployment**

Use Docker Compose project name `current` in every `down`, `up`, and rollback command. Preserve the localhost Caddy origin bind.

- [ ] **Step 3: Verify the real Aliyun SMTP path, then enable features one at a time**

Enable in this order: account mail, reader OTP, comment rules, host monitor. Verify one real end-to-end result before moving to the next switch.

- [ ] **Step 4: Record production acceptance or run rollback**

Acceptance requires real account mail, reader OTP, all three comment events, admin-center operations, one synthetic host failure, one recovery alert, and zero secret findings. On failure, disable OTP and comment rules first, retain diagnostic records, then roll back the release without deleting migrations.

---

## Final Verification Matrix

| Requirement | Proof |
| --- | --- |
| Standard SMTP provider neutrality | Node config/transport unit tests with Aliyun aliases and a second generic SMTP fixture |
| Credentials stay in `admin-auth` | Compose inspection, PocketBase env inspection, DB/dist/log/Git secret scan |
| Account tokens stay ephemeral | Mailpit token extraction followed by raw temp DB and log byte scan |
| Reader-only OTP | Verified reader success plus unknown, unverified, author, admin, and super-admin decoy tests |
| Comment business availability | Comment create/update succeeds while Mailpit is stopped; Outbox enters retry |
| Durable retry and dedupe | Temp DB state assertions and Mailpit message counts |
| Protected admin management | role, email verification, fingerprint, token, IP, and Passkey-session negative tests |
| Host failure/recovery alerts | deterministic monitor unit tests plus one approved production synthetic check |
| No frontend regressions | Astro build, mobile viewport check, login/archive/home/admin smoke checks |
| Rollback viability | disabled flags, old release restart with Compose project `current`, health checks |

## Self-Review

- Spec coverage: gateway, account mail, OTP, comment Outbox, templates, rules, suppressions, logs, mail-admin UI, host alerts, local-first testing, staged deployment, and rollback each map to a named plan and evidence gate.
- Placeholder scan: every phase has exact files, interfaces, commands, expected terminal lines, and evidence shapes; no unresolved implementation marker is present.
- Type consistency: category names, route names, HMAC headers, error classes, feature flags, evidence keys, and the four-plan execution order are fixed here and reused by the subsystem plans.
- Runtime consistency: PocketBase callbacks load CommonJS modules from `__hooks` inside callback bodies, matching the locally proven 0.22.21 executor behavior.
