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
$readerFrontend=(Read 'astro\src\hooks\usePocketBase.ts')+(Read 'astro\src\components\auth\MagicLinkForm.tsx')+(Read 'astro\src\components\auth\PasswordLoginForm.tsx')
Require (-not ($readerFrontend -match '\.requestOTP\(|\.authWithOTP\(')) 'frontend still calls native PocketBase OTP SDK paths'
foreach($path in @('/api/blog-auth/otp/request','/api/blog-auth/otp/verify')){Require ($auth.Contains($path)) "custom OTP facade route missing: $path"}
foreach($path in @('/api/blog-auth/mfa/otp/request','/api/blog-auth/mfa/otp/verify')){Require (-not $auth.Contains($path)) "unsupported PocketBase 0.23 MFA facade remains: $path"}
Require (-not (Test-Path -LiteralPath (Join-Path $root 'pb_hooks\lib\auth_mfa.js'))) 'unsupported auth_mfa module remains'
$blogAuthClient=Read 'astro\src\lib\blog-auth-client.ts'; $passwordLogin=Read 'astro\src\components\auth\PasswordLoginForm.tsx'
Require (-not (($blogAuthClient+$passwordLogin) -match 'requestPasswordMfaOtp|verifyPasswordMfaOtp|/api/blog-auth/mfa/otp/')) 'frontend still calls unsupported MFA facade'
Require ($passwordLogin.Contains('MFA_UNSUPPORTED')) 'password login does not fail closed with stable MFA_UNSUPPORTED'
$proxyFiles=@{ Caddyfile=(Read 'Caddyfile'); 'Caddyfile.local'=(Read 'Caddyfile.local'); OpenResty=(Read 'docs\openresty-login-rate-limit.conf') }
$openResty=$proxyFiles.OpenResty
Require ($openResty.Contains('location ~ ^/api/collections/(users|_pb_users_auth_)/(records|request-password-reset|request-verification|request-email-change|request-otp|auth-with-otp)/?$')) 'OpenResty trailing-slash native auth deny regex missing'
foreach($path in @('/api/blog-auth/mfa/otp/request','/api/blog-auth/mfa/otp/verify')){Require (-not $openResty.Contains($path)) "OpenResty still forwards unsupported MFA facade: $path"}
$configs=($proxyFiles.Values -join "`n")
foreach($path in @('/api/collections/users/records','/api/collections/users/request-password-reset','/api/collections/users/request-verification','/api/collections/users/request-email-change')){Require ($configs.Contains($path)) "native deny path missing: $path"}
foreach($collection in @('users','_pb_users_auth_')){foreach($action in @('request-otp','auth-with-otp')){Require ($configs.Contains("/api/collections/$collection/$action")) "native OTP deny path missing: $collection/$action"}}
foreach($entry in $proxyFiles.GetEnumerator()){foreach($collection in @('users','_pb_users_auth_')){foreach($action in @('records','request-password-reset','request-verification','request-email-change','request-otp','auth-with-otp')){Require ($entry.Value.Contains("/api/collections/$collection/$action")) "$($entry.Key) native deny path missing: $collection/$action"}}}
foreach($path in @('/api/collections/users/confirm-password-reset','/api/collections/users/confirm-verification','/api/collections/users/confirm-email-change')){Require ($configs.Contains($path)) "token confirmation route missing: $path"}
Require ($configs.Contains('/api/blog-auth/register')) 'registration facade route missing'
Require ($configs.Contains('/api/blog-auth/password-reset/request')) 'mail facade route missing'
$registerUi=Read 'astro\src\components\auth\RegisterForm.tsx'; $welcomeUi=Read 'astro\src\components\effects\WelcomeOverlay.tsx'
Require (-not (($registerUi+$welcomeUi) -match '\u6ce8\u518c\u6210\u529f|\u6ce8\u518c\u5e76\u767b\u5f55|\u90ae\u7bb1\u53ef\u80fd\u5df2\u88ab\u6ce8\u518c')) 'registration UI still implies account creation or login'
Require (($registerUi -match '\u63d0\u4ea4\u6ce8\u518c') -and ($registerUi -match '\u8bf7\u9a8c\u8bc1\u90ae\u7bb1')) 'RegisterForm pending-verification wording missing'
Require ($welcomeUi -match '\u63d0\u4ea4\u540e\u8bf7\u9a8c\u8bc1\u90ae\u7bb1\uff0c\u9a8c\u8bc1\u5b8c\u6210\u540e\u53ef\u8bc4\u8bba') 'WelcomeOverlay verification-before-comment wording missing'
Write-Host 'PASS native registration/account-mail cutover preserves token confirmation routes'
