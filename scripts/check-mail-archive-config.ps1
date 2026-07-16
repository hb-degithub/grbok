$ErrorActionPreference = 'Stop'

$repoRoot = Split-Path -Parent $PSScriptRoot
$wrapperPath = Join-Path $PSScriptRoot 'run-mail-archive-1panel.sh'
$pythonPath = Join-Path $PSScriptRoot 'mail-archive.py'
$runbookPath = Join-Path $repoRoot 'docs/operations/mail-archive-1panel.md'
$errors = [System.Collections.Generic.List[string]]::new()

function Require-Match {
    param(
        [string]$Text,
        [string]$Pattern,
        [string]$Message
    )
    if ($Text -notmatch $Pattern) {
        $errors.Add($Message)
    }
}

function Reject-Match {
    param(
        [string]$Text,
        [string]$Pattern,
        [string]$Message
    )
    if ($Text -match $Pattern) {
        $errors.Add($Message)
    }
}

foreach ($requiredPath in @($wrapperPath, $pythonPath, $runbookPath)) {
    if (-not (Test-Path -LiteralPath $requiredPath -PathType Leaf)) {
        $errors.Add("missing required file: $requiredPath")
    }
}

$wrapper = if (Test-Path -LiteralPath $wrapperPath) { Get-Content -LiteralPath $wrapperPath -Raw } else { '' }
$python = if (Test-Path -LiteralPath $pythonPath) { Get-Content -LiteralPath $pythonPath -Raw } else { '' }
$runbook = if (Test-Path -LiteralPath $runbookPath) { Get-Content -LiteralPath $runbookPath -Raw } else { '' }

Require-Match $wrapper '(?m)^set -euo pipefail\s*$' 'wrapper must enable strict shell mode'
Require-Match $wrapper '(?m)^umask 077\s*$' 'wrapper must set umask 077'
Require-Match $wrapper '(?m)^test "\$\(id -u\)" -eq 0\s*$' 'wrapper must require root'
Require-Match $wrapper '(?m)^exec 9>/var/lock/hlydwz-mail-archive\.lock\s*$' 'wrapper must use the fixed lock file'
Require-Match $wrapper '(?m)^flock -n 9 \|\| exit 0\s*$' 'wrapper must prevent overlapping runs with flock'
Require-Match $wrapper '(?m)^\. /etc/hlydwz/mail-archive\.env\s*$' 'wrapper must load the fixed absolute env file'
Require-Match $wrapper '(?m)^exec /usr/bin/python3 /opt/hlydwz/blog/scripts/mail-archive\.py run\s*$' 'wrapper must execute the fixed Python archive command'
Reject-Match $wrapper '(?im)age[^\r\n]*(identity|private|secret|key-file)|MAIL_ARCHIVE_AGE_IDENTITY' 'wrapper must not reference an age private identity'
Reject-Match $wrapper '(?m)rclone[^\r\n]*(\$\{|\$[A-Za-z_])' 'wrapper must not interpolate rclone flags'

Require-Match $python 'MAIL_ARCHIVE_WORK_DIR' 'Python client must require a fixed work directory configuration'
Require-Match $python 'MAIL_ARCHIVE_AGE_RECIPIENTS' 'Python client must support the plural age recipient rotation configuration'
Require-Match $python 'MAIL_ARCHIVE_AGE_RECIPIENT_FINGERPRINTS' 'Python client must support plural recipient fingerprints'
Require-Match $python 'cleanup_startup_plaintext\(config\)' 'Python client must clean crash-left plaintext before archive API work'
Reject-Match $python 'MAIL_ARCHIVE_AGE_IDENTITY|--identity|-i\s' 'production Python client must not reference an age private identity'

foreach ($requiredText in @(
    '/api/blog-internal/mail-archive',
    '/etc/hlydwz/mail-archive.env',
    '0600',
    '0700',
    '90',
    'monthly',
    'fingerprint',
    'MAIL_ARCHIVE_AGE_RECIPIENTS',
    'MAIL_ARCHIVE_AGE_RECIPIENT_FINGERPRINTS',
    'ageRecipientFingerprints',
    'rclone',
    'MAIL_ARCHIVE_RETENTION_MODE=s3-versioned',
    'MAIL_ARCHIVE_WORK_DIR_MAX_BYTES',
    'MAIL_ARCHIVE_COMMAND_TIMEOUT_SECONDS',
    'restore-descriptor',
    '--trusted-descriptor-sha256',
    '--sync-root',
    '--repo-root',
    'MAIL_ARCHIVE_RESTORE_COMMAND_TIMEOUT_SECONDS',
    'verify-mail-archive-restore.py'
)) {
    if ($runbook -notmatch [regex]::Escape($requiredText)) {
        $errors.Add("runbook missing required operational detail: $requiredText")
    }
}

if ($errors.Count -gt 0) {
    $errors | ForEach-Object { Write-Error $_ }
    exit 1
}

Write-Host 'mail archive configuration checks passed'
