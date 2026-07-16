<#
.SYNOPSIS
    Verify that admin route protection is centralized in Caddy.
.DESCRIPTION
    Checks both Caddyfile and Caddyfile.local for:
    - A named matcher @blocked_admin_access
    - respond @blocked_admin_access
    - All four protected paths: /admin*, /_/*, /api/admins/*, /api/blog-admin/webauthn/*
#>
$ErrorActionPreference = 'Stop'

$files = @('Caddyfile', 'Caddyfile.local')
$requiredPaths = @('/admin*', '/_/*', '/api/admins/*', '/api/blog-admin/webauthn/*')
$matcherName = '@blocked_admin_access'
$respondPatterns = @(
    'respond\s+@blocked_admin_access\s+"?Forbidden"?\s+403',
    'handle\s+@blocked_admin_access\s*\{[\s\S]*?respond\s+"?Forbidden"?\s+403[\s\S]*?\}'
)

$failures = @()

foreach ($file in $files) {
    if (-not (Test-Path -LiteralPath $file -PathType Leaf)) {
        $failures += "Missing file: $file"
        continue
    }

    $content = Get-Content -LiteralPath $file -Raw

    if ($content -notmatch [regex]::Escape($matcherName)) {
        $failures += "$file : missing matcher $matcherName"
    }

    $hasBlockedResponse = $false
    foreach ($pattern in $respondPatterns) {
        if ($content -match $pattern) { $hasBlockedResponse = $true; break }
    }
    if (-not $hasBlockedResponse) {
        $failures += "$file : missing blocked admin 403 response"
    }

    foreach ($path in $requiredPaths) {
        # Match the path literal inside a Caddy path directive (may be followed by space or newline)
        $escaped = [regex]::Escape($path).Replace('\*', '[^\s\r\n]*')
        if ($content -notmatch $escaped) {
            $failures += "$file : missing protected path $path"
        }
    }
}


$envFile = '.env.example'
$requiredEnv = @(
    'ADMIN_AUTH_INTERNAL_SECRET',
    'ADMIN_AUTH_HASH_SECRET',
    'ADMIN_AUTH_RP_ID',
    'ADMIN_AUTH_ORIGIN',
    'ADMIN_AUTH_SESSION_TTL_SECONDS'
)

if (-not (Test-Path -LiteralPath $envFile -PathType Leaf)) {
    $failures += "Missing file: $envFile"
} else {
    $envContent = Get-Content -LiteralPath $envFile -Raw
    foreach ($name in $requiredEnv) {
        if ($envContent -notmatch [regex]::Escape($name)) {
            $failures += "$envFile : missing $name"
        }
    }
}

if ($failures.Count -gt 0) {
    Write-Host "FAIL: Admin route protection checks failed" -ForegroundColor Red
    foreach ($failure in $failures) {
        Write-Host "  - $failure" -ForegroundColor Red
    }
    exit 1
}

Write-Host "PASS: Admin route protection is centralized in Caddy." -ForegroundColor Green
exit 0

