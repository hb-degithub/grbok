#Requires -Version 5.1
<#
.SYNOPSIS
    Verify admin recovery script structure.
.DESCRIPTION
    Checks that the recovery script exists and follows the required safety patterns:
    explicit UserEmail/Action parameters, hidden recovery code input, and recovery code
    collection field usage.
#>
$ErrorActionPreference = 'Stop'

$failures = @()

$scriptPath = 'scripts/admin-recovery.ps1'
if (-not (Test-Path -LiteralPath $scriptPath -PathType Leaf)) {
    $failures += "Missing recovery script: $scriptPath"
} else {
    $content = Get-Content -LiteralPath $scriptPath -Raw

    $requiredPatterns = @(
        'UserEmail',
        'Action',
        'Read-Host',
        '-AsSecureString',
        '/api/blog-admin/local-recovery',
        'recoveryCode',
        'referenceId'
    )
    foreach ($pattern in $requiredPatterns) {
        if ($content -notmatch [regex]::Escape($pattern)) {
            $failures += "$scriptPath : missing pattern '$pattern'"
        }
    }

    # Recovery code must not be accepted as a plaintext command-line parameter
    if ($content -match '\\s-RecoveryCode\\b') {
        $failures += "$scriptPath : must not accept -RecoveryCode as a plaintext parameter"
    }
    if ($content -match '\\s-StepUp\\b|X-Admin-Step-Up') {
        $failures += "$scriptPath : local recovery must never accept or send a step-up secret"
    }
    if ($content -match '/api/collections/|Invoke-PBApi\s+PATCH|Method\s*=\s*''PATCH''') {
        $failures += "$scriptPath : recovery must use only the single transactional endpoint"
    }
}

if ($failures.Count -gt 0) {
    Write-Host 'FAIL: Admin recovery checks failed' -ForegroundColor Red
    foreach ($failure in $failures) {
        Write-Host "  - $failure" -ForegroundColor Red
    }
    exit 1
}

Write-Host 'PASS: Admin recovery script structure is in place.' -ForegroundColor Green
exit 0

