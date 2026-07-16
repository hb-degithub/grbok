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

function Require-EnvPlaceholder {
    param([string]$Content, [string]$Name, [string]$ExpectedPrefix = '')
    $match = [regex]::Match($Content, "(?m)^$([regex]::Escape($Name))=(?<value>[^\r\n]*)$")
    if (-not $match.Success) {
        $issues.Add(".env.example missing $Name")
        return
    }
    if ($ExpectedPrefix -and -not $match.Groups['value'].Value.StartsWith($ExpectedPrefix)) {
        $issues.Add(".env.example $Name must use a safe placeholder")
    }
}

$envContent = Get-Content -LiteralPath (Join-Path $repoRoot '.env.example') -Raw
Require-EnvPlaceholder $envContent 'MAIL_ARCHIVE_HMAC_SECRET' 'REPLACE_WITH_'
Require-EnvPlaceholder $envContent 'MAIL_ARCHIVE_API_ENABLED'
Require-EnvPlaceholder $envContent 'ACCOUNT_RETENTION_REMINDER_ENABLED'
Require-EnvPlaceholder $envContent 'ACCOUNT_RETENTION_DELETE_ENABLED'
Require-EnvPlaceholder $envContent 'MAIL_ARCHIVE_AGE_RECIPIENT' 'age1'
Require-EnvPlaceholder $envContent 'MAIL_ARCHIVE_AGE_RECIPIENT_FINGERPRINT' 'REPLACE_WITH_'
Require-EnvPlaceholder $envContent 'MAIL_ARCHIVE_RCLONE_REMOTE'
Require-EnvPlaceholder $envContent 'MAIL_ARCHIVE_RCLONE_PREFIX'

$pocketBaseEntries = @(
    'ADMIN_IP=${ADMIN_IP}',
    'MAIL_ARCHIVE_HMAC_SECRET=${MAIL_ARCHIVE_HMAC_SECRET}',
    'MAIL_ARCHIVE_API_ENABLED=${MAIL_ARCHIVE_API_ENABLED:-false}',
    'ACCOUNT_RETENTION_REMINDER_ENABLED=${ACCOUNT_RETENTION_REMINDER_ENABLED:-false}',
    'ACCOUNT_RETENTION_DELETE_ENABLED=${ACCOUNT_RETENTION_DELETE_ENABLED:-false}'
)
$hostOnlyNames = @(
    'MAIL_ARCHIVE_AGE_RECIPIENT',
    'MAIL_ARCHIVE_AGE_RECIPIENT_FINGERPRINT',
    'MAIL_ARCHIVE_RCLONE_REMOTE',
    'MAIL_ARCHIVE_RCLONE_PREFIX'
)

foreach ($composeName in @('docker-compose.yml', 'docker-compose.local.yml')) {
    $content = Get-Content -LiteralPath (Join-Path $repoRoot $composeName) -Raw
    $pocketbase = Get-ServiceBlock $content 'pocketbase'
    $adminAuth = Get-ServiceBlock $content 'admin-auth'
    if ($null -eq $pocketbase) { $issues.Add("$composeName missing pocketbase service"); continue }
    if ($null -eq $adminAuth) { $issues.Add("$composeName missing admin-auth service"); continue }

    foreach ($entry in $pocketBaseEntries) {
        if ($pocketbase -notmatch [regex]::Escape($entry)) {
            $issues.Add("$composeName pocketbase missing $entry")
        }
    }
    if ($pocketbase -match '(?m)^\s*-\s*SMTP_(?:HOST|PORT|USERNAME|PASSWORD|FROM_ADDRESS|FROM_NAME|TLS_MODE)=') {
        $issues.Add("$composeName pocketbase must not receive SMTP configuration")
    }
    if ($adminAuth -match 'MAIL_ARCHIVE_HMAC_SECRET') {
        $issues.Add("$composeName admin-auth must not receive MAIL_ARCHIVE_HMAC_SECRET")
    }
    foreach ($name in $hostOnlyNames) {
        if ($content -match [regex]::Escape($name)) {
            $issues.Add("$composeName must not inject host-only $name")
        }
    }
}

if ($issues.Count -gt 0) {
    Write-Host "Mail security environment check failed ($($issues.Count) issues):" -ForegroundColor Yellow
    $issues | ForEach-Object { Write-Host "  - $_" -ForegroundColor Yellow }
    exit 1
}

Write-Host 'PASS: mail security environment boundaries are explicit' -ForegroundColor Green
exit 0
