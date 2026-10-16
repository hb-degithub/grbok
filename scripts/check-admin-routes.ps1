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

    Parsing rules (2026-10-16 hardening, after adversarial verification found the
    previous revision both missed real breakage and flagged legal configs):
    - The repo root comes from this script's own location ($PSScriptRoot).
      The previous revision used CWD-relative paths, so invoking it from another
      directory silently validated whatever tree happened to be the CWD.
    - Configs are read with [IO.File]::ReadAllText. On PowerShell 5.1,
      `Get-Content -Raw` uses the platform default encoding and returns NULL for a
      BOM-less LF-only file that contains non-ASCII bytes - and these Caddyfiles
      carry Chinese comments, so an LF-only checkout made every assertion fail.
    - Comments are BLANKED OUT (never deleted, so byte offsets and brace balance
      survive) before anything is matched, so a commented-out directive can
      neither satisfy nor defeat an assertion.
    - Matcher and handle bodies are extracted by brace matching instead of a
      "[^}]*" wildcard, so a legal nested block (e.g. `header { ... }` inside a
      handle) no longer hides the responder.
    - Path coverage is read from positive `path` directives only, so an emptied
      path line or a `path` -> `not path` polarity flip is caught rather than
      silently satisfied by the tokens still being present.
#>
$ErrorActionPreference = 'Stop'

# Derive the tree under test from this script (repo root = parent of scripts/).
$root = Split-Path -Parent $PSScriptRoot

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
# The local listener additionally gates the admin front-end and the blog-admin
# API, which the public listener must NOT gate. Order-independent below.
$localAdminPaths = @('/admin*', '/_/*', '/api/admins/*', '/api/blog-admin/*')
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

function Read-RepoText([string]$RelativePath) {
    $full = Join-Path $root $RelativePath
    if (-not (Test-Path -LiteralPath $full -PathType Leaf)) { return $null }
    return [System.IO.File]::ReadAllText($full)
}

# Replace every comment byte with a space, keeping length and line breaks, so
# that later matching never sees commented-out directives. Quote state is
# tracked (and reset at each newline, since Caddyfile quotes do not span lines)
# so a '#' inside a quoted value survives.
function Get-MaskedCaddy([string]$Text) {
    if ([string]::IsNullOrEmpty($Text)) { return '' }
    $chars = $Text.ToCharArray()
    $inQuote = $false
    $inComment = $false
    for ($i = 0; $i -lt $chars.Length; $i++) {
        $ch = $chars[$i]
        if ($ch -eq "`n") { $inComment = $false; $inQuote = $false; continue }
        if ($inComment) { $chars[$i] = ' '; continue }
        if ($ch -eq '"') { $inQuote = -not $inQuote; continue }
        if ($ch -eq '#' -and -not $inQuote) { $inComment = $true; $chars[$i] = ' '; continue }
    }
    return (-join $chars)
}

# Body of the block opened at $AfterOpenBrace, found by brace counting that
# ignores braces inside quoted strings. Returns $null when unbalanced.
function Get-BraceBody([string]$Text, [int]$AfterOpenBrace) {
    $depth = 1
    $inQuote = $false
    for ($i = $AfterOpenBrace; $i -lt $Text.Length; $i++) {
        $ch = $Text[$i]
        if ($ch -eq '"') { $inQuote = -not $inQuote; continue }
        if ($inQuote) { continue }
        if ($ch -eq '{') { $depth++ }
        elseif ($ch -eq '}') {
            $depth--
            if ($depth -eq 0) { return $Text.Substring($AfterOpenBrace, $i - $AfterOpenBrace) }
        }
    }
    return $null
}

# Matcher bodies come in two shapes:
#   @name { ... }                        (block form, brace-matched)
#   @name path \ <continuation lines>    (backslash-continued one-liner)
# Both are anchored to the start of a line, and the caller passes masked text, so
# neither a "handle @name {" reference nor a commented-out block can be mistaken
# for the definition.
function Get-MatcherBody([string]$Masked, [string]$Name) {
    $escaped = [regex]::Escape($Name)
    $block = [regex]::Match($Masked, "(?m)^[ \t]*@$escaped[ \t]*\{")
    if ($block.Success) {
        $body = Get-BraceBody $Masked ($block.Index + $block.Length)
        if ($null -ne $body) { return $body }
    }
    $continued = [regex]::Match($Masked, "(?m)^[ \t]*@$escaped\b(?<body>(?:.*\\[ \t]*\r?\n)*.*\r?\n)")
    if ($continued.Success) { return $continued.Groups['body'].Value }
    return $null
}

function Get-HandleBodies([string]$Masked, [string]$Name) {
    $escaped = [regex]::Escape($Name)
    $bodies = @()
    foreach ($m in [regex]::Matches($Masked, "(?m)^[ \t]*handle[ \t]+@$escaped[ \t]*\{")) {
        $body = Get-BraceBody $Masked ($m.Index + $m.Length)
        if ($null -ne $body) { $bodies += $body }
    }
    return $bodies
}

# Tokens of positive `path ...` directives only. A `not path ...` line
# contributes nothing, and an emptied path line contributes nothing, so both a
# polarity flip and a blanked path list fail coverage instead of passing on the
# tokens merely being present somewhere in the body.
function Get-PositivePathTokens([string]$Body) {
    $tokens = @()
    if ([string]::IsNullOrEmpty($Body)) { return $tokens }
    $inPositiveContinuation = $false
    foreach ($line in ($Body -split "\r?\n")) {
        $t = $line.Trim()
        if ($t -eq '') { continue }
        if ($t -match '^not\s+path\b') { $inPositiveContinuation = $false; continue }
        $pathMatch = [regex]::Match($t, '^path\s+(?<rest>.*)$')
        if ($pathMatch.Success) {
            $rest = $pathMatch.Groups['rest'].Value.Trim()
            if ($rest -eq '\') { $inPositiveContinuation = $true; continue }
            $rest = $rest.TrimEnd('\').Trim()
            foreach ($tok in ($rest -split '\s+')) { if ($tok -ne '') { $tokens += $tok } }
            $inPositiveContinuation = $false
            continue
        }
        if ($inPositiveContinuation) {
            $tok = $t.TrimEnd('\').Trim()
            if ($tok -ne '') { $tokens += $tok }
        }
    }
    return $tokens
}

function Test-PositivePathToken([string]$Body, [string]$Path) {
    return (@(Get-PositivePathTokens $Body) -contains $Path)
}

# True when some `handle @Name { ... }` block contains a real
# `respond "<Message>" <Code>` directive line.
function Test-HandleRespond([string]$Masked, [string]$Name, [string]$Message, [int]$Code) {
    $pattern = '(?m)^[ \t]*respond[ \t]+"' + [regex]::Escape($Message) + '"[ \t]+' + $Code + '[ \t]*\r?$'
    foreach ($body in @(Get-HandleBodies $Masked $Name)) {
        if ($body -match $pattern) { return $true }
    }
    return $false
}

foreach ($file in @('Caddyfile', 'Caddyfile.local')) {
    $text = Read-RepoText $file
    if ($null -eq $text) {
        $failures += "Missing file: $file"
        continue
    }

    $content = Get-MaskedCaddy $text
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
            if (-not (Test-PositivePathToken $residualBody $path)) {
                $failures += "$file : @residual_escape must cover $path"
            }
        }
        if (-not (Test-HandleRespond $content 'residual_escape' 'Not Found' 404)) {
            $failures += "$file : @residual_escape must answer 404 from a handle block"
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
                if (-not (Test-PositivePathToken $adminBody $path)) {
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
            if (-not (Test-HandleRespond $content 'blocked_admin_access' 'Not Found' 404)) {
                $failures += "$file : blocked admin paths must answer 404 from a handle block"
            }
        }
        else {
            if ($adminBody -notmatch 'not\s+client_ip\s+\{\$ADMIN_IP\}') {
                $failures += "$file : local admin matcher must exempt the loopback ADMIN_IP"
            }
            foreach ($path in $localAdminPaths) {
                if (-not (Test-PositivePathToken $adminBody $path)) {
                    $failures += "$file : local @blocked_admin_access must cover $path"
                }
            }
            if (-not (Test-HandleRespond $content 'blocked_admin_access' 'Forbidden' 403)) {
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
                # Token-anchored, not substring: the matcher lists both "X" and
                # "X/" forms, and a substring test let a sibling token satisfy a
                # missing one (e.g. renaming X to X-xyz still passed).
                foreach ($path in $nativeAuthPaths) {
                    if (-not (Test-PositivePathToken $nativeBody $path)) {
                        $failures += "$file : @blockedNativeAuth must cover $path"
                    }
                }
                if (-not (Test-HandleRespond $content 'blockedNativeAuth' 'Not Found' 404)) {
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
$composeContent = Read-RepoText $composeFile
if ($null -eq $composeContent) {
    $failures += "Missing file: $composeFile"
}
else {
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

$envContent = Read-RepoText $envFile
if ($null -eq $envContent) {
    $failures += "Missing file: $envFile"
}
else {
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
