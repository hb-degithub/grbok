#!/usr/bin/env bash
# =============================================================================
# 胡巴博客 pb_data 每日自动备份脚本（服务器侧执行）
#
# 备份策略（一致性优先）：
#   宿主机 sqlite3 .backup 在线一致性备份（SQLite Online Backup API）
#   - 正确处理 WAL 模式（data.db-wal 自动合并进快照），无需停服
#   - 宿主机已有 sqlite3（3.26+），零新增依赖
#   - 无需 PocketBase super admin 凭证（避免明文凭证落脚本）
#   备份完成后将 data.db 快照 + storage/ 文件目录打包为 tar.gz
#
# 部署位置：/opt/hlydwz-blog/scripts/backup-pb-data.sh（chmod 700）
# 调度：crontab 每日 03:30（root）：
#   30 3 * * * /opt/hlydwz-blog/scripts/backup-pb-data.sh >/dev/null 2>&1
# 产物：/opt/hlydwz-blog/backups/pb_data/pb_data-YYYYMMDD-HHMM.tar.gz
# 保留：最近 14 天滚动删除
# 权限：备份目录 700，备份文件 600（含 TOTP 密钥、SMTP 密码等敏感数据）
# 日志：/opt/hlydwz-blog/backups/backup.log
#
# 约束：不重启容器、不改动 PB 运行数据；失败时退出非零码（cron 邮件可见）
# =============================================================================

set -euo pipefail

# ---------------- 配置项 ----------------
PB_VOLUME_SRC="/var/lib/docker/volumes/blog_pb_data/_data"  # PB 数据卷挂载点
BACKUP_ROOT="/opt/hlydwz-blog/backups"
BACKUP_DIR="${BACKUP_ROOT}/pb_data"
LOG_FILE="${BACKUP_ROOT}/backup.log"
RETENTION_DAYS=14          # 保留天数
LOG_MAX_LINES=5000         # 日志上限行数（防止无限增长）
STAMP="$(date +%Y%m%d-%H%M)"
ARCHIVE="${BACKUP_DIR}/pb_data-${STAMP}.tar.gz"
TMPDIR_BAK="$(mktemp -d /tmp/pb-backup.XXXXXX)"

# ---------------- 日志函数 ----------------
log() { echo "[$(date '+%Y-%m-%d %H:%M:%S')] $*" | tee -a "${LOG_FILE}"; }

# 裁剪日志，防止无限增长
trim_log() {
    if [ -f "${LOG_FILE}" ]; then
        local lines
        lines="$(wc -l < "${LOG_FILE}")"
        if [ "${lines}" -gt "${LOG_MAX_LINES}" ]; then
            tail -n "${LOG_MAX_LINES}" "${LOG_FILE}" > "${LOG_FILE}.tmp" && mv "${LOG_FILE}.tmp" "${LOG_FILE}"
            log "日志已裁剪至 ${LOG_MAX_LINES} 行"
        fi
    fi
}

# 退出清理
cleanup() {
    rm -rf "${TMPDIR_BAK}" 2>/dev/null || true
}
trap cleanup EXIT

# ---------------- 前置检查 ----------------
if [ ! -d "${PB_VOLUME_SRC}" ]; then
    echo "[$(date '+%Y-%m-%d %H:%M:%S')] [ERROR] PB 数据卷目录不存在: ${PB_VOLUME_SRC}" >> "${LOG_FILE}"
    exit 1
fi
if [ ! -f "${PB_VOLUME_SRC}/data.db" ]; then
    echo "[$(date '+%Y-%m-%d %H:%M:%S')] [ERROR] data.db 不存在于 ${PB_VOLUME_SRC}" >> "${LOG_FILE}"
    exit 1
fi
if ! command -v sqlite3 >/dev/null 2>&1; then
    echo "[$(date '+%Y-%m-%d %H:%M:%S')] [ERROR] 宿主机缺少 sqlite3" >> "${LOG_FILE}"
    exit 1
fi

# 创建备份目录并收紧权限（目录 700）
mkdir -p "${BACKUP_DIR}"
chmod 700 "${BACKUP_DIR}"

log "===== 开始备份 pb_data（${STAMP}） ====="
log "源: ${PB_VOLUME_SRC}"

# ---------------- 1. sqlite3 在线一致性备份 data.db ----------------
# .backup 使用 SQLite Online Backup API，正确处理 WAL，源库可被并发访问
if ! sqlite3 "${PB_VOLUME_SRC}/data.db" ".backup '${TMPDIR_BAK}/data.db'"; then
    log "[ERROR] sqlite3 .backup 失败，中止（保留原库不受影响）"
    exit 1
fi

# 校验快照完整性（integrity_check 返回 'ok'）
if [ "$(sqlite3 "${TMPDIR_BAK}/data.db" 'PRAGMA integrity_check;')" != "ok" ]; then
    log "[ERROR] data.db 快照完整性校验失败"
    exit 1
fi
log "data.db 在线快照完成，integrity_check=ok"

# ---------------- 2. 复制 storage/ 文件上传目录 ----------------
# storage 为文件存储（非数据库），文件级复制即可；运行中复制最多丢一个正在写的文件，可接受
if [ -d "${PB_VOLUME_SRC}/storage" ]; then
    cp -a "${PB_VOLUME_SRC}/storage" "${TMPDIR_BAK}/storage"
    log "storage/ 已复制"
fi

# 安全修复：备份归档使用 age 加密（如可用），否则回退到 chmod 600 + 目录 700
# 使用方法：在服务器上安装 age (apt install age / yum install age)，并设置环境变量
#   export BACKUP_AGE_RECIPIENT="age1..."（age 公钥）
# 如未设置 age，则仅使用文件权限保护（原有行为，但增加警告日志）
# 恢复命令：age -d -i <私钥文件> pb_data-YYYYMMDD-HHMM.tar.gz.age | tar xz -C <目标目录>
#
# 打包前校验源快照：age 加密后无法 tar tzf 抽查包内容，
# 空包/截断包要到恢复时才会暴露，故必须在加密前确认源数据完好。
if [ ! -s "${TMPDIR_BAK}/data.db" ]; then
    log "[ERROR] data.db 快照不存在或为空，终止备份"
    exit 1
fi
if [ "$(sqlite3 "${TMPDIR_BAK}/data.db" 'PRAGMA quick_check;')" != "ok" ]; then
    log "[ERROR] data.db 快照 quick_check 失败，终止备份"
    exit 1
fi

if command -v age >/dev/null 2>&1 && [ -n "${BACKUP_AGE_RECIPIENT:-}" ]; then
    if ! tar czf - -C "${TMPDIR_BAK}" . | age -r "${BACKUP_AGE_RECIPIENT}" -o "${ARCHIVE}.age"; then
        log "[ERROR] tar + age 加密打包失败"
        rm -f "${ARCHIVE}.age"
        exit 1
    fi
    chmod 600 "${ARCHIVE}.age"
    log "已生成加密备份: ${ARCHIVE}.age ($(du -h "${ARCHIVE}.age" | cut -f1))"
    # 更新 ARCHIVE 变量指向加密文件，供后续完整性检查使用
    ARCHIVE="${ARCHIVE}.age"
else
    if ! tar czf "${ARCHIVE}" -C "${TMPDIR_BAK}" .; then
        log "[ERROR] tar 打包失败"
        rm -f "${ARCHIVE}"
        exit 1
    fi
    chmod 600 "${ARCHIVE}"   # 收紧文件权限（含 TOTP 密钥、SMTP 密码等敏感数据）
    log "已生成: ${ARCHIVE} ($(du -h "${ARCHIVE}" | cut -f1))"
    log "[WARN] 备份未加密，仅依赖文件权限保护。建议安装 age 并设置 BACKUP_AGE_RECIPIENT 启用加密。"
fi

# 抽查包内包含 data.db（防止空包/损坏包未被发现）
# 注意：勿用 grep -q —— 在 set -o pipefail 下匹配后立即退出会使 tar 收
# SIGPIPE 退出 141，管道被 pipefail 判为非零，误判"缺少 data.db"。
# 加密备份无法直接抽查，跳过此检查（age 解密需要私钥，备份脚本不应持有）
if [[ "${ARCHIVE}" != *.age ]]; then
    DB_CNT="$(tar tzf "${ARCHIVE}" | grep -c '\./data\.db$' || true)"
    if [ "${DB_CNT}" -eq 0 ]; then
        log "[ERROR] 备份包缺少 data.db，标记失败并删除"
        rm -f "${ARCHIVE}"
        exit 1
    fi
else
    log "加密备份跳过包内文件抽查（需私钥解密）"
fi

# ---------------- 4. 滚动删除超过保留期的旧备份 ----------------
DELETED_COUNT="$(find "${BACKUP_DIR}" -maxdepth 1 \( -name 'pb_data-*.tar.gz' -o -name 'pb_data-*.tar.gz.age' \) -mtime "+${RETENTION_DAYS}" | wc -l)"
if [ "${DELETED_COUNT}" -gt 0 ]; then
    find "${BACKUP_DIR}" -maxdepth 1 \( -name 'pb_data-*.tar.gz' -o -name 'pb_data-*.tar.gz.age' \) -mtime "+${RETENTION_DAYS}" -delete
    log "已删除 ${DELETED_COUNT} 个超过 ${RETENTION_DAYS} 天的旧备份"
fi

log "===== 备份完成（${STAMP}），当前保留: $(find "${BACKUP_DIR}" -maxdepth 1 \( -name 'pb_data-*.tar.gz' -o -name 'pb_data-*.tar.gz.age' \) | wc -l) 份 ====="
trim_log
exit 0
