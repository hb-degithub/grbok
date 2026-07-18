#!/usr/bin/env pwsh
[CmdletBinding()]
param()

$ErrorActionPreference = 'Stop'
$target = Join-Path $PSScriptRoot 'pre-deploy-check.ps1'
$source = Get-Content -LiteralPath $target -Raw

function Assert-True {
    param([bool]$Condition, [string]$Message)
    if (-not $Condition) { throw "PREDEPLOY_MANIFEST_TEST: $Message" }
}

Assert-True ($source -match '\$totalStages\s*=\s*25\b') 'aggregate stage count must be 25'
Assert-True (-not $source.Contains('Read-Host')) 'aggregate gate must remain noninteractive'

foreach ($required in @(
    "'test-pre-deploy-manifest'",
    "'test-offline-ci-contract'",
    "'test-hook-log-safety'",
    'hook_log_safety.test.js',
    "'post-build sensitive-check'",
    "'test-account-retention-local -All'",
    "'test-security-rate-local -All'",
    "'check-real-ip-chain'",
    "'check-auth-facade-cutover'",
    "'check-mail-archive-config'"
)) {
    Assert-True ($source.Contains($required)) "aggregate gate is missing $required"
}

Write-Host 'PASS pre-deploy manifest includes every security regression stage' -ForegroundColor Green
