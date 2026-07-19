#!/usr/bin/env pwsh
[CmdletBinding()]
param()

$ErrorActionPreference = 'Stop'
$repoRoot = Split-Path -Parent $PSScriptRoot
$shell = [Diagnostics.Process]::GetCurrentProcess().MainModule.FileName

function Assert-True {
    param([bool]$Condition, [string]$Message)
    if (-not $Condition) { throw "OFFLINE_CI_TEST: $Message" }
}

function Invoke-OfflineFixture {
    param([Parameter(Mandatory)][string]$ScriptName)
    $probeRoot = Join-Path $repoRoot ('tmp\offline-probe-' + [Guid]::NewGuid().ToString('N'))
    $missingBinary = Join-Path $probeRoot 'pocketbase.exe'
    $arguments = @('-NoProfile')
    if ([Environment]::OSVersion.Platform -eq [PlatformID]::Win32NT) {
        $arguments += @('-ExecutionPolicy', 'Bypass')
    }
    $arguments += @('-File', (Join-Path $PSScriptRoot $ScriptName), '-Offline', '-PocketBasePath', $missingBinary)

    $previousPreference = $ErrorActionPreference
    try {
        $ErrorActionPreference = 'Continue'
        $global:LASTEXITCODE = $null
        $output = @(& $shell @arguments 2>&1)
        $exitCode = $global:LASTEXITCODE
    }
    finally {
        $ErrorActionPreference = $previousPreference
    }

    $text = $output -join [Environment]::NewLine
    Assert-True ($exitCode -ne 0) "$ScriptName unexpectedly succeeded without PocketBase"
    Assert-True ($text -match '(?i)offline mode') "$ScriptName did not fail with the stable offline-mode error"
    Assert-True (-not (Test-Path -LiteralPath $probeRoot)) "$ScriptName created files before the offline guard"
}

Invoke-OfflineFixture 'test-admin-step-up.ps1'
Invoke-OfflineFixture 'test-security-rate-local.ps1'
Invoke-OfflineFixture 'test-stats-friend-local.ps1'
Invoke-OfflineFixture 'test-guestbook-local.ps1'
Invoke-OfflineFixture 'test-gallery-local.ps1'

$predeploy = Get-Content -LiteralPath (Join-Path $PSScriptRoot 'pre-deploy-check.ps1') -Raw
foreach ($required in @(
    'test-pre-deploy-runner',
    'test-sensitive-check',
    'post-build sensitive-check',
    'NO_PROXY',
    'no_proxy',
    'PUBLIC_POCKETBASE_URL',
    '127.0.0.1',
    '-Offline'
)) {
    Assert-True ($predeploy.Contains($required)) "pre-deploy CI contract missing: $required"
}

Assert-True ($predeploy -match '(?s)test-admin-step-up.*?Offline') 'admin step-up stage does not receive offline mode'
Assert-True ($predeploy -match '(?s)test-security-rate-local.*?Offline') 'security-rate stage does not receive offline mode'
Assert-True ($predeploy -match '(?s)test-stats-friend-local.*?frontendBackendOfflineArguments') 'stats/friend stage does not receive offline mode'
Assert-True ($predeploy -match '(?s)test-guestbook-local.*?frontendBackendOfflineArguments') 'guestbook stage does not receive offline mode'
Assert-True ($predeploy -match '(?s)test-gallery-local.*?frontendBackendOfflineArguments') 'gallery stage does not receive offline mode'
Write-Host 'PASS CI fixtures fail offline before download and aggregate gate stays loopback-only' -ForegroundColor Green
