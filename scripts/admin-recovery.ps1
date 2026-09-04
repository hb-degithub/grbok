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
    # 安全修复：恢复码不再明文输出到 stdout（避免终端历史/CI 日志/屏幕共享捕获）
    # 改为输出到受保护的临时文件，用户需手动查看并安全存储
    $tempFile = [System.IO.Path]::GetTempFileName()
    try {
        [System.IO.File]::WriteAllText($tempFile, $result.recoveryCode)
        # 设置文件权限为仅当前用户可读（Windows ACL）
        $acl = Get-Acl $tempFile
        $acl.SetAccessRuleProtection($true, $false)
        $rule = New-Object System.Security.AccessControl.FileSystemAccessRule($env:USERNAME, 'Read', 'Allow')
        $acl.AddAccessRule($rule)
        Set-Acl $tempFile $acl
        Write-Output "PASS referenceId=$($result.referenceId) expiresAt=$($result.expiresAt) passkeys=$($result.counts.passkeys) stepUps=$($result.counts.stepUps) recoveryCodeFile=$tempFile"
        Write-Host "恢复码已写入受保护临时文件: $tempFile" -ForegroundColor Yellow
        Write-Host "请立即查看并安全存储，然后删除该文件。" -ForegroundColor Yellow
    } catch {
        if (Test-Path $tempFile) { Remove-Item $tempFile -Force }
        throw
    }
} catch {
    Write-Output 'FAIL'
    exit 1
} finally {
    $script:AdminToken = $null
}
