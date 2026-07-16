#!/usr/bin/env pwsh
#Requires -Version 7.0
[CmdletBinding()]
param(
    [Parameter(Mandatory)][string]$UserEmail,
    [string]$PocketBaseUrl = 'http://localhost:8090'
)

$ErrorActionPreference = 'Stop'
if ($env:POCKETBASE_URL) { $PocketBaseUrl = $env:POCKETBASE_URL }

function Assert-LocalPocketBaseUrl([string]$Value) {
    $uri = [Uri]$Value
    $hostName = $uri.DnsSafeHost.ToLowerInvariant()
    if ($uri.Scheme -notin @('http', 'https') -or $uri.UserInfo -or $uri.AbsolutePath -ne '/') { throw 'invalid URL' }
    if ($hostName -ne 'localhost' -and $hostName -ne '::1' -and $hostName -notmatch '^127(?:\.\d{1,3}){3}$') { throw 'loopback required' }
}

function Get-PlainText([Security.SecureString]$SecureString) {
    $pointer = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($SecureString)
    try { return [Runtime.InteropServices.Marshal]::PtrToStringBSTR($pointer) }
    finally { [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($pointer) }
}

function Get-AdminToken {
    if ($env:POCKETBASE_ADMIN_TOKEN) { return $env:POCKETBASE_ADMIN_TOKEN }
    $value = Read-Host -Prompt 'PocketBase admin token' -AsSecureString
    if (-not $value -or $value.Length -eq 0) { throw 'missing token' }
    return Get-PlainText $value
}

$script:AdminToken = $null
try {
    Assert-LocalPocketBaseUrl $PocketBaseUrl
    $script:AdminToken = Get-AdminToken
    $body = @{ email = $UserEmail.Trim().ToLowerInvariant() } | ConvertTo-Json -Compress
    $result = Invoke-RestMethod -Method POST -Uri "$PocketBaseUrl/api/blog-admin/local-recovery" -Headers @{ Authorization = "Bearer $script:AdminToken" } -ContentType 'application/json' -Body $body
    if (-not $result.recoveryCode -or -not $result.referenceId) { throw 'invalid recovery response' }
    Write-Output "PASS referenceId=$($result.referenceId) expiresAt=$($result.expiresAt) passkeys=$($result.counts.passkeys) stepUps=$($result.counts.stepUps) recoveryCode=$($result.recoveryCode)"
} catch {
    Write-Output 'FAIL'
    exit 1
} finally {
    $script:AdminToken = $null
}
