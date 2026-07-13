# Operations Alerts And Production Rollout Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add stateful host-health email alerts, prove the complete mail platform locally, and deploy it to `47.115.134.238` with staged feature flags, backups, verifiable acceptance, and a tested rollback path.

**Architecture:** A small dependency-free Python monitor runs from a hardened systemd timer and checks the three blog containers, public health, backup age, and root-disk usage. It persists only check state on the host and sends fixed structured events through stdin to the existing `admin-auth` mail CLI; when Docker or the mail container is unavailable it records the event in journald without pretending email succeeded. Production rollout packages one immutable release, keeps Compose project name `current`, starts all mail features disabled, validates Aliyun through the generic SMTP contract, and enables account mail, OTP, comment rules, then host alerts in separate reversible gates.

**Tech Stack:** Python 3 standard library and `unittest`, systemd, Docker Compose v2, Node.js 22 mail CLI, PowerShell 7, PocketBase 0.22.21, Astro 6, Mailpit 1.30.0, OpenSSH/SCP.

## Global Constraints

- Complete and verify the gateway, account-mail/OTP, and comment-Outbox/admin plans before production rollout.
- The current computer is the first execution target; do not SSH, SCP, edit cloud configuration, or contact production SMTP until the local acceptance report passes and the user explicitly approves production execution.
- Production SSH uses the existing key at `C:\tmp\blog_deploy_ed25519`; never place private-key contents, passwords, SMTP credentials, tokens, or prior shell-history secrets in Git, plans, commands, logs, or chat output.
- Standard `SMTP_*` variables are the canonical provider interface; Aliyun is the initial provider and legacy `ALIYUN_*` aliases remain read-only compatibility input.
- SMTP credentials exist only in the root-owned production environment file consumed by `admin-auth`; PocketBase, Astro, APIs, databases, release archives, and Git never receive them.
- Operations alert recipients come only from `MAIL_ALERT_RECIPIENTS`; PocketBase `mail_rules` never controls host alerts.
- Monitor checks are exactly `container_caddy`, `container_pocketbase`, `container_admin_auth`, `public_health`, `backup_age`, and `disk_usage`.
- Mail CLI operations events use only `eventId`, `check`, `state`, `observedAt`, and `summary`; state is `firing` or `recovered`, summary is at most 500 characters.
- Monitor state phases are `healthy`, `firing`, and `recovered`; first failure alerts once, persistent failure repeats only after a six-hour cooldown, and recovery alerts once.
- Root disk fires at 85 percent used and recovers below 80 percent; newest backup fires when older than 26 hours and recovers when age is at most 26 hours.
- Monitor state lives at `/var/lib/hlydwz-monitor/state.json`, directory mode `0700`, file mode `0600`, written atomically.
- If Docker, `blog-admin-auth`, or the mail CLI is unavailable, the monitor writes one sanitized journald event and applies the same cooldown; it never claims an email was delivered.
- Production Compose commands always include `-p current`, including start, stop, down, validation, rollback, and log inspection.
- Preserve named volumes `blog_pb_data`, `blog_caddy_data`, and `blog_caddy_config`; rollback never deletes volumes or new mail collections.
- Production release activation keeps the source listener bound to `127.0.0.1:18080` and does not reopen admin, database, image-host, or PocketBase ports.
- Feature flags start `false`; account mail, OTP, comment rules, and host timer are enabled one gate at a time only after the previous gate passes.
- Do not run OS package upgrades or unrelated server cleanup as part of mail rollout.
- Every task follows red-green-refactor and ends with a focused commit.

---

## File Map

Create:
- `ops/hlydwz_monitor.py` - checks, transition state machine, atomic state persistence, CLI adapter, and sanitized structured logging.
- `ops/test_hlydwz_monitor.py` - dependency-free unit tests with fake clock/runner/HTTP/filesystem.
- `ops/hlydwz-monitor.service` - hardened oneshot unit.
- `ops/hlydwz-monitor.timer` - two-minute persistent timer.
- `ops/hlydwz-monitor.conf.example` - non-secret thresholds/paths only.
- `ops/install-hlydwz-monitor.sh` - idempotent root installation and validation.
- `ops/uninstall-hlydwz-monitor.sh` - disable units and preserve state by default.
- `ops/configure-mail-env.py` - atomic root-only environment updater using stdin prompts/getpass, never command arguments.
- `ops/test_configure_mail_env.py` - parser, permissions, preservation, and redaction tests.
- `scripts/test-mail-platform-local.ps1` - aggregate local gate without Docker or production network.
- `scripts/build-mail-release.ps1` - clean build, allowlisted release archive, manifest, and SHA-256.
- `scripts/server-release-activate.sh` - precheck, backup, immutable release activation, health checks, and rollback using project `current`.
- `docs/operations/mail-platform-runbook.md` - local evidence, provider switch, staged production enablement, incident handling, and rollback commands.

Modify:
- `admin-auth/src/mail/validation.mjs` - keep operations event check/state contract synchronized with the monitor.
- `admin-auth/test/mail/cli.test.mjs` - include monitor event fixtures and sanitized CLI failures.
- `docker-compose.yml` - final mail variables/flags and existing localhost Caddy binding.
- `docker-compose.local.yml` - same service boundary with local-safe defaults.
- `.env.example` - UTF-8 provider-neutral variables and all feature flags false.
- `scripts/pre-deploy-check.ps1` - invoke the aggregate local gate when explicitly requested.
- `scripts/sensitive-check.ps1` - scan release manifest/archive listings and operations files.

---

### Task 1: Define Monitor Checks And A Deterministic State Machine

**Files:**
- Create: `ops/hlydwz_monitor.py`
- Create: `ops/test_hlydwz_monitor.py`

**Interfaces:**
- Consumes: injectable command runner, HTTP client, clock, path/glob functions, and disk usage function.
- Produces:

```python
@dataclass(frozen=True)
class CheckResult:
    key: str
    healthy: bool
    summary: str

@dataclass(frozen=True)
class AlertEvent:
    event_id: str
    check: str
    state: Literal['firing', 'recovered']
    observed_at: str
    summary: str

def evaluate_transition(previous: dict, result: CheckResult, now: datetime, cooldown: timedelta) -> tuple[dict, AlertEvent | None]: ...
def run_monitor(config: MonitorConfig, deps: Dependencies) -> int: ...
```

- [ ] **Step 1: Write failing state-transition tests**

Use `unittest` and a fixed UTC clock. Assert this exact sequence:

```python
def test_failure_cooldown_and_recovery(self):
    healthy = CheckResult('public_health', True, 'HTTP 200')
    failed = CheckResult('public_health', False, 'health request failed')
    state, event = evaluate_transition({}, healthy, T0, timedelta(hours=6))
    self.assertEqual((state['phase'], event), ('healthy', None))
    state, event = evaluate_transition(state, failed, T0 + timedelta(minutes=2), timedelta(hours=6))
    self.assertEqual((state['phase'], event.state), ('firing', 'firing'))
    state, event = evaluate_transition(state, failed, T0 + timedelta(hours=1), timedelta(hours=6))
    self.assertIsNone(event)
    state, event = evaluate_transition(state, failed, T0 + timedelta(hours=6, minutes=2), timedelta(hours=6))
    self.assertEqual(event.state, 'firing')
    state, event = evaluate_transition(state, healthy, T0 + timedelta(hours=7), timedelta(hours=6))
    self.assertEqual((state['phase'], event.state), ('recovered', 'recovered'))
    state, event = evaluate_transition(state, healthy, T0 + timedelta(hours=7, minutes=2), timedelta(hours=6))
    self.assertEqual((state['phase'], event), ('healthy', None))
```

Also test an alert-delivery attempt timestamp is recorded even when CLI delivery fails, so a broken Docker daemon cannot create one journald error every two minutes.

- [ ] **Step 2: Run and prove module missing**

Run:

```powershell
python -m unittest ops.test_hlydwz_monitor -v
```

Expected: import failure for `ops.hlydwz_monitor`.

- [ ] **Step 3: Implement immutable result/event types and transitions**

State for each check contains only:

```json
{
  "phase": "healthy",
  "failureCount": 0,
  "lastObservedAt": "2026-07-13T00:00:00Z",
  "lastAlertAttemptAt": "",
  "lastSummaryCode": "ok"
}
```

Do not persist command output, URLs with queries, container environment, recipient addresses, exception strings, email bodies, or SMTP fields. Normalize summaries to one line, strip control characters, and cap at 500 characters. Generate `eventId` as `ops_` plus 26 URL-safe random characters.

- [ ] **Step 4: Implement monitor orchestration with dependency injection**

`run_monitor` evaluates every check independently, loads missing/corrupt state as empty while logging `state_load_failed`, attempts events through an injected `send_alert`, updates state after the attempt, and returns `0` when checks completed even if an alert could not be emailed. Return `1` only for configuration/state-write failures that invalidate the run.

Structured stdout/journald lines permit only:

```json
{"component":"hlydwz-monitor","check":"public_health","phase":"firing","mail":"failed","code":"CLI_UNAVAILABLE"}
```

- [ ] **Step 5: Run focused tests**

Expected: transition, corruption recovery, summary sanitization, event schema, delivery-failure cooldown, and independent-check tests all pass.

- [ ] **Step 6: Commit**

```powershell
git add ops/hlydwz_monitor.py ops/test_hlydwz_monitor.py
git commit -m "feat(ops): add alert state machine"
```

---

### Task 2: Implement Container, Public Health, Backup, And Disk Checks

**Files:**
- Modify: `ops/hlydwz_monitor.py`
- Modify: `ops/test_hlydwz_monitor.py`

**Interfaces:**
- Produces:
  - `check_container(name, key, runner): CheckResult`
  - `check_public_health(url, http, timeout_seconds): CheckResult`
  - `check_backup_age(pattern, max_age, now, globber, statter): CheckResult`
  - `check_disk(path, fire_percent, recover_percent, previous_phase, disk_usage): CheckResult`

- [ ] **Step 1: Write failing table-driven check tests**

Container cases:

```python
CONTAINERS = {
    'container_caddy': 'blog-caddy',
    'container_pocketbase': 'blog-pocketbase',
    'container_admin_auth': 'blog-admin-auth',
}
```

Assert running+healthy passes, running+starting/failing/unhealthy fails, exited/missing/inspect-timeout fails, and summaries contain only container key plus stable state, never raw `docker inspect` JSON.

Public health passes only HTTP `200..299` within 10 seconds. Backup uses the newest regular file or directory mtime matching the configured glob and fails when none exists or age exceeds 26 hours. Disk fires at `>=85`, stays firing at 80..84, and recovers below 80.

- [ ] **Step 2: Run and prove missing functions**

Expected: import/attribute failures for all four checks.

- [ ] **Step 3: Implement bounded probes**

Container command is exactly:

```text
docker inspect --format {{json .State}} <container-name>
```

Use argument arrays, no shell, 10-second timeout, parse JSON, and require `.Running == true` plus `.Health.Status == 'healthy'` when Health exists. Public check uses `urllib.request` with a fixed user agent and no redirects to a different hostname. Backup follows no symlinks outside the configured pattern root. Disk uses `shutil.disk_usage('/')` and integer percentage.

- [ ] **Step 4: Test timeout, malformed output, and boundary values**

Expected: every probe returns a stable `CheckResult` instead of raising, and test output contains no injected raw command/HTTP exception text.

- [ ] **Step 5: Commit**

```powershell
git add ops/hlydwz_monitor.py ops/test_hlydwz_monitor.py
git commit -m "feat(ops): check blog host health"
```

---

### Task 3: Persist State Atomically And Send Events Through Stdin-Only CLI

**Files:**
- Modify: `ops/hlydwz_monitor.py`
- Modify: `ops/test_hlydwz_monitor.py`
- Modify: `admin-auth/test/mail/cli.test.mjs`

**Interfaces:**
- Consumes: `/var/lib/hlydwz-monitor/state.json` and `docker exec -i blog-admin-auth node src/mail/cli.mjs`.
- Produces:
  - `load_state(path): dict`
  - `save_state(path, state): None`
  - `send_alert_cli(event, runner): tuple[bool, str]`

- [ ] **Step 1: Write failing state-permission and CLI tests**

Python tests assert atomic temp-file+`os.replace`, final `0600`, parent `0700`, a concurrent/interrupted write leaves either the old or complete new JSON, and unknown keys in prior state are discarded.

CLI adapter test captures arguments/stdin:

```python
self.assertEqual(call.argv, ['docker', 'exec', '-i', 'blog-admin-auth', 'node', 'src/mail/cli.mjs'])
self.assertEqual(json.loads(call.stdin), {
    'eventId': event.event_id,
    'check': 'backup_age',
    'state': 'firing',
    'observedAt': '2026-07-13T00:00:00.000Z',
    'summary': 'latest backup is older than 26 hours',
})
```

Assert no event JSON appears in argv/process listing and failure output is reduced to `CLI_UNAVAILABLE`, `MAIL_NOT_CONFIGURED`, or another gateway allowlisted stable code.

- [ ] **Step 2: Run Python and Node tests and prove failures**

Expected: Python functions missing and Node monitor fixture validation absent.

- [ ] **Step 3: Implement state I/O**

Open parent with mode `0700`, create a same-directory temp file using `O_CREAT|O_EXCL` mode `0600`, write canonical UTF-8 JSON with sorted keys, flush and `fsync`, `os.replace`, then `fsync` parent directory on Linux. Reject files not owned by the effective UID or writable by group/other.

- [ ] **Step 4: Implement stdin CLI adapter**

Serialize only the five event keys and append one newline. Invoke without shell, with 30-second timeout and captured output. Success requires exit zero and exact JSON shape `{ok:true,sent:N}` with `N >= 1`; otherwise return a stable code and discard stdout/stderr. If Docker/admin-auth is unavailable, the caller logs sanitized journald state.

- [ ] **Step 5: Add the exact monitor event fixtures to Node CLI tests**

Test all six check names and both states, reject `healthy`, extra keys, summary over 500 characters, malformed timestamp, and event IDs not matching `^ops_[A-Za-z0-9_-]{20,64}$`. Assert CLI stdout/stderr never echoes summary or recipient.

- [ ] **Step 6: Run both suites**

Expected: Python tests pass and all existing/new admin-auth CLI tests pass.

- [ ] **Step 7: Commit**

```powershell
git add ops/hlydwz_monitor.py ops/test_hlydwz_monitor.py admin-auth/test/mail/cli.test.mjs
git commit -m "feat(ops): send stateful alerts through mail CLI"
```

---

### Task 4: Add Hardened systemd Units And Idempotent Installation

**Files:**
- Create: `ops/hlydwz-monitor.service`
- Create: `ops/hlydwz-monitor.timer`
- Create: `ops/hlydwz-monitor.conf.example`
- Create: `ops/install-hlydwz-monitor.sh`
- Create: `ops/uninstall-hlydwz-monitor.sh`
- Modify: `ops/test_hlydwz_monitor.py`

**Interfaces:**
- Consumes: Python `/usr/local/libexec/hlydwz-monitor`, config `/etc/hlydwz-monitor.conf`.
- Produces: `hlydwz-monitor.service` oneshot and `hlydwz-monitor.timer` every two minutes.

- [ ] **Step 1: Write failing static unit/install assertions**

Test/read files and require these service directives:

```ini
[Service]
Type=oneshot
User=root
EnvironmentFile=-/etc/hlydwz-monitor.conf
ExecStart=/usr/bin/python3 /usr/local/libexec/hlydwz-monitor/hlydwz_monitor.py
NoNewPrivileges=true
PrivateTmp=true
ProtectSystem=strict
ProtectHome=true
ProtectKernelTunables=true
ProtectKernelModules=true
ProtectControlGroups=true
RestrictSUIDSGID=true
LockPersonality=true
RestrictAddressFamilies=AF_UNIX AF_INET AF_INET6
ReadWritePaths=/var/lib/hlydwz-monitor
```

Require timer directives `OnBootSec=3min`, `OnUnitActiveSec=2min`, `RandomizedDelaySec=15s`, `Persistent=true`, and `WantedBy=timers.target`.

- [ ] **Step 2: Run static tests and prove files missing**

Expected: file-not-found failures.

- [ ] **Step 3: Implement units and non-secret config example**

Config keys are exactly:

```ini
HLYDWZ_PUBLIC_HEALTH_URL=https://hlydwz.com/api/health
HLYDWZ_BACKUP_GLOB=/opt/security-backups/*
HLYDWZ_BACKUP_MAX_AGE_HOURS=26
HLYDWZ_DISK_PATH=/
HLYDWZ_DISK_FIRE_PERCENT=85
HLYDWZ_DISK_RECOVER_PERCENT=80
HLYDWZ_ALERT_COOLDOWN_HOURS=6
HLYDWZ_STATE_PATH=/var/lib/hlydwz-monitor/state.json
```

No recipient or SMTP value appears here.

- [ ] **Step 4: Implement idempotent installer/uninstaller**

Installer requires root, Python 3, Docker CLI, and systemd; installs files mode `0755`/`0644`, creates state directory `0700`, creates empty state `0600`, runs Python tests from the release before installation, `systemd-analyze verify` on both units, daemon-reloads, but only enables/starts the timer when passed `--enable`.

Uninstaller stops/disables units, removes installed scripts/units, daemon-reloads, and preserves `/var/lib/hlydwz-monitor` unless explicit `--purge-state` is supplied.

- [ ] **Step 5: Run shell/static verification locally**

Run `bash -n` on both scripts, Python tests, and `systemd-analyze verify` when available. On Windows, the Python static parser must still verify all required directives and shell syntax can be deferred to the release Linux precheck.

- [ ] **Step 6: Commit**

```powershell
git add ops/hlydwz-monitor.service ops/hlydwz-monitor.timer ops/hlydwz-monitor.conf.example ops/install-hlydwz-monitor.sh ops/uninstall-hlydwz-monitor.sh ops/test_hlydwz_monitor.py
git commit -m "feat(ops): package hardened alert timer"
```

---

### Task 5: Add A Secret-Safe Production Environment Updater

**Files:**
- Create: `ops/configure-mail-env.py`
- Create: `ops/test_configure_mail_env.py`
- Modify: `.env.example`

**Interfaces:**
- Consumes: an existing env file and interactive stdin/getpass values.
- Produces: atomic mode-`0600` env update with canonical mail keys, no value output.

- [ ] **Step 1: Write failing parser/security tests**

Test preserving comments/unrelated keys, replacing duplicate mail keys once, values containing `#`, spaces, `=`, Unicode sender name, and rejecting newline/NUL. Assert original/temporary/final modes, rollback on interrupted replace, stdout contains key names/status only, and SMTP password/internal secrets never appear in argv/stdout/stderr.

- [ ] **Step 2: Run and prove module missing**

Run `python -m unittest ops.test_configure_mail_env -v`.

Expected: import failure.

- [ ] **Step 3: Implement canonical key management**

Manage exactly:

```python
MAIL_KEYS = [
    'SMTP_HOST', 'SMTP_PORT', 'SMTP_USERNAME', 'SMTP_PASSWORD',
    'SMTP_FROM_ADDRESS', 'SMTP_FROM_NAME', 'SMTP_TLS_MODE',
    'SMTP_CONNECTION_TIMEOUT_MS', 'SMTP_SOCKET_TIMEOUT_MS',
    'MAIL_PROVIDER_LABEL', 'MAIL_ALERT_RECIPIENTS', 'MAIL_INTERNAL_SECRET',
    'MAIL_HASH_SECRET', 'MAIL_GATEWAY_INTERNAL_URL', 'PUBLIC_SITE_URL',
    'MAIL_GATEWAY_ENABLED', 'MAIL_ACCOUNT_ENABLED', 'MAIL_OTP_ENABLED',
]
```

Interactive mode reads SMTP password and both internal secrets through `getpass`; other values through stdin. `--migrate-legacy` copies values from existing `ALIYUN_*` keys into missing generic keys in memory without printing either value, then removes legacy keys only after successful validation and atomic write. Generate missing `MAIL_INTERNAL_SECRET` and `MAIL_HASH_SECRET` independently with `secrets.token_urlsafe(48)`.

- [ ] **Step 4: Validate production values before write**

Require host, port `1..65535`, username/password paired, valid sender/alert addresses, TLS mode `implicit|starttls|auto`, HTTPS production site URL, two distinct secrets of at least 32 characters, and flags exact `true|false`. Initial rollout writes all three feature flags `false`.

- [ ] **Step 5: Update UTF-8 `.env.example`**

Replace mojibake mail comments and list canonical variables with non-secret example domains/addresses, generated-secret instructions, all feature flags `false`, and compatibility notes. Do not include plausible credentials.

- [ ] **Step 6: Run tests and sensitive scan**

Expected: updater tests pass; tracked files contain no assigned real-looking password/secret; output snapshots contain key names only.

- [ ] **Step 7: Commit**

```powershell
git add ops/configure-mail-env.py ops/test_configure_mail_env.py .env.example
git commit -m "security(mail): configure production env safely"
```

---

### Task 6: Build One Aggregate Local Mail-Platform Acceptance Command

**Files:**
- Create: `scripts/test-mail-platform-local.ps1`
- Modify: `scripts/pre-deploy-check.ps1`
- Modify: `scripts/sensitive-check.ps1`

**Interfaces:**
- Consumes: all tests/harnesses from the three prior plans plus monitor/env tests.
- Produces: `tmp/mail-evidence/summary.json` plus an archived `tmp/mail-evidence/runs/<run-id>/summary.json`, both containing non-sensitive evidence only.

- [ ] **Step 1: Write the aggregate contract**

Parameters:

```powershell
param(
  [string]$PocketBasePath = '.\pb_local\pb\pocketbase.exe',
  [string]$MailpitPath = 'C:\tmp\mailpit-v1.30.0\mailpit.exe',
  [switch]$KeepEvidence
)
$ErrorActionPreference = 'Stop'
```

Final summary schema:

```json
{
  "passed": true,
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
  "secretFindings": 0,
  "nodeTests": {"passed": 1, "failed": 0},
  "hookSyntaxFiles": 1,
  "migrationSyntaxFiles": 1,
  "freshMigrationRuns": 2,
  "gatewayIntegration": true,
  "accountIntegration": true,
  "outboxIntegration": true,
  "monitorTests": true,
  "envUpdaterTests": true,
  "mobileCheck": true,
  "uiSmokes": 2,
  "sensitiveFindings": 0,
  "listenersAfter": []
}
```

- [ ] **Step 2: Implement strictly ordered local stages**

Order:

1. Preflight Node >=22, npm, Python 3, PocketBase 0.22.21, Mailpit 1.30.0, and free local ports.
2. `npm ci` only when lockfiles require it; run admin-auth tests.
3. `node --check` all hooks/libs/migrations.
4. Apply all migrations to two fresh temporary databases.
5. Gateway Mailpit harness.
6. Account-mail/OTP harness twice.
7. Comment-Outbox/admin harness twice.
8. Python monitor and env-updater tests.
9. Astro build, mobile check, account UI smoke, mail-admin UI smoke.
10. Sensitive scan, `git diff --check`, final port/process cleanup.

Stop immediately on failure but always run cleanup and emit `passed:false` with only stage name/stable code.

- [ ] **Step 3: Make production network contact mechanically impossible**

Set local harness URLs to loopback and add a script guard that rejects any stage command/argument containing `47.115.134.238`, `hlydwz.com` except the fixed link-rendering fixture, `ssh`, `scp`, `smtpdm`, or a non-loopback SMTP host. Public link strings may be inspected but no web request to them is made.

- [ ] **Step 4: Extend sensitive and pre-deploy checks**

Sensitive scan covers tracked files, build output, test logs, temporary databases, evidence JSON, release listings, and diff. Allowed evidence values are counts, versions, booleans, stable error codes, and local port numbers. `pre-deploy-check.ps1 -IncludeLocalMailIntegration` calls this aggregate script; default pre-deploy remains fast and offline.

- [ ] **Step 5: Run the aggregate command twice**

Run:

```powershell
.\scripts\test-mail-platform-local.ps1 -KeepEvidence
.\scripts\test-mail-platform-local.ps1 -KeepEvidence
```

Expected: both summaries have `passed=true`, `productionTouched=false`, `sensitiveFindings=0`, and an empty `listenersAfter` array.

- [ ] **Step 6: Commit**

```powershell
git add scripts/test-mail-platform-local.ps1 scripts/pre-deploy-check.ps1 scripts/sensitive-check.ps1
git commit -m "test(mail): add full local acceptance gate"
```

---

### Task 7: Build An Allowlisted Immutable Release And Linux Precheck

**Files:**
- Create: `scripts/build-mail-release.ps1`
- Create: `scripts/server-release-activate.sh`
- Modify: `docker-compose.yml`
- Modify: `docker-compose.local.yml`
- Modify: `scripts/verify-pocketbase-migrations-linux.sh`

**Interfaces:**
- Consumes: a clean tested commit and local acceptance summary.
- Produces: `tmp/hlydwz-mail-<full-commit>.tar.gz`, `.sha256`, and manifest; server activation script with `precheck|activate|rollback` modes.

- [ ] **Step 1: Write failing release-content assertions**

Require archive roots:

```text
RELEASE_COMMIT
RELEASE_MANIFEST.json
docker-compose.yml
Caddyfile
astro/dist/
admin-auth/package.json
admin-auth/package-lock.json
admin-auth/src/
admin-auth/Dockerfile
pb_hooks/
pb_migrations/
ops/
scripts/verify-pocketbase-migrations-linux.sh
scripts/server-release-activate.sh
```

Reject `.env*`, `pb_data`, `node_modules`, `tmp`, `.git`, logs, screenshots, private keys, credentials, test databases, and disabled/legacy hooks.

- [ ] **Step 2: Run builder before implementation and prove missing**

Expected: script-not-found failure.

- [ ] **Step 3: Implement deterministic release builder**

Builder requires current HEAD equals the tested commit stored in the latest passing local summary, runs Astro build again, copies only the allowlist to a new staging directory, writes full 40-character commit, inventories path/size/SHA-256, scans staging, creates gzip tar, computes archive SHA-256, verifies extraction into a second temporary directory, and deletes staging on success.

- [ ] **Step 4: Implement Linux `precheck` mode**

Without touching current containers/volumes, verify archive checksum/manifest, no forbidden paths, `docker compose -p current config`, `node --check` all hooks/migrations, admin-auth tests in a disposable build container, Astro required files, Caddy adaptation in its image, monitor Python tests, shell syntax, systemd unit static directives, and all migrations against an isolated new data directory/volume. Output only `precheck=ok commit=<full-commit>`.

- [ ] **Step 5: Lock the Compose boundary and project name assumptions**

Compose retains fixed container names, named volumes, internal `admin-auth` exposure only, Caddy `127.0.0.1:${CADDY_HTTP_PORT:-18080}:80`, SMTP only on admin-auth, gateway/hash/flags only where specified, and no PocketBase `SMTP_*`/`ALIYUN_*`. Every server script command supplies `-p current` explicitly and never derives project name from a release directory.

- [ ] **Step 6: Build and inspect the release locally**

Expected: archive manifest matches, sensitive scan zero, full commit embedded, and extraction contains all mail plans' runtime files but no local evidence/secrets.

- [ ] **Step 7: Commit**

```powershell
git add scripts/build-mail-release.ps1 scripts/server-release-activate.sh docker-compose.yml docker-compose.local.yml scripts/verify-pocketbase-migrations-linux.sh
git commit -m "build(mail): package immutable production release"
```

---

### Task 8: Write The Exact Production Runbook And Rollback Contract

**Files:**
- Create: `docs/operations/mail-platform-runbook.md`
- Modify: `scripts/server-release-activate.sh`

**Interfaces:**
- Consumes: target `root@47.115.134.238`, key path, `/opt/hlydwz-blog/current`, release archive.
- Produces: operator-reviewed commands and automated health/rollback behavior; no execution in this task.

- [ ] **Step 1: Document approval and evidence gates**

The first runbook gate requires: two passing local summaries, clean release checksum/manifest, reviewed Git diff, current server health snapshot, and explicit user approval naming the release commit. The runbook states that reaching this page does not authorize SSH/SCP.

- [ ] **Step 2: Document read-only server preflight**

Exact checks after approval:

```powershell
ssh -i C:\tmp\blog_deploy_ed25519 -o BatchMode=yes root@47.115.134.238 "readlink -f /opt/hlydwz-blog/current; cd /opt/hlydwz-blog/current && docker compose -p current ps; curl -fsS http://127.0.0.1:18080/api/health; systemctl is-enabled blog-security-firewall.service; swapon --show"
```

Require current containers healthy, localhost API 200, security firewall enabled, swap active, at least 2 GiB free disk, and no unrelated deployment in progress.

- [ ] **Step 3: Define consistent PocketBase and configuration backups**

`activate` creates `/opt/hlydwz-blog/backups/<UTC-run-id>` mode `0700`, records old symlink and `docker compose -p current config --no-interpolate`, copies current `.env` mode `0600`, stops PocketBase briefly, copies `/pb_data` from the stopped container, restarts it, and validates API health before continuing. Hash every backup file and verify the SQLite/PocketBase data copy can be opened in an isolated precheck. If backup verification fails, abort before release activation.

- [ ] **Step 4: Define immutable activation and automatic rollback**

Upload archive/checksum to `/opt/hlydwz-blog/incoming`, verify, extract to `/opt/hlydwz-blog/releases/<UTC>-<short-commit>`, copy the secured `.env`, and run release `precheck`. Activation:

```text
docker compose -p current down
atomically repoint /opt/hlydwz-blog/current symlink
docker compose -p current up -d --build
wait up to 180 seconds for blog-admin-auth, blog-pocketbase, blog-caddy healthy
verify http://127.0.0.1:18080/api/health and required local pages
```

On any failure: `docker compose -p current down`, restore old symlink, `docker compose -p current up -d --build`, verify old health, and keep the failed release/log evidence. Never run `down -v`.

- [ ] **Step 5: Define environment migration without secret exposure**

Run `configure-mail-env.py --migrate-legacy /opt/hlydwz-blog/current/.env` interactively inside the approved SSH session. It maps existing Aliyun settings to canonical generic names, generates distinct internal secrets if absent, sets provider label, verifies alert recipients, and writes all three feature flags false. The runbook forbids passing values on command lines and requires `stat` mode `0600` plus a key-name-only configuration check.

- [ ] **Step 6: Define rollback semantics**

Emergency rollback first writes `MAIL_GATEWAY_ENABLED=false`, `MAIL_ACCOUNT_ENABLED=false`, `MAIL_OTP_ENABLED=false`, disables all comment rules through a local protected maintenance command or retained DB values, and stops/disables `hlydwz-monitor.timer`. Then switch to the old release with `-p current`. Preserve new collections and mail diagnostics; do not roll back migrations destructively during an incident.

- [ ] **Step 7: Verify runbook commands against a disposable Linux tree**

Run shell syntax/static checks and search every Compose invocation in script/runbook; expected: each contains `-p current`, no `down -v`, no secret-valued command arguments, and rollback includes health verification.

- [ ] **Step 8: Commit**

```powershell
git add docs/operations/mail-platform-runbook.md scripts/server-release-activate.sh
git commit -m "docs(mail): add staged production runbook"
```

---

### Task 9: Execute Production Base Deployment With Every Mail Feature Disabled

**Files:**
- Runtime operation only after explicit approval; do not modify tracked source during the operation.

**Interfaces:**
- Consumes: approved release archive/commit and runbook Tasks 1-8.
- Produces: new healthy release with generic SMTP configured, all feature flags false, comment rules disabled, monitor not enabled.

- [ ] **Step 1: Reconfirm explicit production approval and immutable commit**

Record the approved full commit and archive SHA-256. If approval names a different commit or local HEAD changed after evidence, rebuild/retest and request approval again.

- [ ] **Step 2: Run read-only preflight and capture redacted health evidence**

Capture symlink target, container health/status, local API, disk/swap, firewall service, recent backup timestamp, and current release commit. Do not print environment values.

- [ ] **Step 3: Upload archive/checksum and run remote precheck**

Use `scp` with the approved key, verify server SHA-256 equals local, extract under a new immutable release directory, and run `server-release-activate.sh precheck`. Expected: `precheck=ok` with the approved full commit.

- [ ] **Step 4: Back up and migrate environment interactively**

Create/verify backup, migrate existing Aliyun variables to generic keys without output, and ensure flags:

```text
MAIL_GATEWAY_ENABLED=false
MAIL_ACCOUNT_ENABLED=false
MAIL_OTP_ENABLED=false
```

Verify PocketBase service receives no `SMTP_*` or `ALIYUN_*`, admin-auth receives SMTP values, and environment file is root `0600`.

- [ ] **Step 5: Activate using project `current`**

Run activation script and require all three containers healthy, source only at `127.0.0.1:18080`, `/api/health` 200, `/login/` 200, `/archive/` 200, non-allowed `/admin/` 403, and `RELEASE_COMMIT` exact. Verify Caddy direct account request endpoints are blocked and confirmation endpoints still route.

- [ ] **Step 6: Prove disabled-feature behavior**

Account Mailer hooks remain registered and return false without default SMTP fallback; OTP returns the approved disabled response; comment rules remain disabled and Outbox worker sends nothing; monitor timer is absent/disabled. Core password login, Passkey, browsing, and comment save/moderation continue working.

- [ ] **Step 7: Stop on contradiction**

If any base check fails, execute automatic rollback, verify old release, retain redacted evidence, and do not proceed to SMTP or feature enablement.

---

### Task 10: Validate Aliyun Through Generic SMTP And Enable Features In Stages

**Files:**
- Runtime operation only after Task 9 passes.

**Interfaces:**
- Consumes: canonical `SMTP_*` configuration backed by the existing approved Aliyun account.
- Produces: validated account mail, reader OTP, and comment notifications with each gate independently reversible.

- [ ] **Step 1: Verify connection and one administrator test message**

From the protected `/admin/mail` center, run gateway verify then test-send to the current verified super-admin. Require redacted gateway status, delivery receipt in the intended mailbox, body/subject UTF-8 rendering, one body-free log, one redacted audit, and no credential/raw SMTP data in PocketBase/container logs.

- [ ] **Step 2: Enable account mail only**

Set `MAIL_GATEWAY_ENABLED=true`, `MAIL_ACCOUNT_ENABLED=true`, keep OTP false and comment rules disabled, recreate only PocketBase/admin-auth as needed with `docker compose -p current`, and test registration verification, verification resend, password reset, and email change. Confirm each token works once and token scans across DB/logs/API/build are zero.

- [ ] **Step 3: Enable reader OTP only after account mail passes**

Set `MAIL_OTP_ENABLED=true`. Test verified reader success, unknown/unverified decoy parity, expiry, reuse rejection, and an administrator address rejection. Confirm OTP plaintext scans zero and password+Passkey admin flow remains unchanged.

- [ ] **Step 4: Enable comment rules one at a time**

Through `/admin/mail`, configure the sole business administrator list and enable `comment_new`, then `comment_approved`, then `comment_reply`. For each: create one event, verify one row per unique recipient, self-notification skip, one Mailpit-equivalent real mailbox delivery, dedupe replay, and no comment rollback during a deliberately rejected test message.

- [ ] **Step 5: Validate transient retry without harming production recipients**

Use a controlled test Outbox row to the current super-admin and temporarily disable its rule/gateway path rather than sending to arbitrary addresses. Verify pending/retry timing and restore immediately. Do not intentionally corrupt global production SMTP credentials.

- [ ] **Step 6: Prove provider neutrality**

Run `check-mail-config` and config unit tests with a second generic standard-SMTP fixture. Demonstrate the runtime provider switch diff changes only `SMTP_HOST`, `SMTP_PORT`, `SMTP_USERNAME`, `SMTP_PASSWORD`, `SMTP_FROM_ADDRESS`, `SMTP_FROM_NAME`, `SMTP_TLS_MODE`, and `MAIL_PROVIDER_LABEL`; no application source, migration, template, route, or UI code changes.

- [ ] **Step 7: Abort only the failing feature when a gate fails**

Disable OTP independently, account mail independently, or the affected comment rule; keep the base release if core health remains proven. If core authentication/health regresses, perform full release rollback.

---

### Task 11: Install Host Alerts Last And Prove Firing/Cooldown/Recovery

**Files:**
- Runtime operation only after Task 10 passes.

**Interfaces:**
- Consumes: tested release `ops/` files and working mail CLI.
- Produces: enabled hardened timer plus one controlled firing/recovery acceptance pair.

- [ ] **Step 1: Install without enabling**

Run `ops/install-hlydwz-monitor.sh` without `--enable`. Verify installed checksums match release, script/unit permissions, state directory/file modes, Python tests, `systemd-analyze verify`, and no timer is active.

- [ ] **Step 2: Run one healthy manual check**

Run `systemctl start hlydwz-monitor.service`; require exit success, all six checks healthy, no alert email, state JSON contains only permitted fields, and journald contains no addresses/SMTP values/raw command output.

- [ ] **Step 3: Trigger a safe synthetic firing/recovery pair**

Create `/run/hlydwz-monitor-acceptance/backups` mode `0700` and run the installed monitor directly with a separate state path plus `HLYDWZ_BACKUP_GLOB=/run/hlydwz-monitor-acceptance/backups/*`. With no backup file, verify exactly one firing email; rerun before cooldown and verify no second email. Create a current-time backup marker in that directory, run again, and verify exactly one recovery email. Remove only the dedicated acceptance directory after recording results; never stop production containers or fill disk.

- [ ] **Step 4: Enable and observe timer**

Run installer with `--enable`, verify timer enabled/active, wait for two invocations, inspect sanitized journal and state. Confirm `MAIL_ALERT_RECIPIENTS` is present only in admin-auth environment and not in monitor config/state.

- [ ] **Step 5: Test Docker-unavailable fallback without stopping Docker**

Run the installed Python test case that injects a missing Docker runner and compare its result with the locally recorded acceptance evidence. Require a sanitized `CLI_UNAVAILABLE` result, no false mail-success claim, and a cooldown state update. Do not change `PATH`, stop Docker, or alter the running containers.

- [ ] **Step 6: Disable timer on any unexplained repeated alert**

`systemctl disable --now hlydwz-monitor.timer` is the immediate containment action; preserve state/journal for diagnosis while core blog services stay running.

---

### Task 12: Run Final Production Acceptance And Close The Rollout

**Files:**
- Runtime verification and redacted operations record only.

**Interfaces:**
- Consumes: Tasks 9-11.
- Produces: requirement-by-requirement production evidence for the full mail platform.

- [ ] **Step 1: Verify infrastructure and exposure**

Require three healthy blog containers, current release commit exact, source only localhost 18080, SSH key auth still works, firewall rules/services loaded, swap active, no reopened 3306/8089/8090/9853/18080/40027 exposure from a non-whitelisted source, and no failed systemd units related to the blog.

- [ ] **Step 2: Verify public/core regression surface**

Require public `/api/health`, `/`, `/login/`, `/archive/`, one post, comments, and PocketBase API behavior; non-whitelisted `/admin/` and `/api/blog-admin/mail/*` remain 403; password reader login and super-admin password+Passkey both work.

- [ ] **Step 3: Verify every mail category**

Evidence covers account verification, password reset, email change, reader OTP, new comment, comment approval, comment reply, admin test, operations firing, and operations recovery. Verify expected recipient/self-skip/dedupe behavior, UTF-8 HTML/text, and valid action links.

- [ ] **Step 4: Verify queue/admin behavior**

Test overview, gateway status, queue filtering, allowed retry/cancel, sent retry rejection, template save/version conflict/restore/preview/test, rule updates, suppression create/update/delete, logs, and all matching audit actions. Test mobile/desktop rendering through the deployed site from the allowed IP.

- [ ] **Step 5: Run full sensitive-data audit**

Scan production env ownership/mode, PocketBase DB, Outbox/log/audit collections, container logs, journald, Astro assets, release tree, archive listing, and Git for SMTP password, internal secrets, account tokens, OTP plaintext, authorization headers, and raw SMTP responses. Expected: secrets only in root-owned env/admin-auth process environment where required; all prohibited surfaces zero.

- [ ] **Step 6: Verify state/retention and rollback readiness**

Confirm monitor state `0600`, timer active, backup fresh, Outbox retention cron registered, stale lease recovery observable in test evidence, old release and verified backup remain present, and rollback dry-run command validates without changing symlink.

- [ ] **Step 7: Record redacted acceptance evidence**

Record full release commit, archive hash, UTC deploy time, pass/fail per category, container/image versions, feature-flag states, monitor unit state, and backup path/checksum. Exclude all addresses, subjects/bodies, IDs tied to users, tokens, codes, credentials, signatures, and raw provider responses.

- [ ] **Step 8: Keep the goal active on any missing evidence**

Any untested category, indirect assertion, unexplained log, incomplete leak scan, or missing rollback proof remains incomplete. Correct it and repeat the affected gate; do not declare the mail platform complete from container health alone.



---

## Self-Review

- Spec coverage: all six host checks, healthy/firing/recovered transitions, cooldown, stdin CLI, journald fallback, atomic state, hardened timer, secret-safe environment migration, full local gate, immutable release, project-name-safe activation, staged Aliyun enablement, provider-neutral switch proof, rollback, and final production acceptance map to explicit tasks.
- Placeholder scan: thresholds, paths, unit directives, event schema, test data, commands, expected outputs, feature gates, deployment target, backup/rollback behavior, and evidence fields are concrete; secret values are generated or entered through protected runtime input rather than embedded.
- Type consistency: operations check/state names match the gateway validator; environment names match Compose and PocketBase plans; every Compose command uses project `current`; local evidence keys and harness filenames match the roadmap.
- Safety consistency: production access remains behind a new explicit approval after local evidence, SMTP values never enter command arguments, activation auto-rolls back on health failure, and monitor acceptance uses an isolated backup path rather than disrupting live services.
