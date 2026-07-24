# Admin Auth Hardening Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add private admin entry hardening, Passkey/WebAuthn admin verification, verified admin sessions, audit-safe recovery, and deployment checks for the blog admin surface.

**Architecture:** Caddy remains the first public gate. PocketBase remains the source of users, roles, data, hooks, and migrations. WebAuthn cryptographic option generation and assertion verification run in a small internal Node service, while PocketBase hook routes expose `/api/blog-admin/webauthn/*` and persist state in PocketBase collections.

**Tech Stack:** Astro 6, React 19, PocketBase 0.22.21 JS hooks/migrations, Caddy 2.8.4, Docker Compose, Node 22.12+, Node built-in test runner, SimpleWebAuthn server/browser packages.

## Global Constraints

- Keep existing PocketBase password login, OTP/MFA login, reader login, and role model.
- WebAuthn is admin privilege verification, independent of PocketBase native MFA.
- Do not mutate PocketBase internal MFA state or disable native OTP during passkey registration.
- Do not implement custom browser password encryption.
- Do not expose a public admin recovery page.
- Admin verification must be server-side and must not modify PocketBase JWT payloads.
- Verified admin sessions must bind user, PocketBase token hash, browser fingerprint hash, IP hash, user agent hash, and expiry.
- Recovery codes must be generated server-side, shown once, stored only as hashes, expire after 30 days, and be single-use.
- Audit logs must prefer user id over email and must not store raw secrets or full IP addresses by default.
- Avoid touching the existing unrelated dirty files unless an implementation task explicitly lists them.
- Every behavior-bearing task starts with a failing test and ends with a focused commit.

---

## File Map

Create:
- `scripts/check-admin-routes.ps1`
- `admin-auth/package.json`
- `admin-auth/Dockerfile`
- `admin-auth/src/config.mjs`
- `admin-auth/src/session-policy.mjs`
- `admin-auth/src/webauthn-service.mjs`
- `admin-auth/src/server.mjs`
- `admin-auth/test/session-policy.test.mjs`
- `admin-auth/test/webauthn-service.test.mjs`
- `admin-auth/test/server.test.mjs`
- `pb_migrations/20260701090000_create_admin_auth_hardening.pb.js`
- `pb_hooks/admin_webauthn.pb.js`
- `scripts/check-pb-admin-auth.ps1`
- `astro/src/lib/admin-passkey.ts`
- `astro/src/hooks/useAdminVerification.ts`
- `astro/src/components/auth/AdminPasskeyStep.tsx`
- `astro/src/components/admin/PasskeyManager.tsx`
- `scripts/admin-recovery.ps1`
- `scripts/check-admin-recovery.ps1`
- `docs/admin-auth-hardening-runbook.md`

Modify:
- `Caddyfile`
- `Caddyfile.local`
- `docker-compose.yml`
- `docker-compose.local.yml`
- `.env.example`
- `astro/package.json`
- `astro/src/components/auth/PasswordLoginForm.tsx`
- `astro/src/components/admin/AdminGuard.tsx`
- `astro/src/hooks/useAdminAuth.ts`
- `astro/src/components/admin/SecurityAudit.tsx`
- `astro/src/types/pocketbase.ts`
- `scripts/pre-deploy-check.ps1`
- `scripts/sensitive-check.ps1`

---

### Task 1: Centralize Admin Route Protection

**Files:** `scripts/check-admin-routes.ps1`, `Caddyfile`, `Caddyfile.local`

**Produces:** Caddy matcher `@blocked_admin_access` protecting `/admin*`, `/_/*`, `/api/admins/*`, and `/api/blog-admin/webauthn/*`.

- [ ] Write `scripts/check-admin-routes.ps1` to assert both Caddy files contain `@blocked_admin_access`, `respond @blocked_admin_access`, and all four protected paths.
- [ ] Run `pwsh -File scripts/check-admin-routes.ps1`; expected failure because matcher is not present yet.
- [ ] Add this matcher near the top of both Caddy server blocks:

```caddyfile
@blocked_admin_access {
    path /admin* /_/* /api/admins/* /api/blog-admin/webauthn/*
    not remote_ip {$ADMIN_IP}
}
respond @blocked_admin_access "Forbidden" 403
```

- [ ] Remove duplicate per-route IP blocking from existing `/admin*`, `/_/*`, and `/api/admins/*` handles while preserving headers, reverse proxy, `try_files`, and file serving.
- [ ] Run `pwsh -File scripts/check-admin-routes.ps1`; expected pass.
- [ ] Commit: `git add Caddyfile Caddyfile.local scripts/check-admin-routes.ps1 && git commit -m "security: centralize admin route protection"`

### Task 2: Build Internal Admin Auth Session Policy

**Files:** `admin-auth/package.json`, `admin-auth/src/config.mjs`, `admin-auth/src/session-policy.mjs`, `admin-auth/test/session-policy.test.mjs`

**Produces:** `hashBinding`, `createVerifiedSessionRecord`, `isVerifiedSessionValid`.

- [ ] Create `admin-auth/package.json` using Node 22+, `type=module`, scripts `test=node --test`, `start=node src/server.mjs`, dependency `@simplewebauthn/server`.
- [ ] Write `session-policy.test.mjs` covering stable HMAC hashes, no plaintext hashes, required fields, expiry, revoked sessions, and mismatch rejection.
- [ ] Run `cd admin-auth; npm test -- test/session-policy.test.mjs`; expected failure because module is missing.
- [ ] Implement `session-policy.mjs` using `node:crypto` HMAC SHA-256 and `timingSafeEqual`.
- [ ] Implement `config.mjs` reading `ADMIN_AUTH_INTERNAL_SECRET`, `ADMIN_AUTH_HASH_SECRET`, `ADMIN_AUTH_RP_ID`, `ADMIN_AUTH_ORIGIN`, and `ADMIN_AUTH_SESSION_TTL_SECONDS`.
- [ ] Run `cd admin-auth; npm test -- test/session-policy.test.mjs`; expected pass.
- [ ] Commit: `git add admin-auth && git commit -m "security: add admin verification session policy"`

### Task 3: Wrap SimpleWebAuthn Operations

**Files:** `admin-auth/src/webauthn-service.mjs`, `admin-auth/test/webauthn-service.test.mjs`, `admin-auth/package-lock.json`

**Produces:** `createWebAuthnService(adapter, config)` with `registrationOptions`, `verifyRegistration`, `authenticationOptions`, `verifyAuthentication`.

- [ ] Run `cd admin-auth; npm install @simplewebauthn/server`; network approval may be required.
- [ ] Write tests with a fake adapter proving RP ID, origin, user verification `required`, expected challenge, and credential fields are passed correctly.
- [ ] Run `cd admin-auth; npm test -- test/webauthn-service.test.mjs`; expected failure because wrapper is missing.
- [ ] Implement wrapper around `generateRegistrationOptions`, `verifyRegistrationResponse`, `generateAuthenticationOptions`, and `verifyAuthenticationResponse`.
- [ ] Run `cd admin-auth; npm test -- test/webauthn-service.test.mjs`; expected pass.
- [ ] Commit: `git add admin-auth && git commit -m "security: wrap webauthn server operations"`

### Task 4: Add Internal Admin Auth HTTP Service

**Files:** `admin-auth/src/server.mjs`, `admin-auth/test/server.test.mjs`

**Produces:** Internal endpoints protected by `X-Internal-Secret`:
- `POST /internal/webauthn/registration/options`
- `POST /internal/webauthn/registration/verify`
- `POST /internal/webauthn/authentication/options`
- `POST /internal/webauthn/authentication/verify`
- `GET /health`

- [ ] Write server tests using Node `fetch` and `node:test` for missing/invalid secret, route JSON output, and verified session record creation.
- [ ] Run `cd admin-auth; npm test -- test/server.test.mjs`; expected failure because server module is missing.
- [ ] Implement `createServer({ config, webauthnService })` with JSON parsing, method checks, internal secret checks, route dispatch, and safe JSON errors.
- [ ] In authentication verify, call `createVerifiedSessionRecord` after successful WebAuthn verification.
- [ ] Run `cd admin-auth; npm test -- test/server.test.mjs`; expected pass.
- [ ] Commit: `git add admin-auth && git commit -m "security: add internal webauthn service api"`

### Task 5: Wire Docker and Environment

**Files:** `admin-auth/Dockerfile`, `docker-compose.yml`, `docker-compose.local.yml`, `.env.example`, `scripts/check-admin-routes.ps1`

**Produces:** Docker service `admin-auth` available only on the internal compose network as `http://admin-auth:8787`.

- [ ] Extend `check-admin-routes.ps1` to require `.env.example` entries for `ADMIN_AUTH_INTERNAL_SECRET`, `ADMIN_AUTH_HASH_SECRET`, `ADMIN_AUTH_RP_ID`, `ADMIN_AUTH_ORIGIN`, `ADMIN_AUTH_SESSION_TTL_SECONDS`.
- [ ] Run `pwsh -File scripts/check-admin-routes.ps1`; expected failure for missing env entries.
- [ ] Add `admin-auth/Dockerfile` from `node:22-alpine`, `npm ci --omit=dev`, copy `src`, expose `8787`, run `npm run start`.
- [ ] Add `admin-auth` service to both compose files with env values and a `/health` healthcheck.
- [ ] Add `ADMIN_AUTH_INTERNAL_URL`, `ADMIN_AUTH_INTERNAL_SECRET`, and `ADMIN_AUTH_HASH_SECRET` env vars to the PocketBase service.
- [ ] Add documented env variables to `.env.example` with example non-secret values only.
- [ ] Run `pwsh -File scripts/check-admin-routes.ps1`; expected pass.
- [ ] Run `docker compose config`; expected valid YAML when env vars are present.
- [ ] Commit: `git add admin-auth/Dockerfile docker-compose.yml docker-compose.local.yml .env.example scripts/check-admin-routes.ps1 && git commit -m "security: wire internal admin auth service"`

### Task 6: Add PocketBase Admin Auth Collections

**Files:** `pb_migrations/20260701090000_create_admin_auth_hardening.pb.js`, `scripts/check-pb-admin-auth.ps1`, `scripts/pre-deploy-check.ps1`

**Produces:** Collections `admin_passkeys`, `webauthn_challenges`, `admin_verified_sessions`, `admin_recovery_codes`.

- [ ] Write `scripts/check-pb-admin-auth.ps1` to assert migration exists and includes collection names plus fields `credential_id`, `public_key`, `token_hash`, `fingerprint_hash`, `ip_hash`, `expires_at`, `used_at`, `code_hash`.
- [ ] Run `pwsh -File scripts/check-pb-admin-auth.ps1`; expected failure because migration is missing.
- [ ] Add migration using the repo's existing `Dao`, `Collection`, `SchemaField` style.
- [ ] Set public rules to `null` for challenges, verified sessions, and recovery codes; allow passkey list/view only for owner or `super_admin`.
- [ ] Add indexes for credential id, owner, challenge, verified session user/expires, and recovery code hash.
- [ ] Wire `check-pb-admin-auth.ps1` into `scripts/pre-deploy-check.ps1`.
- [ ] Run `pwsh -File scripts/check-pb-admin-auth.ps1`; expected pass.
- [ ] Commit: `git add pb_migrations/20260701090000_create_admin_auth_hardening.pb.js scripts/check-pb-admin-auth.ps1 scripts/pre-deploy-check.ps1 && git commit -m "security: add admin auth pocketbase schema"`

### Task 7: Add PocketBase WebAuthn Hook Routes

**Files:** `pb_hooks/admin_webauthn.pb.js`, `scripts/check-pb-admin-auth.ps1`

**Produces:** PB routes under `/api/blog-admin/webauthn/*` that delegate WebAuthn cryptography to `admin-auth` and persist PB records.

- [ ] Extend `check-pb-admin-auth.ps1` to require hook file and all route strings.
- [ ] Run `pwsh -File scripts/check-pb-admin-auth.ps1`; expected failure because hook is missing.
- [ ] Implement helpers in `admin_webauthn.pb.js`: `currentUser`, `requireAdminCapable`, `getClientIP`, `postInternal`, `writeAuditLog`, `hashBinding` if needed by PB persistence.
- [ ] Implement registration option/verify routes for `super_admin` only.
- [ ] Implement authentication option/verify routes for `author`, `admin`, and `super_admin`.
- [ ] Implement session status route returning `{ verified: boolean, expires_at?: string }`.
- [ ] Persist challenges as single-use records with expiry.
- [ ] Persist verified sessions returned by the internal service.
- [ ] Write audit logs using user id and hashed/truncated IP values.
- [ ] Run `pwsh -File scripts/check-pb-admin-auth.ps1`; expected pass.
- [ ] Run `docker compose -f docker-compose.local.yml --env-file .env.local config`; expected valid config.
- [ ] Commit: `git add pb_hooks/admin_webauthn.pb.js scripts/check-pb-admin-auth.ps1 && git commit -m "security: add admin webauthn pocketbase routes"`

### Task 8: Add Browser Passkey Login Step

**Files:** `astro/src/lib/admin-passkey.ts`, `astro/src/components/auth/AdminPasskeyStep.tsx`, `astro/src/components/auth/PasswordLoginForm.tsx`, `astro/package.json`, `astro/package-lock.json`

**Produces:** Admin-capable users complete Passkey verification after password/OTP login before redirecting to `/admin`.

- [ ] Run `cd astro; npm install @simplewebauthn/browser`; network approval may be required.
- [ ] Create `admin-passkey.ts` exporting `isAdminCapableRole`, `requestAdminPasskeyVerification`, `registerAdminPasskey`, and `fetchAdminVerificationStatus`.
- [ ] Create `AdminPasskeyStep.tsx` with loading/error states and buttons for Passkey verification and return-to-login.
- [ ] Modify `PasswordLoginForm.tsx`: after password or OTP auth, admin-capable roles set `pendingAdminRole`; readers keep current redirect; verified admins redirect to `/admin`.
- [ ] Run `cd astro; npm run build`; expected success.
- [ ] Commit: `git add astro/package.json astro/package-lock.json astro/src/lib/admin-passkey.ts astro/src/components/auth/AdminPasskeyStep.tsx astro/src/components/auth/PasswordLoginForm.tsx && git commit -m "security: require passkey step for admin login"`

### Task 9: Enforce Verified Admin Sessions in Admin Guard

**Files:** `astro/src/hooks/useAdminVerification.ts`, `astro/src/hooks/useAdminAuth.ts`, `astro/src/components/admin/AdminGuard.tsx`

**Produces:** Admin UI blocks users until both PB auth and verified admin session are valid.

- [ ] Create `useAdminVerification.ts` calling `/api/blog-admin/webauthn/session` and returning `isChecking`, `isVerified`, `expiresAt`, `refresh`.
- [ ] Modify `useAdminAuth.ts` to expose normalized `role` while preserving existing `hasPermission` behavior.
- [ ] Modify `AdminGuard.tsx` to show a locked admin verification state when PB auth passes but admin verification fails.
- [ ] Keep login and permission denied screens behaviorally intact.
- [ ] Run `cd astro; npm run build`; expected success.
- [ ] Commit: `git add astro/src/hooks/useAdminVerification.ts astro/src/hooks/useAdminAuth.ts astro/src/components/admin/AdminGuard.tsx && git commit -m "security: enforce verified admin sessions in guard"`

### Task 10: Add Super Admin Passkey Management UI

**Files:** `astro/src/components/admin/PasskeyManager.tsx`, `astro/src/components/admin/SecurityAudit.tsx`, `astro/src/types/pocketbase.ts`

**Produces:** Super admin can list, register, and revoke passkeys from `/admin/security`.

- [ ] Add `AdminPasskey` interface to `astro/src/types/pocketbase.ts`.
- [ ] Create `PasskeyManager.tsx` with label input, current passkey list, register button, revoke button, loading state, and error state.
- [ ] Use `registerAdminPasskey(label)` for enrollment.
- [ ] Use a PB hook route or locked-down PB collection update to revoke passkeys by setting `revoked_at`.
- [ ] Embed `PasskeyManager` above static audit cards in `SecurityAudit.tsx`.
- [ ] Add audit row `管理员 Passkey` describing enforced admin verification.
- [ ] Run `cd astro; npm run build`; expected success.
- [ ] Commit: `git add astro/src/components/admin/PasskeyManager.tsx astro/src/components/admin/SecurityAudit.tsx astro/src/types/pocketbase.ts && git commit -m "security: add admin passkey management ui"`

### Task 11: Add Server-Local Recovery Workflow

**Files:** `scripts/admin-recovery.ps1`, `scripts/check-admin-recovery.ps1`, `scripts/sensitive-check.ps1`, `scripts/pre-deploy-check.ps1`

**Produces:** Local-only recovery workflow with hidden code input, single-use code handling, expiry checks, and audit output.

- [ ] Write `check-admin-recovery.ps1` to require `admin-recovery.ps1`, `UserEmail`, `Action`, `Read-Host -AsSecureString`, `admin_recovery_codes`, `used_at`, and `expires_at`.
- [ ] Run `pwsh -File scripts/check-admin-recovery.ps1`; expected failure because recovery script is missing.
- [ ] Create `admin-recovery.ps1` with parameters `-UserEmail`, `-Action issue-reenroll|revoke-passkeys|clear-sessions`, and `-PocketBaseUrl`.
- [ ] Read recovery code through hidden prompt or protected env var; never accept `-RecoveryCode` as a plaintext argument.
- [ ] Validate code hash, reject expired/used codes, mark `used_at`, then perform the chosen action.
- [ ] Add audit log entry using user id and redacted operator context.
- [ ] Extend `sensitive-check.ps1` to catch committed admin auth secrets and plaintext recovery code strings.
- [ ] Wire recovery check into `pre-deploy-check.ps1`.
- [ ] Run `pwsh -File scripts/check-admin-recovery.ps1`; expected pass.
- [ ] Run `pwsh -File scripts/sensitive-check.ps1`; expected no findings for committed files.
- [ ] Commit: `git add scripts/admin-recovery.ps1 scripts/check-admin-recovery.ps1 scripts/sensitive-check.ps1 scripts/pre-deploy-check.ps1 && git commit -m "security: add local admin recovery workflow"`

### Task 12: Add Runbook and Final Verification

**Files:** `docs/admin-auth-hardening-runbook.md`, optionally `README.md`

**Produces:** Operator instructions for first deploy, first enrollment, recovery, rollback, and verification.

- [ ] Create `docs/admin-auth-hardening-runbook.md` with sections: required environment, first deploy, first enrollment, recovery, rollback, verification commands.
- [ ] Link the runbook from `README.md` only if README already links deployment docs nearby.
- [ ] Run `pwsh -File scripts/check-admin-routes.ps1`; expected pass.
- [ ] Run `pwsh -File scripts/check-pb-admin-auth.ps1`; expected pass.
- [ ] Run `pwsh -File scripts/check-admin-recovery.ps1`; expected pass.
- [ ] Run `cd admin-auth; npm test`; expected pass.
- [ ] Run `cd astro; npm run build`; expected success.
- [ ] Commit: `git add docs/admin-auth-hardening-runbook.md README.md && git commit -m "docs: add admin auth hardening runbook"`

---

## Execution Notes

- npm install tasks require network approval in this workspace.
- PocketBase JSVM is not Node or browser JavaScript; keep WebAuthn cryptography inside `admin-auth` and make PB hooks act as stateful adapters.
- Do not re-enable `pb_hooks/login_security.pb.js.disabled`.
- The feature can ship with current IP allowlist first; Tailscale/WireGuard is a later network-layer plan.
- Do not use Tailscale Funnel for admin access.

## Self-Review

- Spec coverage: Caddy private entry is Task 1; WebAuthn admin verification is Tasks 2-10; server-side verified sessions are Tasks 2, 4, 6, 7, and 9; recovery code lifecycle is Task 11; audit privacy is Tasks 6, 7, 11, and 12; rollout is Task 12.
- Scan result: plan uses concrete file paths, route names, collection names, commands, and expected outcomes.
- Type consistency: verified session field names are consistent: `token_hash`, `fingerprint_hash`, `ip_hash`, `user_agent_hash`, `verified_at`, `expires_at`, and `revoked_at`.

