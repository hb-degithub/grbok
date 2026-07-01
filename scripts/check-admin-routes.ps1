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
$respondPattern = 'respond @blocked_admin_access'

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

    if ($content -notmatch [regex]::Escape($respondPattern)) {
        $failures += "$file : missing '$respondPattern'"
    }

    foreach ($path in $requiredPaths) {
        # Match the path literal inside a Caddy path directive (may be followed by space or newline)
        $escaped = [regex]::Escape($path).Replace('\*', '[^\s\r\n]*')
        if ($content -notmatch $escaped) {
            $failures += "$file : missing protected path $path"
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

