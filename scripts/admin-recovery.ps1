#!/usr/bin/env pwsh
#Requires -Version 7.0
<#
.SYNOPSIS
    服务器本地管理员恢复脚本
.DESCRIPTION
    通过一次性恢复码执行管理员账户恢复操作。必须在 PocketBase 服务器本地或受信网络内运行。
    恢复码通过隐藏输入读取，禁止作为命令行参数传入，避免泄露到 shell history 或进程列表。
.EXAMPLE
    .\scripts\admin-recovery.ps1 -UserEmail admin@example.com -Action revoke-passkeys
#>
[CmdletBinding()]
param(
    [Parameter(Mandatory)]
    [string]$UserEmail,

    [Parameter(Mandatory)]
    [ValidateSet('issue-reenroll', 'revoke-passkeys', 'clear-sessions')]
    [string]$Action,

    [string]$PocketBaseUrl = 'http://localhost:8090'
)

$ErrorActionPreference = 'Stop'

if ($env:POCKETBASE_URL) {
    $PocketBaseUrl = $env:POCKETBASE_URL
}

function Get-SHA256Hash($value) {
    $bytes = [System.Text.Encoding]::UTF8.GetBytes($value)
    $hash = [System.Security.Cryptography.SHA256]::Create().ComputeHash($bytes)
    return [BitConverter]::ToString($hash).Replace('-', '').ToLower()
}

function Get-PlainText($secureString) {
    $bstr = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($secureString)
    try {
        return [Runtime.InteropServices.Marshal]::PtrToStringAuto($bstr)
    } finally {
        [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($bstr)
    }
}

function Get-AdminToken {
    $token = $env:POCKETBASE_ADMIN_TOKEN
    if ($token) { return $token }

    $secureToken = Read-Host -Prompt '请输入 PocketBase admin token' -AsSecureString
    if (-not $secureToken -or $secureToken.Length -eq 0) {
        throw 'PocketBase admin token 不能为空'
    }
    return Get-PlainText $secureToken
}

function Invoke-PBApi($method, $path, $body = $null) {
    $headers = @{ Authorization = "Bearer $script:adminToken" }
    $uri = "$PocketBaseUrl$path"

    $params = @{
        Uri = $uri
        Method = $method
        Headers = $headers
    }

    if ($body) {
        $params.ContentType = 'application/json'
        $params.Body = $body | ConvertTo-Json -Depth 10 -Compress
    }

    try {
        return Invoke-RestMethod @params
    } catch {
        $message = if ($_.ErrorDetails.Message) { $_.ErrorDetails.Message } else { $_.Exception.Message }
        throw "PocketBase API 请求失败: $message"
    }
}

function Find-UserByEmail($email) {
    $normalized = $email.ToLower().Trim()
    $filter = [uri]::EscapeDataString("email = `"$normalized`"")
    $result = Invoke-PBApi -method GET -path "/api/collections/users/records?filter=$filter&perPage=1"
    if (-not $result.items -or $result.items.Count -eq 0) {
        throw "找不到用户: $email"
    }
    return $result.items[0]
}

function Validate-RecoveryCode($userId, $code) {
    $codeHash = Get-SHA256Hash $code
    $filter = [uri]::EscapeDataString("user = `"$userId`" && code_hash = `"$codeHash`"")
    $result = Invoke-PBApi -method GET -path "/api/collections/admin_recovery_codes/records?filter=$filter&perPage=1"
    if (-not $result.items -or $result.items.Count -eq 0) {
        throw '恢复码无效'
    }

    $record = $result.items[0]
    $now = [DateTime]::UtcNow

    if ($record.expires_at -and [DateTime]::Parse($record.expires_at).ToUniversalTime() -lt $now) {
        throw '恢复码已过期'
    }
    if ($record.used_at) {
        throw '恢复码已被使用'
    }

    return $record
}

function Mark-CodeUsed($record) {
    $now = [DateTime]::UtcNow.ToString('o')
    Invoke-PBApi -method PATCH -path "/api/collections/admin_recovery_codes/records/$($record.id)" -body @{ used_at = $now }
}

function Revoke-AllPasskeys($userId) {
    $filter = [uri]::EscapeDataString("owner = `"$userId`" && revoked_at = null")
    $result = Invoke-PBApi -method GET -path "/api/collections/admin_passkeys/records?filter=$filter&perPage=1000"
    $now = [DateTime]::UtcNow.ToString('o')
    foreach ($record in $result.items) {
        Invoke-PBApi -method PATCH -path "/api/collections/admin_passkeys/records/$($record.id)" -body @{ revoked_at = $now }
    }
}

function Clear-VerifiedSessions($userId) {
    $filter = [uri]::EscapeDataString("user = `"$userId`" && revoked_at = null")
    $result = Invoke-PBApi -method GET -path "/api/collections/admin_verified_sessions/records?filter=$filter&perPage=1000"
    $now = [DateTime]::UtcNow.ToString('o')
    foreach ($record in $result.items) {
        Invoke-PBApi -method PATCH -path "/api/collections/admin_verified_sessions/records/$($record.id)" -body @{ revoked_at = $now }
    }
}

function Invoke-RecoveryAction($userId, $action) {
    switch ($action) {
        'issue-reenroll' {
            Revoke-AllPasskeys $userId
            Clear-VerifiedSessions $userId
            Write-Host '已撤销旧 Passkey 并清除验证会话，请重新注册 Passkey' -ForegroundColor Green
        }
        'revoke-passkeys' {
            Revoke-AllPasskeys $userId
            Write-Host '已撤销该用户的所有 Passkey' -ForegroundColor Green
        }
        'clear-sessions' {
            Clear-VerifiedSessions $userId
            Write-Host '已清除该用户的验证会话' -ForegroundColor Green
        }
    }
}

function Write-AuditLog($userId, $action, $email) {
    $operator = if ($env:USER) { $env:USER } elseif ($env:USERNAME) { $env:USERNAME } else { 'unknown' }
    $hostname = if ($env:COMPUTERNAME) { $env:COMPUTERNAME } elseif ($env:HOSTNAME) { $env:HOSTNAME } else { 'localhost' }
    $summary = "Recovery action '$action' executed for user $email (operator: $operator, host: $hostname)"
    Invoke-PBApi -method POST -path '/api/collections/audit_logs/records' -body @{
        actor = 'recovery-script'
        action = "recovery:$action"
        target_collection = 'users'
        target_id = $userId
        summary = $summary
    }
}

# 主流程
$codePlain = $null
try {
    $script:adminToken = Get-AdminToken
    $user = Find-UserByEmail $UserEmail

    $secureCode = Read-Host -Prompt '请输入恢复码' -AsSecureString
    if (-not $secureCode -or $secureCode.Length -eq 0) {
        throw '恢复码不能为空'
    }
    $codePlain = Get-PlainText $secureCode

    $codeRecord = Validate-RecoveryCode -userId $user.id -code $codePlain
    Invoke-RecoveryAction -userId $user.id -action $Action
    Mark-CodeUsed $codeRecord
    Write-AuditLog -userId $user.id -action $Action -email $UserEmail

    Write-Host '恢复操作完成' -ForegroundColor Green
} catch {
    Write-Host "ERROR: $_" -ForegroundColor Red
    exit 1
} finally {
    $codePlain = $null
    $script:adminToken = $null
}

