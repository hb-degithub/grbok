#!/usr/bin/env pwsh
$ErrorActionPreference='Stop'
$root=Split-Path -Parent $PSScriptRoot
function Read([string]$p){[IO.File]::ReadAllText((Join-Path $root $p))}
function Require([bool]$ok,[string]$message){if(-not $ok){throw $message}}
$migrationPath=Join-Path $root 'pb_migrations\20260716130000_close_native_auth_entrypoints.pb.js'
Require (Test-Path -LiteralPath $migrationPath) 'native auth cutover migration missing'
$migration=[IO.File]::ReadAllText($migrationPath)
Require ($migration -match 'users\.createRule\s*=\s*null') 'users.createRule is not closed'
Require ($migration.Contains('@request.data.role = "reader"')) 'rollback expression missing'
$auth=Read 'pb_hooks\blog_auth.pb.js'; $register=Read 'pb_hooks\blog_register.pb.js'
Require ($auth.Contains('/api/blog-auth/mail/health')) 'mail facade health route missing'
Require ($register.Contains('/api/blog-auth/registration/health')) 'registration facade health route missing'
$configs=(Read 'Caddyfile')+(Read 'Caddyfile.local')+(Read 'docs\openresty-login-rate-limit.conf')
foreach($path in @('/api/collections/users/records','/api/collections/users/request-password-reset','/api/collections/users/request-verification','/api/collections/users/request-email-change')){Require ($configs.Contains($path)) "native deny path missing: $path"}
foreach($path in @('/api/collections/users/confirm-password-reset','/api/collections/users/confirm-verification','/api/collections/users/confirm-email-change')){Require ($configs.Contains($path)) "token confirmation route missing: $path"}
Require ($configs.Contains('/api/blog-auth/register')) 'registration facade route missing'
Require ($configs.Contains('/api/blog-auth/password-reset/request')) 'mail facade route missing'
Write-Host 'PASS native registration/account-mail cutover preserves token confirmation routes'
