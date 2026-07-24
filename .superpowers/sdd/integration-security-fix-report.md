# Mail security integration fix report

Date: 2026-07-18

Branch: `codex/mail-security-integration`

Baseline reviewed: `c9b8ade`

## Scope and safety boundary

- Changes were limited to the local integration worktree.
- No production access, deployment, remote push, real SMTP delivery, real rclone transfer, or age private-key handling occurred.
- Existing user changes were preserved.
- Existing-file patches used the approved local workflow: `git apply --check` before `git apply`.

## Closed findings

- The aggregate runner now preserves native child exit codes and remains noninteractive.
- CI mode is loopback-only and passes `-Offline` to fixtures that otherwise support downloading PocketBase.
- Sensitive scanning handles benign Git stderr, rejects secret fallback bypasses, checks archive field names, and scans ignored Astro build output.
- Production proxy trust is explicit and injected only into Caddy; local Caddy is host-loopback-bound.
- Caddy access logs delete action-token query parameters and admin credential headers, rotate daily, and retain identifiable online logs for at most seven days.
- Mail hooks log fixed operation/result codes instead of raw exception details.
- Retention reminders use a trusted HTTPS site origin and a fixed `/login` CTA without account identifiers or tokens.
- Account-retention input now matches the camelCase Outbox contract and uses a readable safe display-name fallback.
- The Outbox crash-retry fixture now establishes explicit record ordering instead of relying on equal-millisecond timestamps.

## TDD and regression evidence

- Native capture probe: RED lost exit code `23`; GREEN preserved it.
- Offline fixture contract: RED missing `-Offline`; GREEN fails before any filesystem/network setup when the binary is absent.
- Sensitive canaries: dangerous assignments, credentials, archive plaintext, forbidden log fields, and ignored build output are blocked; safe placeholders remain accepted.
- Retention display name: RED received the damaged `??` fallback; GREEN receives `用户`.
- Outbox determinism: three fresh runs reproduced one intermittent lease-order failure and two passes before the fixture fix; five consecutive fresh runs passed after explicit timestamps were added.
- Caddy 2.8.4 adapted and validated both configurations. A local runtime canary confirmed that the access record omits the action token and all protected admin headers.

## Focused verification

- `check-mail-config.ps1`: PASS
- `check-mail-security-env.ps1`: PASS
- `check-admin-routes.ps1`: PASS
- `check-real-ip-chain.ps1`: PASS
- `test-pre-deploy-runner.ps1`: PASS
- `test-pre-deploy-manifest.ps1`: PASS
- `test-offline-ci-contract.ps1`: PASS
- `test-sensitive-check.ps1`: PASS
- `hook_log_safety.test.js`: PASS
- Account retention `-All`: PASS
- Outbox fixture, five consecutive fresh runs: PASS
- Direct sensitive scan: zero issues
- Changed PowerShell parsers: PASS
- `git diff --check`: PASS

## Aggregate verification

Command:

```powershell
powershell.exe -NoProfile -ExecutionPolicy Bypass -File scripts\pre-deploy-check.ps1 -Ci
```

Result: `23 passed, 2 skipped, 0 failed`.

Explicit environment skips:

- Bash syntax check: no usable Bash runtime on this Windows host.
- Linux PocketBase migration verifier: current platform is not Linux.

These skips are environment limitations, not claimed passes. Docker Compose runtime expansion was not executed because Docker is unavailable; service-scoped static checks and Caddy 2.8.4 runtime validation covered the local evidence available on this host.
