#!/usr/bin/env pwsh
<#
.SYNOPSIS
    Noninteractive aggregate verification for the mail security release.

.DESCRIPTION
    Reports a dirty worktree without prompting, runs every locally available
    check, and aggregates failures. All mail/archive stages use local fixtures
    and fakes; this script never contacts real SMTP, rclone, or age identities.
#>
[CmdletBinding()]
param([switch]$Ci)

$ErrorActionPreference = 'Stop'
$repoRoot = Split-Path -Parent $PSScriptRoot
$failures = [System.Collections.Generic.List[string]]::new()
$skips = [System.Collections.Generic.List[string]]::new()
$passed = 0
$stage = 0
$totalStages = 28
$isWindows = [Environment]::OSVersion.Platform -eq [PlatformID]::Win32NT
$isLinux = (-not $isWindows) -and (Test-Path -LiteralPath '/proc/sys/kernel/ostype')

if ($isWindows) {
    $normalizedPath = [Environment]::GetEnvironmentVariable('Path', 'Process')
    if ([string]::IsNullOrWhiteSpace($normalizedPath)) {
        $normalizedPath = [Environment]::GetEnvironmentVariable('PATH', 'Process')
    }
    [Environment]::SetEnvironmentVariable('PATH', $null, 'Process')
    [Environment]::SetEnvironmentVariable('Path', $normalizedPath, 'Process')
}

$loopbackNoProxy = '127.0.0.1,localhost'
[Environment]::SetEnvironmentVariable('NO_PROXY', $loopbackNoProxy, 'Process')
[Environment]::SetEnvironmentVariable('no_proxy', $loopbackNoProxy, 'Process')

function Resolve-Tool {
    param([Parameter(Mandatory)][string[]]$Names)
    foreach ($name in $Names) {
        $command = Get-Command $name -ErrorAction SilentlyContinue | Select-Object -First 1
        if ($command -and $command.Source) { return [string]$command.Source }
        if ($command -and $command.Definition) { return [string]$command.Definition }
    }
    return $null
}

function New-Result {
    param([int]$ExitCode, [object[]]$Output)
    return [pscustomobject]@{ ExitCode = $ExitCode; Output = @($Output) }
}

function Invoke-Capture {
    param(
        [AllowNull()][string]$FilePath,
        [string[]]$Arguments = @(),
        [string]$WorkingDirectory = $repoRoot
    )
    if ([string]::IsNullOrWhiteSpace($FilePath)) {
        return New-Result 1 @('required executable is unavailable')
    }

    $previousPreference = $ErrorActionPreference
    Push-Location $WorkingDirectory
    try {
        $ErrorActionPreference = 'Continue'
        $global:LASTEXITCODE = $null
        $output = @(& $FilePath @Arguments 2>&1)
        $exitCode = $global:LASTEXITCODE
        if ($null -eq $exitCode) { $exitCode = 1 }
        return New-Result ([int]$exitCode) $output
    }
    catch {
        return New-Result 1 @($_)
    }
    finally {
        $ErrorActionPreference = $previousPreference
        Pop-Location
    }
}

function Protect-Diagnostic {
    param([AllowNull()]$Value)
    $text = [string]$Value
    $text = [regex]::Replace($text, '(?i)\beyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\b', '[REDACTED_JWT]')
    $text = [regex]::Replace($text, '(?i)\bv1\.[A-Za-z0-9_-]{16,}\.[A-Za-z0-9_-]{32,}\b', '[REDACTED_STEP_UP]')
    $text = [regex]::Replace($text, '(?i)AGE-SECRET-KEY-[A-Z0-9-]{20,}', '[REDACTED_AGE_IDENTITY]')
    $text = [regex]::Replace($text, '(?i)\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b', '[REDACTED_EMAIL]')
    $text = [regex]::Replace($text, '(?i)((?:PASSWORD|SECRET|TOKEN|IDENTITY)\s*[:=]\s*)[^\s,;]+', '$1[REDACTED]')
    return $text
}

function Complete-Stage {
    param([Parameter(Mandatory)][string]$Name, [Parameter(Mandatory)]$Result)
    if ($Result.ExitCode -eq 0) {
        $script:passed++
        Write-Host '  PASS' -ForegroundColor Green
        return
    }

    $failures.Add($Name)
    Write-Host "  FAIL (exit $($Result.ExitCode))" -ForegroundColor Red
    $lines = @($Result.Output | ForEach-Object { Protect-Diagnostic $_ })
    if ($lines.Count -gt 80) {
        Write-Host "    ... $($lines.Count - 80) earlier lines omitted ..." -ForegroundColor DarkYellow
        $lines = @($lines | Select-Object -Last 80)
    }
    $lines | ForEach-Object { Write-Host "    $_" -ForegroundColor Red }
}

function Invoke-Stage {
    param(
        [Parameter(Mandatory)][string]$Name,
        [AllowNull()][string]$FilePath,
        [string[]]$Arguments = @(),
        [string]$WorkingDirectory = $repoRoot
    )
    $script:stage++
    Write-Host "[$script:stage/$totalStages] $Name" -ForegroundColor Cyan
    Complete-Stage $Name (Invoke-Capture $FilePath $Arguments $WorkingDirectory)
}

$powerShell = [Diagnostics.Process]::GetCurrentProcess().MainModule.FileName
function Invoke-PowerShellStage {
    param(
        [Parameter(Mandatory)][string]$Name,
        [Parameter(Mandatory)][string]$ScriptName,
        [string[]]$Arguments = @()
    )
    $scriptPath = Join-Path $PSScriptRoot $ScriptName
    $childArguments = @('-NoProfile')
    if ($isWindows) { $childArguments += @('-ExecutionPolicy', 'Bypass') }
    $childArguments += @('-File', $scriptPath)
    $childArguments += @($Arguments)
    Invoke-Stage $Name $powerShell $childArguments $repoRoot
}

function Skip-Stage {
    param([Parameter(Mandatory)][string]$Name, [Parameter(Mandatory)][string]$Reason)
    $script:stage++
    $skips.Add($Name + ': ' + $Reason)
    Write-Host "[$script:stage/$totalStages] $Name" -ForegroundColor Cyan
    Write-Host "  SKIP: $Reason" -ForegroundColor Yellow
}

$git = Resolve-Tool @('git.exe', 'git')
$node = Resolve-Tool @('node.exe', 'node')
$npm = if ($isWindows) { Resolve-Tool @('npm.cmd', 'npm.exe', 'npm') } else { Resolve-Tool @('npm') }
$python = Resolve-Tool @('python.exe', 'python3', 'python')
$bash = Resolve-Tool @('bash.exe', 'bash')

Write-Host '=== Mail security pre-deploy verification ===' -ForegroundColor Cyan
Write-Host $(if ($Ci) { 'Mode: CI/noninteractive' } else { 'Mode: local/noninteractive' }) -ForegroundColor DarkCyan

$gitStatus = Invoke-Capture $git @('-C', $repoRoot, 'status', '--porcelain')
if ($gitStatus.ExitCode -ne 0) {
    $failures.Add('Git status')
    Write-Host 'Git status failed; checks continue.' -ForegroundColor Yellow
}
elseif ($gitStatus.Output.Count -gt 0) {
    Write-Host 'Dirty worktree reported (no prompt; checks continue):' -ForegroundColor Yellow
    $gitStatus.Output | ForEach-Object { Write-Host "  $_" -ForegroundColor Yellow }
}
else {
    Write-Host 'Worktree: clean' -ForegroundColor Green
}

Invoke-PowerShellStage 'test-pre-deploy-runner' 'test-pre-deploy-runner.ps1'
Invoke-PowerShellStage 'test-sensitive-check' 'test-sensitive-check.ps1'
Invoke-PowerShellStage 'sensitive-check' 'sensitive-check.ps1'
Invoke-PowerShellStage 'check-mail-config' 'check-mail-config.ps1'
Invoke-PowerShellStage 'check-mail-security-env' 'check-mail-security-env.ps1'
Invoke-Stage 'admin-auth npm test' $npm @('test') (Join-Path $repoRoot 'admin-auth')

Invoke-PowerShellStage 'test-pre-deploy-manifest' 'test-pre-deploy-manifest.ps1'
Invoke-PowerShellStage 'test-offline-ci-contract' 'test-offline-ci-contract.ps1'
$previousVerificationPocketBaseUrl = [Environment]::GetEnvironmentVariable('PUBLIC_POCKETBASE_URL', 'Process')
if ($Ci) {
    [Environment]::SetEnvironmentVariable('PUBLIC_POCKETBASE_URL', 'http://127.0.0.1:9', 'Process')
    Write-Host 'CI build uses a loopback-only PocketBase URL; generated dist is a verification artifact and must not be deployed.' -ForegroundColor DarkCyan
}
try {
    Invoke-Stage 'test-hook-log-safety' $node @('tests\security-rate\hook_log_safety.test.js') $repoRoot
    Invoke-Stage 'Astro build' $npm @('run', 'build') (Join-Path $repoRoot 'astro')
}
finally {
    if ($Ci) {
        [Environment]::SetEnvironmentVariable('PUBLIC_POCKETBASE_URL', $previousVerificationPocketBaseUrl, 'Process')
    }
}
Invoke-PowerShellStage 'post-build sensitive-check' 'sensitive-check.ps1'

$script:stage++
Write-Host "[$script:stage/$totalStages] PocketBase hook/migration node --check" -ForegroundColor Cyan
$syntaxOutput = [System.Collections.Generic.List[object]]::new()
$syntaxFailed = 0
$pbFiles = @()
foreach ($directory in @('pb_hooks', 'pb_migrations')) {
    $root = Join-Path $repoRoot $directory
    if (Test-Path -LiteralPath $root -PathType Container) {
        $pbFiles += @(Get-ChildItem -LiteralPath $root -Recurse -File -Filter '*.js')
    }
}
if (-not $node) {
    $syntaxResult = New-Result 1 @('node is unavailable')
}
elseif ($pbFiles.Count -eq 0) {
    $syntaxResult = New-Result 1 @('no PocketBase JavaScript files found')
}
else {
    foreach ($file in $pbFiles | Sort-Object FullName) {
        $result = Invoke-Capture $node @('--check', '--', $file.FullName)
        if ($result.ExitCode -ne 0) {
            $syntaxFailed++
            $relative = $file.FullName.Substring($repoRoot.Length).TrimStart('\', '/')
            $syntaxOutput.Add($relative + ': node --check failed')
            $result.Output | ForEach-Object { $syntaxOutput.Add($_) }
        }
    }
    if ($syntaxFailed -eq 0) { $syntaxOutput.Add("node --check passed for $($pbFiles.Count) files") }
    $syntaxResult = New-Result $(if ($syntaxFailed -eq 0) { 0 } else { 1 }) @($syntaxOutput)
}
Complete-Stage 'PocketBase hook/migration node --check' $syntaxResult

Invoke-PowerShellStage 'check-pb-admin-auth' 'check-pb-admin-auth.ps1'
Invoke-PowerShellStage 'check-admin-recovery' 'check-admin-recovery.ps1'
Invoke-PowerShellStage 'check-admin-routes' 'check-admin-routes.ps1'
$fixtureOfflineArguments = if ($Ci) { @('-Offline') } else { @() }
Invoke-PowerShellStage 'test-admin-step-up' 'test-admin-step-up.ps1' $fixtureOfflineArguments
$securityRateOfflineArguments = @('-All') + $fixtureOfflineArguments
Invoke-PowerShellStage 'test-security-rate-local -All' 'test-security-rate-local.ps1' $securityRateOfflineArguments
Invoke-PowerShellStage 'test-account-retention-local -All' 'test-account-retention-local.ps1' @('-All')
Invoke-PowerShellStage 'test-mail-archive-api-local' 'test-mail-archive-api-local.ps1'
Invoke-Stage 'python -m unittest tests.ops.test_mail_archive' $python @('-m', 'unittest', 'tests.ops.test_mail_archive')
Invoke-PowerShellStage 'check-real-ip-chain' 'check-real-ip-chain.ps1'
Invoke-PowerShellStage 'check-auth-facade-cutover' 'check-auth-facade-cutover.ps1'
Invoke-PowerShellStage 'check-mail-archive-config' 'check-mail-archive-config.ps1'
$frontendBackendOfflineArguments = if ($Ci) { @('-Offline') } else { @() }
Invoke-PowerShellStage 'stats/friend backend contracts' 'test-stats-friend-local.ps1' $frontendBackendOfflineArguments
Invoke-PowerShellStage 'guestbook durable quota' 'test-guestbook-local.ps1' $frontendBackendOfflineArguments
Invoke-PowerShellStage 'gallery passkey audit' 'test-gallery-local.ps1' $frontendBackendOfflineArguments

$bashReady = $false
if ($bash) { $bashReady = (Invoke-Capture $bash @('--version')).ExitCode -eq 0 }
if ($bashReady) {
    Invoke-Stage 'bash syntax: run-mail-archive-1panel.sh' $bash @('-n', (Join-Path $PSScriptRoot 'run-mail-archive-1panel.sh'))
}
else {
    Skip-Stage 'bash syntax: run-mail-archive-1panel.sh' 'no usable bash runtime is available'
}

if (-not $isLinux) {
    Skip-Stage 'Linux PocketBase migration verifier' 'current platform is not Linux'
}
elseif (-not $bashReady) {
    $script:stage++
    Write-Host "[$script:stage/$totalStages] Linux PocketBase migration verifier" -ForegroundColor Cyan
    Complete-Stage 'Linux PocketBase migration verifier' (New-Result 1 @('bash is required on Linux'))
}
else {
    Invoke-Stage 'Linux PocketBase migration verifier' $bash @((Join-Path $PSScriptRoot 'verify-pocketbase-migrations-linux.sh'))
}

Write-Host ''
if ($failures.Count -eq 0) {
    Write-Host "=== Verification passed: $passed passed, $($skips.Count) skipped ===" -ForegroundColor Green
    $skips | ForEach-Object { Write-Host "  - $_" -ForegroundColor Yellow }
    exit 0
}

Write-Host "=== Verification failed: $($failures.Count) failed, $passed passed, $($skips.Count) skipped ===" -ForegroundColor Red
$failures | ForEach-Object { Write-Host "  - $_" -ForegroundColor Red }
$skips | ForEach-Object { Write-Host "  - SKIP: $_" -ForegroundColor Yellow }
exit 1
