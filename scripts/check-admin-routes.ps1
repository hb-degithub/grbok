<#
.SYNOPSIS
    Verify that admin route protection is centralized in Caddy.
.DESCRIPTION
    Checks both Caddyfile and Caddyfile.local for:
    - A named matcher @blocked_admin_access
    - respond @blocked_admin_access
    - All four protected path families, including every /api/blog-admin/* route
    - Exact CORS allow-list for the four admin security headers
    - Access-log deletion filters for security credentials and Authorization
    - Access-log query filtering that removes account action tokens
#>
$ErrorActionPreference = 'Stop'

$files = @('Caddyfile', 'Caddyfile.local')
$requiredPaths = @('/admin*', '/_/*', '/api/admins/*', '/api/blog-admin/*')
$matcherName = '@blocked_admin_access'
$securityHeaders = @(
    'X-Admin-Step-Up',
    'X-Admin-Session',
    'X-Browser-Fingerprint',
    'X-Admin-Recovery-Code'
)
$expectedCorsHeaders = @('Content-Type', 'Authorization') + $securityHeaders
$logSecrets = @('Authorization') + $securityHeaders
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

    if ($content -notmatch 'not\s+client_ip\s+\{\$ADMIN_IP\}') {
        $failures += "$file : blocked admin matcher must use trusted client_ip ADMIN_IP"
    }
    if ($content -match 'not\s+remote_ip\s+\{\$ADMIN_IP\}') {
        $failures += "$file : blocked admin matcher must not use proxy peer remote_ip"
    }

    foreach ($path in $requiredPaths) {
        $escaped = [regex]::Escape($path).Replace('\*', '[^\s\r\n]*')
        if ($content -notmatch $escaped) {
            $failures += "$file : missing protected path $path"
        }
    }

    $corsMatches = [regex]::Matches(
        $content,
        '(?m)^[ \t]*(?:header|header_down)[ \t]+Access-Control-Allow-Headers[ \t]+"(?<value>[^"]+)"[ \t]*\r?$'
    )
    if ($corsMatches.Count -lt 2) {
        $failures += "$file : CORS allow headers must be explicit for preflight and proxied responses"
    }
    foreach ($corsMatch in $corsMatches) {
        $actual = @($corsMatch.Groups['value'].Value.Split(',') | ForEach-Object { $_.Trim() })
        $difference = @(Compare-Object -ReferenceObject $expectedCorsHeaders -DifferenceObject $actual -CaseSensitive)
        if ($difference.Count -gt 0 -or $actual.Count -ne $expectedCorsHeaders.Count) {
            $failures += "$file : CORS headers must be exactly $($expectedCorsHeaders -join ', ')"
        }
    }

    if ($content -notmatch 'format\s+filter\s*\{') {
        $failures += "$file : access log must use the filter encoder"
    }
    foreach ($header in $logSecrets) {
        $fieldPattern = "(?m)^[ \t]*request>headers>$([regex]::Escape($header))[ \t]+delete[ \t]*\r?$"
        if ($content -notmatch $fieldPattern) {
            $failures += "$file : access log must delete request header $header"
        }
    }
    $uriFilter = [regex]::Match(
        $content,
        '(?ms)^[ \t]*request>uri[ \t]+query[ \t]*\{(?<body>.*?)^[ \t]*\}'
    )
    if (-not $uriFilter.Success) {
        $failures += "$file : access log must filter request URI queries"
    }
    elseif ([regex]::Matches($uriFilter.Groups['body'].Value, '(?m)^[ \t]*delete[ \t]+token[ \t]*\r?$').Count -ne 1) {
        $failures += "$file : access log must delete the token query parameter exactly once"
    }
    if ($content -match '(?m)^\s*log_credentials\b') {
        $failures += "$file : access log must not enable credential logging"
    }
    if ($file -eq 'Caddyfile') {
        $rollIntervals = [regex]::Matches($content, '(?m)^\s*roll_interval\s+')
        if ($rollIntervals.Count -ne 1 -or $content -notmatch '(?m)^\s*roll_interval\s+24h\s*$') {
            $failures += "$file : identifiable access logs must rotate every 24h"
        }
        $rollRetentions = [regex]::Matches($content, '(?m)^\s*roll_keep_for\s+')
        if ($rollRetentions.Count -ne 1 -or $content -notmatch '(?m)^\s*roll_keep_for\s+168h\s*$') {
            $failures += "$file : online identifiable access logs must be retained for at most 7 days"
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
