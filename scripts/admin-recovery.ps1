#!/usr/bin/env pwsh
#Requires -Version 7.0
[CmdletBinding()]
param(
    [Parameter(Mandatory)][string]$UserEmail,
    [Parameter(Mandatory)][ValidateSet('issue-reenroll', 'revoke-passkeys', 'clear-sessions')][string]$Action,
    [string]$PocketBaseUrl = 'http://localhost:8090'
)

$ErrorActionPreference = 'Stop'
if ($env:POCKETBASE_URL) { $PocketBaseUrl = $env:POCKETBASE_URL }

function New-ReferenceId {
    $bytes = [byte[]]::new(16)
    [Security.Cryptography.RandomNumberGenerator]::Fill($bytes)
    return [Convert]::ToBase64String($bytes).TrimEnd('=').Replace('+', '-').Replace('/', '_')
}

function Assert-LocalPocketBaseUrl([string]$Value) {
    $uri = [Uri]$Value
    if ($uri.Scheme -notin @('http', 'https') -or $uri.UserInfo -or $uri.AbsolutePath -ne '/') {
        throw 'invalid local PocketBase URL'
    }
    $hostName = $uri.DnsSafeHost.ToLowerInvariant()
    if ($hostName -ne 'localhost' -and $hostName -ne '::1' -and $hostName -notmatch '^127(?:\.\d{1,3}){3}$') {
        throw 'PocketBase URL must resolve to loopback'
    }
}

function Get-PlainText([Security.SecureString]$SecureString) {
    $pointer = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($SecureString)
    try { return [Runtime.InteropServices.Marshal]::PtrToStringBSTR($pointer) }
    finally { [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($pointer) }
}

function Get-AdminToken {
    if ($env:POCKETBASE_ADMIN_TOKEN) { return $env:POCKETBASE_ADMIN_TOKEN }
    $value = Read-Host -Prompt 'PocketBase admin token' -AsSecureString
    if (-not $value -or $value.Length -eq 0) { throw 'missing admin token' }
    return Get-PlainText $value
}

function Get-SHA256Hash([string]$Value) {
    $bytes = [Text.Encoding]::UTF8.GetBytes($Value)
    $hash = [Security.Cryptography.SHA256]::HashData($bytes)
    return [Convert]::ToHexString($hash).ToLowerInvariant()
}

function Invoke-PBApi([string]$Method, [string]$Path, $Body = $null) {
    $params = @{
        Uri = "$PocketBaseUrl$Path"
        Method = $Method
        Headers = @{ Authorization = "Bearer $script:AdminToken" }
    }
    if ($null -ne $Body) {
        $params.ContentType = 'application/json'
        $params.Body = $Body | ConvertTo-Json -Depth 10 -Compress
    }
    return Invoke-RestMethod @params
}

function Find-Record([string]$Collection, [string]$Filter) {
    $escaped = [uri]::EscapeDataString($Filter)
    $result = Invoke-PBApi GET "/api/collections/$Collection/records?filter=$escaped&perPage=1"
    if (-not $result.items -or $result.items.Count -ne 1) { throw 'required record not found' }
    return $result.items[0]
}

function Find-UserByEmail([string]$Email) {
    $normalized = $Email.Trim().ToLowerInvariant().Replace('"', '\"')
    return Find-Record 'users' "email = `"$normalized`""
}

function Validate-RecoveryCode([string]$UserId, [string]$Code) {
    $hash = Get-SHA256Hash $Code
    $record = Find-Record 'admin_recovery_codes' "user = `"$UserId`" && code_hash = `"$hash`""
    if ($record.used_at) { throw 'recovery code unavailable' }
    if (-not $record.expires_at -or [DateTime]::Parse($record.expires_at).ToUniversalTime() -le [DateTime]::UtcNow) {
        throw 'recovery code unavailable'
    }
    return $record
}

function Revoke-Records([string]$Collection, [string]$OwnerField, [string]$UserId) {
    $filter = [uri]::EscapeDataString("$OwnerField = `"$UserId`" && revoked_at = null")
    $result = Invoke-PBApi GET "/api/collections/$Collection/records?filter=$filter&perPage=1000"
    $count = 0
    $now = [DateTime]::UtcNow.ToString('o')
    foreach ($record in @($result.items)) {
        Invoke-PBApi PATCH "/api/collections/$Collection/records/$($record.id)" @{ revoked_at = $now } | Out-Null
        $count++
    }
    return $count
}

$referenceId = New-ReferenceId
$codePlain = $null
$script:AdminToken = $null
try {
    Assert-LocalPocketBaseUrl $PocketBaseUrl
    $script:AdminToken = Get-AdminToken
    $user = Find-UserByEmail $UserEmail
    $secureCode = Read-Host -Prompt 'Recovery code' -AsSecureString
    if (-not $secureCode -or $secureCode.Length -eq 0) { throw 'missing recovery code' }
    $codePlain = Get-PlainText $secureCode
    $codeRecord = Validate-RecoveryCode $user.id $codePlain

    $passkeyCount = 0
    $verifiedSessionCount = 0
    if ($Action -in @('issue-reenroll', 'revoke-passkeys')) {
        $passkeyCount = Revoke-Records 'admin_passkeys' 'owner' $user.id
    }
    if ($Action -in @('issue-reenroll', 'clear-sessions')) {
        $verifiedSessionCount = Revoke-Records 'admin_verified_sessions' 'user' $user.id
    }
    $stepUpSessionCount = Revoke-Records 'admin_step_up_sessions' 'user' $user.id

    $auditBody = @{
        actor = ''
        action_code = 'ADMIN_LOCAL_RECOVERY'
        target_type = 'user'
        target_id = $user.id
        before_json = @{ action = $Action }
        after_json = @{
            passkeys_revoked = $passkeyCount
            verified_sessions_revoked = $verifiedSessionCount
            step_up_sessions_revoked = $stepUpSessionCount
        }
        version = 1
        reference_id = $referenceId
        priority = 'high'
    }
    Invoke-PBApi POST '/api/collections/admin_security_audits/records' $auditBody | Out-Null
    Invoke-PBApi PATCH "/api/collections/admin_recovery_codes/records/$($codeRecord.id)" @{ used_at = [DateTime]::UtcNow.ToString('o') } | Out-Null

    Write-Output "PASS reference=$referenceId passkeys=$passkeyCount verifiedSessions=$verifiedSessionCount stepUpSessions=$stepUpSessionCount audits=1"
} catch {
    Write-Output "FAIL reference=$referenceId"
    exit 1
} finally {
    $codePlain = $null
    $script:AdminToken = $null
}
