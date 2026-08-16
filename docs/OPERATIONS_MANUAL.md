# 胡巴博客运维手册

**版本**: v1.0  
**更新日期**: 2026年8月14日  
**适用环境**: 生产服务器 (47.115.134.238)

---

## 一、日常运维任务

### 1.1 每日任务

#### 检查服务状态
```bash
# 检查所有服务状态
docker ps
systemctl status blog-astro-ssr

# 检查服务健康状态
curl -s http://127.0.0.1:8090/api/health
curl -s http://127.0.0.1:4321/
```

#### 检查系统资源
```bash
# 检查内存使用
free -h

# 检查磁盘使用
df -h

# 检查CPU负载
uptime
```

#### 检查日志
```bash
# 查看SSR错误日志
journalctl -u blog-astro-ssr --since today | grep -i error

# 查看PocketBase错误日志
docker logs blog-pocketbase --since today | grep -i error

# 查看Caddy错误日志
docker logs blog-caddy --since today | grep -i error
```

---

### 1.2 每周任务

#### 清理日志文件
```bash
# 清理Caddy访问日志（保留最近7天）
docker exec blog-caddy find /data -name "access.log" -mtime +7 -delete

# 清理系统日志（保留最近30天）
journalctl --vacuum-time=30d
```

#### 检查备份状态
```bash
# 检查备份文件
ls -lh /opt/hlydwz-blog/backups/pb_data/

# 验证备份完整性
cd /opt/hlydwz-blog/backups/pb_data/
tar -tzf pb_data-$(date +%Y%m%d)-0330.tar.gz
```

#### 更新系统补丁
```bash
# 检查系统更新
yum check-update

# 安装安全补丁（谨慎操作）
yum update -y --security
```

---

### 1.3 每月任务

#### 更新依赖包
```bash
# 进入项目目录
cd /opt/hlydwz-blog/current

# 检查过时的包
npm outdated

# 更新依赖（测试环境先验证）
npm update
```

#### 性能分析
```bash
# 分析SSR服务器性能
journalctl -u blog-astro-ssr --since "1 month ago" | grep "response time"

# 分析数据库性能
sqlite3 /var/lib/docker/volumes/blog_pb_data/_data/data.db "SELECT * FROM _logs WHERE level='error' ORDER BY created DESC LIMIT 50;"
```

#### 安全审计
```bash
# 检查失败的登录尝试
sqlite3 /var/lib/docker/volumes/blog_pb_data/_data/data.db "SELECT * FROM _logs WHERE message LIKE '%auth%' AND level='error' ORDER BY created DESC LIMIT 20;"

# 检查异常访问
docker exec blog-caddy grep "403\|404\|500" /data/access.log | tail -50
```

---

## 二、部署流程

### 2.1 前端代码部署

#### 步骤1: 本地构建
```bash
# 进入项目目录
cd h:\开发\个人博客\astro

# 安装依赖
npm install

# 运行测试
npm run test

# 构建生产版本
npm run build
```

#### 步骤2: 打包上传

> ⚠️ **不要用 PowerShell `Compress-Archive`**：它生成的 zip 使用反斜杠路径分隔符，Linux `unzip` 无法正确解压（2026-08-16 部署时实际踩坑）。在 Git Bash 中用 `tar` 打包。

```bash
# 复制 package.json 到构建产物（SSR 运行时需要）
cp package.json dist/

# 压缩构建产物（在 Git Bash 中执行，勿用 PowerShell Compress-Archive）
tar -czf dist-deploy.tar.gz -C dist .

# 上传到服务器
scp -o IdentitiesOnly=yes -i C:\tmp\blog-ssh\blog_deploy_ed25519 dist-deploy.tar.gz root@47.115.134.238:/tmp/
```

#### 步骤3: 服务器部署
```bash
# SSH到服务器
ssh -o IdentitiesOnly=yes -i C:\tmp\blog-ssh\blog_deploy_ed25519 root@47.115.134.238

# 备份当前版本
cd /opt/hlydwz-blog/current
mv dist dist.backup.$(date +%Y%m%d_%H%M%S)

# 解压新版本
mkdir -p dist
tar -xzf /tmp/dist-deploy.tar.gz -C dist

# 复制依赖（node_modules 不打入压缩包，从旧版本继承；
# 注意：若 package.json 依赖有变更，需在 dist 内执行 npm install --omit=dev）
cp -r dist.backup.*/node_modules dist/

# 重启SSR服务
systemctl restart blog-astro-ssr

# 验证服务
sleep 5
systemctl status blog-astro-ssr
curl -s http://127.0.0.1:4321/
```

---

### 2.2 后端Hooks部署

#### 步骤1: 上传Hooks文件
```bash
# 上传修改的hooks
scp -o IdentitiesOnly=yes -i C:\tmp\blog-ssh\blog_deploy_ed25519 pb_hooks/*.pb.js root@47.115.134.238:/opt/hlydwz-blog/current/pb_hooks/
```

#### 步骤2: 重启PocketBase
```bash
# SSH到服务器
ssh -o IdentitiesOnly=yes -i C:\tmp\blog-ssh\blog_deploy_ed25519 root@47.115.134.238

# 重启PocketBase
docker restart blog-pocketbase

# 验证服务
sleep 5
docker ps --filter name=blog-pocketbase
curl -s http://127.0.0.1:8090/api/health
```

---

### 2.3 配置文件部署

#### Caddyfile更新
```bash
# 上传新配置
scp -o IdentitiesOnly=yes -i C:\tmp\blog-ssh\blog_deploy_ed25519 Caddyfile root@47.115.134.238:/opt/hlydwz-blog/current/Caddyfile

# 重启Caddy
ssh -o IdentitiesOnly=yes -i C:\tmp\blog-ssh\blog_deploy_ed25519 root@47.115.134.238 "docker restart blog-caddy"

# 验证配置
curl -s https://hlydwz.com/
```

#### 环境变量更新
```bash
# 上传新的.env文件
scp -o IdentitiesOnly=yes -i C:\tmp\blog-ssh\blog_deploy_ed25519 .env root@47.115.134.238:/opt/hlydwz-blog/current/.env

# 重启相关服务
ssh -o IdentitiesOnly=yes -i C:\tmp\blog-ssh\blog_deploy_ed25519 root@47.115.134.238 "docker restart blog-pocketbase blog-admin-auth"
```

---

## 三、监控告警

### 3.1 服务监控

#### 设置监控脚本
```bash
# 创建监控脚本
cat > /opt/hlydwz-blog/current/scripts/monitor.sh <<'EOF'
#!/bin/bash

# 检查SSR服务
if ! systemctl is-active --quiet blog-astro-ssr; then
  echo "ALERT: SSR service is down!"
  systemctl restart blog-astro-ssr
fi

# 检查PocketBase
if ! docker ps | grep -q blog-pocketbase; then
  echo "ALERT: PocketBase is down!"
  docker start blog-pocketbase
fi

# 检查Caddy
if ! docker ps | grep -q blog-caddy; then
  echo "ALERT: Caddy is down!"
  docker start blog-caddy
fi

# 检查磁盘空间
DISK_USAGE=$(df -h / | awk 'NR==2 {print $5}' | sed 's/%//')
if [ $DISK_USAGE -gt 80 ]; then
  echo "ALERT: Disk usage is ${DISK_USAGE}%"
fi

# 检查内存使用
MEM_USAGE=$(free | awk 'NR==2 {printf "%.0f", $3/$2*100}')
if [ $MEM_USAGE -gt 90 ]; then
  echo "ALERT: Memory usage is ${MEM_USAGE}%"
fi
EOF

chmod +x /opt/hlydwz-blog/current/scripts/monitor.sh
```

#### 设置定时任务
```bash
# 编辑crontab
crontab -e

# 添加监控任务（每5分钟执行一次）
*/5 * * * * /opt/hlydwz-blog/current/scripts/monitor.sh >> /var/log/blog-monitor.log 2>&1
```

---

### 3.2 日志监控

#### 实时监控错误日志
```bash
# 创建日志监控脚本
cat > /opt/hlydwz-blog/current/scripts/log-monitor.sh <<'EOF'
#!/bin/bash

# 监控SSR错误
journalctl -u blog-astro-ssr -f | grep --line-buffered "ERROR" | while read line; do
  echo "SSR ERROR: $line" | logger -t blog-monitor
done

# 监控PocketBase错误
docker logs blog-pocketbase -f | grep --line-buffered "error" | while read line; do
  echo "PB ERROR: $line" | logger -t blog-monitor
done
EOF

chmod +x /opt/hlydwz-blog/current/scripts/log-monitor.sh
```

---

## 四、备份恢复

### 4.1 数据库备份

#### 手动备份
```bash
# 备份PocketBase数据
cd /opt/hlydwz-blog/current
./scripts/backup-pb-data.sh

# 验证备份
ls -lh /opt/hlydwz-blog/backups/pb_data/
```

#### 自动备份
```bash
# 查看备份定时任务
crontab -l | grep backup

# 备份日志
tail -f /var/log/blog-backup.log
```

---

### 4.2 数据恢复

#### 恢复数据库
```bash
# 停止服务
docker stop blog-pocketbase

# 备份当前数据（以防万一）
mv /var/lib/docker/volumes/blog_pb_data/_data /var/lib/docker/volumes/blog_pb_data/_data.old

# 恢复备份
cd /opt/hlydwz-blog/backups/pb_data/
tar -xzf pb_data-20260814-0330.tar.gz -C /var/lib/docker/volumes/blog_pb_data/_data/

# 启动服务
docker start blog-pocketbase

# 验证数据
sqlite3 /var/lib/docker/volumes/blog_pb_data/_data/data.db "SELECT COUNT(*) FROM posts;"
```

---

## 五、性能优化

### 5.1 数据库优化

#### 清理过期数据
```bash
# 清理过期的限流桶
sqlite3 /var/lib/docker/volumes/blog_pb_data/_data/data.db "DELETE FROM security_rate_buckets WHERE expires_at < datetime('now');"

# 清理过期的会话
sqlite3 /var/lib/docker/volumes/blog_pb_data/_data/data.db "DELETE FROM _sessions WHERE expires < datetime('now');"

# 优化数据库
sqlite3 /var/lib/docker/volumes/blog_pb_data/_data/data.db "VACUUM;"
```

#### 分析慢查询
```bash
# 启用慢查询日志
sqlite3 /var/lib/docker/volumes/blog_pb_data/_data/data.db "PRAGMA slow_query_log = ON;"

# 查看慢查询
sqlite3 /var/lib/docker/volumes/blog_pb_data/_data/logs.db "SELECT * FROM _logs WHERE duration_ms > 1000 ORDER BY created DESC LIMIT 20;"
```

---

### 5.2 缓存优化

#### 清理ESA缓存
```bash
# 登录阿里云控制台
# ESA -> 缓存管理 -> 刷新预热
# 提交URL刷新：https://hlydwz.com/
```

#### 清理本地缓存
```bash
# 清理Astro构建缓存
cd /opt/hlydwz-blog/current
rm -rf dist/.astro

# 清理npm缓存
npm cache clean --force
```

---

## 六、安全管理

### 6.1 定期检查

#### 检查安全更新
```bash
# 检查系统安全更新
yum updateinfo list security

# 检查Docker镜像安全更新
docker images | grep -E 'pocketbase|caddy'
```

#### 检查异常登录
```bash
# 查看最近的登录日志
last -20

# 查看失败的登录尝试
lastb -20

# 查看SSH登录日志
grep "Accepted password" /var/log/secure | tail -20
```

---

### 6.2 安全加固

#### 更新SSH配置
```bash
# 编辑SSH配置
vi /etc/ssh/sshd_config

# 推荐配置
PermitRootLogin prohibit-password
PasswordAuthentication no
Port 22  # 可改为其他端口
AllowUsers root  # 限制允许的用户

# 重启SSH服务
systemctl restart sshd
```

#### 配置防火墙
```bash
# 安装firewalld
yum install firewalld -y

# 启动防火墙
systemctl start firewalld
systemctl enable firewalld

# 开放必要端口
firewall-cmd --permanent --add-port=80/tcp
firewall-cmd --permanent --add-port=443/tcp
firewall-cmd --permanent --add-port=22/tcp

# 重载配置
firewall-cmd --reload
```

---

## 七、故障恢复

### 7.1 服务故障

#### SSR服务器故障
```bash
# 查看错误日志
journalctl -u blog-astro-ssr -n 100 --no-pager

# 检查依赖
cd /opt/hlydwz-blog/current/dist
npm install --production

# 重启服务
systemctl restart blog-astro-ssr
```

#### PocketBase故障
```bash
# 查看错误日志
docker logs blog-pocketbase --tail 100

# 检查数据文件
ls -lh /var/lib/docker/volumes/blog_pb_data/_data/

# 重启服务
docker restart blog-pocketbase
```

#### Caddy故障
```bash
# 查看错误日志
docker logs blog-caddy --tail 100

# 检查配置文件
docker exec blog-caddy cat /etc/caddy/Caddyfile

# 验证配置
docker exec blog-caddy caddy validate --config /etc/caddy/Caddyfile

# 重启服务
docker restart blog-caddy
```

---

### 7.2 数据恢复

#### 从备份恢复
```bash
# 停止所有服务
systemctl stop blog-astro-ssr
docker stop blog-pocketbase blog-caddy

# 恢复数据
cd /opt/hlydwz-blog/backups/pb_data/
tar -xzf pb_data-20260814-0330.tar.gz -C /var/lib/docker/volumes/blog_pb_data/_data/

# 启动服务
docker start blog-pocketbase blog-caddy
systemctl start blog-astro-ssr

# 验证服务
curl -s https://hlydwz.com/
```

---

## 八、联系信息

**技术支持**:
- 阿里云技术支持: https://workorder.console.aliyun.com/
- 雷池技术支持: https://docs.waf-ce.chaitin.cn/

**紧急联系**:
- 服务器宕机: 阿里云控制台重启
- 数据丢失: 从备份恢复
- 安全事件: 立即断网并排查

---

**文档版本**: v1.0  
**最后更新**: 2026-08-14  
**下次审核**: 2026-09-14
