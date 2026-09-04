# ==============================================================================
# deploy-dist.ps1 — 胡巴博客静态文件部署 PowerShell 包装脚本
#
# 背景：2025-07-29 全站 404 事故根因是部署时删除重建了
#       /opt/hlydwz-blog/current/astro/dist 目录，导致 blog-caddy 的
#       bind mount (./astro/dist:/srv) inode 悬空，前台全站 404 持续 5.7 天。
#
# 整改方案：rsync -a --delete 原地更新（只同步差异，目录 inode 不变，
#           容器无需因挂载问题重启）。
#
# 严禁：任何 rm -rf dist 或删除重建目录的命令。
#
# 用法：
#   powershell -ExecutionPolicy Bypass -File scripts/deploy-dist.ps1 [dist目录路径]
#   powershell -ExecutionPolicy Bypass -File scripts/deploy-dist.ps1 ./astro/dist
#
# 说明：
#   Windows 原生环境通常没有 rsync，本脚本优先尝试调用 Git Bash 中的
#   deploy-dist.sh；若 Git Bash 不可用，则提供 scp 兜底方案说明。
# ==============================================================================

param(
    [string]$DistDir = "./astro/dist"
)

# ── 颜色输出（必须在所有调用点之前定义，保证逐行执行/嵌入场景可用）────────────

function Write-Info  { param([string]$Msg) Write-Host "[INFO] $Msg" -ForegroundColor Cyan }
function Write-Ok    { param([string]$Msg) Write-Host "[OK] $Msg" -ForegroundColor Green }
function Write-Warn  { param([string]$Msg) Write-Host "[WARN] $Msg" -ForegroundColor Yellow }
function Write-Error { param([string]$Msg) Write-Host "[ERROR] $Msg" -ForegroundColor Red }

function Exit-WithError {
    param([string]$Msg, [string]$RecoveryHint = "", [int]$ExitCode = 1)
    Write-Error $Msg
    if ($RecoveryHint) {
        Write-Host ""
        Write-Host "恢复建议: $RecoveryHint" -ForegroundColor Yellow
    }
    exit $ExitCode
}

# ── 可配置变量 ────────────────────────────────────────────────────────────────

# 安全修复：敏感值从环境变量读取，不再硬编码到版本控制
# 使用方法：$env:DEPLOY_SSH_HOST = "root@your-server"; $env:DEPLOY_SSH_KEY = "C:\path\to\key"
$SshHost = $env:DEPLOY_SSH_HOST
if (-not $SshHost) { Exit-WithError "环境变量 DEPLOY_SSH_HOST 未设置" "请设置： `$env:DEPLOY_SSH_HOST = 'root@your-server-ip'" 1 }
$SshPort = if ($env:DEPLOY_SSH_PORT) { $env:DEPLOY_SSH_PORT } else { "22" }
$SshKey = $env:DEPLOY_SSH_KEY
if (-not $SshKey) { Exit-WithError "环境变量 DEPLOY_SSH_KEY 未设置" "请设置： `$env:DEPLOY_SSH_KEY = 'C:\path\to\blog_deploy_ed25519'" 1 }
$RemoteDistDir = "/opt/hlydwz-blog/current/astro/dist"
$RemoteCaddyContainer = "blog-caddy"
$OriginUrl = "http://127.0.0.1:18080/"
$PublicUrl = "https://hlydwz.com/"

# ── 前置检查 ──────────────────────────────────────────────────────────────────

Write-Info "========== 胡巴博客静态文件部署 (PowerShell 包装) =========="
Write-Info "dist 目录: $DistDir"
Write-Info "目标服务器: $SshHost"
Write-Info "远端路径: $RemoteDistDir"
Write-Host ""

# 检查 dist 目录是否存在
if (-not (Test-Path $DistDir -PathType Container)) {
    Exit-WithError "dist 目录不存在: $DistDir" "请先执行 Astro 构建: cd astro && npm run build" 1
}
Write-Ok "dist 目录存在: $DistDir"

# 检查 dist 目录是否包含 index.html
$IndexHtmlPath = Join-Path $DistDir "index.html"
if (-not (Test-Path $IndexHtmlPath -PathType Leaf)) {
    Exit-WithError "dist 目录中未找到 index.html: $IndexHtmlPath" "请确认 Astro 构建已成功完成，或检查 dist 目录路径是否正确" 1
}
Write-Ok "dist 目录包含 index.html"

# 检查 SSH 私钥是否存在
if (-not (Test-Path $SshKey -PathType Leaf)) {
    Exit-WithError "SSH 私钥不存在: $SshKey" "请确认私钥路径正确，或修改脚本中的 `$SshKey 变量" 1
}
Write-Ok "SSH 私钥存在: $SshKey"

# ── 检测 Git Bash 是否可用 ────────────────────────────────────────────────────

$GitBashPath = $null
$PossibleGitBashPaths = @(
    "H:\Git\bin\bash.exe",
    "C:\Program Files\Git\bin\bash.exe",
    "C:\Program Files (x86)\Git\bin\bash.exe",
    "$env:LOCALAPPDATA\Programs\Git\bin\bash.exe"
)

foreach ($Path in $PossibleGitBashPaths) {
    if (Test-Path $Path -PathType Leaf) {
        $GitBashPath = $Path
        break
    }
}

# 也尝试从 PATH 中查找
if (-not $GitBashPath) {
    try {
        $GitBashPath = (Get-Command bash.exe -ErrorAction Stop).Source
    } catch {
        # bash.exe 不在 PATH 中
    }
}

if ($GitBashPath) {
    Write-Ok "检测到 Git Bash: $GitBashPath"
    Write-Host ""
    Write-Info "========== 调用 Git Bash 执行 deploy-dist.sh =========="
    Write-Host ""

    # 转换路径为 Git Bash 格式
    $ScriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
    $DeployScript = Join-Path $ScriptDir "deploy-dist.sh"

    # 将 Windows 路径转换为 Git Bash 路径格式
    $DeployScriptBash = $DeployScript -replace '\\', '/' -replace '^([A-Za-z]):', '/$1'
    $DistDirBash = $DistDir -replace '\\', '/' -replace '^([A-Za-z]):', '/$1'

    # 设置环境变量，让 bash 脚本使用 Windows 侧密钥
    $env:SSH_KEY = $SshKey -replace '\\', '/' -replace '^([A-Za-z]):', '/$1'

    # 调用 Git Bash 执行部署脚本
    & $GitBashPath -c "bash '$DeployScriptBash' '$DistDirBash'"

    if ($LASTEXITCODE -ne 0) {
        Exit-WithError "Git Bash 部署脚本执行失败 (退出码: $LASTEXITCODE)" "请查看上方错误信息，或手动执行: bash scripts/deploy-dist.sh $DistDir" $LASTEXITCODE
    }

    Write-Host ""
    Write-Ok "Git Bash 部署脚本执行成功"
    exit 0
}

# ── Git Bash 不可用，提供 scp 兜底方案 ────────────────────────────────────────

Write-Warn "未检测到 Git Bash，将使用 scp 兜底方案"
Write-Host ""
Write-Info "========== SCP 兜底方案说明 =========="
Write-Host ""
Write-Host "Windows 原生环境没有 rsync，scp 无法实现 --delete 增量同步。" -ForegroundColor Yellow
Write-Host "使用 scp 时需要注意以下事项：" -ForegroundColor Yellow
Write-Host ""
Write-Host "1. scp 会覆盖目标文件，但不会删除远端多余文件" -ForegroundColor Yellow
Write-Host "2. 如果需要完全同步，必须手动清理远端目录（严禁删除重建！）" -ForegroundColor Yellow
Write-Host "3. 推荐安装 Git Bash 或 WSL 以获得完整的 rsync 功能" -ForegroundColor Yellow
Write-Host ""

$Confirm = Read-Host "是否继续使用 scp 方案？(y/N)"
if ($Confirm -ne 'y' -and $Confirm -ne 'Y') {
    Write-Info "已取消部署。建议安装 Git Bash 后重新运行本脚本。"
    exit 0
}

# ── SCP 兜底方案 ──────────────────────────────────────────────────────────────

Write-Host ""
Write-Info "========== 使用 SCP 上传文件 =========="
Write-Warn "注意：scp 不会删除远端多余文件，仅覆盖同名文件"
Write-Host ""

# 检查 scp 是否可用
try {
    $null = Get-Command scp.exe -ErrorAction Stop
    Write-Ok "scp 可用"
} catch {
    Exit-WithError "scp 未安装或不在 PATH 中" "Windows 10/11 可通过 设置 > 应用 > 可选功能 > 添加功能 > OpenSSH 客户端 安装" 1
}

# 检查 ssh 是否可用
try {
    $null = Get-Command ssh.exe -ErrorAction Stop
    Write-Ok "ssh 可用"
} catch {
    Exit-WithError "ssh 未安装或不在 PATH 中" "Windows 10/11 可通过 设置 > 应用 > 可选功能 > 添加功能 > OpenSSH 客户端 安装" 1
}

# 测试 SSH 连接
Write-Info "测试 SSH 连接..."
$SshTestResult = & ssh.exe -i $SshKey -p $SshPort -o ConnectTimeout=10 -o BatchMode=yes $SshHost "echo 'SSH OK'" 2>&1
if ($LASTEXITCODE -ne 0) {
    Exit-WithError "SSH 连接失败: $SshHost" "请检查: 1) 网络连通性 2) SSH 密钥是否正确 3) 服务器 SSH 服务是否运行" 1
}
Write-Ok "SSH 连接正常"

# 检查远端 Caddy 容器是否运行
Write-Info "检查远端 Caddy 容器..."
$DockerCheckResult = & ssh.exe -i $SshKey -p $SshPort $SshHost "docker ps --format '{{.Names}}' | Select-String -Pattern '^$RemoteCaddyContainer$'" 2>&1
if ($LASTEXITCODE -ne 0) {
    Exit-WithError "远端 Caddy 容器未运行: $RemoteCaddyContainer" "请先启动容器: ssh $SshHost 'cd /opt/hlydwz-blog/current && docker compose up -d'" 1
}
Write-Ok "远端 Caddy 容器运行中"

# 使用 scp 上传文件
Write-Host ""
Write-Info "开始上传文件..."
Write-Warn "scp 不会删除远端多余文件，仅覆盖同名文件"
Write-Host ""

# scp 上传所有文件（递归）
$ScpSource = Join-Path $DistDir "*"
& scp.exe -i $SshKey -P $SshPort -r $ScpSource "${SshHost}:${RemoteDistDir}/"

if ($LASTEXITCODE -ne 0) {
    Exit-WithError "scp 上传失败" "请检查网络连接和磁盘空间" 1
}

Write-Host ""
Write-Ok "文件上传完成"

# ── 远端自检 ──────────────────────────────────────────────────────────────────

Write-Host ""
Write-Info "========== 远端自检 =========="

# 自检 1: Caddy 容器内 /srv 目录非空
Write-Info "自检 1/3: 检查 Caddy 容器内 /srv 目录..."
$SrvCheckResult = & ssh.exe -i $SshKey -p $SshPort $SshHost "docker exec $RemoteCaddyContainer ls /srv" 2>&1
if ($LASTEXITCODE -ne 0 -or -not $SrvCheckResult) {
    Exit-WithError "Caddy 容器内 /srv 目录为空或无法访问" "可能 bind mount 已失效。恢复命令: ssh $SshHost 'cd /opt/hlydwz-blog/current && docker compose restart caddy'" 2
}
Write-Ok "Caddy 容器内 /srv 目录非空"

# 自检 2: 源站探活
Write-Info "自检 2/3: 源站探活 $OriginUrl ..."
$OriginCheckResult = & ssh.exe -i $SshKey -p $SshPort $SshHost "curl -sf --connect-timeout 10 '$OriginUrl' > /dev/null && echo 'OK'" 2>&1
if ($LASTEXITCODE -ne 0) {
    Exit-WithError "源站探活失败: $OriginUrl" "Caddy 可能未正确加载静态文件。恢复命令: ssh $SshHost 'cd /opt/hlydwz-blog/current && docker compose restart caddy'" 2
}
Write-Ok "源站探活正常"

# 自检 3: 外网探活
Write-Info "自检 3/3: 外网探活 $PublicUrl ..."
try {
    $Response = Invoke-WebRequest -Uri $PublicUrl -Method Head -TimeoutSec 15 -UseBasicParsing
    if ($Response.StatusCode -ne 200) {
        Exit-WithError "外网探活失败: $PublicUrl (HTTP $($Response.StatusCode))" "可能是 CDN 缓存问题或源站异常。建议: 1) 检查 ESA/CDN 缓存 2) 手动访问确认 3) 必要时回滚" 3
    }
} catch {
    Exit-WithError "外网探活失败: $PublicUrl" "可能是 CDN 缓存问题或源站异常。建议: 1) 检查 ESA/CDN 缓存 2) 手动访问确认 3) 必要时回滚" 3
}
Write-Ok "外网探活正常"

# ── 部署完成 ──────────────────────────────────────────────────────────────────

Write-Host ""
Write-Host "========================================" -ForegroundColor Green
Write-Host "  部署成功！(SCP 兜底方案)" -ForegroundColor Green
Write-Host "========================================" -ForegroundColor Green
Write-Host ""
Write-Info "部署时间: $(Get-Date -Format 'yyyy-MM-dd HH:mm:ss')"
Write-Info "dist 目录: $DistDir"
Write-Info "远端路径: ${SshHost}:${RemoteDistDir}"
Write-Host ""
Write-Warn "提醒：scp 方案不会删除远端多余文件，如需完全同步请使用 Git Bash 执行 deploy-dist.sh"
Write-Host ""
Write-Info "验证地址: $PublicUrl"
Write-Host ""

exit 0
