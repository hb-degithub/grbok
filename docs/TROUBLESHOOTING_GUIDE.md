# 胡巴博客故障排查指南

**版本**: v1.0  
**更新日期**: 2026年8月14日  
**适用环境**: 生产服务器 (47.115.134.238)

---

## 一、快速诊断流程

### 1.1 网站无法访问

```
用户报告: 网站无法访问
    ↓
检查1: 服务是否运行
    ├─→ docker ps
    ├─→ systemctl status blog-astro-ssr
    └─→ netstat -tlnp | grep LISTEN
    ↓
检查2: 端口是否监听
    ├─→ 80 (雷池WAF)
    ├─→ 18080 (Caddy)
    ├─→ 4321 (SSR)
    └─→ 8090 (PocketBase)
    ↓
检查3: 日志是否有错误
    ├─→ journalctl -u blog-astro-ssr -n 50
    ├─→ docker logs blog-caddy --tail 50
    └─→ docker logs blog-pocketbase --tail 50
    ↓
检查4: 系统资源是否充足
    ├─→ free -h (内存)
    ├─→ df -h (磁盘)
    └─→ top (CPU)
```

---

## 二、常见故障与解决方案

### 2.1 SSR服务器故障

#### 故障1: SSR服务器无法启动

**症状**:
```bash
systemctl status blog-astro-ssr
# Active: failed (Result: exit-code)
```

**可能原因**:
1. Node.js依赖未安装
2. 端口被占用
3. 配置文件错误
4. 内存不足

**排查步骤**:
```bash
# 1. 查看详细错误日志
journalctl -u blog-astro-ssr -n 100 --no-pager

# 2. 检查端口占用
netstat -tlnp | grep 4321

# 3. 检查依赖是否安装
ls -la /opt/hlydwz-blog/current/dist/node_modules

# 4. 手动启动测试
cd /opt/hlydwz-blog/current/dist
node server/entry.mjs
```

**解决方案**:
```bash
# 方案1: 重新安装依赖
cd /opt/hlydwz-blog/current/dist
npm install --production --legacy-peer-deps

# 方案2: 杀死占用端口的进程
lsof -ti:4321 | xargs kill -9

# 方案3: 检查并修复配置文件
cat /etc/systemd/system/blog-astro-ssr.service

# 方案4: 重启服务器（最后手段）
reboot
```

---

#### 故障2: SSR服务器返回500错误

**症状**:
```
访问 https://hlydwz.com/posts/xxx 返回 500 Internal Server Error
```

**可能原因**:
1. PocketBase连接失败
2. 数据库查询错误
3. 代码bug

**排查步骤**:
```bash
# 1. 查看SSR错误日志
journalctl -u blog-astro-ssr -n 50 --no-pager | grep -i error

# 2. 检查PocketBase连接
curl -s http://127.0.0.1:8090/api/health

# 3. 测试数据库查询
sqlite3 /var/lib/docker/volumes/blog_pb_data/_data/data.db "SELECT COUNT(*) FROM posts;"

# 4. 查看PocketBase日志
docker logs blog-pocketbase --tail 50
```

**解决方案**:
```bash
# 方案1: 重启PocketBase
docker restart blog-pocketbase

# 方案2: 检查数据库文件权限
ls -la /var/lib/docker/volumes/blog_pb_data/_data/

# 方案3: 修复数据库
sqlite3 /var/lib/docker/volumes/blog_pb_data/_data/data.db "PRAGMA integrity_check;"

# 方案4: 从备份恢复
# 参考"数据恢复"章节
```

---

### 2.2 PocketBase故障

#### 故障3: PocketBase无法启动

**症状**:
```bash
docker ps | grep blog-pocketbase
# 容器不存在或状态为 Exited
```

**可能原因**:
1. 数据文件损坏
2. 端口被占用
3. 环境变量错误
4. 磁盘空间不足

**排查步骤**:
```bash
# 1. 查看容器日志
docker logs blog-pocketbase --tail 100

# 2. 检查数据文件
ls -lh /var/lib/docker/volumes/blog_pb_data/_data/

# 3. 检查端口占用
netstat -tlnp | grep 8090

# 4. 检查磁盘空间
df -h
```

**解决方案**:
```bash
# 方案1: 重启容器
docker restart blog-pocketbase

# 方案2: 检查数据文件权限
chown -R root:root /var/lib/docker/volumes/blog_pb_data/_data/

# 方案3: 修复数据库
sqlite3 /var/lib/docker/volumes/blog_pb_data/_data/data.db "PRAGMA integrity_check;"

# 方案4: 从备份恢复
docker stop blog-pocketbase
cd /opt/hlydwz-blog/backups/pb_data/
tar -xzf pb_data-20260814-0330.tar.gz -C /var/lib/docker/volumes/blog_pb_data/_data/
docker start blog-pocketbase
```

---

#### 故障4: PocketBase返回503错误

**症状**:
```
访问 https://hlydwz.com/api/xxx 返回 503 Service Unavailable
```

**可能原因**:
1. 限流策略缺失
2. 数据库锁定
3. 内存不足

**排查步骤**:
```bash
# 1. 检查限流策略
sqlite3 /var/lib/docker/volumes/blog_pb_data/_data/data.db "SELECT COUNT(*) FROM security_rate_policies;"

# 2. 检查数据库锁定
sqlite3 /var/lib/docker/volumes/blog_pb_data/_data/data.db "PRAGMA lock_status;"

# 3. 检查内存使用
free -h
```

**解决方案**:
```bash
# 方案1: 添加缺失的限流策略
# 参考"限流策略修复"章节

# 方案2: 重启PocketBase
docker restart blog-pocketbase

# 方案3: 清理内存
sync && echo 3 > /proc/sys/vm/drop_caches
```

---

### 2.3 Caddy故障

#### 故障5: Caddy返回502错误

**症状**:
```
访问 https://hlydwz.com 返回 502 Bad Gateway
```

**可能原因**:
1. SSR服务器未运行
2. Caddy配置错误
3. 网络连接问题

**排查步骤**:
```bash
# 1. 检查SSR服务器状态
systemctl status blog-astro-ssr

# 2. 测试SSR服务器
curl -v http://127.0.0.1:4321/

# 3. 检查Caddy配置
docker exec blog-caddy cat /etc/caddy/Caddyfile

# 4. 查看Caddy日志
docker logs blog-caddy --tail 50
```

**解决方案**:
```bash
# 方案1: 重启SSR服务器
systemctl restart blog-astro-ssr

# 方案2: 检查Caddy配置
docker exec blog-caddy caddy validate --config /etc/caddy/Caddyfile

# 方案3: 重启Caddy
docker restart blog-caddy

# 方案4: 检查网络连接
docker exec blog-caddy ping 10.255.0.1
```

---

#### 故障6: Caddy返回404错误

**症状**:
```
访问 https://hlydwz.com/posts/xxx 返回 404 Not Found
```

**可能原因**:
1. 文章不存在
2. 文章未发布
3. SSR路由配置错误

**排查步骤**:
```bash
# 1. 检查文章是否存在
sqlite3 /var/lib/docker/volumes/blog_pb_data/_data/data.db "SELECT * FROM posts WHERE slug='your-slug';"

# 2. 检查文章状态
sqlite3 /var/lib/docker/volumes/blog_pb_data/_data/data.db "SELECT slug, status FROM posts;"

# 3. 测试SSR服务器
curl -v http://127.0.0.1:4321/posts/your-slug

# 4. 检查Caddy配置
docker exec blog-caddy cat /etc/caddy/Caddyfile | grep -A 10 "ssr_pages"
```

**解决方案**:
```bash
# 方案1: 检查文章状态
sqlite3 /var/lib/docker/volumes/blog_pb_data/_data/data.db "UPDATE posts SET status='published' WHERE slug='your-slug';"

# 方案2: 重启SSR服务器
systemctl restart blog-astro-ssr

# 方案3: 检查Caddy配置
# 确保SSR路由配置正确
```

---

### 2.4 数据库故障

#### 故障7: 数据库锁定

**症状**:
```
PocketBase返回 "database is locked" 错误
```

**可能原因**:
1. 多个进程同时写入
2. 事务未提交
3. 数据库文件损坏

**排查步骤**:
```bash
# 1. 检查数据库锁定状态
sqlite3 /var/lib/docker/volumes/blog_pb_data/_data/data.db "PRAGMA lock_status;"

# 2. 检查WAL文件
ls -lh /var/lib/docker/volumes/blog_pb_data/_data/*.wal

# 3. 检查进程
lsof /var/lib/docker/volumes/blog_pb_data/_data/data.db
```

**解决方案**:
```bash
# 方案1: 重启PocketBase
docker restart blog-pocketbase

# 方案2: 检查并修复数据库
sqlite3 /var/lib/docker/volumes/blog_pb_data/_data/data.db "PRAGMA integrity_check;"

# 方案3: 从备份恢复
# 参考"数据恢复"章节
```

---

#### 故障8: 数据库损坏

**症状**:
```
PocketBase返回 "database disk image is malformed" 错误
```

**可能原因**:
1. 磁盘故障
2. 意外断电
3. 文件系统错误

**排查步骤**:
```bash
# 1. 检查数据库完整性
sqlite3 /var/lib/docker/volumes/blog_pb_data/_data/data.db "PRAGMA integrity_check;"

# 2. 检查磁盘错误
dmesg | grep -i error

# 3. 检查文件系统
fsck /dev/vda3
```

**解决方案**:
```bash
# 方案1: 尝试修复数据库
sqlite3 /var/lib/docker/volumes/blog_pb_data/_data/data.db ".recover" | sqlite3 /tmp/recovered.db

# 方案2: 从备份恢复
docker stop blog-pocketbase
cd /opt/hlydwz-blog/backups/pb_data/
tar -xzf pb_data-20260814-0330.tar.gz -C /var/lib/docker/volumes/blog_pb_data/_data/
docker start blog-pocketbase

# 方案3: 检查磁盘
# 联系阿里云技术支持
```

---

### 2.5 网络故障

#### 故障9: 无法连接到服务器

**症状**:
```
SSH连接超时或拒绝
```

**可能原因**:
1. 服务器宕机
2. 网络故障
3. 防火墙阻止
4. SSH服务未运行

**排查步骤**:
```bash
# 1. 检查服务器状态（阿里云控制台）
# 登录阿里云ECS控制台查看实例状态

# 2. 检查网络连接
ping 47.115.134.238

# 3. 检查SSH端口
telnet 47.115.134.238 22

# 4. 检查防火墙（阿里云安全组）
# 登录阿里云控制台检查安全组规则
```

**解决方案**:
```bash
# 方案1: 重启服务器（阿里云控制台）

# 方案2: 检查安全组规则
# 确保22端口开放

# 方案3: 使用VNC登录（阿里云控制台）
# 检查SSH服务状态
systemctl status sshd
```

---

#### 故障10: 域名无法解析

**症状**:
```
访问 https://hlydwz.com 提示 "无法访问此网站"
```

**可能原因**:
1. DNS解析失败
2. ESA配置错误
3. 证书过期

**排查步骤**:
```bash
# 1. 检查DNS解析
nslookup hlydwz.com

# 2. 检查ESA配置
# 登录阿里云ESA控制台

# 3. 检查证书状态
echo | openssl s_client -connect hlydwz.com:443 -servername hlydwz.com 2>/dev/null | openssl x509 -noout -dates
```

**解决方案**:
```bash
# 方案1: 检查DNS配置
# 登录阿里云DNS控制台

# 方案2: 检查ESA配置
# 登录阿里云ESA控制台

# 方案3: 更新证书
# ESA自动管理证书
```

---

## 三、紧急恢复流程

### 3.1 完整系统恢复

**适用场景**: 服务器完全故障，需要从备份恢复

**恢复步骤**:

```bash
# 1. 停止所有服务
systemctl stop blog-astro-ssr
docker stop blog-pocketbase blog-caddy blog-admin-auth

# 2. 备份当前数据（以防万一）
mv /opt/hlydwz-blog/current /opt/hlydwz-blog/current.broken.$(date +%Y%m%d_%H%M%S)

# 3. 从备份恢复
cd /opt/hlydwz-blog/backups/
tar -xzf pb_data-20260814-0330.tar.gz -C /var/lib/docker/volumes/blog_pb_data/_data/

# 4. 恢复代码
# 从Git仓库或本地备份恢复代码到 /opt/hlydwz-blog/current/

# 5. 安装依赖
cd /opt/hlydwz-blog/current/dist
npm install --production --legacy-peer-deps

# 6. 启动服务
docker start blog-pocketbase blog-caddy blog-admin-auth
systemctl start blog-astro-ssr

# 7. 验证服务
curl -s https://hlydwz.com/
docker ps
systemctl status blog-astro-ssr
```

---

### 3.2 数据库恢复

**适用场景**: 数据库损坏，需要从备份恢复

**恢复步骤**:

```bash
# 1. 停止PocketBase
docker stop blog-pocketbase

# 2. 备份当前数据
mv /var/lib/docker/volumes/blog_pb_data/_data /var/lib/docker/volumes/blog_pb_data/_data.broken.$(date +%Y%m%d_%H%M%S)

# 3. 创建新数据目录
mkdir -p /var/lib/docker/volumes/blog_pb_data/_data

# 4. 从备份恢复
cd /opt/hlydwz-blog/backups/pb_data/
tar -xzf pb_data-20260814-0330.tar.gz -C /var/lib/docker/volumes/blog_pb_data/_data/

# 5. 启动PocketBase
docker start blog-pocketbase

# 6. 验证数据
sqlite3 /var/lib/docker/volumes/blog_pb_data/_data/data.db "SELECT COUNT(*) FROM posts;"
```

---

## 四、预防措施

### 4.1 定期备份

```bash
# 设置每日自动备份
crontab -e

# 添加备份任务
30 3 * * * /opt/hlydwz-blog/current/scripts/backup-pb-data.sh >> /var/log/blog-backup.log 2>&1
```

---

### 4.2 监控告警

```bash
# 设置监控脚本
cat > /opt/hlydwz-blog/current/scripts/monitor.sh <<'EOF'
#!/bin/bash

# 检查服务状态
if ! systemctl is-active --quiet blog-astro-ssr; then
  echo "ALERT: SSR service is down!" | mail -s "Blog Alert" admin@example.com
fi

if ! docker ps | grep -q blog-pocketbase; then
  echo "ALERT: PocketBase is down!" | mail -s "Blog Alert" admin@example.com
fi

# 检查磁盘空间
DISK_USAGE=$(df -h / | awk 'NR==2 {print $5}' | sed 's/%//')
if [ $DISK_USAGE -gt 80 ]; then
  echo "ALERT: Disk usage is ${DISK_USAGE}%" | mail -s "Blog Alert" admin@example.com
fi
EOF

chmod +x /opt/hlydwz-blog/current/scripts/monitor.sh

# 设置定时任务
crontab -e
*/5 * * * * /opt/hlydwz-blog/current/scripts/monitor.sh
```

---

### 4.3 日志轮转

```bash
# 配置日志轮转
cat > /etc/logrotate.d/blog <<'EOF'
/var/log/blog-*.log {
    daily
    rotate 30
    compress
    delaycompress
    notifempty
    create 0644 root root
    sharedscripts
    postrotate
        systemctl reload blog-astro-ssr > /dev/null 2>&1 || true
    endscript
}
EOF
```

---

## 五、联系信息

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
