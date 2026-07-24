# Account Retention and Encrypted Mail Archive Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Remind and safely remove unverified unused accounts after 60 days, and archive minimal delivery audit summaries after 7 days using age encryption and rclone with zero-delete-on-failure guarantees.

**Architecture:** PocketBase owns lifecycle state, trusted business relationships, archive batch state, persistent replay nonces, whitelist projection, and transactional deletion. A host-only Python client creates canonical JSONL/gzip artifacts, invokes fixed age/rclone commands, verifies remote hashes, and calls signed internal state transitions from an hourly 1Panel wrapper.

**Tech Stack:** PocketBase 0.22.21 JS hooks/migrations, Python 3 standard library, age CLI, rclone CLI, Bash/flock, 1Panel scheduled tasks, PowerShell and Python unit/integration harnesses.

## Global Constraints

- Unverified accounts receive one successful reminder at day 45 and are eligible for deletion at day 60 only when no trusted business relationship exists.
- Reminder transient failures retry at most 3 times within 72 hours and never extend retention indefinitely.
- Existing accounts use `max(created + 60 days, deployment + 15 days)`.
- Verified accounts and accounts with trusted business relationships are never automatically deleted.
- Online delivery logs target 7 days; archive failure keeps old rows and alerts rather than deleting them.
- Archive batches are at most 5000 rows and follow `prepared -> sealed -> uploaded -> committed`.
- Only committed transactions delete logs.
- Archive rows contain only the approved fixed whitelist; unknown fields are rejected.
- No email, masked email, email/IP hash, raw IP, source record ID, subject, body, token, OTP, UA, SMTP text, stack, or free text enters the archive.
- Server stores only the age recipient public key/fingerprint; private keys remain offline in two copies.
- rclone credentials stay on the host in a root-only config and never enter PocketBase, containers, Git, arguments, or logs.
- Cloud ciphertext/manifest retention is 90 days including version history and trash.
- Do not read or modify live `data.db`, WAL, or free pages.
- Agent B owns `mail_logs.js`, the final delivery-log schema, the rate limiter, and the outbox; this track consumes those interfaces only.

---

### Task 1: Create trusted account lifecycle relationships and state

**Files:**
- Create: `pb_migrations/20260716120000_create_account_retention_state.pb.js`
- Create: `pb_hooks/lib/account_retention.js`
- Create: `tests/mail-local/account_retention_fixture.pb.js`
- Create: `scripts/test-account-retention-local.ps1`
- Modify: `pb_hooks/validate_comment.pb.js:103-182`
- Modify: `pb_hooks/validate_reaction.pb.js:22-51`

**Interfaces:**
- Produces `initializeNewUser(txDao, userRecord, nowMs)`, `cancelForVerifiedUser`, `bindAuthenticatedComment`, and `hasBusinessRelationship`.

- [ ] **Step 1: Write failing relationship and migration tests**

Assert `comments.author_user` is an optional users relation with client create/update blocked, authenticated matching comments receive the relation, anonymous comments do not, and `reactions.user_id` is overwritten with the current authenticated user rather than trusted from the client.

Assert lifecycle state fields and migration grace:

```js
assertEqual(state.cleanup_eligible_at, maxIso(addDays(user.created, 60), addDays(deployedAt, 15)));
assertEqual(state.reminder_attempts, 0);
assertEqual(state.reminder_sent_at, null);
```

Run: `powershell.exe -NoProfile -File scripts/test-account-retention-local.ps1 -Fixture schema`

Expected: FAIL because lifecycle state and `comments.author_user` do not exist.

- [ ] **Step 2: Create the additive migration**

Create private `account_retention_state` with unique `user`, `cleanup_eligible_at`, `reminder_due_at`, `reminder_sent_at`, `reminder_attempts`, `next_attempt_at`, and stable `last_error_class`. Add optional `comments.author_user` relation with an index. Backfill only comments whose normalized `author_email` uniquely matches a current user email and whose existing server validation evidence is sufficient; ambiguous rows remain unbound.

- [ ] **Step 3: Implement lifecycle initialization and trusted relationship checks**

```js
function initializeNewUser(txDao, user, nowMs) {
  const state = new Record(collection(txDao, 'account_retention_state'));
  state.set('user', user.id);
  state.set('reminder_due_at', iso(nowMs + 45 * DAY_MS));
  state.set('cleanup_eligible_at', iso(nowMs + 60 * DAY_MS));
  state.set('reminder_attempts', 0);
  txDao.saveRecord(state);
}

function hasBusinessRelationship(dao, user) {
  return exists(dao, 'posts', 'author', user.id) ||
    exists(dao, 'comments', 'author_user', user.id) ||
    exists(dao, 'media_assets', 'uploader', user.id) ||
    exists(dao, 'post_versions', 'editor', user.id) ||
    exists(dao, 'reactions', 'user_id', user.id);
}
```

Do not count untrusted email-only reports or client-supplied relations.

- [ ] **Step 4: Bind new authenticated activity**

In `validate_comment.pb.js`, after the existing identity match, set `author_user` server-side. In `validate_reaction.pb.js`, reject anonymous user relations and force `user_id = auth.id` for authenticated reactions.
At the same time, remove `validate_comment.pb.js` fallback reads of `X-Real-IP` and `X-Forwarded-For`; use only the framework real IP supplied by Agent B's proxy chain.

- [ ] **Step 5: Run fixture and migration validation**

Run: `powershell.exe -NoProfile -File scripts/test-account-retention-local.ps1 -Fixture schema`

Expected: PASS.

Run: `bash scripts/verify-pocketbase-migrations-linux.sh`

Expected: fresh and upgrade paths PASS.

- [ ] **Step 6: Commit**

```powershell
git add pb_migrations/20260716120000_create_account_retention_state.pb.js pb_hooks/lib/account_retention.js tests/mail-local/account_retention_fixture.pb.js scripts/test-account-retention-local.ps1 pb_hooks/validate_comment.pb.js pb_hooks/validate_reaction.pb.js
git commit -m "feat(accounts): add trusted retention lifecycle state"
```

### Task 2: Implement day-45 reminder and day-60 cleanup jobs

**Files:**
- Create: `pb_hooks/account_retention.pb.js`
- Modify: `pb_hooks/lib/account_retention.js`
- Modify: `tests/mail-local/account_retention_fixture.pb.js`
- Modify: `scripts/test-account-retention-local.ps1`

**Interfaces:**
- Consumes Agent B `mailOutbox.enqueue()` using policy `account_retention_notice`.
- Produces `runDueReminders(nowMs, limit)` and `runDueCleanup(nowMs, limit)`.

- [ ] **Step 1: Write failing reminder and cleanup tests**

Cover day 44/45/60 boundaries, one successful reminder, three transient attempts within 72h, no infinite retry, verification cancellation, business relation exemption, repeated job idempotency, deletion cascade, and audit summary counts without email addresses.

- [ ] **Step 2: Implement bounded reminder selection**

```js
function runDueReminders(nowMs, limit) {
  const due = findDueStates('reminder_sent_at = null && reminder_due_at <= {:now} && reminder_attempts < 3 && (next_attempt_at = null || next_attempt_at <= {:now})', nowMs, limit);
  return processEach(due, (state, txDao) => {
    const user = loadUser(txDao, state.get('user'));
    if (!eligible(user, txDao)) return cancelState(txDao, state);
    const queued = mailOutbox.enqueue(txDao, retentionNoticeInput(user, nowMs));
    state.set('reminder_attempts', state.get('reminder_attempts') + 1);
    if (queued.queued) state.set('reminder_sent_at', iso(nowMs));
    else state.set('next_attempt_at', iso(nowMs + retryDelay(state.get('reminder_attempts'))));
    txDao.saveRecord(state);
  });
}
```

Use a fixed retention template with no arbitrary HTML and a site URL from trusted configuration.

- [ ] **Step 3: Implement deletion with final transactional recheck**

For each due state, start a transaction, reload user/state, recheck unverified status and all trusted relations, then delete user and state. If any check/query fails, keep both and record a stable aggregate error.

- [ ] **Step 4: Register schedules behind environment gates**

Reminder and deletion jobs have separate environment flags; deletion defaults disabled until migration and reminder health checks pass. Batch size is fixed and bounded.

- [ ] **Step 5: Run lifecycle fixture including repeated execution**

Run: `powershell.exe -NoProfile -File scripts/test-account-retention-local.ps1 -Fixture jobs`

Expected: PASS with no duplicate reminder and no protected-account deletion.

- [ ] **Step 6: Commit**

```powershell
git add pb_hooks/account_retention.pb.js pb_hooks/lib/account_retention.js tests/mail-local/account_retention_fixture.pb.js scripts/test-account-retention-local.ps1
git commit -m "feat(accounts): remind and clean unused registrations"
```

### Task 3: Create archive batches, persistent nonces, and strict projection

**Files:**
- Create: `pb_migrations/20260716121000_create_mail_archive_state.pb.js`
- Create: `pb_hooks/lib/mail_archive_auth.js`
- Create: `pb_hooks/lib/mail_archive.js`
- Create: `pb_hooks/mail_archive.pb.js`
- Create: `tests/mail-local/archive_retention_fixture.pb.js`
- Create: `scripts/test-mail-archive-api-local.ps1`

**Interfaces:**
- Produces prepare/export/seal/uploaded/commit routes and functions exactly as specified in the design.

- [ ] **Step 1: Write failing schema, auth, and state-machine tests**

Test private `mail_archive_batches` and `mail_archive_request_nonces`, nonce replay across process restart, timestamp skew, body-hash mismatch, unknown batch, invalid transition, 5000-row cap, cutoff strictness, duplicate commit, and commit hash/object mismatch.

- [ ] **Step 2: Add the private archive migration**

Create unique batch ID, status, cursor, row count, plaintext/gzip/cipher hashes, cipher size, recipient fingerprint, object key, manifest hash, stage timestamps, and stable error class. Add unique nonce plus expiry index. Add `archive_batch_id` and `created` indexes to the minimal delivery log without adding PII.

- [ ] **Step 3: Implement persistent signed-request authentication**

```js
const canonical = [timestamp, nonce, method.toUpperCase(), path, bodySha256].join('\n');
const expected = hmacSha256(env('MAIL_ARCHIVE_HMAC_SECRET'), canonical);
if (!constantTimeEqual(expected, signature)) throw unauthorized();
$app.runInTransaction((txDao) => consumeNonce(txDao, nonce, timestamp));
```

Verify body SHA-256 before parsing JSON. Nonce rows expire after the maximum replay window but remain durable across PocketBase restarts.

- [ ] **Step 4: Implement strict audit projection**

```js
const ARCHIVE_KEYS = ['schema_version','event_id','created_at','category','source_kind','result','duration_ms','attempt','error_class'];
function projectLog(record) {
  return {
    schema_version: 1,
    event_id: requiredRandomEventId(record),
    created_at: utc(record.get('created')),
    category: enumValue(CATEGORIES, record.get('category')),
    source_kind: enumValue(SOURCE_KINDS, record.get('source_kind')),
    result: enumValue(['sent','failed'], record.get('result')),
    duration_ms: boundedInteger(record.get('duration_ms'), 0, 600000),
    attempt: boundedInteger(record.get('attempt'), 1, 20),
    error_class: enumValue(ERROR_CLASSES, record.get('error_class')),
  };
}
```

Any unknown/invalid value fails export; no generic record serialization is permitted.

- [ ] **Step 5: Implement idempotent state transitions**

Prepare reserves only `created < now-7d` unassigned rows in a transaction. Seal stores trusted hashes. Uploaded requires exact sealed cipher/object values. Commit rechecks remote-confirmed values, deletes only rows with the batch ID, marks committed, and returns prior success for repeated identical commit.

- [ ] **Step 6: Run API fixture and syntax checks**

Run: `powershell.exe -NoProfile -File scripts/test-mail-archive-api-local.ps1`

Expected: all auth, replay, projection, transition, idempotency and zero-delete-on-failure cases PASS.

- [ ] **Step 7: Commit**

```powershell
git add pb_migrations/20260716121000_create_mail_archive_state.pb.js pb_hooks/lib/mail_archive_auth.js pb_hooks/lib/mail_archive.js pb_hooks/mail_archive.pb.js tests/mail-local/archive_retention_fixture.pb.js scripts/test-mail-archive-api-local.ps1
git commit -m "feat(mail): add transactional archive batches"
```

### Task 4: Build the host-only age/rclone pipeline

**Files:**
- Create: `scripts/mail-archive.py`
- Create: `tests/ops/test_mail_archive.py`
- Create: `tests/ops/fakes/fake-age.py`
- Create: `tests/ops/fakes/fake-rclone.py`

**Interfaces:**
- Consumes the signed internal archive API.
- Executes fixed argument arrays for age/rclone; never accepts arbitrary flags.

- [ ] **Step 1: Write failure-injection tests first**

Use `unittest` temporary directories and fake executables. Cover prepare, export, JSONL write, gzip, age, public-key fingerprint, rclone upload, remote readback, manifest upload, uploaded transition, and commit failures. After each failure assert DB commit was not called and no plaintext `.jsonl`/`.gz` remains.

```python
def test_age_failure_removes_plaintext_and_never_commits(self):
    result = self.run_archive(FAKE_AGE_MODE='fail')
    self.assertNotEqual(result.returncode, 0)
    self.assertEqual(list(self.workdir.glob('*.jsonl')), [])
    self.assertEqual(list(self.workdir.glob('*.jsonl.gz')), [])
    self.assertEqual(self.api.commit_calls, 0)
```

Run: `python -m unittest tests.ops.test_mail_archive`

Expected: FAIL because the script and fakes do not exist.

- [ ] **Step 2: Implement canonical export and local hashing**

Use `json.dumps(row, ensure_ascii=False, separators=(',', ':'), sort_keys=True)` plus `\n`, deterministic gzip metadata (`mtime=0`), and SHA-256 at plaintext/gzip/cipher stages. File creation uses an exclusive root-only work directory and atomic `.tmp` rename.

- [ ] **Step 3: Invoke age safely and verify the recipient fingerprint**

```python
run_checked([age_bin, '--recipient', config.age_recipient, '--output', cipher_tmp, gzip_path])
if config.age_recipient_fingerprint != fingerprint(config.age_recipient):
    raise ArchiveError('AGE_RECIPIENT_FINGERPRINT_MISMATCH')
```

The recipient is configuration, not request input. The private key is never referenced by the production script.

- [ ] **Step 4: Upload and independently verify remote ciphertext**

Use a stable object key `YYYY-MM/<random-batch-id>.jsonl.gz.age`. If an object exists, compare its readback SHA-256; mismatch stops without overwrite. When the backend lacks hashes, stream `rclone cat remote:path` through local SHA-256. Upload the minimal manifest only after ciphertext verification.

- [ ] **Step 5: Implement restart-safe idempotency**

On restart, query the batch state and resume the earliest incomplete batch. Reuse existing verified local ciphertext when hashes match. If local ciphertext is absent after upload, read back remote ciphertext and compare with sealed DB hash before calling uploaded/commit.

- [ ] **Step 6: Run all Python tests**

Run: `python -m unittest tests.ops.test_mail_archive`

Expected: PASS for success, every injected failure, same-name mismatch, retry, repeated commit, and plaintext cleanup.

- [ ] **Step 7: Commit**

```powershell
git add scripts/mail-archive.py tests/ops/test_mail_archive.py tests/ops/fakes/fake-age.py tests/ops/fakes/fake-rclone.py
git commit -m "feat(ops): encrypt and sync mail audit batches"
```

### Task 5: Add the 1Panel wrapper and operational documentation

**Files:**
- Create: `scripts/run-mail-archive-1panel.sh`
- Create: `docs/operations/mail-archive-1panel.md`
- Create: `scripts/check-mail-archive-config.ps1`

- [ ] **Step 1: Write static wrapper/config checks**

Require root, `umask 077`, `flock`, an absolute root-only env file, fixed work directory, fixed Python script, no shell interpolation of rclone flags, and no age private-key path.

- [ ] **Step 2: Implement the wrapper**

```bash
#!/usr/bin/env bash
set -euo pipefail
umask 077
test "$(id -u)" -eq 0
exec 9>/var/lock/hlydwz-mail-archive.lock
flock -n 9 || exit 0
set -a
. /etc/hlydwz/mail-archive.env
set +a
exec /usr/bin/python3 /opt/hlydwz/blog/scripts/mail-archive.py run
```

- [ ] **Step 3: Document exact 1Panel and permission setup**

Document an hourly task, `/etc/hlydwz/mail-archive.env` mode `0600`, work directory mode `0700`, rclone config mode `0600`, dedicated remote/prefix, age recipient fingerprint verification, cloud region/data-processing review, version/trash deletion, 90-day cleanup, alert thresholds, and monthly isolated restore drill.

- [ ] **Step 4: Validate shell and config**

Run: `bash -n scripts/run-mail-archive-1panel.sh`

Expected: exit 0.

Run: `powershell.exe -NoProfile -File scripts/check-mail-archive-config.ps1`

Expected: PASS without any real credentials.

- [ ] **Step 5: Commit**

```powershell
git add scripts/run-mail-archive-1panel.sh docs/operations/mail-archive-1panel.md scripts/check-mail-archive-config.ps1
git commit -m "docs(ops): add controlled mail archive schedule"
```

### Task 6: Implement 90-day remote retention and restore verification

**Files:**
- Modify: `scripts/mail-archive.py`
- Modify: `tests/ops/test_mail_archive.py`
- Create: `scripts/verify-mail-archive-restore.py`
- Modify: `docs/operations/mail-archive-1panel.md`

- [ ] **Step 1: Write failing retention and restore tests**

Simulate provider objects, versions, and trash before/after 90 days. Assert uncommitted objects are never removed. Restore tests decrypt in a separate directory and verify cipher/gzip/plain hashes, gzip integrity, JSONL schema, row count, and cursor.

- [ ] **Step 2: Implement retention from event time**

Delete ciphertext and manifest only when `max_created_at < now-90d` and the matching batch is committed. Then invoke provider-specific version/trash purge configured as a fixed supported mode and verify no remaining object/version/trash entry.

- [ ] **Step 3: Implement isolated restore verification**

The verifier accepts a local ciphertext/manifest and an explicit offline identity path, refuses paths inside the sync/work directory, writes to a new mode-0700 temporary directory, verifies all hashes/schema, prints only counts, and deletes plaintext on exit.

- [ ] **Step 4: Run privacy, retention, and restore tests**

Run: `python -m unittest tests.ops.test_mail_archive`

Expected: PASS.

Run the fake restore fixture and scan decrypted output for seeded email, masked email, email/IP hashes, source ID, token, OTP, UA, SMTP response, and free text.

Expected: zero matches and only the nine whitelist keys.

- [ ] **Step 5: Commit**

```powershell
git add scripts/mail-archive.py tests/ops/test_mail_archive.py scripts/verify-mail-archive-restore.py docs/operations/mail-archive-1panel.md
git commit -m "feat(ops): enforce archive retention and restore checks"
```

### Task 7: Run the complete lifecycle and archive verification

- [ ] **Step 1: Run full track verification**

```powershell
powershell.exe -NoProfile -File scripts/test-account-retention-local.ps1 -All
powershell.exe -NoProfile -File scripts/test-mail-archive-api-local.ps1
python -m unittest tests.ops.test_mail_archive
bash -n scripts/run-mail-archive-1panel.sh
powershell.exe -NoProfile -File scripts/check-mail-archive-config.ps1
powershell.exe -NoProfile -File scripts/sensitive-check.ps1
bash scripts/verify-pocketbase-migrations-linux.sh
```

Expected: every command exits 0; no plaintext artifacts remain in the test work directories.

The integration plan owns shared changes to `scripts/sensitive-check.ps1` and `scripts/pre-deploy-check.ps1` after all three tracks are merged.
