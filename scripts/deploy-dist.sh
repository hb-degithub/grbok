#!/usr/bin/env bash
# ==============================================================================
# deploy-dist.sh — 胡巴博客静态文件标准化部署脚本
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
#   bash scripts/deploy-dist.sh [dist目录路径]
#   bash scripts/deploy-dist.sh ./astro/dist
#
# 环境要求：
#   - bash (Git Bash / WSL / Linux 均可)
#   - rsync (本地 + 远端服务器均需安装)
#   - ssh 密钥认证已配置
#   - curl (用于远端自检)
# ==============================================================================

set -euo pipefail

# ── 可配置变量 ────────────────────────────────────────────────────────────────

# SSH 连接信息
SSH_HOST="root@47.115.134.238"
SSH_PORT="22"

# SSH 私钥路径
# Windows (Git Bash): 指向 Windows 侧私钥文件
#   示例: /c/tmp/blog-ssh/blog_deploy_ed25519
#   对应 Windows 路径: C:\tmp\blog-ssh\blog_deploy_ed25519
# Linux/WSL: 指向 Linux 侧私钥文件
#   示例: /root/.ssh/blog_deploy_ed25519 或 ~/.ssh/blog_deploy_ed25519
# 注意: 确保私钥权限为 600 (chmod 600)
SSH_KEY="${SSH_KEY:-/c/tmp/blog-ssh/blog_deploy_ed25519}"

# 远端部署路径（Caddy bind mount 的宿主机侧）
REMOTE_DIST_DIR="/opt/hlydwz-blog/current/astro/dist"

# 远端 Caddy 容器名称
REMOTE_CADDY_CONTAINER="blog-caddy"

# 源站探活地址（Caddy 容器映射到宿主机的端口）
ORIGIN_URL="http://127.0.0.1:18080/"

# 外网探活地址（注意：hlydwz.com 前台页面需尾随斜杠）
PUBLIC_URL="https://hlydwz.com/"

# 本地 dist 目录（默认 ./astro/dist，可通过第一个参数覆盖）
DIST_DIR="${1:-./astro/dist}"

# ── 颜色输出 ──────────────────────────────────────────────────────────────────
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

info()  { echo -e "${BLUE}[INFO]${NC} $*"; }
ok()    { echo -e "${GREEN}[OK]${NC} $*"; }
warn()  { echo -e "${YELLOW}[WARN]${NC} $*"; }
error() { echo -e "${RED}[ERROR]${NC} $*" >&2; }

die() {
    error "$1"
    if [[ -n "${2:-}" ]]; then
        echo ""
        echo -e "${YELLOW}恢复建议:${NC} $2" >&2
    fi
    exit "${3:-1}"
}

# ── 前置检查 ──────────────────────────────────────────────────────────────────

info "========== 胡巴博客静态文件部署 =========="
info "dist 目录: $DIST_DIR"
info "目标服务器: $SSH_HOST"
info "远端路径: $REMOTE_DIST_DIR"
echo ""

# 检查 dist 目录是否存在
if [[ ! -d "$DIST_DIR" ]]; then
    die "dist 目录不存在: $DIST_DIR" \
        "请先执行 Astro 构建: cd astro && npm run build" 1
fi
ok "dist 目录存在: $DIST_DIR"

# 检查 dist 目录是否包含 index.html
if [[ ! -f "$DIST_DIR/index.html" ]]; then
    die "dist 目录中未找到 index.html: $DIST_DIR/index.html" \
        "请确认 Astro 构建已成功完成，或检查 dist 目录路径是否正确" 1
fi
ok "dist 目录包含 index.html"

# 检查 rsync 是否可用
if ! command -v rsync &>/dev/null; then
    die "rsync 未安装或不在 PATH 中" \
        "Windows: 安装 Git Bash 或 WSL 后使用；Linux: apt/yum install rsync" 1
fi
ok "rsync 可用: $(rsync --version | head -1)"

# 检查 ssh 是否可用
if ! command -v ssh &>/dev/null; then
    die "ssh 未安装或不在 PATH 中" \
        "Windows: 安装 Git Bash 或 OpenSSH；Linux: apt/yum install openssh-client" 1
fi
ok "ssh 可用"

# 检查 SSH 私钥是否存在
if [[ ! -f "$SSH_KEY" ]]; then
    die "SSH 私钥不存在: $SSH_KEY" \
        "请确认私钥路径正确。Windows Git Bash 示例: /c/tmp/blog-ssh/blog_deploy_ed25519；Linux 示例: ~/.ssh/blog_deploy_ed25519" 1
fi
ok "SSH 私钥存在: $SSH_KEY"

# 检查私钥权限（仅 Unix-like 系统）
if [[ "$(uname -s)" != MINGW* ]] && [[ "$(uname -s)" != MSYS* ]] && [[ "$(uname -s)" != CYGWIN* ]]; then
    KEY_PERM=$(stat -c '%a' "$SSH_KEY" 2>/dev/null || stat -f '%OLp' "$SSH_KEY" 2>/dev/null || echo "unknown")
    if [[ "$KEY_PERM" != "600" ]] && [[ "$KEY_PERM" != "400" ]]; then
        warn "SSH 私钥权限为 $KEY_PERM，建议设置为 600: chmod 600 $SSH_KEY"
    fi
fi

# ── SSH 连接测试 ──────────────────────────────────────────────────────────────

info "测试 SSH 连接..."
if ! ssh -i "$SSH_KEY" -p "$SSH_PORT" -o ConnectTimeout=10 -o BatchMode=yes "$SSH_HOST" "echo 'SSH OK'" &>/dev/null; then
    die "SSH 连接失败: $SSH_HOST" \
        "请检查: 1) 网络连通性 2) SSH 密钥是否正确 3) 服务器 SSH 服务是否运行 4) 防火墙/安全组是否放行" 1
fi
ok "SSH 连接正常"

# ── 远端环境检查 ──────────────────────────────────────────────────────────────

info "检查远端环境..."

# 检查远端 rsync
if ! ssh -i "$SSH_KEY" -p "$SSH_PORT" "$SSH_HOST" "command -v rsync" &>/dev/null; then
    die "远端服务器未安装 rsync" \
        "请在服务器上执行: apt install rsync (Debian/Ubuntu) 或 yum install rsync (CentOS/RHEL)" 1
fi
ok "远端 rsync 可用"

# 检查远端 dist 目录是否存在
if ! ssh -i "$SSH_KEY" -p "$SSH_PORT" "$SSH_HOST" "[[ -d $REMOTE_DIST_DIR ]]" &>/dev/null; then
    die "远端 dist 目录不存在: $REMOTE_DIST_DIR" \
        "请先在服务器上创建目录: mkdir -p $REMOTE_DIST_DIR" 1
fi
ok "远端 dist 目录存在"

# 检查远端 Caddy 容器是否运行
if ! ssh -i "$SSH_KEY" -p "$SSH_PORT" "$SSH_HOST" "docker ps --format '{{.Names}}' | grep -q '^${REMOTE_CADDY_CONTAINER}$'" &>/dev/null; then
    die "远端 Caddy 容器未运行: $REMOTE_CADDY_CONTAINER" \
        "请先启动容器: cd /opt/hlydwz-blog/current && docker compose up -d" 1
fi
ok "远端 Caddy 容器运行中"

# ── 执行 rsync 原地同步 ───────────────────────────────────────────────────────

echo ""
info "========== 开始 rsync 原地同步 =========="
info "本地: $DIST_DIR/"
info "远端: $SSH_HOST:$REMOTE_DIST_DIR/"
echo ""

# rsync 参数说明:
#   -a          归档模式（递归、保留权限、时间戳等）
#   --delete    删除远端多余文件（保持与本地一致）
#   -v          详细输出
#   -z          传输时压缩
#   --progress  显示进度
#   -e          指定 SSH 命令（含密钥和端口）
#
# 关键: 使用 <dist>/ 源路径末尾带斜杠，表示同步目录内容而非目录本身，
#       确保远端目录 inode 不变，bind mount 保持有效。
RSYNC_OPTS="-avz --delete --progress"
SSH_CMD="ssh -i $SSH_KEY -p $SSH_PORT -o StrictHostKeyChecking=accept-new"

# 执行 rsync
if ! rsync $RSYNC_OPTS -e "$SSH_CMD" "$DIST_DIR/" "$SSH_HOST:$REMOTE_DIST_DIR/"; then
    die "rsync 同步失败" \
        "请检查网络连接和磁盘空间。可尝试手动执行: rsync $RSYNC_OPTS -e \"$SSH_CMD\" \"$DIST_DIR/\" \"$SSH_HOST:$REMOTE_DIST_DIR/\"" 1
fi

echo ""
ok "rsync 同步完成"

# ── 远端自检 ──────────────────────────────────────────────────────────────────

echo ""
info "========== 远端自检 =========="

# 自检 1: Caddy 容器内 /srv 目录非空
info "自检 1/3: 检查 Caddy 容器内 /srv 目录..."
if ! ssh -i "$SSH_KEY" -p "$SSH_PORT" "$SSH_HOST" "docker exec $REMOTE_CADDY_CONTAINER ls /srv | grep -q ." &>/dev/null; then
    die "Caddy 容器内 /srv 目录为空或无法访问" \
        "可能 bind mount 已失效。恢复命令: ssh $SSH_HOST 'cd /opt/hlydwz-blog/current && docker compose restart caddy'" 2
fi
ok "Caddy 容器内 /srv 目录非空"

# 自检 2: 源站探活（Caddy 容器映射到宿主机的端口）
info "自检 2/3: 源站探活 $ORIGIN_URL ..."
if ! ssh -i "$SSH_KEY" -p "$SSH_PORT" "$SSH_HOST" "curl -sf --connect-timeout 10 '$ORIGIN_URL' > /dev/null" &>/dev/null; then
    die "源站探活失败: $ORIGIN_URL" \
        "Caddy 可能未正确加载静态文件。恢复命令: ssh $SSH_HOST 'cd /opt/hlydwz-blog/current && docker compose restart caddy'" 2
fi
ok "源站探活正常"

# 自检 3: 外网探活（注意尾随斜杠）
info "自检 3/3: 外网探活 $PUBLIC_URL ..."
if ! curl -sf --connect-timeout 15 "$PUBLIC_URL" > /dev/null 2>&1; then
    die "外网探活失败: $PUBLIC_URL" \
        "可能是 CDN 缓存问题或源站异常。建议: 1) 检查 ESA/CDN 缓存 2) 手动访问 $PUBLIC_URL 确认 3) 必要时回滚: 重新部署上一版本 dist" 3
fi
ok "外网探活正常"

# ── ESA 缓存自动刷新 ──────────────────────────────────────────────────────────

echo ""
info "========== ESA 缓存刷新 =========="

# 使用阿里云 CLI 直接调用 ESA 刷新 API（全站刷新）
# 需要服务器上已配置阿里云 CLI 凭据（aliyun configure）
ESA_REFRESH_RESULT=$(ssh -i "$SSH_KEY" -p "$SSH_PORT" "$SSH_HOST" bash -s <<'ESA_EOF'
# 检查阿里云 CLI 是否可用
if ! command -v aliyun &>/dev/null; then
    echo "NO_CLI"
    exit 0
fi

# 检查 ESA 配置是否存在
if [[ ! -f /root/.aliyun/config.json ]]; then
    echo "NO_CONFIG"
    exit 0
fi

# 调用 ESA 全站刷新
RESULT=$(aliyun esa PurgeCaches --Type purgeall --SiteId "${ESA_SITE_ID:-0}" 2>&1)
if [[ $? -eq 0 ]]; then
    echo "ESA_PURGE_OK"
else
    # 如果 SiteId 未配置，尝试从配置读取
    SITE_ID=$(grep -o '"SiteId"[^,}]*' /root/.aliyun/config.json 2>/dev/null | head -1 | cut -d: -f2 | tr -d ' "')
    if [[ -n "$SITE_ID" && "$SITE_ID" != "0" ]]; then
        RESULT=$(aliyun esa PurgeCaches --Type purgeall --SiteId "$SITE_ID" 2>&1)
        if [[ $? -eq 0 ]]; then
            echo "ESA_PURGE_OK"
        else
            echo "ESA_PURGE_FAILED: $RESULT"
        fi
    else
        echo "NO_SITE_ID"
    fi
fi
ESA_EOF
)

case "$ESA_REFRESH_RESULT" in
    ESA_PURGE_OK)
        ok "ESA 缓存已自动刷新"
        ;;
    NO_CLI)
        warn "阿里云 CLI 未安装，跳过 ESA 缓存刷新"
        ;;
    NO_CONFIG)
        warn "阿里云 CLI 未配置凭据，跳过 ESA 缓存刷新"
        info "  配置方法: ssh $SSH_HOST 'aliyun configure'"
        ;;
    NO_SITE_ID)
        warn "ESA SiteId 未配置，跳过缓存刷新"
        info "  配置方法: 在服务器上设置环境变量 ESA_SITE_ID 或编辑 /root/.aliyun/config.json"
        ;;
    ESA_PURGE_FAILED:*)
        warn "ESA 缓存刷新失败: ${ESA_REFRESH_RESULT#ESA_PURGE_FAILED: }"
        ;;
    *)
        warn "ESA 缓存刷新状态未知: $ESA_REFRESH_RESULT"
        ;;
esac

# ── 部署完成 ──────────────────────────────────────────────────────────────────

echo ""
echo -e "${GREEN}========================================${NC}"
echo -e "${GREEN}  部署成功！${NC}"
echo -e "${GREEN}========================================${NC}"
echo ""
info "部署时间: $(date '+%Y-%m-%d %H:%M:%S')"
info "dist 目录: $DIST_DIR"
info "远端路径: $SSH_HOST:$REMOTE_DIST_DIR"
echo ""
info "验证地址: $PUBLIC_URL"
echo ""

exit 0
