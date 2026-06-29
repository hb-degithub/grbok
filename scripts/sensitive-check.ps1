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
