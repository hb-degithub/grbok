#!/usr/bin/env pwsh
<#
.SYNOPSIS
    检查工作区和暂存区是否有敏感文件（私钥、环境变量、token 等）
#>

$ErrorActionPreference = 'Stop'
$repoRoot = Split-Path -Parent $PSScriptRoot | Split-Path -Parent
$issues = @()

# 检查项 1: 暂存区中的敏感文件
$sensitivePatterns = @(
    'PRIVATE KEY-----',
    'sk-[a-zA-Z0-9]{20,}',
    'ghp_[a-zA-Z0-9]{36}',
    'gho_[a-zA-Z0-9]{36}',
    'xox[baprs]-[a-zA-Z0-9-]{10,}'
)
$stagedDiff = git diff --cached -U0 2>$null
foreach ($pattern in $sensitivePatterns) {
    if ($stagedDiff -match $pattern) {
        $issues += "暂存区包含疑似敏感字符串: $pattern"
    }
}

# 检查项 1b: 暂存区中的 admin auth 硬编码密钥（hex 格式视为真实密钥）
$adminAuthStagedPatterns = @(
    "ADMIN_AUTH_INTERNAL_SECRET\s*[:=]\s*['`"][a-f0-9]{40,}['`"]",
    "ADMIN_AUTH_HASH_SECRET\s*[:=]\s*['`"][a-f0-9]{40,}['`"]",
    "PB_ENCRYPTION_KEY\s*[:=]\s*['`"][a-f0-9]{40,}['`"]"
)
foreach ($pattern in $adminAuthStagedPatterns) {
    if ($stagedDiff -match $pattern) {
        $issues += "暂存区包含疑似硬编码 admin auth 密钥"
    }
}

# 检查项 2: 未跟踪的敏感文件
$untracked = git ls-files --others --exclude-standard 2>$null
$dangerousFiles = $untracked | Where-Object {
    $_ -match '\.(pem|key|ppk)$' -or
    $_ -match '^(id_|.*_ed25519)' -or
    $_ -match '\.env$' -or
    $_ -match '\.env\.(local|prod|production)$'
}
if ($dangerousFiles) {
    $issues += "未跟踪的敏感文件:"
    $dangerousFiles | ForEach-Object { $issues += "  - $_" }
}

# 检查项 3: 构建产物
if (Test-Path "$repoRoot\astro\dist") {
    $distItems = Get-ChildItem "$repoRoot\astro\dist" -ErrorAction SilentlyContinue
    if ($distItems.Count -gt 0) {
        $issues += "存在 astro/dist 构建产物未清理。部署前建议清理。"
    }
}

# 检查项 4: 已提交文件中的 admin auth 硬编码密钥
$committedFilesToCheck = @(
    'docker-compose.yml',
    'docker-compose.local.yml',
    'admin-auth/src/config.mjs',
    'admin-auth/src/server.mjs',
    'admin-auth/src/session-policy.mjs',
    'admin-auth/src/webauthn-service.mjs',
    'pb_hooks/admin_webauthn.pb.js'
)
foreach ($file in $committedFilesToCheck) {
    $fullPath = "$repoRoot\$file"
    if (Test-Path -LiteralPath $fullPath -PathType Leaf) {
        $content = Get-Content -LiteralPath $fullPath -Raw
        if ($content -match "ADMIN_AUTH_INTERNAL_SECRET\s*[:=]\s*['`"][a-f0-9]{40,}['`"]") {
            $issues += "文件 $file 可能存在硬编码的 ADMIN_AUTH_INTERNAL_SECRET"
        }
        if ($content -match "ADMIN_AUTH_HASH_SECRET\s*[:=]\s*['`"][a-f0-9]{40,}['`"]") {
            $issues += "文件 $file 可能存在硬编码的 ADMIN_AUTH_HASH_SECRET"
        }
    }
}

# 检查项 5: 恢复脚本中是否包含硬编码恢复码示例
$recoveryScript = "$PSScriptRoot\admin-recovery.ps1"
if (Test-Path -LiteralPath $recoveryScript -PathType Leaf) {
    $recoveryContent = Get-Content -LiteralPath $recoveryScript -Raw
    if ($recoveryContent -match '"[a-f0-9]{32,}"') {
        $issues += "admin-recovery.ps1 包含疑似硬编码恢复码的十六进制字符串"
    }
}

# 输出结果
if ($issues.Count -eq 0) {
    Write-Host "OK 未发现敏感文件问题" -ForegroundColor Green
    exit 0
}
else {
    Write-Host "发现 $($issues.Count) 个问题:" -ForegroundColor Yellow
    $issues | ForEach-Object { Write-Host "  $_" -ForegroundColor Yellow }
    Write-Host "请修复后再提交/部署。" -ForegroundColor Yellow
    exit 1
}
