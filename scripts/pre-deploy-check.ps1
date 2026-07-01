#!/usr/bin/env pwsh
<#
.SYNOPSIS
    部署前检查：构建、敏感文件、迁移验证、admin auth schema
#>

$ErrorActionPreference = 'Stop'
$repoRoot = Split-Path -Parent $PSScriptRoot | Split-Path -Parent
$failures = @()

Write-Host "=== 部署前检查 ===" -ForegroundColor Cyan

# 1. Git 状态检查
Write-Host "[1/6] Git 状态检查" -ForegroundColor Cyan
$status = git status --porcelain
if ($status) {
    Write-Host "  暂存区/工作区有未提交改动:" -ForegroundColor Yellow
    $status | ForEach-Object { Write-Host "    $_" -ForegroundColor Yellow }
    $answer = Read-Host "  是否继续部署? (y/N)"
    if ($answer -ne 'y') { Write-Host "  已取消"; exit 0 }
}
else {
    Write-Host "  OK 工作区干净" -ForegroundColor Green
}

# 2. 敏感文件检查
Write-Host "[2/6] 敏感文件检查" -ForegroundColor Cyan
$sensitive = & "$PSScriptRoot\sensitive-check.ps1" 2>&1
if ($LASTEXITCODE -ne 0) {
    $failures += "敏感文件检查未通过"
    Write-Host "  $sensitive" -ForegroundColor Red
}
else {
    Write-Host "  OK" -ForegroundColor Green
}

# 3. Astro 构建验证
Write-Host "[3/6] Astro 构建验证" -ForegroundColor Cyan
Push-Location "$repoRoot\astro"
try {
    $buildResult = npm run build 2>&1
    if ($LASTEXITCODE -ne 0) {
        $failures += "Astro 构建失败"
        Write-Host "  FAIL" -ForegroundColor Red
        Write-Host "  $buildResult" -ForegroundColor Red
    }
    else {
        Write-Host "  OK" -ForegroundColor Green
    }
}
finally {
    Pop-Location
}

# 4. 迁移验证 (Linux 环境)
Write-Host "[4/6] 迁移验证 (Linux)" -ForegroundColor Cyan
if ($IsLinux -or $IsMacOS) {
    $migrateResult = bash "$repoRoot\scripts\verify-pocketbase-migrations-linux.sh" 2>&1
    if ($LASTEXITCODE -ne 0) {
        $failures += "迁移验证失败"
        Write-Host "  FAIL" -ForegroundColor Red
        Write-Host "  $migrateResult" -ForegroundColor Red
    }
    else {
        Write-Host "  OK" -ForegroundColor Green
    }
}
else {
    Write-Host "  跳过（当前非 Linux 环境）" -ForegroundColor Yellow
}

# 5. Admin auth schema 检查
Write-Host "[5/6] Admin auth schema 检查" -ForegroundColor Cyan
$pbAdminAuthResult = & "$PSScriptRoot\check-pb-admin-auth.ps1" 2>&1
if ($LASTEXITCODE -ne 0) {
    $failures += "Admin auth schema 检查未通过"
    Write-Host "  FAIL" -ForegroundColor Red
    Write-Host "  $pbAdminAuthResult" -ForegroundColor Red
}
else {
    Write-Host "  OK" -ForegroundColor Green
}

# 6. .env 文件检查
Write-Host "[6/6] .env 文件检查" -ForegroundColor Cyan
$requiredEnvFiles = @('.env.example')
$missingEnv = $requiredEnvFiles | Where-Object { -not (Test-Path "$repoRoot\$_") }
if ($missingEnv) {
    $failures += "缺少环境变量模板: $($missingEnv -join ', ')"
    Write-Host "  FAIL" -ForegroundColor Red
}
else {
    Write-Host "  OK" -ForegroundColor Green
}

# 总结
Write-Host ""
if ($failures.Count -eq 0) {
    Write-Host "=== 全部检查通过 ===" -ForegroundColor Green
    exit 0
}
else {
    Write-Host "=== $($failures.Count) 项检查失败 ===" -ForegroundColor Red
    $failures | ForEach-Object { Write-Host "  - $_" -ForegroundColor Red }
    Write-Host "请修复后重新运行 pre-deploy-check" -ForegroundColor Red
    exit 1
}

