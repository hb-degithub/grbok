# Mail Security Parallel Integration Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Execute and integrate the three approved security tracks without shared-file races, then verify the complete mail, registration, Passkey, retention, proxy, and encrypted-archive system.

**Architecture:** Three implementation agents work from the same plan commit in isolated git worktrees and communicate only through locked interfaces. The controller integrates commits in migration order, resolves shared configuration centrally, runs track reviewers plus one whole-branch security review, and leaves production rollout disabled until explicit operator configuration.

**Tech Stack:** Git worktrees, PocketBase 0.22.21, Node.js 22, Astro 6, PowerShell, Python 3, Bash, OpenResty, Caddy, age, rclone.

## Global Constraints

- Track A plan: `docs/superpowers/plans/2026-07-16-admin-step-up-passkey-security.md`.
- Track B plan: `docs/superpowers/plans/2026-07-16-security-rate-registration-mail-routing.md`.
- Track C plan: `docs/superpowers/plans/2026-07-16-account-retention-mail-archive.md`.
- Each implementer uses TDD and commits each independently testable task.
- Worktrees start from the same plan commit; no agent edits another track's worktree.
- Migration order is A `10000`, B `11000/11100/11200`, C `12000/12100`, then B cutover `13000`.
- Track A owns Passkey/step-up files; Track B owns rate limits, registration, mail logs/outbox, proxy configs; Track C owns lifecycle/archive files and `validate_comment.pb.js` relation/fallback cleanup.
- The integration controller exclusively owns `.env.example`, `docker-compose.yml`, `docker-compose.local.yml`, `scripts/sensitive-check.ps1`, and `scripts/pre-deploy-check.ps1`.
- Do not deploy production, enable deletion, send real SMTP, upload to a real rclone remote, or handle private age keys.
- No Critical or Important review finding may remain open.

---

## Spec Coverage Matrix

| Approved design area | Owning plan/tasks |
| --- | --- |
| Browser-bound Passkey step-up and protected writes | Track A Tasks 1–3, 5 |
| Controlled bootstrap, server-only Passkey CRUD, last-key protection | Track A Tasks 2, 4, 6–7 |
| Exact email/IP/global rolling limits and bounded admin configuration | Track B Tasks 1–3, 6 |
| Registration facade, IPv6 `/64`, restart persistence, invite mode | Track B Tasks 2, 4, 6, 8 |
| Account-mail/OTP anti-enumeration, detailed authenticated codes, help references | Track B Task 3 |
| Comment/outbox/gateway bypass closure | Track B Task 5 |
| OpenResty/Caddy/PocketBase real IP chain | Track B Tasks 7–8 and Track C Task 1 |
| Day-45 reminder and day-60 trusted cleanup | Track C Tasks 1–2 |
| Seven-day minimal log archive, signed API, age/rclone, 90-day deletion | Track C Tasks 3–7 |
| Secret boundaries, staged flags, two-release cutover, whole-system review | Integration Tasks 4–7 |


### Task 1: Create isolated worktrees and dispatch the three tracks

**Files:**
- Read: the four plan files listed above
- Create during execution: `.superpowers/sdd/progress.md`

- [ ] **Step 1: Use the worktree skill and record the common base**

Run:

```powershell
$base = git rev-parse HEAD
git worktree add '..\个人博客-stepup' -b codex/mail-security-stepup $base
git worktree add '..\个人博客-rate' -b codex/mail-security-rate $base
git worktree add '..\个人博客-archive' -b codex/mail-security-archive $base
git worktree add '..\个人博客-integration' -b codex/mail-security-integration $base
```

Expected: four worktrees at the same commit and four `codex/` branches. Before creation, the controller must run the `using-git-worktrees` skill's path, ignore, and safety checks; its result governs exact placement if the suggested sibling paths are unsuitable.

- [ ] **Step 2: Create the durable progress ledger**

```markdown
# Mail security parallel progress
Base: <exact git commit recorded at execution>
Track A: pending
Track B: pending
Track C: pending
Integration: pending
```

Store it at the integration worktree's `.superpowers/sdd/progress.md`.

- [ ] **Step 3: Dispatch one implementer per track**

Each prompt names only its plan file, worktree, allowed files, report path, exact cross-track interfaces, TDD requirement, and prohibition on production access. Agents may complete tasks within their own track continuously; they must not modify controller-owned shared files.

- [ ] **Step 4: Require per-track reports**

Reports must list commits, files, exact commands and outputs, unresolved concerns, migration results, and confirmation that no real SMTP/rclone/private key was used.

### Task 2: Review each track before integration

**Files:**
- Create during execution: unique review packages under `.superpowers/sdd/`

- [ ] **Step 1: Generate diff packages from the recorded common base**

For each track use the subagent-driven-development `review-package BASE HEAD` helper. Never use `HEAD~1`.

- [ ] **Step 2: Dispatch one independent reviewer per track**

The reviewer receives the exact track plan, implementer report, diff package, and the Global Constraints copied verbatim. It returns separate spec-compliance and code-quality verdicts.

- [ ] **Step 3: Fix and re-review Critical/Important findings**

The same track implementer or one bounded fixer addresses the complete finding set, reruns covering tests, appends the report, and sends the same reviewer a new diff package. Do not integrate until both verdicts approve.

- [ ] **Step 4: Mark approved track commits in the ledger**

```text
Track A: complete (commits <base7>..<head7>, review clean)
Track B: complete (commits <base7>..<head7>, review clean)
Track C: complete (commits <base7>..<head7>, review clean)
```

### Task 3: Integrate tracks in dependency and migration order

**Files:**
- Integration worktree only

- [ ] **Step 1: Merge Track A**

Run: `git merge --no-ff codex/mail-security-stepup -m "merge: admin step-up security"`

Expected: clean merge. Run A's focused verification before proceeding.

- [ ] **Step 2: Merge Track B**

Run: `git merge --no-ff codex/mail-security-rate -m "merge: durable rate limits and mail routing"`

Expected: no conflict in A-owned files. Confirm B created `pb_hooks/security_policy_admin.pb.js` rather than editing A's Passkey route file.

- [ ] **Step 3: Merge Track C**

Run: `git merge --no-ff codex/mail-security-archive -m "merge: account retention and encrypted archive"`

Expected: C owns `validate_comment.pb.js`; ensure it contains both `author_user` binding and framework-only real IP behavior. Confirm C did not edit `mail_logs.js`, rate modules, Caddy, or OpenResty.

- [ ] **Step 4: Run interface contract checks**

Verify exact module exports/imports:

```text
admin_step_up.requireAdminStepUp
admin_security_audit.writeSecurityAudit
security_policy_store.getRatePolicySet
security_policy_store.replaceRatePolicySet
registration_mode.getRegistrationMode
registration_mode.replaceRegistrationMode
security_rate_limit.consume
mail_outbox.enqueue
mail_logs.delivery
account_retention.initializeNewUser
account_retention.runDueReminders
account_retention.runDueCleanup
mail_archive.prepareBatch/exportBatch/sealBatch/markUploaded/commitBatch
```

Run hook syntax checks immediately; fix naming mismatches before shared configuration work.

### Task 4: Wire shared environment and container boundaries

**Files:**
- Modify: `.env.example`
- Modify: `docker-compose.yml:47-128`
- Modify: `docker-compose.local.yml:7-67`
- Modify: `scripts/check-mail-config.ps1`
- Create: `scripts/check-mail-security-env.ps1`

- [ ] **Step 1: Write the shared environment checker first**

Require placeholder-only declarations and exact injection boundaries:

```powershell
$pocketBaseOnly = @(
  'ADMIN_IP',
  'MAIL_HASH_SECRET',
  'MAIL_ARCHIVE_HMAC_SECRET',
  'ACCOUNT_RETENTION_REMINDER_ENABLED',
  'ACCOUNT_RETENTION_DELETE_ENABLED',
  'MAIL_ARCHIVE_API_ENABLED'
)
$hostOnly = @(
  'MAIL_ARCHIVE_AGE_RECIPIENT',
  'MAIL_ARCHIVE_AGE_RECIPIENT_FINGERPRINT',
  'MAIL_ARCHIVE_RCLONE_REMOTE',
  'MAIL_ARCHIVE_RCLONE_PREFIX'
)
```

The checker fails if host-only age/rclone values enter either container, if SMTP values enter PocketBase, or if the archive HMAC secret enters `admin-auth`.

Run: `powershell.exe -NoProfile -File scripts/check-mail-security-env.ps1`

Expected: FAIL until templates and Compose are updated.

- [ ] **Step 2: Add safe placeholders to `.env.example`**

```dotenv
MAIL_ARCHIVE_HMAC_SECRET=REPLACE_WITH_RANDOM_MAIL_ARCHIVE_HMAC_SECRET_AT_LEAST_32_CHARS
MAIL_ARCHIVE_API_ENABLED=false
ACCOUNT_RETENTION_REMINDER_ENABLED=false
ACCOUNT_RETENTION_DELETE_ENABLED=false

# Host-only /etc/hlydwz/mail-archive.env examples; never inject into containers
MAIL_ARCHIVE_AGE_RECIPIENT=age1replace_with_public_recipient
MAIL_ARCHIVE_AGE_RECIPIENT_FINGERPRINT=REPLACE_WITH_EXPECTED_PUBLIC_RECIPIENT_FINGERPRINT
MAIL_ARCHIVE_RCLONE_REMOTE=archive-remote
MAIL_ARCHIVE_RCLONE_PREFIX=personal-blog/mail-audit
```

Do not add an age identity/private-key variable or rclone password/token.

- [ ] **Step 3: Inject only PocketBase runtime values**

Add to the PocketBase environment in production/local Compose:

```yaml
- ADMIN_IP=${ADMIN_IP}
- MAIL_ARCHIVE_HMAC_SECRET=${MAIL_ARCHIVE_HMAC_SECRET}
- MAIL_ARCHIVE_API_ENABLED=${MAIL_ARCHIVE_API_ENABLED:-false}
- ACCOUNT_RETENTION_REMINDER_ENABLED=${ACCOUNT_RETENTION_REMINDER_ENABLED:-false}
- ACCOUNT_RETENTION_DELETE_ENABLED=${ACCOUNT_RETENTION_DELETE_ENABLED:-false}
```

Do not add them to `admin-auth`; do not mount rclone config or age keys into containers.

- [ ] **Step 4: Run environment checks**

Run: `powershell.exe -NoProfile -File scripts/check-mail-config.ps1`

Expected: PASS.

Run: `powershell.exe -NoProfile -File scripts/check-mail-security-env.ps1`

Expected: PASS.

- [ ] **Step 5: Commit**

```powershell
git add .env.example docker-compose.yml docker-compose.local.yml scripts/check-mail-config.ps1 scripts/check-mail-security-env.ps1
git commit -m "chore(security): wire mail security configuration boundaries"
```

### Task 5: Consolidate sensitive scanning and noninteractive predeploy checks

**Files:**
- Modify: `scripts/sensitive-check.ps1`
- Modify: `scripts/pre-deploy-check.ps1`

- [ ] **Step 1: Add failing secret/leak fixtures to the scanner**

Cover raw step-up credentials, admin client sessions, archive HMAC secrets, age identities/private keys, rclone tokens/passwords, archive plaintext, email/IP archive keys, OTP/token/body fields, and SMTP original responses. The test feeds temporary files and expects failure for real-looking literals while allowing explicit `REPLACE_WITH_` placeholders and public age recipients.

- [ ] **Step 2: Expand relevant path ownership**

Scan `admin-auth/src/step-up-policy.mjs`, admin security hooks, all rate/mail/archive/lifecycle hooks, host archive scripts, ops tests, Compose, env templates, and operations docs.

- [ ] **Step 3: Add all noninteractive verification stages**

`pre-deploy-check.ps1 -Ci` runs, in order:

```text
sensitive-check
check-mail-config
check-mail-security-env
admin-auth npm test
Astro build
PocketBase hook/migration node --check
check-pb-admin-auth
check-admin-recovery
check-admin-routes
test-admin-step-up
test-security-rate-local -All
test-account-retention-local -All
test-mail-archive-api-local
python -m unittest tests.ops.test_mail_archive
check-real-ip-chain
check-auth-facade-cutover
check-mail-archive-config
bash -n run-mail-archive-1panel.sh
Linux migration verifier when available
```

CI mode must never prompt on a dirty worktree; it reports the status and continues verification.

- [ ] **Step 4: Run focused shared checks**

Run: `powershell.exe -NoProfile -File scripts/sensitive-check.ps1`

Expected: PASS with zero findings.

Run: `powershell.exe -NoProfile -File scripts/pre-deploy-check.ps1 -Ci`

Expected: all locally available stages PASS; platform-specific Linux migration stage is explicitly skipped on Windows rather than silently treated as passed.

- [ ] **Step 5: Commit**

```powershell
git add scripts/sensitive-check.ps1 scripts/pre-deploy-check.ps1
git commit -m "test(security): consolidate mail hardening checks"
```

### Task 6: Verify two-stage rollout and disabled-by-default operations

**Files:**
- Create: `docs/operations/mail-security-rollout.md`
- Modify: `docs/operations/mail-archive-1panel.md`

- [ ] **Step 1: Document Release 1 additive rollout**

Exact order: backup; isolated migration test; deploy A/B/C additive schema and code; keep reminder/delete/archive flags false; verify new step-up/facades/outbox/IP chain; switch frontend callers; run Mailpit/temporary DB tests; revoke old verified sessions only after the new browser flow is healthy.

- [ ] **Step 2: Document Release 2 cutover**

Exact order: verify `/api/blog-auth/register` and all account-mail facades; apply `users.createRule=null`; deny native request/create routes at OpenResty/Caddy; retain token-confirmation routes; enable strict defaults; verify no bypass; enable reminder only; wait through health evidence; enable deletion; install hourly archive last.

- [ ] **Step 3: Document rollback boundaries**

Rollback may disable reminder/delete/archive and new UI, but must not reopen default PocketBase SMTP or public native mail request paths. Never delete new collections during emergency rollback. Preserve incomplete archive batches and old logs.

- [ ] **Step 4: Document operator-only secrets and checks**

Production operator supplies real `MAIL_ARCHIVE_HMAC_SECRET`, root-only rclone config, public age recipient/fingerprint, and offline private keys. Include provider region/data-processing review, 90-day versions/trash deletion proof, monthly restore evidence, and no-real-mail local test requirement.

- [ ] **Step 5: Commit**

```powershell
git add docs/operations/mail-security-rollout.md docs/operations/mail-archive-1panel.md
git commit -m "docs(security): define staged mail hardening rollout"
```

### Task 7: Run final verification and whole-branch security review

**Files:**
- Read: all changed files since the recorded common base
- Update: `.superpowers/sdd/progress.md`

- [ ] **Step 1: Run the complete verification suite**

Run:

```powershell
powershell.exe -NoProfile -File scripts/pre-deploy-check.ps1 -Ci
```

On a Linux-capable environment additionally run:

```bash
bash scripts/verify-pocketbase-migrations-linux.sh
```

Expected: zero failures. Record exact output summaries in the integration report.

- [ ] **Step 2: Run targeted leak and bypass scans**

Confirm no direct `newMailClient`/`MailerMessage` in comment hooks, no `rateCount` use, no `{remote_host}` or `$proxy_add_x_forwarded_for`, no client Passkey collection CRUD, no userId-only live-session query, no native anonymous users create rule after cutover, and no forbidden archive key.

- [ ] **Step 3: Generate the whole-branch review package**

Use `review-package MERGE_BASE HEAD`, where `MERGE_BASE` is the recorded plan/base commit. Dispatch the final reviewer with the approved design, all four plans, integration report, review package, and any Minor findings carried from track reviews.

- [ ] **Step 4: Fix and re-review the complete final finding set**

Dispatch one fixer for all final Critical/Important findings, rerun covering tests, regenerate the package, and return to the same final reviewer. Do not claim completion until the review is clean.

- [ ] **Step 5: Mark the ledger complete and commit integration evidence**

```text
Integration: complete (all track reviews clean, full suite green, final security review clean)
```

Commit only non-secret reports/docs that belong in Git; keep raw diff packages and the progress ledger in ignored `.superpowers/sdd/` storage.
