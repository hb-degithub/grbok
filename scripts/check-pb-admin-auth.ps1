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

$stepUpMigration = Get-Item -LiteralPath 'pb_migrations/20260716100000_create_admin_step_up_security.pb.js' -ErrorAction SilentlyContinue
if (-not $stepUpMigration) {
    $failures += 'Missing migration pb_migrations/20260716100000_create_admin_step_up_security.pb.js'
} else {
    $stepUpContent = Get-Content -LiteralPath $stepUpMigration.FullName -Raw

    $requiredCollections = @('admin_step_up_sessions', 'admin_passkey_state', 'admin_security_audits')
    foreach ($name in $requiredCollections) {
        if ($stepUpContent -notmatch [regex]::Escape($name)) {
            $failures += "Step-up migration missing collection $name"
        }
    }

    $requiredStepUpFields = @('user','selector','secret_hmac','client_session_hmac','fingerprint_hash','ip_hash','user_agent_hash','verified_at','expires_at','revoked_at')
    foreach ($field in $requiredStepUpFields) {
        if ($stepUpContent -notmatch [regex]::Escape($field)) {
            $failures += "Step-up migration missing field $field"
        }
    }

    $requiredChallengeContract = @('binding_selector', 'client_session_hmac', 'bootstrap_registration', 'add_registration', 'authentication')
    foreach ($value in $requiredChallengeContract) {
        if ($stepUpContent -notmatch [regex]::Escape($value)) {
            $failures += "Step-up migration missing challenge contract $value"
        }
    }

    $requiredIndexes = @(
        'idx_admin_step_up_sessions_selector',
        'idx_admin_step_up_sessions_expires',
        'idx_admin_passkey_state_user',
        'idx_webauthn_challenges_expires'
    )
    foreach ($index in $requiredIndexes) {
        if ($stepUpContent -notmatch [regex]::Escape($index)) {
            $failures += "Step-up migration missing index $index"
        }
    }

    foreach ($collectionVariable in @('stepUpSessions', 'passkeyState', 'securityAudits')) {
        foreach ($rule in @('listRule', 'viewRule', 'createRule', 'updateRule', 'deleteRule')) {
            if ($stepUpContent -notmatch "(?m)^\s*$collectionVariable\.$rule\s*=\s*null;") {
                $failures += "Step-up migration must set $collectionVariable.$rule to null"
            }
        }
    }

    foreach ($rule in @('listRule', 'viewRule', 'updateRule', 'deleteRule')) {
        if ($stepUpContent -notmatch "(?m)^\s*passkeys\.$rule\s*=\s*null;") {
            $failures += "Step-up migration must set admin_passkeys $rule to null"
        }
    }
}


$hookFile = 'pb_hooks/admin_webauthn.pb.js'
if (-not (Test-Path -LiteralPath $hookFile -PathType Leaf)) {
    $failures += "Missing hook file: $hookFile"
} else {
    $hookContent = Get-Content -LiteralPath $hookFile -Raw
    $requiredRoutes = @(
        '/api/blog-admin/webauthn/register/options',
        '/api/blog-admin/webauthn/register/verify',
        '/api/blog-admin/webauthn/authenticate/options',
        '/api/blog-admin/webauthn/authenticate/verify',
        '/api/blog-admin/webauthn/session'
    )
    foreach ($route in $requiredRoutes) {
        if ($hookContent -notmatch [regex]::Escape($route)) {
            $failures += "$hookFile : missing route $route"
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
