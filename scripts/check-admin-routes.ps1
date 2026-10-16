<#
.SYNOPSIS
    Verify that admin route protection is centralized in Caddy.
.DESCRIPTION
    Production listener (Caddyfile, public :80) since 2026-09-20:
    - Public admin paths (/_, /_/*, /api/admins, /api/admins/*, bare paths
      included) answer an unconditional 404. There is deliberately NO IP
      whitelist on the public listener: client_ip is header-derived and therefore
      forgeable (a self-supplied Ali-Real-Client-Ip: 127.0.0.1 used to win), and
      remote_ip is always the docker gateway for SafeLine/host-published traffic.
      The only non-forgeable discriminator is the ingress port, so the PocketBase
      admin UI stays reachable through the loopback tunnel only.
    - @residual_escape closes the double percent-decoding bypass reported by the
      2026-10-14 pentest: Caddy decodes one layer for path matching while
      PocketBase decodes another for route params, so a path that still carries
      %xx after one decode must not reach the backend.
    Local listener (Caddyfile.local, loopback-only :80) keeps an ADMIN_IP
    exemption so developers can still reach /_/, but it must carry the same
    residual-escape guard and the native-auth path block.
    Both listeners must keep the exact CORS allow-list and the access-log
    scrubbing described below.
#>
$ErrorActionPreference = 'Stop'

$failures = @()
$securityHeaders = @(
    'X-Admin-Step-Up',
    'X-Admin-Session',
    'X-Browser-Fingerprint',
    'X-Admin-Recovery-Code'
)
$expectedCorsHeaders = @('Content-Type', 'Authorization') + $securityHeaders
$logSecrets = @('Authorization') + $securityHeaders
$adminPaths = @('/_', '/_/*', '/api/admins', '/api/admins/*')
$residualPaths = @('/api/*', '/_', '/_/*', '/admin', '/admin/*')
$nativeAuthPaths = @(
    '/api/collections/users/records',
    '/api/collections/users/request-password-reset',
    '/api/collections/users/request-verification',
    '/api/collections/users/request-email-change',
    '/api/collections/users/request-otp',
    '/api/collections/users/auth-with-otp',
    '/api/collections/_pb_users_auth_/records',
    '/api/collections/_pb_users_auth_/request-password-reset',
    '/api/collections/_pb_users_auth_/request-verification',
    '/api/collections/_pb_users_auth_/request-email-change',
    '/api/collections/_pb_users_auth_/request-otp',
    '/api/collections/_pb_users_auth_/auth-with-otp'
)

# Matcher bodies come in two shapes:
#   @name { ... }                        (block form, closed by a "}" line)
#   @name path \ <continuation lines>    (backslash-continued one-liner)
# Both are anchored to the start of a line so that a "handle @name {" reference
# can never be mistaken for the matcher definition itself.
function Get-MatcherBody([string]$Content, [string]$Name) {
    $escaped = [regex]::Escape($Name)
    $block = [regex]::Match($Content, "(?ms)^[ \t]*@$escaped[ \t]*\{[ \t]*\r?\n(?<body>.*?)^[ \t]*\}")
    if ($block.Success) { return $block.Groups['body'].Value }
    $continued = [regex]::Match($Content, "(?m)^[ \t]*@$escaped\b(?<body>(?:.*\\[ \t]*\r?\n)*.*\r?\n)")
    if ($continued.Success) { return $continued.Groups['body'].Value }
    return $null
}

function Test-PathToken([string]$Body, [string]$Path) {
    if ([string]::IsNullOrEmpty($Body)) { return $false }
    return [bool]($Body -match "(^|\s)$([regex]::Escape($Path))(\s|$)")
}

foreach ($file in @('Caddyfile', 'Caddyfile.local')) {
    if (-not (Test-Path -LiteralPath $file -PathType Leaf)) {
        $failures += "Missing file: $file"
        continue
    }

    $content = Get-Content -LiteralPath $file -Raw
    $isProduction = ($file -eq 'Caddyfile')

    # --- residual percent-escape guard (both listeners) ---
    $residualBody = Get-MatcherBody $content 'residual_escape'
    if ($null -eq $residualBody) {
        $failures += "$file : missing @residual_escape double-decoding guard"
    }
    else {
        if ($residualBody -notmatch '(?m)^\s*path_regexp\s+\(\?i\)%\[0-9a-f\]\{2\}\s*$') {
            $failures += "$file : @residual_escape must match a residual %xx escape"
        }
        foreach ($path in $residualPaths) {
            if (-not (Test-PathToken $residualBody $path)) {
                $failures += "$file : @residual_escape must cover $path"
            }
        }
        if ($content -notmatch '(?s)handle\s+@residual_escape\s*\{[^}]*respond\s+"Not Found"\s+404') {
            $failures += "$file : @residual_escape must answer 404"
        }
    }

    # --- admin path protection ---
    $adminBody = Get-MatcherBody $content 'blocked_admin_access'
    if ($null -eq $adminBody) {
        $failures += "$file : missing @blocked_admin_access matcher"
    }
    else {
        # fdbcc08 regression guard: dropping this exclusion let @blocked_admin_access
        # swallow /_astro/* and /pagefind/* static assets. Both listeners must keep it.
        if ($adminBody -notmatch 'not\s+path\s+/_astro/\*\s+/pagefind/\*') {
            $failures += "$file : @blocked_admin_access must keep the /_astro/* /pagefind/* exclusion"
        }

        if ($isProduction) {
            foreach ($path in $adminPaths) {
                if (-not (Test-PathToken $adminBody $path)) {
                    $failures += "$file : @blocked_admin_access must cover $path"
                }
            }
            if ($adminBody -match 'client_ip|ADMIN_IP') {
                $failures += "$file : public admin matcher must not trust a header-derived client IP"
            }
            if ($adminBody -match '\/admin\b') {
                $failures += "$file : /admin front-end page must not be gated on the public listener"
            }
            if ($content -match 'ADMIN_IP') {
                $failures += "$file : public listener must not reintroduce an ADMIN_IP whitelist"
            }
            if ($content -notmatch '(?s)handle\s+@blocked_admin_access\s*\{[^}]*respond\s+"Not Found"\s+404') {
                $failures += "$file : blocked admin paths must answer 404"
            }
        }
        else {
            if ($adminBody -notmatch 'not\s+client_ip\s+\{\$ADMIN_IP\}') {
                $failures += "$file : local admin matcher must exempt the loopback ADMIN_IP"
            }
            if ($content -notmatch '(?s)handle\s+@blocked_admin_access\s*\{[^}]*respond\s+"Forbidden"\s+403') {
                $failures += "$file : local blocked admin paths must answer 403 from a handle block"
            }
            if ($content -match '(?m)^\s*respond\s+@blocked_admin_access\b') {
                $failures += "$file : bare 'respond @blocked_admin_access' sorts after every handle block and is silently bypassed"
            }
            $nativeBody = Get-MatcherBody $content 'blockedNativeAuth'
            if ($null -eq $nativeBody) {
                $failures += "$file : missing @blockedNativeAuth matcher"
            }
            else {
                foreach ($path in $nativeAuthPaths) {
                    if ($nativeBody -notmatch [regex]::Escape($path)) {
                        $failures += "$file : @blockedNativeAuth must cover $path"
                    }
                }
                if ($content -notmatch '(?s)handle\s+@blockedNativeAuth\s*\{[^}]*respond\s+"Not Found"\s+404') {
                    $failures += "$file : blocked native auth paths must answer 404 from a handle block"
                }
                if ($content -match '(?m)^\s*respond\s+@blockedNativeAuth\b') {
                    $failures += "$file : bare 'respond @blockedNativeAuth' sorts after every handle block and is silently bypassed"
                }
            }
        }
    }

    # --- PB file URLs must not be swallowed by the suffix-wildcard static matcher ---
    # @static ends in "*.jpg" style tokens, and a suffix wildcard beats the path
    # specificity of handle /api/files/* in Caddy's matcher ordering. Without the
    # exclusion PocketBase-served files (/api/files/media_assets/.../x.jpg) are
    # answered by file_server with 404. Production carried the exclusion since the
    # 2026-08-31 routing rework; the local listener was missing it until 2026-10-16
    # (reproduced on the Caddy 2.8.4 lab: baseline 404, fixed 200).
    $staticBody = Get-MatcherBody $content 'static'
    if ($null -eq $staticBody) {
        $failures += "$file : missing @static matcher"
    }
    elseif ($staticBody -notmatch 'not\s+path\s+(?:\S+\s+)*/api/\*') {
        $failures += "$file : @static must exclude /api/* so PB file URLs are not served by file_server"
    }

    # --- CORS allow-list (preflight + proxied responses) ---
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

    # --- access log scrubbing ---
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

    # --- identifiable access log retention (production only) ---
    if ($isProduction) {
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

# --- ingress port boundary: the admin tunnel must stay loopback-bound ---
$composeFile = 'docker-compose.yml'
if (-not (Test-Path -LiteralPath $composeFile -PathType Leaf)) {
    $failures += "Missing file: $composeFile"
}
else {
    $composeContent = Get-Content -LiteralPath $composeFile -Raw
    if ([regex]::Matches($composeContent, '(?m)^\s*-\s*"127\.0\.0\.1:\$\{CADDY_HTTP_PORT:-18080\}:80"\s*$').Count -ne 1) {
        $failures += "$composeFile : public Caddy listener must stay loopback-bound"
    }
    if ([regex]::Matches($composeContent, '(?m)^\s*-\s*"127\.0\.0\.1:18081:8080"\s*$').Count -ne 1) {
        $failures += "$composeFile : admin tunnel port must stay loopback-bound to 127.0.0.1"
    }
    if ($composeContent -match 'ADMIN_IP:-0\.0\.0\.0/0') {
        $failures += "$composeFile : ADMIN_IP default must never be 0.0.0.0/0"
    }
    if ($composeContent -notmatch 'ADMIN_IP=\$\{ADMIN_IP:-192\.0\.2\.[0-9]+\}') {
        $failures += "$composeFile : ADMIN_IP must keep a non-matching reserved default"
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
}
else {
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
