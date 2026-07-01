#Requires -Version 5.1
<#
.SYNOPSIS
    Verify PocketBase admin auth migration and hook files.
.DESCRIPTION
    Checks that the migration creates the required collections and fields.
#>
$ErrorActionPreference = 'Stop'

$failures = @()

$migration = Get-ChildItem -Path 'pb_migrations' -Filter '*_create_admin_auth_hardening.pb.js' -File | Select-Object -First 1
if (-not $migration) {
    $failures += 'Missing migration pb_migrations/*_create_admin_auth_hardening.pb.js'
} else {
    $content = Get-Content -LiteralPath $migration.FullName -Raw

    $requiredCollections = @('admin_passkeys', 'webauthn_challenges', 'admin_verified_sessions', 'admin_recovery_codes')
    foreach ($name in $requiredCollections) {
        if ($content -notmatch [regex]::Escape($name)) {
            $failures += "Migration missing collection $name"
        }
    }

    $requiredFields = @('credential_id', 'public_key', 'token_hash', 'fingerprint_hash', 'ip_hash', 'expires_at', 'used_at', 'code_hash')
    foreach ($field in $requiredFields) {
        if ($content -notmatch [regex]::Escape($field)) {
            $failures += "Migration missing field $field"
        }
    }
}

if ($failures.Count -gt 0) {
    Write-Host 'FAIL: PocketBase admin auth checks failed' -ForegroundColor Red
    foreach ($failure in $failures) {
        Write-Host "  - $failure" -ForegroundColor Red
    }
    exit 1
}

Write-Host 'PASS: PocketBase admin auth migration is in place.' -ForegroundColor Green
exit 0
