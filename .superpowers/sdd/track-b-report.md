# Track B — Durable Rate Limits, Registration, Mail Routing, and Trusted IP Report

## Branch and commit range

- Worktree: `H:\开发\个人博客\.worktrees\mail-security-rate`
- Branch: `codex/mail-security-rate`
- Base: `e88e231`
- Original report head: `8a55feb`
- Reviewer remediation implementation head: `cff1786`

Commits:

1. `e4de39a feat(security): add durable rate policy schema`
2. `990cbd0 feat(security): enforce exact rolling SQLite limits`
3. `b7f0303 fix(mail): stop persistent writes for rejected requests`
4. `70a7681 feat(auth): route registration through durable facade`
5. `85bb3dc fix(mail): route comment delivery through outbox`
6. `e0b2c5e feat(admin): manage bounded security rate policies`
7. `1ce1a00 fix(proxy): preserve trustworthy client IPs`
8. `9b62292 fix(auth): close native registration and mail bypasses`
9. `c3b975b fix(mail): support retention outbox delivery`
10. `2947484 fix(security): isolate registration mode storage`
11. `e4440ed fix(auth): route reader OTP through facades`
12. `280bee4 fix(security): clean expired rate buckets hourly`
13. `7acf961 fix(mail): harden outbox worker leases`
14. `d713fd9 fix(mail): paginate and normalize delivery log migration`
15. `7f17762 fix(auth): expose safe authenticated mail limits`
16. `cff1786 fix(proxy): deny trailing native auth aliases`

## Files changed

- Proxy/cutover: `Caddyfile`, `Caddyfile.local`, `docs/openresty-login-rate-limit.conf`, `scripts/check-real-ip-chain.ps1`, `scripts/check-auth-facade-cutover.ps1`.
- PocketBase migrations: `20260716110000_create_security_rate_limits.pb.js`, `20260716111000_minimize_mail_delivery_logs.pb.js`, `20260716112000_create_mail_outbox.pb.js`, `20260716130000_close_native_auth_entrypoints.pb.js`, `20260716131000_create_security_registration_mode.pb.js`, and `20260716132000_harden_mail_outbox_leases.pb.js`.
- PocketBase hooks/modules: `blog_auth.pb.js`, `blog_register.pb.js`, `login_security.pb.js`, `registration_rate_limit.pb.js`, `mail_outbox.pb.js`, `security_policy_admin.pb.js`, `send_email_comment.pb.js`, and the Track B modules under `pb_hooks/lib/` for policy storage, rolling limits, public errors, registration, minimal logs, outbox, and admin policy transactions.
- Frontend: typed blog-auth/admin-policy clients, registration/verification callers, help page, admin policy form, and `SecurityAudit` integration.
- Gateway: `admin-auth/src/mail/constants.mjs` and the mail service/validation contract tests.
- Tests: all fixtures under `tests/security-rate/` and `scripts/test-security-rate-local.ps1`.

No changes were made to `pb_hooks/validate_comment.pb.js`, Track A/C-owned files, `.env.example`, either compose file, `scripts/sensitive-check.ps1`, or `scripts/pre-deploy-check.ps1`.

## Verification evidence

### Full Track B fixtures

Command:

```powershell
powershell.exe -NoProfile -File scripts/test-security-rate-local.ps1 -All
```

Result: exit `0`.

```text
PASS policy: 12 policies, version 2
PASS rate boundary/corruption/rollback/hourly expired-bucket cleanup
PASS rate concurrency: 2/20 allowed; all three buckets contain 2 events
PASS account-mail parity/shared quotas/fake OTP/zero-write/minimal logs and authenticated EMAIL/IP/GLOBAL detailed limits
PASS registration IPv4, IPv6 /64, global, concurrency, duplicate parity, mail suppression, fail-closed storage
PASS outbox dedupe, five-row/180-second token lease and renewal/reclaim safety, sent/permanent-failed mapping, retention delivery, quota-denied zero-write
PASS admin policy audit rollback, bounds, CAS, bucket preservation, sixth-write limit, private registration-mode singleton/CRUD denial/corruption fail-closed
```

Focused restart command:

```powershell
powershell.exe -NoProfile -File scripts/test-security-rate-local.ps1 -Fixture registration -RestartPocketBase
```

Result: exit `0`; registration buckets persisted across PocketBase restart.

### Static proxy and cutover checks

```powershell
powershell.exe -NoProfile -File scripts/check-real-ip-chain.ps1
powershell.exe -NoProfile -File scripts/check-auth-facade-cutover.ps1
```

Result: both exit `0`.

```text
PASS trustworthy OpenResty -> Caddy -> PocketBase real IP chain
PASS native registration/account-mail cutover preserves token confirmation routes
```

### Hook and migration JavaScript syntax

```powershell
Get-ChildItem pb_hooks,pb_migrations -Recurse -File -Include *.js |
  ForEach-Object { node --check $_.FullName }
```

Result: exit `0`, no syntax errors.

### Node gateway tests

```powershell
Push-Location admin-auth
npm test
Pop-Location
```

Result: exit `0`; `146` tests, `145` passed, `0` failed, `1` local Mailpit integration test skipped. This includes a VM-executed migration test proving 500-row pagination to EOF, unique event IDs, sensitive-field clearing, required fields/indexes, and Track C-compatible enums.

### Astro build

```powershell
Push-Location astro
npm run build
Pop-Location
```

Result: exit `0`; Astro built `22` pages and Pagefind completed. Existing prerender/header and chunk-size warnings remain warnings only.

### Direct SMTP bypass check

```powershell
Select-String -LiteralPath pb_hooks/send_email_comment.pb.js -Pattern 'newMailClient|MailerMessage'
```

Result: no matches.

### Migration results

- Every fixture run bootstrapped a fresh temporary PocketBase 0.22.21 data directory and applied the current migration set successfully.
- `bash scripts/verify-pocketbase-migrations-linux.sh` could not be executed on this host: `bash` is not installed and `wsl.exe` reports that no Linux distribution is installed. Therefore the dedicated Linux fresh-plus-upgrade verifier remains an integration-host check.

## Cross-track contracts and unresolved integration checks

- Locked exports are preserved: `registration_mode.getRegistrationMode`, `registration_mode.replaceRegistrationMode`, `security_rate_limit.consume`, `mail_outbox.enqueue`, and `mail_logs.delivery`.
- `security_registration_mode` is now a private server-only singleton collection; the generic `settings` key is ignored even if retained or modified.
- Reader OTP uses only `/api/blog-auth/otp/request` and `/api/blog-auth/otp/verify`. Native `request-otp`/`auth-with-otp` paths for both `users` and `_pb_users_auth_`, with or without trailing slashes, are denied in every proxy configuration. Password MFA has explicit dedicated facade routes.
- Delivery logs now emit Track C's exact runtime contract: source kinds `account|reader|comment|admin|operations|retention|registration` and uppercase stable error classes. Track C does not need a `legacy` or `legacy_minimized` exception.
- Registration calls the locked Track C interface `account_retention.initializeNewUser` in the user-create transaction. The Track C module is not present in this branch, so the merged branch must run the real integration test.
- Admin routes import the locked Track A interfaces `admin_step_up.requireAdminStepUp` and `admin_security_audit.writeSecurityAudit`. Transaction behavior is covered with injected audit fixtures, but role/network/real-step-up black-box tests require Track A to be merged.
- The two-source-network/forged-XFF namespace test was not available in this Windows worktree. Static chain checks pass; the integration/deployment harness must still prove distinct client bucket hashes and forged-XFF resistance.
- The integration controller must provide `OPENRESTY_TRUSTED_PROXY`; Track B intentionally did not edit controller-owned environment or compose files.

## Safety confirmation

- No production deployment was performed.
- No real SMTP server or real recipient was contacted; gateway tests used only the temporary PocketBase loopback fixture.
- No real rclone remote was accessed.
- No private age key or production secret was read, created, or used.
