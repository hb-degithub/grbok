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
2. Add Passkey/WebAuthn as a required admin privilege verification step for `author`, `admin`, and `super_admin` users.
3. Keep existing password and reader login behavior for compatibility.
4. Recovery is server-local only, through a CLI script and recovery codes; no public admin recovery page.
5. Treat PocketBase native MFA and WebAuthn as independent layers. PocketBase MFA protects login; WebAuthn protects admin privilege elevation.

## Architecture

### Layer 1: Private Admin Entry

Caddy remains the first gate for sensitive admin surfaces.

Protected routes:

- `/admin*`
- `/_/*`
- `/api/admins/*`
- Passkey admin endpoints under `/api/blog-admin/webauthn/*`
- Admin recovery endpoints, if any are ever added, must stay blocked from public access.

The first implementation keeps `ADMIN_IP` as the allowlist source because the project already uses it. The Caddyfile should centralize the admin IP matcher so future migration to Tailscale/WireGuard, mTLS, or Cloudflare Access does not require rewriting every route.

Expected Caddyfile pattern:

```caddyfile
@blocked_admin_access {
    path /admin* /_/* /api/admins/* /api/blog-admin/webauthn/*
    not remote_ip {$ADMIN_IP}
}
respond @blocked_admin_access "Forbidden" 403
```

Route-specific `handle` blocks may still apply headers and reverse proxy behavior, but they should not duplicate the allowlist rule with slightly different path lists.

### Layer 2: Standard Admin Privilege Verification

Use WebAuthn/Passkey rather than custom frontend encryption.

This implementation is intentionally independent of PocketBase native MFA. It must not mutate PocketBase internal MFA state, disable native OTP, or rely on PocketBase token internals. Existing PocketBase MFA may remain enabled as an account login factor, while WebAuthn is the admin elevation check required before admin UI/API access.

Admin login flow:

1. User submits email and password through the existing PocketBase auth flow.
2. If the authenticated role is `reader`, redirect as today.
3. If the role is `author`, `admin`, or `super_admin`, mark the session as pending admin verification.
4. The browser requests a WebAuthn challenge from a PocketBase hook endpoint.
5. The browser calls `navigator.credentials.get()`.
6. The server verifies the assertion against the stored public credential.
7. The server writes a short-lived verified session record.
8. `/admin` renders only when both PocketBase auth and admin verification are valid.

Registration flow:

1. A logged-in `super_admin` opens the security area.
2. The server issues a WebAuthn registration challenge.
3. The browser calls `navigator.credentials.create()`.
4. The server stores the credential public key, credential id, sign count, device label, and owner user id.

Credential storage should live in a PocketBase collection such as `admin_passkeys`. Challenge state should be short-lived and single-use, either in a `webauthn_challenges` collection or a server-side signed challenge record.

The first implementation should not use PocketBase External Auth/OAuth2 for WebAuthn. WebAuthn is not an OAuth provider, and forcing it through OAuth would add compatibility and threat-model complexity without clear benefit for this project.

### Layer 3: Session, Rate Limit, and Audit Hardening

Session hardening:

- Keep PocketBase auth as the primary identity token.
- Add an admin verification state with short TTL.
- Require fresh admin verification for sensitive admin actions when practical.
- Continue clearing invalid PocketBase tokens on refresh failure.

PocketBase JWTs are treated as immutable once issued. Admin verification is therefore represented by a server-side record, not by modifying the PocketBase token payload.

Suggested `admin_verified_sessions` fields:

- `user`: relation to `users`
- `token_hash`: HMAC/SHA-256 hash of the current PocketBase token or a stable token identifier
- `fingerprint_hash`: HMAC/SHA-256 hash of the browser fingerprint header
- `ip_hash`: HMAC/SHA-256 hash or truncated representation of the client IP
- `user_agent_hash`: HMAC/SHA-256 hash of the user agent
- `verified_at`
- `expires_at`
- `revoked_at`

Every admin-only API request should verify `(user, token_hash, fingerprint_hash, ip_hash, expires_at)` server-side. This limits replay if a token is copied to another device or network.

Rate limiting:

- Keep existing client-side throttling as UX protection only.
- Treat server-side Caddy/OpenResty/PocketBase hook limits as the real control.
- Add strict limits to WebAuthn challenge and verification endpoints.

Audit logging:

- Log passkey registration, passkey deletion, admin verification success, admin verification failure, and recovery use.
- Do not log raw passwords, passkey challenge bytes, private secrets, or recovery code plaintext.
- Prefer `user_id` over email in audit events.
- Store IP addresses as HMAC hashes or truncated values by default. Full IP logging is reserved for explicit security investigation mode.
- Give audit logs their own retention policy and admin-only access rule.

### Layer 4: Server-Local Recovery

No public recovery page is added for admin passkeys.

Recovery path:

1. Operator SSHs into the server.
2. Operator runs a script such as `scripts/admin-recovery.ps1` or a Linux shell equivalent, depending on deployment host.
3. The script verifies a recovery code hash or a locally supplied confirmation secret.
4. The script can disable a lost passkey, issue a one-time passkey re-enrollment window, or reset a specific admin verification lock.
5. Every recovery action writes an audit event.

Recovery codes must be generated server-side, shown once, stored only as hashes, expire after an absolute lifetime such as 30 days, and be single-use.

Recovery scripts must require an explicit target user such as `--user-email` or `--user-id`. They should not require the recovery code as a command-line argument because command arguments can leak through shell history or process listings. Prefer hidden interactive input, a protected environment variable, or a permission-restricted temporary file.

## Components

### Caddy

- Centralize the admin allowlist matcher.
- Apply the matcher to `/admin*`, `/_/*`, `/api/admins/*`, and new WebAuthn admin endpoints.
- Keep noindex headers on admin surfaces.

### PocketBase Hooks and Migrations

- Add collections for admin passkeys, WebAuthn challenges, and audit events if the existing `audit_logs` collection is not sufficient.
- Add a collection for `admin_verified_sessions`.
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
- Verified admin sessions bind to user, token hash, browser fingerprint, and IP hash, and expire as expected.
- Caddy config protects all intended admin routes.
- Recovery code hashes validate correctly, expire, are single-use, and plaintext codes are never stored.
- Audit events use user ids and do not store raw secrets or default full IP addresses.

Configuration-only changes may be verified with config validation and route-level curl checks.

## Rollout Plan

1. Add design and implementation plan.
2. Harden Caddy route grouping first.
3. Add server-side WebAuthn data model and tests.
4. Add frontend passkey step and admin guard integration.
5. Add recovery scripts.
6. Run local build/tests.
7. Deploy behind the existing IP allowlist.
8. Register at least two passkeys before enforcing passkey-required admin verification.

## Non-Goals

- Do not implement custom password encryption in the browser.
- Do not expose an admin recovery page on the public site.
- Do not remove existing PocketBase auth or reader login behavior.
- Do not rely on client-side throttling as a security boundary.
- Do not automatically disable PocketBase native MFA when registering a passkey.

## Open Follow-Up

The first implementation uses IP allowlisting because it matches current infrastructure. The preferred later upgrade path is Tailnet-private access through Tailscale or WireGuard, then mTLS if device certificates become manageable, then Cloudflare Access if multi-user SSO policy becomes more important.

Do not use Tailscale Funnel for the admin surface. Funnel intentionally exposes a service to the public internet; the admin surface should stay private to a tailnet or VPN.
