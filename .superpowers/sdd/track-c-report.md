# Track C report: account retention and encrypted mail archive

Date: 2026-07-16

Worktree: `H:\开发\个人博客\.worktrees\mail-security-archive`

Branch: `codex/mail-security-archive`

Base: `e88e231`

Original review-remediation head: `630d65c`

Second remediation implementation head: `60a4ab2`

## Status

Track C account retention, encrypted archive, retention purge, restore verification, and the second reviewer-remediation wave are implemented. No production deployment, real PocketBase instance, real SMTP provider, real rclone remote, production secret, or private age identity was used.

## Commits

1. `fd3df1c` — `feat(accounts): add trusted retention lifecycle state`
2. `23df24f` — `feat(accounts): remind and clean unused registrations`
3. `7fe25a6` — `feat(mail): add transactional archive batches`
4. `1157468` — `fix(mail): expose restart-safe archive status`
5. `56fedfa` — `feat(ops): encrypt and sync mail audit batches`
6. `e681709` — `docs(ops): add controlled mail archive schedule`
7. `8c08713` — `feat(ops): enforce archive retention and restore checks`
8. `d9cd715` — `fix(ops): restrict archive retention provider mode`
9. `630d65c` — `fix(mail): close archive review gaps`
10. `60a4ab2` — `fix(mail): harden archive retention and key rotation`

Implementation range: `e88e231..60a4ab2`

## Second remediation delivered contracts

- After the 1Panel wrapper obtains its fixed `flock`, every Python invocation removes crash-left final `.jsonl`, `.jsonl.gz`, and matching temporary plaintext before the first archive API call. The scan rejects symlinks and never deletes `.jsonl.gz.age` ciphertext.
- Successful retention-reminder enqueue updates `cleanup_eligible_at` to `max(original, now + 15 days)`. The email uses the same effective date, and cleanup still requires both `reminder_sent_at` and `now >= cleanup_eligible_at`.
- After remote current objects, versions, delete markers, and manifests are proven absent, `retention-confirm` transactionally replaces the complete `mail_archive_batches` record with a private tombstone containing only `batch_id`, `confirmed_at`, and `expires_at`. Repeated confirmation succeeds through that tombstone; scheduled cleanup deletes tombstones after seven days.
- `account_retention.initializeNewUser(txDao, userRecord, nowMs)` remains the locked Track C export. The static integration fixture verifies its exact three-argument signature and verifies that Track C does not add a users-create hook.
- The optional plural configuration `MAIL_ARCHIVE_AGE_RECIPIENTS` and `MAIL_ARCHIVE_AGE_RECIPIENT_FINGERPRINTS` accepts one or two comma-separated, positionally matched, unique values. Without plural configuration, the existing singular variables remain supported.
- age receives one fixed `--recipient` group per configured public recipient. Manifests, PocketBase batch state, and trusted restore descriptors store a sorted `age_recipient_fingerprints` / `ageRecipientFingerprints` array. Restore accepts either matching offline identity during rotation and rejects identities outside the trusted array.
- The operations runbook documents dual-recipient rotation and explicitly excludes private identities from the archive host. All changed and new files end with exactly one terminal newline; the earlier EOF newline defect remains closed.

## Verification evidence

Fresh verification after the final implementation change and before commit `60a4ab2`:

- `powershell.exe -NoProfile -File scripts/test-account-retention-local.ps1 -All`
  - PASS: Track B integration contract, retention schema/relationships, reminder jobs, and cleanup jobs.
- `powershell.exe -NoProfile -File scripts/test-mail-archive-api-local.ps1`
  - PASS: archive schema, signed auth, projections, transitions, retention tombstones, idempotency, and zero-delete guarantees.
- `python -m unittest tests.ops.test_mail_archive -v`
  - PASS: 20 tests, including SIGKILL plaintext recovery before API failure, dual-recipient encryption/restore, wrong/count/duplicate fingerprint rejection, retention version purge, restore trust checks, and failure cleanup.
- `powershell.exe -NoProfile -File scripts/check-mail-archive-config.ps1`
  - PASS.
- `powershell.exe -NoProfile -File scripts/sensitive-check.ps1`
  - PASS: zero issues.
- `Get-ChildItem pb_hooks,pb_migrations -Recurse -File -Include *.js | ForEach-Object { node --check $_.FullName }`
  - PASS: 47 files.
- `python -m py_compile scripts/mail-archive.py scripts/verify-mail-archive-restore.py tests/ops/test_mail_archive.py tests/ops/fakes/fake-age.py tests/ops/fakes/fake-rclone.py`
  - PASS.
- `git diff --check`
  - PASS.

Generated Python `__pycache__` directories were removed before commit.

## Integration dependency

- Track B owns the registration facade and must call the locked interface exactly once inside the successful user-create transaction: `accountRetention.initializeNewUser(txDao, userRecord, nowMs)`.
- Track C intentionally does not register a separate users-create hook, because doing so would race or double-write `account_retention_state`.
- `tests/mail-local/account_retention_integration_contract.js` is the static producer contract. The merged main branch must run the real Track B registration integration and prove one user plus exactly one retention-state row commit together, with both rolling back on failure.
- The local archive API fixture executes the PocketBase-compatible modules in Node; the merged/integration branch remains responsible for the full PocketBase 0.22.21 migration and HTTP route run with Tracks A/B present.

## Safety confirmation

- No private age key or identity was created, read, logged, or committed.
- No plaintext archive output remains in the repository or test work directories.
- No real cloud object was uploaded or deleted; rclone behavior used the deterministic local fake.
- Complete `mail_archive_batches` metadata is deleted after confirmed 90-day remote purge; seven-day tombstones contain no object key, hash, event range, cursor, row count, or recipient fingerprint.
