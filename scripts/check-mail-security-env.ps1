#!/usr/bin/env pwsh

$ErrorActionPreference = 'Stop'
$repoRoot = Split-Path -Parent $PSScriptRoot
$issues = [System.Collections.Generic.List[string]]::new()

function Get-ServiceBlock {
    param(
        [Parameter(Mandatory)][string]$Content,
        [Parameter(Mandatory)][string]$Service
    )

    $pattern = "(?ms)^  $([regex]::Escape($Service)):\r?\n(?<body>.*?)(?=^  [A-Za-z0-9_-]+:\r?\n|^networks:\r?\n|^volumes:\r?\n|\z)"
    $match = [regex]::Match($Content, $pattern)
    if (-not $match.Success) { return $null }
    return $match.Value
}

function Get-EnvValue {
    param([string]$Content, [string]$Name)

    $match = [regex]::Match($Content, "(?m)^$([regex]::Escape($Name))=(?<value>[^\r\n]*)\r?$")
    if (-not $match.Success) {
        $issues.Add(".env.example missing $Name")
        return $null
    }

    return $match.Groups['value'].Value
}

function Require-EnvPlaceholder {
    param(
        [string]$Content,
        [string]$Name,
        [string]$ExpectedPrefix = '',
        [string]$ExpectedValue = ''
    )

    $value = Get-EnvValue $Content $Name
    if ($null -eq $value) { return }
    if ($ExpectedPrefix -and -not $value.StartsWith($ExpectedPrefix, [StringComparison]::Ordinal)) {
        $issues.Add(".env.example $Name must use a safe placeholder")
    }
    if ($ExpectedValue -and $value -cne $ExpectedValue) {
        $issues.Add(".env.example $Name must be $ExpectedValue")
    }
}

function Require-PlaceholderList {
    param(
        [string]$Content,
        [string]$Name,
        [string]$ExpectedPrefix
    )

    $value = Get-EnvValue $Content $Name
    if ($null -eq $value) { return @() }
    $entries = @($value.Split(',') | ForEach-Object { $_.Trim() })
    if ($entries.Count -lt 1 -or $entries.Count -gt 2 -or @($entries | Where-Object { -not $_ }).Count -gt 0) {
        $issues.Add(".env.example $Name must contain 1-2 non-empty comma-separated entries")
        return $entries
    }
    foreach ($entry in $entries) {
        if (-not $entry.StartsWith($ExpectedPrefix, [StringComparison]::Ordinal)) {
            $issues.Add(".env.example $Name entries must use safe placeholders")
        }
    }
    return $entries
}

$envContent = Get-Content -LiteralPath (Join-Path $repoRoot '.env.example') -Raw
Require-EnvPlaceholder $envContent 'MAIL_ARCHIVE_HMAC_SECRET' 'REPLACE_WITH_'
Require-EnvPlaceholder $envContent 'MAIL_ARCHIVE_API_ENABLED' '' 'false'
Require-EnvPlaceholder $envContent 'ACCOUNT_RETENTION_REMINDER_ENABLED' '' 'false'
Require-EnvPlaceholder $envContent 'ACCOUNT_RETENTION_DELETE_ENABLED' '' 'false'
$ageRecipients = @(Require-PlaceholderList $envContent 'MAIL_ARCHIVE_AGE_RECIPIENTS' 'age1replace')
$ageFingerprints = @(Require-PlaceholderList $envContent 'MAIL_ARCHIVE_AGE_RECIPIENT_FINGERPRINTS' 'REPLACE_WITH_')
if ($ageRecipients.Count -ne $ageFingerprints.Count) {
    $issues.Add('.env.example age recipient and fingerprint entry counts must match')
}
Require-EnvPlaceholder $envContent 'MAIL_ARCHIVE_RCLONE_REMOTE' '' 'archive-remote'
Require-EnvPlaceholder $envContent 'MAIL_ARCHIVE_RCLONE_PREFIX' '' 'personal-blog/mail-audit'
Require-EnvPlaceholder $envContent 'OPENRESTY_TRUSTED_PROXY' '' 'REPLACE_WITH_EXACT_OPENRESTY_SOURCE_CIDR'

foreach ($legacyName in @('MAIL_ARCHIVE_AGE_RECIPIENT', 'MAIL_ARCHIVE_AGE_RECIPIENT_FINGERPRINT')) {
    if ($envContent -match "(?m)^$([regex]::Escape($legacyName))=") {
        $issues.Add(".env.example must use the canonical plural variables instead of $legacyName")
    }
}

$forbiddenSecretDeclarations = @(
    'MAIL_ARCHIVE_AGE_IDENTITY',
    'MAIL_ARCHIVE_AGE_PRIVATE_KEY',
    'MAIL_ARCHIVE_RCLONE_PASSWORD',
    'MAIL_ARCHIVE_RCLONE_TOKEN',
    'RCLONE_CONFIG_PASS'
)
foreach ($name in $forbiddenSecretDeclarations) {
    if ($envContent -match "(?m)^$([regex]::Escape($name))=") {
        $issues.Add(".env.example must not declare host private credential $name")
    }
}
if ($envContent -match 'AGE-SECRET-KEY-1') {
    $issues.Add('.env.example must not contain an age private key')
}

$pocketBaseEntries = @(
    'ADMIN_IP=${ADMIN_IP}',
    'MAIL_HASH_SECRET=${MAIL_HASH_SECRET}',
    'MAIL_ARCHIVE_HMAC_SECRET=${MAIL_ARCHIVE_HMAC_SECRET}',
    'MAIL_ARCHIVE_API_ENABLED=${MAIL_ARCHIVE_API_ENABLED:-false}',
    'ACCOUNT_RETENTION_REMINDER_ENABLED=${ACCOUNT_RETENTION_REMINDER_ENABLED:-false}',
    'ACCOUNT_RETENTION_DELETE_ENABLED=${ACCOUNT_RETENTION_DELETE_ENABLED:-false}'
)
$caddyEntries = @{
    'docker-compose.yml' = @(
        'ADMIN_IP=${ADMIN_IP}',
        'OPENRESTY_TRUSTED_PROXY=${OPENRESTY_TRUSTED_PROXY}'
    )
    'docker-compose.local.yml' = @(
        'ADMIN_IP=${ADMIN_IP:-127.0.0.1}'
    )
}
$hostOnlyNames = @(
    'MAIL_ARCHIVE_AGE_RECIPIENTS',
    'MAIL_ARCHIVE_AGE_RECIPIENT_FINGERPRINTS',
    'MAIL_ARCHIVE_RCLONE_REMOTE',
    'MAIL_ARCHIVE_RCLONE_PREFIX'
)
$pocketBaseExclusiveNames = @(
    'MAIL_HASH_SECRET',
    'MAIL_ARCHIVE_HMAC_SECRET',
    'MAIL_ARCHIVE_API_ENABLED',
    'ACCOUNT_RETENTION_REMINDER_ENABLED',
    'ACCOUNT_RETENTION_DELETE_ENABLED'
)
$forbiddenContainerPatterns = @(
    'MAIL_ARCHIVE_AGE_IDENTITY',
    'MAIL_ARCHIVE_AGE_PRIVATE_KEY',
    'AGE-SECRET-KEY-1',
    'MAIL_ARCHIVE_RCLONE_PASSWORD',
    'MAIL_ARCHIVE_RCLONE_TOKEN',
    'RCLONE_CONFIG_PASS',
    '(?i)(?:^|[/\\])rclone\.conf(?:$|[:/\\])'
)

foreach ($composeName in @('docker-compose.yml', 'docker-compose.local.yml')) {
    $content = Get-Content -LiteralPath (Join-Path $repoRoot $composeName) -Raw
    $pocketbase = Get-ServiceBlock $content 'pocketbase'
    $adminAuth = Get-ServiceBlock $content 'admin-auth'
    $caddy = Get-ServiceBlock $content 'caddy'
    if ($null -eq $pocketbase) { $issues.Add("$composeName missing pocketbase service"); continue }
    if ($null -eq $adminAuth) { $issues.Add("$composeName missing admin-auth service"); continue }
    if ($null -eq $caddy) { $issues.Add("$composeName missing caddy service"); continue }

    foreach ($entry in $pocketBaseEntries) {
        $entryPattern = "(?m)^[ \t]*-[ \t]*$([regex]::Escape($entry))[ \t]*\r?$"
        $entryCount = [regex]::Matches($pocketbase, $entryPattern).Count
        if ($entryCount -ne 1) {
            $issues.Add("$composeName pocketbase must inject $entry exactly once (found $entryCount)")
        }
    }
    foreach ($caddyEntry in $caddyEntries[$composeName]) {
        $caddyEntryPattern = "(?m)^[ \t]*-[ \t]*$([regex]::Escape($caddyEntry))[ \t]*\r?$"
        $caddyEntryCount = [regex]::Matches($caddy, $caddyEntryPattern).Count
        if ($caddyEntryCount -ne 1) {
            $issues.Add("$composeName caddy must inject $caddyEntry exactly once (found $caddyEntryCount)")
        }
    }
    $trustedProxyEntryPattern = '(?m)^[ \t]*-[ \t]*OPENRESTY_TRUSTED_PROXY='
    $trustedProxyEntryCount = [regex]::Matches($content, $trustedProxyEntryPattern).Count
    $expectedTrustedProxyCount = if ($composeName -eq 'docker-compose.yml') { 1 } else { 0 }
    if ($trustedProxyEntryCount -ne $expectedTrustedProxyCount) {
        $issues.Add("$composeName must contain $expectedTrustedProxyCount OPENRESTY_TRUSTED_PROXY environment entries (found $trustedProxyEntryCount)")
    }
    if ($pocketbase -match '(?m)^\s*-\s*SMTP_(?:HOST|PORT|USERNAME|PASSWORD|FROM_ADDRESS|FROM_NAME|TLS_MODE)=') {
        $issues.Add("$composeName pocketbase must not receive SMTP configuration")
    }
    foreach ($name in $pocketBaseExclusiveNames) {
        if ($adminAuth -match "(?m)^[ \t]*-[ \t]*$([regex]::Escape($name))=") {
            $issues.Add("$composeName admin-auth must not receive PocketBase-only $name")
        }
        if ($caddy -match "(?m)^[ \t]*-[ \t]*$([regex]::Escape($name))=") {
            $issues.Add("$composeName caddy must not receive PocketBase-only $name")
        }
    }
    foreach ($name in $hostOnlyNames) {
        if ($content -match "(?m)^[ \t]*-[ \t]*$([regex]::Escape($name))=") {
            $issues.Add("$composeName must not inject host-only $name")
        }
    }
    foreach ($pattern in $forbiddenContainerPatterns) {
        if ($content -match $pattern) {
            $issues.Add("$composeName must not contain private age/rclone material matching $pattern")
        }
    }
}

$gitignoreContent = Get-Content -LiteralPath (Join-Path $repoRoot '.gitignore') -Raw
foreach ($entry in @('mail-archive.env', 'rclone.conf', '*.agekey', 'age-identity*', 'archive-remote.conf')) {
    $entryPattern = "(?m)^$([regex]::Escape($entry))\r?$"
    if ([regex]::Matches($gitignoreContent, $entryPattern).Count -ne 1) {
        $issues.Add(".gitignore must contain exactly one private archive pattern: $entry")
    }
}

if ($issues.Count -gt 0) {
    Write-Host "Mail security environment check failed ($($issues.Count) issues):" -ForegroundColor Yellow
    $issues | ForEach-Object { Write-Host "  - $_" -ForegroundColor Yellow }
    exit 1
}

Write-Host 'PASS: mail security environment boundaries are explicit' -ForegroundColor Green
exit 0
