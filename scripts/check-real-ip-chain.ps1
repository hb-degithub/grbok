#!/usr/bin/env pwsh
$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $PSScriptRoot
$open = [IO.File]::ReadAllText((Join-Path $root 'docs\openresty-login-rate-limit.conf'))
$caddy = [IO.File]::ReadAllText((Join-Path $root 'Caddyfile'))
$local = [IO.File]::ReadAllText((Join-Path $root 'Caddyfile.local'))
$login = [IO.File]::ReadAllText((Join-Path $root 'pb_hooks\login_security.pb.js'))
$registration = [IO.File]::ReadAllText((Join-Path $root 'pb_hooks\registration_rate_limit.pb.js'))
function Require([bool]$ok, [string]$message) { if (-not $ok) { throw $message } }
Require (-not ($open -match '\$proxy_add_x_forwarded_for')) 'OpenResty must not append untrusted X-Forwarded-For'
Require ($open -match 'proxy_set_header X-Real-IP \$remote_addr;') 'OpenResty X-Real-IP normalization missing'
Require ($open -match 'proxy_set_header X-Forwarded-For \$remote_addr;') 'OpenResty X-Forwarded-For normalization missing'
foreach ($path in @('/api/blog-auth/register','/api/blog-auth/password-reset/request','/api/blog-auth/verification/request','/api/blog-auth/email-change/request','/api/blog-auth/otp/request','/api/blog-auth/otp/verify')) { Require ($open.Contains($path)) "OpenResty facade path missing: $path" }
Require ($open -match 'location \^~ /api/blog-internal/mail-archive/') 'public archive deny location missing'
Require (-not (($caddy + $local) -match '\{remote_host\}')) 'Caddy remote_host forwarding remains'
Require ($caddy -match 'trusted_proxies static \{\$OPENRESTY_TRUSTED_PROXY\}') 'production trusted OpenResty peer placeholder missing'
Require (($caddy + $local) -match 'header_up X-Real-IP \{client_ip\}') 'Caddy X-Real-IP client_ip missing'
Require (($caddy + $local) -match 'header_up X-Forwarded-For \{client_ip\}') 'Caddy X-Forwarded-For client_ip missing'
foreach ($header in @('X-Admin-Step-Up','X-Admin-Session','X-Browser-Fingerprint')) { Require ($caddy.Contains($header)) "CORS header missing: $header" }
Require (-not ($login -match 'X-Real-IP|X-Forwarded-For|getHeader')) 'login hook still falls back to request headers'
Require (-not ($registration -match 'registrationRateBuckets|X-Real-IP|X-Forwarded-For')) 'legacy in-memory registration limiter remains'
Write-Host 'PASS trustworthy OpenResty -> Caddy -> PocketBase real IP chain'
