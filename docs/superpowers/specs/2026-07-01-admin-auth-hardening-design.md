# Admin Auth Hardening Design

Date: 2026-07-01
Project: Huba's Blog
Status: Draft for review

## Goal

Harden the blog admin authentication path without replacing the existing PocketBase user model. The admin surface should be difficult to discover, resistant to password attacks, and recoverable only through a controlled server-side path.

## Current Context

The project is an Astro static frontend backed by PocketBase. Caddy serves static files, proxies `/api/*` to PocketBase, and already restricts PocketBase admin UI/API paths with `ADMIN_IP`.

The custom `/admin` panel currently relies on client-side PocketBase auth checks through `AdminGuard` and `useAdminAuth`. The login UI already supports password login, PocketBase MFA/OTP flow, client-side failure throttling, and request metadata headers from `security.ts`.

## Confirmed Decisions

1. Start with Caddy/IP whitelist hardening as the private access layer.
2. Add Passkey/WebAuthn as a required second factor for `author`, `admin`, and `super_admin` users.
3. Keep existing password and reader login behavior for compatibility.
4. Recovery is server-local only, through a CLI script and recovery codes; no public admin recovery page.

## Architecture

### Layer 1: Private Admin Entry

Caddy remains the first gate for sensitive admin surfaces.

Protected routes:

- `/admin*`
- `/_/*`
- `/api/admins/*`
- Passkey admin endpoints under `/api/blog-admin/webauthn/*`
- Admin recovery endpoints, if any are ever added, must stay blocked from public access.

The first implementation keeps `ADMIN_IP` as the allowlist source because the project already uses it. The Caddyfile should centralize the admin IP matcher so future migration to Cloudflare Access, Tailscale/WireGuard, or mTLS does not require rewriting every route.

### Layer 2: Standard Admin Second Factor

Use WebAuthn/Passkey rather than custom frontend encryption.

Admin login flow:

1. User submits email and password through the existing PocketBase auth flow.
2. If the authenticated role is `reader`, redirect as today.
3. If the role is `author`, `admin`, or `super_admin`, mark the session as pending admin verification.
4. The browser requests a WebAuthn challenge from a PocketBase hook endpoint.
5. The browser calls `navigator.credentials.get()`.
6. The server verifies the assertion against the stored public credential.
7. The server marks the current auth token/session as admin-verified for a short window.
8. `/admin` renders only when both PocketBase auth and admin verification are valid.

Registration flow:

1. A logged-in `super_admin` opens the security area.
2. The server issues a WebAuthn registration challenge.
3. The browser calls `navigator.credentials.create()`.
4. The server stores the credential public key, credential id, sign count, device label, and owner user id.

Credential storage should live in a PocketBase collection such as `admin_passkeys`. Challenge state should be short-lived and single-use, either in a `webauthn_challenges` collection or a server-side signed challenge record.

### Layer 3: Session, Rate Limit, and Audit Hardening

Session hardening:

- Keep PocketBase auth as the primary identity token.
- Add an admin verification state with short TTL.
- Require fresh admin verification for sensitive admin actions when practical.
- Continue clearing invalid PocketBase tokens on refresh failure.

Rate limiting:

- Keep existing client-side throttling as UX protection only.
- Treat server-side Caddy/OpenResty/PocketBase hook limits as the real control.
- Add strict limits to WebAuthn challenge and verification endpoints.

Audit logging:

- Log passkey registration, passkey deletion, admin verification success, admin verification failure, and recovery use.
- Do not log raw passwords, passkey challenge bytes, private secrets, or recovery code plaintext.

### Layer 4: Server-Local Recovery

No public recovery page is added for admin passkeys.

Recovery path:

1. Operator SSHs into the server.
2. Operator runs a script such as `scripts/admin-recovery.ps1` or a Linux shell equivalent, depending on deployment host.
3. The script verifies a recovery code hash or a locally supplied confirmation secret.
4. The script can disable a lost passkey, issue a one-time passkey re-enrollment window, or reset a specific admin verification lock.
5. Every recovery action writes an audit event.

Recovery codes must be generated server-side, shown once, and stored only as hashes.

## Components

### Caddy

- Centralize the admin allowlist matcher.
- Apply the matcher to `/admin*`, `/_/*`, `/api/admins/*`, and new WebAuthn admin endpoints.
- Keep noindex headers on admin surfaces.

### PocketBase Hooks and Migrations

- Add collections for admin passkeys, WebAuthn challenges, and audit events if the existing `audit_logs` collection is not sufficient.
- Add hook endpoints for challenge creation and assertion verification.
- Enforce role checks server-side.

### Astro Frontend

- Add an admin passkey step after password login for admin-capable roles.
- Update `AdminGuard` to require both PocketBase auth and admin verification.
- Add passkey management UI under the security/admin area for `super_admin`.

### Scripts

- Add recovery-code generation and server-local recovery scripts.
- Scripts must be explicit about target user email/id and must not print stored secret material.

## Testing Strategy

Use test-first implementation for behavior-bearing code.

Suggested tests:

- Admin-capable users are blocked from `/admin` until passkey verification succeeds.
- Reader users do not require passkey verification.
- WebAuthn challenges are single-use and expire.
- Verification rejects wrong challenge, wrong origin, wrong user, replayed signature, and unknown credential id.
- Caddy config protects all intended admin routes.
- Recovery code hashes validate correctly and plaintext codes are never stored.

Configuration-only changes may be verified with config validation and route-level curl checks.

## Rollout Plan

1. Add design and implementation plan.
2. Harden Caddy route grouping first.
3. Add server-side WebAuthn data model and tests.
4. Add frontend passkey step and admin guard integration.
5. Add recovery scripts.
6. Run local build/tests.
7. Deploy behind the existing IP allowlist.
8. Register at least two passkeys before enforcing passkey-only admin verification.

## Non-Goals

- Do not implement custom password encryption in the browser.
- Do not expose an admin recovery page on the public site.
- Do not remove existing PocketBase auth or reader login behavior.
- Do not rely on client-side throttling as a security boundary.

## Open Follow-Up

The first implementation uses IP allowlisting because it matches current infrastructure. A later upgrade can replace or augment this with Cloudflare Access, Tailscale/WireGuard, or mTLS.
