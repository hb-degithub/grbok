# pb_data 备份与恢复手册

> 适用范围：生产服务器 `root@47.115.134.238`（博客容器 `blog-pocketbase`）
> 最后更新：2026-08-05

## 1. 备份概览

| 项 | 说明 |
|---|---|
| 备份脚本 | `/opt/hlydwz-blog/scripts/backup-pb-data.sh`（仓库 `scripts/backup-pb-data.sh`） |
| 备份目录 | `/opt/hlydwz-blog/backups/pb_data/` |
| 备份文件 | `pb_data-YYYYMMDD-HHMM.tar.gz` |
| 调度 | root crontab 每日 `03:30` |
| 保留策略 | 最近 **14 天** 滚动删除 |
| 日志 | `/opt/hlydwz-blog/backups/backup.log`（上限 5000 行自动裁剪） |

### 备份内容
- `data.db`：PocketBase 主数据库（SQLite，**一致性快照**，由宿主机 `sqlite3 .backup` 在线备份生成，正确处理 WAL）
- `storage/`：PocketBase 文件上传目录（原样复制）

### 备份方式说明（为何采用此方案）
- 宿主机已有 `sqlite3`，其 `.backup` 命令使用 SQLite Online Backup API，对 WAL 模式数据库可安全在线备份，**无需停止 PocketBase**，一致性有保证。
- PB 0.22 容器（Alpine）内**无 sqlite3**，故不采用容器内备份。
- 备选方案（PB Admin API `POST /api/backups`）需要 super admin 凭证，存在明文凭证落脚本的风险，未采用。

## 2. 手动执行备份

```bash
# 服务器上手动执行（root）
/opt/hlydwz-blog/scripts/backup-pb-data.sh
# 校验：退出码 0 且 backup.log 出现 "备份完成"
tail -5 /opt/hlydwz-blog/backups/backup.log
```

## 3. 恢复步骤

> **重要**：恢复前请先确认目标 PB 版本与备份来源版本一致（`docker exec blog-pocketbase pocketbase --version`），避免迁移不兼容。

### 3.1 恢复到容器内（常规恢复）

```bash
# 1) 找到要恢复的备份文件
ls -lt /opt/hlydwz-blog/backups/pb_data/pb_data-*.tar.gz

# 2) 【必须】停止 PocketBase 容器（SQLite 库被占用时恢复会产生损坏）
docker stop blog-pocketbase

# 3) 备份当前坏数据（保险）
mkdir -p /opt/hlydwz-blog/backups/pre-restore-$(date +%Y%m%d-%H%M)
cp -a /var/lib/docker/volumes/blog_pb_data/_data/. /opt/hlydwz-blog/backups/pre-restore-$(date +%Y%m%d-%H%M)/

# 4) 清空数据卷目录（只清 data，保留目录本身）
rm -rf /var/lib/docker/volumes/blog_pb_data/_data/*
#    注：此目录是容器 mount 点，删除内容不影响卷定义

# 5) 解压备份到数据卷
tar xzf /opt/hlydwz-blog/backups/pb_data/pb_data-20260726-030000.tar.gz \
  -C /var/lib/docker/volumes/blog_pb_data/_data/

# 6) 权限校正（PocketBase 以非 root 运行，文件归属需一致）
chown -R 1000:1000 /var/lib/docker/volumes/blog_pb_data/_data 2>/dev/null || true

# 7) 启动容器
docker start blog-pocketbase

# 8) 验证恢复结果（见第 4 节）
```

### 3.2 恢复到本地开发环境（测试/演练）

```bash
# 本机拉取备份（PowerShell，Windows）
scp -i C:\tmp\blog-ssh\blog_deploy_ed25519 -o IdentitiesOnly=yes \
  root@47.115.134.238:/opt/hlydwz-blog/backups/pb_data/pb_data-20260726-030000.tar.gz .

# 解压到本地 pb_local 数据目录后启动本地 PB（参照仓库 start-local.bat / docker-compose.local.yml）
tar xzf pb_data-20260726-030000.tar.gz -C ./pb_local/pb_data/
```

## 4. 恢复后验证清单

- [ ] `docker ps` 显示 `blog-pocketbase` 为 `healthy`
- [ ] 后台可登录：`https://hlydwz.com/_/`（用备份时的 super admin 凭证）
- [ ] 抽查文章列表、评论、统计接口返回正常（`curl https://hlydwz.com/api/health` 返回 200）
- [ ] `storage/` 内图片可访问（备份文件上传目录）
- [ ] 查看 PB 日志无迁移失败：`docker logs blog-pocketbase --since 10m | grep -iE 'error|migration'`

## 5. 注意事项

1. **恢复前必须停止容器**：SQLite 在 WAL 模式下被占用时写入会失败，切勿热恢复。
2. **版本核对**：PB 升级后 `data.db` 可能已迁移到新 schema，用旧备份恢复到新版本前先测试（本地演练），必要时先跑迁移。
3. **凭证一致性**：备份包含 TOTP 密钥、SMTP 密码等加密数据，`PB_ENCRYPTION_KEY`（`.env`）**必须与备份时的值一致**，否则恢复后加密数据无法解密。
4. **权限敏感**：备份文件含敏感数据，保持 `600` 权限；备份目录 `700`。
5. **恢复前先备份坏数据**（3.1 第 3 步），恢复失败可回退。
6. **不要同时恢复多个时间点**：只选一个备份作为权威恢复源。

## 6. 故障排查

| 症状 | 排查 |
|---|---|
| 备份脚本退出非零 | 查看 `backup.log` 末尾 `[ERROR]` 行 |
| 备份包缺 data.db | 脚本已内置检查，失败会自动删除坏包；检查卷路径是否正确 |
| 恢复后 PB 起不来 | `docker logs blog-pocketbase --tail 50`；多半是权限或版本问题 |
| 恢复后数据不完整 | 确认解压覆盖了 `data.db` 与 `storage/`，且未残留旧的 `data.db-wal`（恢复前应删除） |

> 残留的 `data.db-wal`/`data.db-shm` 可能被 SQLite 复用导致数据混乱，恢复时若目标目录存在这两个文件务必一并删除。
