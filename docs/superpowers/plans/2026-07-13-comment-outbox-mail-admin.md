# Comment Outbox And Mail Admin Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add durable comment-notification delivery with deduplication, retries, suppression, and a secure `/admin/mail` control surface that never exposes SMTP credentials or delivery bodies outside an explicit safe template preview.

**Architecture:** Comment hooks derive recipients and enqueue one private Outbox record per address without performing network I/O. A single-instance PocketBase cron worker atomically leases due records one at a time, renders structured templates, checks rules/suppressions, and calls the existing signed gateway. Custom `/api/blog-admin/mail/*` routes revalidate super-admin identity, verified email, Passkey session, and Caddy IP boundary, then return only redacted DTOs to a compact React management view.

**Tech Stack:** PocketBase 0.22.21 JavaScript hooks/migrations, SQLite transactions and indexes, Astro 6, React 19, PocketBase SDK 0.27, Playwright 1.61, Mailpit 1.30.0, PowerShell 7.

## Global Constraints

- Complete and verify both `2026-07-13-mail-gateway.md` and `2026-07-13-account-mail-reader-otp.md` before this plan.
- Run the full implementation and Mailpit tests on this computer before any production change.
- Require `require(__hooks + '/lib/...')` inside every PocketBase route, record hook, and cron callback; no callback depends on an outer lexical closure.
- Comment creation, moderation, and replies must succeed even when templates, Outbox, the gateway, SMTP, or Mailpit fail.
- Hook callbacks only enqueue; they never call `$app.newMailClient()`, `$http.send`, or the gateway directly.
- `mail_outbox`, `mail_rules`, and `mail_suppressions` have all API rules set to `null`; the browser uses custom redacted APIs only.
- Each Outbox row represents exactly one recipient and has a unique `dedupe_key` derived from event, source record, recipient HMAC, and transition.
- Outbox states are exactly `pending`, `processing`, `retry`, `sent`, `failed`, `cancelled`.
- Retry delays are exactly 1 minute, 5 minutes, 30 minutes, 2 hours, and 12 hours with at most five delivery attempts.
- A processing lease older than five minutes is stale and recoverable.
- `RECIPIENT_PERMANENT` may create an automatic suppression; authentication, configuration, connection, timeout, rate-limit, and temporary-recipient errors never suppress an address.
- Stable `messageId` plus Outbox deduplication reduces duplicates but does not claim SMTP exactly-once delivery.
- Sent/cancelled Outbox records are retained 30 days; final failed records are retained 90 days.
- Comment snippets are plain text, HTML-escaped by the renderer, and capped at 500 Unicode characters before enqueue.
- Comment rules are disabled by default after migration and are the only source for business administrator recipient addresses.
- Account mail and operations alerts appear as read-only control sources; business rules cannot disable them.
- Every `/api/blog-admin/mail/*` operation revalidates exact role `super_admin`, verified email, and a currently bound Passkey session on the server.
- Caddy protects all `/api/blog-admin/*` routes with the existing `ADMIN_IP` boundary.
- Every mail-management write, SMTP verify, and test send writes a redacted `audit_logs` entry.
- Outside the explicit fixed-data template preview response, no admin DTO, audit summary, log, or frontend state contains full SMTP host, username, password, full sender, message body, gateway response, token, or OTP code.
- Every task follows red-green-refactor and ends with a focused commit.

---

## File Map

Create:
- `pb_migrations/20260713100000_create_mail_outbox_management.pb.js` - private Outbox, rules, suppressions, comment templates, and disabled default rules.
- `pb_hooks/lib/mail_outbox.js` - recipient derivation, safe payload creation, dedupe, enqueue, and command transitions.
- `pb_hooks/lib/mail_worker.js` - stale-lease recovery, claim, render/send, retry classification, suppression, and retention.
- `pb_hooks/lib/admin_mail_guard.js` - server-side role/email/Passkey checks and redacted audit helper.
- `pb_hooks/lib/admin_mail_api.js` - DTOs, validation, filtering, pagination, management commands, previews, gateway checks, and test sending.
- `pb_hooks/comment_mail_outbox.pb.js` - create/update hooks and worker/retention cron registrations.
- `pb_hooks/admin_mail.pb.js` - protected admin mail routes.
- `tests/mail-local/comment_outbox_fixture.pb.js` - deterministic event, lease, retry, suppression, permissions, and API assertions.
- `scripts/test-mail-outbox-local.ps1` - isolated PocketBase/gateway/Mailpit Outbox harness.
- `astro/src/lib/admin-mail.ts` - typed custom API client and DTO definitions.
- `astro/src/components/admin/mail/MailAdmin.tsx` - tab shell, loading/error state, responsive controls.
- `astro/src/components/admin/mail/MailOverviewPanel.tsx`
- `astro/src/components/admin/mail/MailQueuePanel.tsx`
- `astro/src/components/admin/mail/MailTemplatesPanel.tsx`
- `astro/src/components/admin/mail/MailRulesPanel.tsx`
- `astro/src/components/admin/mail/MailSuppressionsPanel.tsx`
- `astro/src/components/admin/mail/MailLogsPanel.tsx`
- `astro/src/pages/admin/mail/index.astro`
- `astro/scripts/test-mail-admin-ui.mjs` - Playwright permissions, viewport, and redaction smoke.

Modify:
- `pb_hooks/lib/mail_templates.js` - comment templates, fixed preview samples, and code-owned action URLs.
- `pb_hooks/lib/mail_logs.js` - worker delivery log helper and redacted list DTO.
- `pb_hooks/send_email_comment.pb.js` - delete after Outbox replacement is proven.
- `pb_hooks/guard_user_role.pb.js` - include new mail collections in protected collection checks if it owns that list.
- `pb_hooks/audit_admin_actions.pb.js` - recognize redacted mail action names without duplicating route-level audits.
- `Caddyfile` - expand admin IP matcher to all `/api/blog-admin/*` routes.
- `astro/src/components/admin/AdminSidebar.tsx` - add `邮件` under `系统`, exact `super_admin` permission.
- `astro/package.json` - add `test:mail-admin-ui`.
- `scripts/sensitive-check.ps1`
- `scripts/pre-deploy-check.ps1`

Delete:
- `pb_hooks/send_email_comment.pb.js`

---

### Task 1: Create Outbox, Rule, Suppression, And Comment Template Storage

**Files:**
- Create: `pb_migrations/20260713100000_create_mail_outbox_management.pb.js`
- Modify: `tests/mail-local/comment_outbox_fixture.pb.js`

**Interfaces:**
- Consumes: Task 1 account collections, especially `mail_templates` and `mail_delivery_logs`.
- Produces: private collections `mail_outbox`, `mail_rules`, `mail_suppressions`; template keys `comment_new`, `comment_approved`, `comment_reply`; disabled rules with those keys.

The record contracts are fixed:

```ts
type OutboxStatus = 'pending' | 'processing' | 'retry' | 'sent' | 'failed' | 'cancelled';

interface MailOutboxRecord {
  event_key: 'comment_new' | 'comment_approved' | 'comment_reply';
  message_id: string;
  template_key: string;
  template_version: number;
  recipient_address: string;
  recipient_name: string;
  recipient_masked: string;
  recipient_hash: string;
  payload_json: string;
  status: OutboxStatus;
  attempts: number;
  max_attempts: number;
  next_attempt_at: string;
  locked_at: string;
  lock_token: string;
  error_class: string;
  sent_at: string;
  source_collection: string;
  source_record_id: string;
  dedupe_key: string;
}

interface MailRuleRecord {
  key: 'comment_new' | 'comment_approved' | 'comment_reply';
  enabled: boolean;
  notify_post_author: boolean;
  notify_comment_author: boolean;
  notify_parent_author: boolean;
  admin_recipients_json: string;
  max_attempts: number;
}

interface MailSuppressionRecord {
  address: string;
  address_hash: string;
  reason: string;
  source: 'automatic' | 'manual';
  enabled: boolean;
  error_class: string;
  expires_at: string;
}
```

- [ ] **Step 1: Write failing schema and seed assertions**

The fixture loads each collection, verifies every API rule is `null`, checks the fields above, and asserts:

```js
const expected = ['comment_approved', 'comment_new', 'comment_reply'];
const rules = $app.dao().findRecordsByFilter('mail_rules', '', 'key', 20, 0);
if (JSON.stringify(rules.map((r) => r.getString('key')).sort()) !== JSON.stringify(expected)) throw new Error('rule keys mismatch');
if (rules.some((r) => r.getBool('enabled'))) throw new Error('comment rules must start disabled');
const templates = $app.dao().findRecordsByFilter('mail_templates', 'is_current = true', 'key', 20, 0);
for (const key of expected) if (!templates.some((r) => r.getString('key') === key)) throw new Error('missing template ' + key);
```

- [ ] **Step 2: Run all migrations against a fresh database and prove failure**

Expected before implementation: fixture reports `collection mail_outbox not found`.

- [ ] **Step 3: Implement private collections and indexes**

Create exact indexes:

```js
outbox.indexes = [
  'CREATE UNIQUE INDEX idx_mail_outbox_dedupe ON mail_outbox (dedupe_key)',
  'CREATE UNIQUE INDEX idx_mail_outbox_message_id ON mail_outbox (message_id)',
  'CREATE INDEX idx_mail_outbox_due ON mail_outbox (status, next_attempt_at, created)',
  'CREATE INDEX idx_mail_outbox_stale ON mail_outbox (status, locked_at)',
  'CREATE INDEX idx_mail_outbox_source ON mail_outbox (source_collection, source_record_id)',
  'CREATE INDEX idx_mail_outbox_recipient ON mail_outbox (recipient_hash, created)',
];
rules.indexes = ['CREATE UNIQUE INDEX idx_mail_rules_key ON mail_rules (key)'];
suppressions.indexes = [
  'CREATE UNIQUE INDEX idx_mail_suppressions_hash ON mail_suppressions (address_hash)',
  'CREATE INDEX idx_mail_suppressions_active ON mail_suppressions (enabled, expires_at)',
];
```

Use select constraints from the interfaces, enforce recipient email fields, cap `payload_json` at 8192 chars, `recipient_name` at 100, `reason` at 500, and `max_attempts` at `1..5`. All date fields except `next_attempt_at` are optional. The rollback deletes suppressions, rules, Outbox, then only the three comment template seed records.

- [ ] **Step 4: Seed templates and disabled rule defaults**

Seed version `1` current built-in templates with declared variables:

```js
const comments = [
  ['comment_new', ['postTitle', 'commentAuthorName', 'commentExcerpt', 'actionUrl'], ['postTitle', 'commentAuthorName', 'commentExcerpt', 'actionUrl']],
  ['comment_approved', ['postTitle', 'commentAuthorName', 'commentExcerpt', 'actionUrl'], ['postTitle', 'commentAuthorName', 'actionUrl']],
  ['comment_reply', ['postTitle', 'replyAuthorName', 'replyExcerpt', 'actionUrl'], ['postTitle', 'replyAuthorName', 'replyExcerpt', 'actionUrl']],
];
```

Actions use an `actionUrl` variable generated by code. Default rules:

```js
[
  { key: 'comment_new', enabled: false, notify_post_author: true, notify_comment_author: false, notify_parent_author: false, admin_recipients_json: '[]', max_attempts: 5 },
  { key: 'comment_approved', enabled: false, notify_post_author: false, notify_comment_author: true, notify_parent_author: false, admin_recipients_json: '[]', max_attempts: 5 },
  { key: 'comment_reply', enabled: false, notify_post_author: false, notify_comment_author: false, notify_parent_author: true, admin_recipients_json: '[]', max_attempts: 5 },
]
```

- [ ] **Step 5: Run schema/seed fixture and migration rollback/reapply**

Expected: schema assertions pass, rollback removes only the three new collections/comment templates, and reapply recreates exactly three disabled rules without duplicates.

- [ ] **Step 6: Commit**

```powershell
git add pb_migrations/20260713100000_create_mail_outbox_management.pb.js tests/mail-local/comment_outbox_fixture.pb.js
git commit -m "feat(mail): add comment Outbox storage"
```

---

### Task 2: Enqueue Three Comment Events Without Blocking Business Writes

**Files:**
- Create: `pb_hooks/lib/mail_outbox.js`
- Create: `pb_hooks/comment_mail_outbox.pb.js`
- Delete: `pb_hooks/send_email_comment.pb.js`
- Modify: `tests/mail-local/comment_outbox_fixture.pb.js`

**Interfaces:**
- Consumes: `comments`, `posts`, `users`, current `mail_rules`, and `MAIL_HASH_SECRET`.
- Produces:
  - `outbox.handleCommentCreated(record): { enqueued: number }`
  - `outbox.handleCommentUpdated(record, original): { enqueued: number }`
  - `outbox.enqueue(input): { created: boolean, id: string }`

- [ ] **Step 1: Add failing event and non-blocking tests**

Create a post author, a commenter, an approved parent commenter, and rules with duplicate mixed-case admin addresses. Assert:

```text
new comment -> post author + unique administrators; commenter self skipped
first pending -> approved transition -> original commenter once
second approved -> approved update -> no new row
approved reply at create -> parent commenter once
pending reply -> approved -> parent commenter once
reply author equals parent address -> no reply row
same event replay -> unique dedupe leaves row count unchanged
broken template/rule lookup -> comment API still returns success
```

- [ ] **Step 2: Run fixture and prove direct sender/Outbox behavior fails**

Expected: no Outbox records exist and the legacy hook attempts direct mail.

- [ ] **Step 3: Implement normalized recipient and payload derivation**

Normalize addresses with `trim().toLowerCase()`, validate a single RFC-like mailbox using `/^[^\s@]+@[^\s@]+\.[^\s@]+$/`, derive `recipient_hash = hashPrivate('email', normalized)`, and deduplicate by hash. Build payloads only from:

```js
{
  postTitle: plain(post.getString('title')).slice(0, 160),
  postSlug: plain(post.getString('slug') || post.id).slice(0, 200),
  commentAuthorName: plain(comment.getString('author_name')).slice(0, 100),
  commentExcerpt: plain(comment.getString('content')).slice(0, 500),
  replyAuthorName: plain(comment.getString('author_name')).slice(0, 100),
  replyExcerpt: plain(comment.getString('content')).slice(0, 500),
}
```

`plain` removes tags and control characters and normalizes whitespace. No IP, authorization, cookie, user token, password, SMTP setting, or full post/comment body is accepted.

- [ ] **Step 4: Implement stable enqueue and dedupe**

`enqueue` accepts an explicit allowlisted object. Construct:

```js
const transition = input.transition || 'created';
const dedupeKey = hashPrivate('outbox-dedupe', [input.eventKey, input.sourceRecordId, input.recipientHash, transition].join(':'));
const messageId = 'outbox_' + dedupeKey.slice(0, 40);
```

Read the current template version and rule max attempts at enqueue time. Insert status `pending`, attempts `0`, `next_attempt_at` equal to now, empty lock/error/sent fields. On unique-index conflict, load by `dedupe_key` and return `{created:false,id}`; do not treat it as a hook failure.

- [ ] **Step 5: Implement create and update event semantics**

`handleCommentCreated` always considers `comment_new`. If the new comment status is already `approved`, it also considers `comment_approved` and, when `parent_id` exists, `comment_reply`. `handleCommentUpdated` uses `original` and only considers approval/reply when `original.status !== 'approved' && record.status === 'approved'`.

For update hooks, obtain the previous snapshot with `record.originalCopy()` before deriving the transition. Use exact transition labels `created`, `first-approved`, and `reply-first-public`.

- [ ] **Step 6: Register failure-isolated hooks**

Use callback-local requires and never throw mail failures back into the request:

```js
onRecordAfterCreateRequest(function (e) {
  try {
    const outbox = require(__hooks + '/lib/mail_outbox.js');
    outbox.handleCommentCreated(e.record);
  } catch (error) {
    console.error('[mail-outbox-enqueue] event=comment-created result=failed');
  }
}, 'comments');

onRecordAfterUpdateRequest(function (e) {
  try {
    const outbox = require(__hooks + '/lib/mail_outbox.js');
    outbox.handleCommentUpdated(e.record, e.record.originalCopy());
  } catch (error) {
    console.error('[mail-outbox-enqueue] event=comment-updated result=failed');
  }
}, 'comments');
```

Do not include `String(error)`, record fields, or addresses in logs.

- [ ] **Step 7: Remove direct sender and verify event matrix**

Delete `send_email_comment.pb.js`. Run:

```powershell
Get-ChildItem pb_hooks -Recurse -File | Select-String -Pattern '\$app\.newMailClient|MailerMessage|send_email_comment'
```

Expected: no comment sender match; fixture event matrix passes; forced mail exceptions leave created/updated comments intact.

- [ ] **Step 8: Commit**

```powershell
git add pb_hooks/lib/mail_outbox.js pb_hooks/comment_mail_outbox.pb.js tests/mail-local/comment_outbox_fixture.pb.js
git rm pb_hooks/send_email_comment.pb.js
git commit -m "feat(mail): enqueue comment notifications"
```

---

### Task 3: Deliver Outbox With Atomic Leases, Retry, Suppression, And Retention

**Files:**
- Create: `pb_hooks/lib/mail_worker.js`
- Modify: `pb_hooks/comment_mail_outbox.pb.js`
- Modify: `pb_hooks/lib/mail_logs.js`
- Modify: `tests/mail-local/comment_outbox_fixture.pb.js`

**Interfaces:**
- Consumes: due Outbox rows, current rules/templates/suppressions, `mailGateway.send`.
- Produces:
  - `templates.renderVersion(key, version, variables): { category, subject, html, text, version }`
  - `worker.runBatch({limit, now}): BatchResult`
  - `worker.recoverStale(now): number`
  - `worker.cleanup(now): {sentCancelled:number,failed:number}`
  - `worker.retryDelayMs(attempt): number`

```ts
interface BatchResult {
  claimed: number;
  sent: number;
  retried: number;
  failed: number;
  suppressed: number;
  cancelled: number;
  paused: boolean;
  pauseCode: string;
}
```

- [ ] **Step 1: Add failing deterministic worker tests**

Inject a fixture clock and a fake gateway mode through test-only fixture commands. Cover:

```text
only pending/retry due rows are claimable
two concurrent fixture calls claim one row once
processing lock younger than 5m remains locked
processing lock older than 5m returns to retry
success -> sent, sent_at set, lock cleared, payload_json cleared, one minimal log
temporary recipient failure -> retry at 1m/5m/30m/2h/12h
fifth temporary failure -> failed
permanent recipient failure -> failed + one automatic suppression
authentication/configuration/connection/global timeout -> current row retry + batch pause
existing active suppression -> cancelled without gateway call
expired suppression -> gateway call allowed
rule disabled after enqueue -> cancelled
sent/cancelled older than 30d deleted; failed older than 90d deleted
```

- [ ] **Step 2: Run and prove worker module is missing**

Expected: fixture command fails with `Cannot find module .../mail_worker.js`.

- [ ] **Step 3: Implement delays and stale lease recovery**

Use exact delay table:

```js
const RETRY_DELAYS_MS = [60_000, 300_000, 1_800_000, 7_200_000, 43_200_000];
function retryDelayMs(attempt) {
  const index = Math.max(0, Math.min(RETRY_DELAYS_MS.length - 1, Number(attempt) - 1));
  return RETRY_DELAYS_MS[index];
}
```

In one transaction, find `processing` records with `locked_at <= now-5m`; set status `retry`, clear lock fields, set `next_attempt_at=now`, and set `error_class='STALE_LEASE'`. Process at most 100 stale records per run.

- [ ] **Step 4: Claim one record atomically**

For each batch slot, run a transaction selecting the oldest row matching `(status='pending' || status='retry') && next_attempt_at <= now`, set `status='processing'`, a random `lock_token`, and `locked_at=now`, then return its ID and token. Reload after the transaction and require the exact token before every terminal update. Batch limit defaults to 20 and clamps to `1..50`.

- [ ] **Step 5: Revalidate and deliver outside the transaction**

Before sending:

1. Ensure the current rule exists and is enabled; otherwise cancel.
2. Find an active suppression by recipient hash where `enabled=true` and expiry is blank or future; otherwise cancel.
3. Parse allowlisted payload keys and generate `actionUrl` from `PUBLIC_SITE_URL` plus `/posts/` and encoded slug.
4. Call `templates.renderVersion(template_key, template_version, variables)`. If that exact version no longer exists, fail with `TEMPLATE_VERSION_MISSING` and do not silently switch versions.
5. Call the gateway once with a fresh request ID and stable Outbox `message_id`.

After success, in a transaction requiring the lock token, set `sent`, `sent_at`, clear lock/error, and set `payload_json=''`. Write one body-free delivery log after the state update.

- [ ] **Step 6: Classify failures and pause only global failures**

Use exact groups:

```js
const PERMANENT_RECIPIENT = ['RECIPIENT_PERMANENT'];
const TEMPORARY = ['RECIPIENT_TEMPORARY', 'RATE_LIMITED'];
const GLOBAL_PAUSE = ['MAIL_NOT_CONFIGURED', 'SMTP_AUTH', 'SMTP_CONNECTION', 'SMTP_TIMEOUT', 'INTERNAL_ERROR'];
const PAYLOAD_FAILURE = ['PAYLOAD_INVALID', 'TEMPLATE_VERSION_MISSING', 'TEMPLATE_INVALID'];
```

Increment `attempts` only when a gateway send was attempted. Retry temporary/global failures when attempts remain; otherwise fail. Payload failures fail immediately without suppression. Only `RECIPIENT_PERMANENT` upserts an automatic suppression by recipient hash and fails immediately. On `GLOBAL_PAUSE`, finish the current state update and stop claiming more rows.

- [ ] **Step 7: Register worker and retention cron callbacks**

Register:

```js
cronAdd('mail-outbox-worker', '* * * * *', function () {
  const worker = require(__hooks + '/lib/mail_worker.js');
  worker.runBatch({ limit: 20, now: new Date() });
});

cronAdd('mail-outbox-retention', '17 3 * * *', function () {
  const worker = require(__hooks + '/lib/mail_worker.js');
  worker.cleanup(new Date());
});
```

Catch/log only stable batch counters and pause code. No addresses, payload, SMTP response, or exception strings.

- [ ] **Step 8: Run worker suite including concurrent claims**

Expected: all state/lease/retry/suppression/retention cases pass; Mailpit receives one message for the concurrent claim case; comment API latency is unaffected by a stopped gateway.

- [ ] **Step 9: Commit**

```powershell
git add pb_hooks/lib/mail_worker.js pb_hooks/comment_mail_outbox.pb.js pb_hooks/lib/mail_logs.js tests/mail-local/comment_outbox_fixture.pb.js
git commit -m "feat(mail): process Outbox with retries"
```

---

### Task 4: Revalidate Mail-Admin Identity, Passkey Session, And IP Boundary

**Files:**
- Create: `pb_hooks/lib/admin_mail_guard.js`
- Create: `pb_hooks/admin_mail.pb.js`
- Modify: `Caddyfile`
- Modify: `tests/mail-local/comment_outbox_fixture.pb.js`

**Interfaces:**
- Consumes: PocketBase auth context, `Authorization`, `X-Browser-Fingerprint`, trusted client IP, user agent, `admin_verified_sessions`, and existing `admin-auth /internal/session/verify`.
- Produces: `guard.requireMailAdmin(e): {user, clientIp, audit(action,target,summary)}`.

- [ ] **Step 1: Write failing authorization matrix**

For a probe `GET /api/blog-admin/mail/overview`, assert:

```text
anonymous -> 401
reader -> 401/403
author -> 403
admin -> 403
unverified super_admin -> 403
verified super_admin without Passkey session -> 403
verified super_admin with expired/revoked/mismatched binding -> 403
verified super_admin with valid bound session -> 200
same valid request from non-ADMIN_IP through Caddy -> 403 before PocketBase
```

- [ ] **Step 2: Run and prove the route/guard is absent**

Expected: direct PocketBase request returns `404`; Caddy matcher does not yet cover `/api/blog-admin/mail/*`.

- [ ] **Step 3: Implement server-side guard**

The guard must:

1. Read `authRecord` from context and require exact role `super_admin`.
2. Require `record.verified() === true`.
3. Require bearer token, browser fingerprint, user agent, and trusted request client IP.
4. Query an unrevoked, unexpired `admin_verified_sessions` row for the user.
5. Call `ADMIN_AUTH_INTERNAL_URL + '/internal/session/verify'` with the stored hashes plus current binding values and `X-Internal-Secret`.
6. Require `{verified:true}`; fail closed on timeout, malformed JSON, or gateway error.

Return generic `UnauthorizedError('Mail administration verification required')` and never report which check failed.

- [ ] **Step 4: Add redacted audit helper**

`audit(action,target,summary)` permits only action names:

```js
[
  'mail_gateway_verified', 'mail_test_sent', 'mail_outbox_retried', 'mail_outbox_cancelled',
  'mail_template_saved', 'mail_template_restored', 'mail_rule_updated',
  'mail_suppression_created', 'mail_suppression_updated', 'mail_suppression_deleted',
]
```

Summary is capped at 300 chars and rejects `@`, `smtp`, `password`, `token`, `authorization`, `<html`, and line breaks. Store actor ID, action, target collection/ID, summary, and redacted IP using the existing `audit_logs` fields.

- [ ] **Step 5: Expand Caddy's exact admin boundary**

Replace the specific `/api/blog-admin/webauthn/*` path in `@blocked_admin_access` with `/api/blog-admin/*`. Preserve `/admin*`, `/_/*`, `/api/admins/*`, static exceptions, and `not client_ip {$ADMIN_IP}`.

- [ ] **Step 6: Register a guarded overview route and verify matrix**

Route callback:

```js
routerAdd('GET', '/api/blog-admin/mail/overview', function (e) {
  const guard = require(__hooks + '/lib/admin_mail_guard.js');
  const api = require(__hooks + '/lib/admin_mail_api.js');
  const context = guard.requireMailAdmin(e);
  return e.json(200, api.overview(context));
});
```

Expected: full matrix passes and no response body contains a reason-specific guard failure.

- [ ] **Step 7: Commit**

```powershell
git add pb_hooks/lib/admin_mail_guard.js pb_hooks/admin_mail.pb.js Caddyfile tests/mail-local/comment_outbox_fixture.pb.js
git commit -m "feat(mail): guard mail administration routes"
```

---

### Task 5: Add Redacted Overview, Gateway Verify, Test Send, And Queue Commands

**Files:**
- Create: `pb_hooks/lib/admin_mail_api.js`
- Modify: `pb_hooks/admin_mail.pb.js`
- Modify: `pb_hooks/lib/mail_outbox.js`
- Modify: `tests/mail-local/comment_outbox_fixture.pb.js`

**Interfaces:**
- Produces:
  - `GET /api/blog-admin/mail/overview`
  - `POST /api/blog-admin/mail/gateway/verify`
  - `POST /api/blog-admin/mail/test-send`
  - `GET /api/blog-admin/mail/outbox`
  - `POST /api/blog-admin/mail/outbox/retry`
  - `POST /api/blog-admin/mail/outbox/cancel`

DTO contracts:

```ts
interface MailOverviewDto {
  gateway: { configured:boolean; providerLabel:string; port:number; tlsMode:string; fromDomain:string; lastVerify:string; checkedAt:string };
  last24Hours: { sent:number; failed:number; successRate:number };
  queue: { pending:number; retry:number; processing:number; failed:number };
  recentFailures: Array<{ id:string; category:string; recipientMasked:string; errorClass:string; created:string }>;
  controls: { accountMail:'environment'; otp:'environment'; operationsAlerts:'environment'; commentRules:'database' };
}
```

- [ ] **Step 1: Write failing DTO redaction and command-state tests**

Seed full addresses, payloads, fake SMTP-like strings, all statuses, and delivery logs. Recursively scan overview, queue, command, rule, suppression, and log responses (template preview is tested separately with fixed fake data) and fail on `recipient_address`, `payload_json`, `smtp`, `username`, `password`, `host`, `html`, `text`, `token`, or any unmasked seeded address. Test allowed transitions:

```text
retry: failed/retry/cancelled -> pending with attempts=0, next_attempt_at=now, lock/error/sent cleared
retry: sent/processing -> 409 INVALID_STATE
cancel: pending/retry/failed -> cancelled
cancel: sent/processing/cancelled -> 409 INVALID_STATE
batch IDs: 1..50 unique valid PocketBase IDs; malformed/oversized -> 400
```

- [ ] **Step 2: Run and prove API methods/routes are missing**

Expected: route requests return `404` or module method errors.

- [ ] **Step 3: Implement overview and pagination DTOs**

Use bound filters and aggregate counts from private collections. `successRate` is `sent / (sent + failed) * 100`, rounded to one decimal and `0` when denominator is zero. Outbox query accepts only:

```text
page: 1..100000
perPage: 10, 20, 50 (default 20)
status: one exact Outbox status or blank
category: comment_new/comment_approved/comment_reply or blank
recipient: normalized substring matched only against recipient_masked
from/to: ISO dates no wider than 90 days
```

Return redacted fields: id, eventKey, messageId, templateKey/version, recipientMasked, status, attempts/maxAttempts, nextAttemptAt, errorClass, sentAt, sourceCollection/sourceRecordId, created, updated. Never return full recipient or payload.

- [ ] **Step 4: Implement signed gateway verify and admin test send**

Gateway verify calls the HMAC `/internal/mail/verify` through `mail_gateway.js`, returns only redacted status, and audits `mail_gateway_verified` with `result=<ok|stable-code>`.

Test send ignores any caller recipient and always uses `context.user.getString('email')` after rechecking verified super-admin. Enforce three sends per user per 15 minutes using `mail_delivery_logs` category `admin_test` and recipient hash. Render a code-owned `admin_test` template/sample, call the gateway, write a body-free log, and audit `mail_test_sent`. Return `{ok:true,recipientMasked,requestId}` or a stable code without gateway raw data.

- [ ] **Step 5: Implement atomic queue commands**

Accept `{ids:string[]}` only. In one transaction, reload each selected record, validate current state, apply all transitions, and fail the whole command if any ID/state is invalid. Retry uses a new business request ID during the worker send but preserves stable `message_id` and `dedupe_key`. Audit one redacted summary such as `count=3 states=failed,retry`.

- [ ] **Step 6: Register all six routes with strict body limits**

Use callback-local requires and `$apis.bodyLimit(16384)` on POST routes. The list route uses query parameters only. Apply `requireMailAdmin` before parsing or querying private records.

- [ ] **Step 7: Run redaction, rate-limit, transition, and audit tests**

Expected: every response passes recursive secret/body/address scans; fourth test send returns `429 RATE_LIMITED`; each successful write has exactly one audit record with no `@` or full address.

- [ ] **Step 8: Commit**

```powershell
git add pb_hooks/lib/admin_mail_api.js pb_hooks/lib/mail_outbox.js pb_hooks/admin_mail.pb.js tests/mail-local/comment_outbox_fixture.pb.js
git commit -m "feat(mail): expose redacted queue controls"
```

---

### Task 6: Add Versioned Templates, Rules, Suppressions, And Delivery Log APIs

**Files:**
- Modify: `pb_hooks/lib/admin_mail_api.js`
- Modify: `pb_hooks/admin_mail.pb.js`
- Modify: `pb_hooks/lib/mail_templates.js`
- Modify: `pb_hooks/lib/mail_logs.js`
- Modify: `tests/mail-local/comment_outbox_fixture.pb.js`

**Interfaces:**
- Produces:
  - `GET /api/blog-admin/mail/templates`
  - `POST /api/blog-admin/mail/templates/save`
  - `POST /api/blog-admin/mail/templates/restore`
  - `POST /api/blog-admin/mail/templates/preview`
  - `POST /api/blog-admin/mail/templates/test-send`
  - `GET /api/blog-admin/mail/rules`
  - `POST /api/blog-admin/mail/rules/update`
  - `GET /api/blog-admin/mail/suppressions`
  - `POST /api/blog-admin/mail/suppressions/create`
  - `POST /api/blog-admin/mail/suppressions/update`
  - `POST /api/blog-admin/mail/suppressions/delete`
  - `GET /api/blog-admin/mail/logs`

- [ ] **Step 1: Write failing validation/version/audit tests**

Cover:

```text
template save creates version N+1 and atomically flips prior current=false
unknown variable, missing required variable, CR/LF subject, external action URL, script/image/style/raw HTML -> 400
preview uses fixed fake data and never a live account token/code/address
restore creates N+1 from code-owned built-in default
account templates cannot be disabled/deleted
rule update normalizes/lowercases/deduplicates admin addresses and clamps max attempts 1..5
account and ops sources are returned read-only and reject updates
suppression create hashes/normalizes; duplicate hash rejected; expired active state computed correctly
log list returns minimal fields only and supports 90-day max range
every successful mutation/test has one redacted audit record
```

- [ ] **Step 2: Run and prove routes are absent**

Expected: requests return `404`.

- [ ] **Step 3: Implement versioned template save/restore**

Accept only:

```ts
{
  key: string;
  expectedCurrentVersion: number;
  subjectTemplate: string;
  content: {
    preheader: string;
    title: string;
    paragraphs: string[];
    action: null | { label: string; urlVariable: 'actionUrl' };
    footer: string;
  };
}
```

Reject unknown object keys. Limits: preheader/title/label 160 chars, 1..6 paragraphs each 500 chars, footer 300, serialized content 8192. Validate variables against the immutable declaration on the current record. In one transaction verify `expectedCurrentVersion`, mark current false, insert version+1 current true with the same key/category/variable declarations/builtin flag. A stale version returns `409 VERSION_CONFLICT`.

Restore loads a code-owned frozen default object by key and creates a new version through the same transaction. It never copies arbitrary historical HTML.

- [ ] **Step 4: Implement safe preview and template test**

Fixed preview data:

```js
const samples = {
  account_verification: { displayName: '示例读者', actionUrl: 'https://hlydwz.com/verify-email?token=preview-token', expiresMinutes: '30', subject: '验证邮箱' },
  account_password_reset: { displayName: '示例读者', actionUrl: 'https://hlydwz.com/reset-password?token=preview-token', expiresMinutes: '30', subject: '重置密码' },
  account_email_change: { displayName: '示例读者', newEmailMasked: 'n***w@example.com', actionUrl: 'https://hlydwz.com/confirm-email-change?token=preview-token', expiresMinutes: '30', subject: '确认新邮箱' },
  reader_otp: { displayName: '示例读者', code: '123456', expiresMinutes: '10', subject: '登录验证码' },
  comment_new: { postTitle: '示例文章', commentAuthorName: '示例评论者', commentExcerpt: '这是一段安全的评论预览。', actionUrl: 'https://hlydwz.com/posts/demo', subject: '文章收到新评论' },
  comment_approved: { postTitle: '示例文章', commentAuthorName: '示例评论者', commentExcerpt: '评论已通过审核。', actionUrl: 'https://hlydwz.com/posts/demo', subject: '评论已通过审核' },
  comment_reply: { postTitle: '示例文章', replyAuthorName: '示例回复者', replyExcerpt: '这是一段安全的回复预览。', actionUrl: 'https://hlydwz.com/posts/demo', subject: '评论收到回复' },
};
```

Preview returns subject/html/text for display only. Test send always targets the current verified super-admin address and shares the three-per-15-minute `admin_test` limit.

- [ ] **Step 5: Implement rules and suppressions**

Rules API returns the three editable comment rules plus two immutable rows `{key:'account_mail',controlSource:'environment'}` and `{key:'operations_alerts',controlSource:'environment'}`. Update accepts one known comment rule, booleans matching that rule's recipient policy, `adminRecipients:string[]` up to 20, and max attempts 1..5. Reject addresses longer than 254 or containing control characters.

Suppression APIs expose the address only as `addressMasked`. Create accepts an address but never returns it; update accepts only ID, reason, enabled, and optional expiry because address/hash/source/error class are immutable. `source='manual'` for admin creation, reason is required 1..500, and expiry is blank or future ISO time. Automatic suppressions can be disabled/reenabled manually but address, hash, source, and error class remain immutable.

- [ ] **Step 6: Implement minimal logs API**

Filters: category, result, errorClass, date range no wider than 90 days, page/perPage 10/20/50. Return requestId, category, source collection/record ID, recipientMasked, result, durationMs, attempt, errorClass, created. No body, payload, address hash, IP hash, SMTP response, or export endpoint.

- [ ] **Step 7: Register routes and run validation/redaction suite**

Use GET for lists and POST with 16384-byte limits for commands. Expected: all version/conflict/dangerous-content/control-source/suppression/log tests pass and recursive response scan finds no forbidden values.

- [ ] **Step 8: Commit**

```powershell
git add pb_hooks/lib/admin_mail_api.js pb_hooks/lib/mail_templates.js pb_hooks/lib/mail_logs.js pb_hooks/admin_mail.pb.js tests/mail-local/comment_outbox_fixture.pb.js
git commit -m "feat(mail): manage templates rules and suppressions"
```

---

### Task 7: Build The Compact Responsive Mail Management UI

**Files:**
- Create: `astro/src/lib/admin-mail.ts`
- Create: `astro/src/components/admin/mail/MailAdmin.tsx`
- Create: `astro/src/components/admin/mail/MailOverviewPanel.tsx`
- Create: `astro/src/components/admin/mail/MailQueuePanel.tsx`
- Create: `astro/src/components/admin/mail/MailTemplatesPanel.tsx`
- Create: `astro/src/components/admin/mail/MailRulesPanel.tsx`
- Create: `astro/src/components/admin/mail/MailSuppressionsPanel.tsx`
- Create: `astro/src/components/admin/mail/MailLogsPanel.tsx`
- Create: `astro/src/pages/admin/mail/index.astro`
- Modify: `astro/src/components/admin/AdminSidebar.tsx`
- Create: `astro/scripts/test-mail-admin-ui.mjs`
- Modify: `astro/package.json`

**Interfaces:**
- Consumes: protected redacted routes from Tasks 4-6 and existing `AdminLayout`/`AdminGuard`/Passkey headers.
- Produces: `/admin/mail/` with tabs `概览`, `队列`, `模板`, `规则`, `抑制`, `日志`.

- [ ] **Step 1: Write a failing Playwright permission/layout/redaction smoke**

Mock only the custom admin-mail routes with redacted DTOs and assert:

```js
await page.setViewportSize({ width: 1440, height: 900 });
await page.goto(baseUrl + '/admin/mail/');
for (const label of ['概览', '队列', '模板', '规则', '抑制', '日志']) await page.getByRole('tab', { name: label }).waitFor();
const body = await page.locator('body').innerText();
for (const forbidden of ['smtp.example.com', 'user@example.com', 'SMTP_PASSWORD', '<html>']) {
  if (body.includes(forbidden)) throw new Error('forbidden value rendered: ' + forbidden);
}
```

Repeat at `390x844`, assert `document.documentElement.scrollWidth <= innerWidth`, keyboard tab activation, visible focus, no console errors, and long masked/error strings do not overlap adjacent controls. Also test unauthenticated and non-super-admin users are redirected/rejected by existing guards.

- [ ] **Step 2: Run build/smoke and prove route is absent**

Expected: `/admin/mail/` returns 404 or sidebar lacks `邮件`.

- [ ] **Step 3: Implement typed API client**

Define exact DTOs matching Tasks 5-6. Every call uses the existing PocketBase auth token and browser fingerprint mechanism; command methods accept typed IDs/content and never accept SMTP configuration. Normalize API failures to `{code,message}` using safe Chinese messages and discard raw response details.

- [ ] **Step 4: Implement tab shell and overview**

`MailAdmin` uses a stable horizontal tab row with overflow scrolling on mobile, keeps one active panel mounted at a time, and preserves filters in component state. Overview uses compact metrics, a definition list for redacted gateway fields, recent failure rows, and icon buttons for refresh/verify/test with tooltips. Do not use a marketing hero, decorative gradients, nested cards, or oversized headings.

- [ ] **Step 5: Implement queue and logs panels**

Desktop queue uses stable columns for status, type, masked recipient, attempt, next time, error, and source. Mobile uses one unframed labeled list item per record. Selection controls enable retry/cancel only when every selected state permits it; sent and processing rows cannot be selected for those commands. Confirm destructive cancel in an accessible dialog. Logs are read-only and have no export/body drawer.

- [ ] **Step 6: Implement template editor and preview**

Use text inputs/textareas for the structured fields, a displayed variable allowlist, and segmented preview modes `桌面`, `移动`, `纯文本`. Render HTML preview in a sandboxed iframe with `sandbox=""` and `srcDoc`; never use unsandboxed `dangerouslySetInnerHTML` in the admin document. Show version conflicts and reload action. Restore default and test-send require confirmation and display only the masked destination.

- [ ] **Step 7: Implement rules and suppressions**

Use switches for enabled/recipient policies, a numeric stepper for attempts 1..5, and removable address rows for administrator recipients. Render account mail and operations alerts as read-only source rows. Suppression creation uses address, reason, enabled, and optional expiry; edit exposes only reason, enabled, and expiry because the stored address is immutable. List output shows the masked address only.

- [ ] **Step 8: Add page/sidebar and package script**

Create:

```astro
---
import AdminLayout from '../../../layouts/AdminLayout.astro';
import MailAdmin from '../../../components/admin/mail/MailAdmin';
---
<AdminLayout title="邮件管理" requiredRole="super_admin">
  <MailAdmin client:only="react" />
</AdminLayout>
```

Add sidebar item `{href:'/admin/mail',label:'邮件',section:'系统',requiredRole:'super_admin',hint:'投递'}` with an existing-style envelope icon path. Add `"test:mail-admin-ui": "node scripts/test-mail-admin-ui.mjs"`.

- [ ] **Step 9: Build and run desktop/mobile checks**

Run `npm run build`, `npm run check:mobile`, and `npm run test:mail-admin-ui` from `astro`.

Expected: build succeeds; both viewports have no overlap/overflow/console errors; all six tabs are keyboard-operable; forbidden raw values never render.

- [ ] **Step 10: Commit**

```powershell
git add astro/src/lib/admin-mail.ts astro/src/components/admin/mail astro/src/pages/admin/mail/index.astro astro/src/components/admin/AdminSidebar.tsx astro/scripts/test-mail-admin-ui.mjs astro/package.json
git commit -m "feat(admin): add mail management center"
```

---

### Task 8: Build The Local Comment-Outbox Integration Harness

**Files:**
- Create: `scripts/test-mail-outbox-local.ps1`
- Modify: `tests/mail-local/comment_outbox_fixture.pb.js`
- Modify: `scripts/sensitive-check.ps1`
- Modify: `scripts/pre-deploy-check.ps1`

**Interfaces:**
- Consumes: local Mailpit, gateway, PocketBase binary, migrations/hooks, fixture-only authenticated admin session stubs.
- Produces: repeatable local evidence for all three comment events, worker failure modes, admin API authorization/redaction, and UI build.

- [ ] **Step 1: Add harness contract and preflight**

Parameters:

```powershell
param(
  [string]$PocketBasePath = '.\pb_local\pb\pocketbase.exe',
  [string]$MailpitPath = 'C:\tmp\mailpit-v1.30.0\mailpit.exe',
  [int]$SmtpPort = 1125,
  [int]$MailpitUiPort = 8125,
  [int]$GatewayPort = 18787,
  [int]$PocketBasePort = 18093
)
```

Require both executable paths and all ports free, then create `tmp/comment-mail-local/<run-id>`. Use different test addresses for author, commenter, parent, administrator, and super-admin, all included in the exact Mailpit allowlist. A successful run writes the roadmap-compatible redacted evidence file `tmp/mail-evidence/outbox.json`.

- [ ] **Step 2: Start local dependencies with recorded PowerShell jobs**

Reuse the gateway/account harness startup helpers where practical, but keep this script independently runnable. Use `Start-Job`, fresh HMAC/hash secrets, loopback-only SMTP, exact recipient allowlist, and bounded health polling. Do not use Docker or contact internet SMTP.

- [ ] **Step 3: Execute event, worker, and admin API matrix**

Fixture diagnostic output:

```json
{
  "allPassed": true,
  "commentEvents": 3,
  "dedupeConflicts": 3,
  "mailpitMessages": 5,
  "retryDelaysVerified": 5,
  "staleLocksRecovered": 1,
  "automaticSuppressions": 1,
  "globalPauses": 1,
  "permissionCases": 9,
  "auditActions": 9,
  "redactionLeaks": 0
}
```

Stop Mailpit during the temporary failure phase, run one worker pass, restart Mailpit, advance fixture clock to the due time, and prove retry then succeeds. Keep business comment creation successful throughout. After assertions, write `tmp/mail-evidence/outbox.json` with the roadmap keys `phase`, `newCommentDelivered`, `approvalDeliveredOnce`, `replyDelivered`, `dedupeWorked`, `temporaryFailureRetried`, `permanentFailureSuppressed`, `nonAdminDenied`, `missingPasskeyDenied`, and `sensitiveDtoFindings`.

- [ ] **Step 4: Scan all persistence/output surfaces**

Scan isolated `pb_data`, PocketBase/gateway output, admin API response captures, Astro `dist`, and Git diff for SMTP test password, HMAC/hash secrets, raw gateway response, a test bearer token, and test payload marker. Full test recipient addresses may exist only in private SQLite Outbox/suppression records before retention; they must not appear in API captures, logs, audits, or `dist`.

- [ ] **Step 5: Guarantee process and port cleanup**

Use `try/finally`, recorded job IDs, bounded stop waits, and final listener assertions for 1125/8125/18787/18093. Retain failed artifacts and delete successful run data.

- [ ] **Step 6: Integrate static/pre-deploy checks**

Add checks that no comment hook contains `$http.send`, `$app.newMailClient`, or `MailerMessage`; every callback source contains callback-local `require`; all mail collections have null rules; and no admin API DTO includes forbidden raw fields. `pre-deploy-check.ps1 -IncludeLocalMailIntegration` runs account then comment harness sequentially to avoid port conflicts.

- [ ] **Step 7: Run twice**

Run:

```powershell
.\scripts\test-mail-outbox-local.ps1
.\scripts\test-mail-outbox-local.ps1
Get-NetTCPConnection -State Listen | Where-Object LocalPort -In 1125,8125,18787,18093
```

Expected: both final objects match the contract and listener query is empty.

- [ ] **Step 8: Commit**

```powershell
git add scripts/test-mail-outbox-local.ps1 tests/mail-local/comment_outbox_fixture.pb.js scripts/sensitive-check.ps1 scripts/pre-deploy-check.ps1
git commit -m "test(mail): cover Outbox and admin center locally"
```

---

### Task 9: Run The Comment-Outbox And Admin Acceptance Gate

**Files:**
- Verify only; no planned source change.

**Interfaces:**
- Consumes: all earlier mail plans through this plan.
- Produces: local evidence required before operations alerts and production rollout work.

- [ ] **Step 1: Run clean migration cycles**

Apply all migrations to two separate empty databases; rollback/reapply the last two mail migrations in one of them.

Expected: both end with all six mail collections, seven current templates, three disabled-by-default comment rules, and no public mail collection rules.

- [ ] **Step 2: Run all syntax/unit tests**

Run admin-auth `npm test`, every PocketBase hook/lib/migration through `node --check`, and the existing admin-auth 23-test regression suite.

Expected: zero failures.

- [ ] **Step 3: Run account and comment local integrations twice**

Run both PowerShell harnesses twice.

Expected: every contract counter matches, no listeners remain, comments persist under gateway/SMTP failure, and leak counts are zero.

- [ ] **Step 4: Build and test the frontend**

Run Astro build, mobile viewport check, account-mail UI smoke, and mail-admin UI smoke.

Expected: all public account pages and six admin tabs pass desktop/mobile/keyboard checks with no overlap, overflow, or console errors.

- [ ] **Step 5: Verify source and API boundaries**

Run:

```powershell
Get-ChildItem pb_hooks -Recurse -File | Select-String -Pattern '\$app\.newMailClient|MailerMessage|ALIYUN_SMTP_PASSWORD'
Get-ChildItem astro\src -Recurse -File | Select-String -Pattern 'recipient_address|payload_json|SMTP_PASSWORD|SMTP_USERNAME'
git diff --check
```

Expected: no forbidden source matches and no whitespace errors.

- [ ] **Step 6: Record the local-only gate**

Record versions, commands, pass counts, and `production server unchanged`. Do not record test addresses, bearer tokens, message contents, secrets, nonce/signatures, or raw SMTP responses.

- [ ] **Step 7: Commit any acceptance correction separately**

If corrections were required, commit only those files with `fix(mail): satisfy Outbox acceptance gate`, rerun every gate step, and leave no uncommitted plan implementation change.



---

## Self-Review

- Spec coverage: three comment recipient policies, one-recipient Outbox rows, dedupe, stable Message-ID, leases, stale recovery, exact retry schedule, permanent suppression, retention, protected management APIs, audits, all six UI views, and local failure recovery map to explicit tasks.
- Placeholder scan: every collection field, status, transition, error group, route, DTO, command, local port, fixture counter, and commit boundary is named with concrete limits and expected outcomes.
- Type consistency: `test-mail-outbox-local.ps1`, event categories, Outbox states, template keys, command routes, DTO names, and audit actions match the roadmap and adjacent plans.
- Security consistency: raw collections remain private, hooks only enqueue, browser DTOs stay redacted, every admin route performs server-side super-admin/email/Passkey checks, and Caddy covers all `/api/blog-admin/*` routes.
