#!/usr/bin/env pwsh
$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $PSScriptRoot
$open = [IO.File]::ReadAllText((Join-Path $root 'docs\openresty-login-rate-limit.conf'))
$caddy = [IO.File]::ReadAllText((Join-Path $root 'Caddyfile'))
$local = [IO.File]::ReadAllText((Join-Path $root 'Caddyfile.local'))
$envExample = [IO.File]::ReadAllText((Join-Path $root '.env.example'))
$compose = [IO.File]::ReadAllText((Join-Path $root 'docker-compose.yml'))
$composeLocal = [IO.File]::ReadAllText((Join-Path $root 'docker-compose.local.yml'))
$login = [IO.File]::ReadAllText((Join-Path $root 'pb_hooks\login_security.pb.js'))
$registration = [IO.File]::ReadAllText((Join-Path $root 'pb_hooks\registration_rate_limit.pb.js'))
function Require([bool]$ok, [string]$message) { if (-not $ok) { throw $message } }
function Get-ServiceBlock([string]$Text, [string]$Service) {
    $pattern = "(?ms)^  $([regex]::Escape($Service)):\s*\r?\n.*?(?=^  [A-Za-z0-9_-]+:\s*(?:\r?\n|$)|^networks:|^volumes:|\z)"
    return [regex]::Match($Text, $pattern).Value
}
$productionCaddyService = Get-ServiceBlock $compose 'caddy'
$localCaddyService = Get-ServiceBlock $composeLocal 'caddy'
Require (-not [string]::IsNullOrWhiteSpace($productionCaddyService)) 'production Compose caddy service missing'
Require (-not [string]::IsNullOrWhiteSpace($localCaddyService)) 'local Compose caddy service missing'
Require (-not ($open -match '\$proxy_add_x_forwarded_for')) 'OpenResty must not append untrusted X-Forwarded-For'
Require ($open -match 'proxy_set_header X-Real-IP \$remote_addr;') 'OpenResty X-Real-IP normalization missing'
Require ($open -match 'proxy_set_header X-Forwarded-For \$remote_addr;') 'OpenResty X-Forwarded-For normalization missing'
foreach ($path in @('/api/blog-auth/register','/api/blog-auth/password-reset/request','/api/blog-auth/verification/request','/api/blog-auth/email-change/request','/api/blog-auth/otp/request','/api/blog-auth/otp/verify')) { Require ($open.Contains($path)) "OpenResty facade path missing: $path" }
Require ($open -match 'location \^~ /api/blog-internal/mail-archive/') 'public archive deny location missing'
Require (-not ($caddy -match '\{remote_host\}')) 'production Caddy remote_host forwarding remains'
Require (-not ($local -match '\{remote_host\}')) 'local Caddy remote_host forwarding remains'
Require ([regex]::Matches($caddy, '(?m)^\s*trusted_proxies\s+static\s+\{\$OPENRESTY_TRUSTED_PROXY\}\s*$').Count -eq 1) 'production must trust exactly the configured OpenResty source CIDR'
Require ([regex]::Matches($caddy, '(?m)^\s*trusted_proxies\s+static\s+').Count -eq 1) 'production must define exactly one trusted proxy source'
Require ([regex]::Matches($local, '(?m)^\s*trusted_proxies\s+static\s+127\.0\.0\.1/32\s+172\.16\.0\.0/12\s*$').Count -eq 1) 'local trusted proxy sources must stay explicit and local-only'
Require (-not $local.Contains('OPENRESTY_TRUSTED_PROXY')) 'local Caddy must not depend on the production proxy source'
Require ([regex]::Matches($envExample, '(?m)^OPENRESTY_TRUSTED_PROXY=REPLACE_WITH_EXACT_OPENRESTY_SOURCE_CIDR\r?$').Count -eq 1) '.env.example must use a non-operational exact OpenResty source placeholder'
Require ([regex]::Matches($productionCaddyService, '(?m)^\s*-\s*OPENRESTY_TRUSTED_PROXY=\$\{OPENRESTY_TRUSTED_PROXY\}\s*$').Count -eq 1) 'production Compose caddy must inject OPENRESTY_TRUSTED_PROXY exactly once'
Require ([regex]::Matches($compose, '(?m)^\s*-\s*OPENRESTY_TRUSTED_PROXY=').Count -eq 1) 'production Compose must inject OPENRESTY_TRUSTED_PROXY nowhere except caddy'
Require ([regex]::Matches($localCaddyService, '(?m)^\s*-\s*OPENRESTY_TRUSTED_PROXY=').Count -eq 0) 'local Compose caddy must not inject the production proxy source'
Require ([regex]::Matches($composeLocal, '(?m)^\s*-\s*OPENRESTY_TRUSTED_PROXY=').Count -eq 0) 'local Compose must not inject the production proxy source into any service'
Require ([regex]::Matches($productionCaddyService, '(?m)^\s*-\s*"127\.0\.0\.1:\$\{CADDY_HTTP_PORT:-18080\}:80"\s*$').Count -eq 1) 'production Caddy port must stay loopback-bound'
Require ([regex]::Matches($localCaddyService, '(?m)^\s*-\s*"127\.0\.0\.1:80:80"\s*$').Count -eq 1) 'local Caddy port must be loopback-bound'
Require ([regex]::Matches($localCaddyService, '(?m)^\s*-\s*"80:80"\s*$').Count -eq 0) 'local Caddy must not publish port 80 on every host interface'
Require ([regex]::Matches($composeLocal, '(?m)^\s*-\s*"127\.0\.0\.1:80:80"\s*$').Count -eq 1) 'local loopback Caddy port binding must not be duplicated or placed on another service'
Require ($caddy -match 'client_ip_headers X-Forwarded-For X-Real-IP') 'production client_ip_headers order missing'
Require ($local -match 'client_ip_headers X-Forwarded-For X-Real-IP') 'local client_ip_headers order missing'
foreach ($config in @(@('production', $caddy), @('local', $local))) {
    Require ([regex]::Matches($config[1], '(?m)^\s*header_up X-Real-IP \{client_ip\}\s*$').Count -ge 1) "$($config[0]) Caddy X-Real-IP client_ip missing"
    Require ([regex]::Matches($config[1], '(?m)^\s*header_up X-Forwarded-For \{client_ip\}\s*$').Count -ge 1) "$($config[0]) Caddy X-Forwarded-For client_ip missing"
}
foreach ($header in @('X-Admin-Step-Up','X-Admin-Session','X-Browser-Fingerprint','X-Admin-Recovery-Code')) {
    Require ($caddy.Contains($header)) "production CORS header missing: $header"
    Require ($local.Contains($header)) "local CORS header missing: $header"
}
Require (-not ($login -match 'X-Real-IP|X-Forwarded-For|getHeader')) 'login hook still falls back to request headers'
Require (-not ($registration -match 'registrationRateBuckets|X-Real-IP|X-Forwarded-For')) 'legacy in-memory registration limiter remains'
Write-Host 'PASS trustworthy OpenResty -> Caddy -> PocketBase real IP chain'
