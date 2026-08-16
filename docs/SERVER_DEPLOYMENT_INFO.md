# 胡巴博客服务器部署信息

**生成时间**: 2026年8月14日  
**服务器**: 阿里云 ECS (47.115.134.238)  
**架构**: Astro SSR + PocketBase + Caddy + Docker

---

## 一、服务器基础信息

### 1.1 硬件配置

| 项目 | 配置 | 说明 |
|------|------|------|
| **CPU** | Intel(R) Xeon(R) Platinum | 云服务器 |
| **内存** | 3.5 GB | 已用 2.1 GB (60%) |
| **磁盘** | 49 GB | 已用 20 GB (43%) |
| **Swap** | 2.0 GB | 已用 86 MB (4%) |
| **操作系统** | Alibaba Cloud Linux 8 | Kernel 5.10.134 |

### 1.2 系统信息

```bash
# 系统版本
Linux iZwz9gdkcyz302wmfdeuf9Z 5.10.134-19.7.al8.x86_64

# Docker版本
Docker version 26.1.3, build b72abbb

# Node.js版本
v20.20.2

# 运行时间
up 4 days, 6:02
```

---

## 二、服务架构

### 2.1 服务架构图

```
用户请求
    ↓
阿里云 ESA (CDN + WAF)
    ↓
雷池 WAF (80端口)
    ↓
Caddy (18080端口)
    ↓
    ├─→ Astro SSR Server (4321端口) [动态页面]
    ├─→ PocketBase (8090端口) [API请求]
    └─→ 静态文件 (/srv) [静态资源]
```

### 2.2 服务列表

| 服务名称 | 类型 | 端口 | 状态 | 说明 |
|---------|------|------|------|------|
| **blog-astro-ssr** | Systemd | 4321 | ✅ 运行中 | Astro SSR服务器 |
| **blog-pocketbase** | Docker | 8090 | ✅ 运行中 | PocketBase数据库 |
| **blog-admin-auth** | Docker | 8787 | ✅ 运行中 | 认证服务 |
| **blog-caddy** | Docker | 18080 | ✅ 运行中 | 反向代理 |
| **safeline-*** | Docker | 80/9443 | ✅ 运行中 | 雷池WAF |

---

## 三、Docker容器详情

### 3.1 博客相关容器

#### blog-pocketbase
```yaml
镜像: ghcr.io/muchobien/pocketbase:0.22.21
状态: Up 44 hours (healthy)
端口: 8090/tcp
卷:
  - pb_data:/pb/pb_data
  - pb_migrations:/pb/pb_migrations
  - pb_hooks:/pb/pb_hooks
环境变量:
  - PB_ENCRYPTION_KEY
  - ADMIN_AUTH_INTERNAL_URL=http://admin-auth:8787
  - PUBLIC_SITE_URL=https://hlydwz.com
```

#### blog-caddy
```yaml
镜像: caddy:2.8.4-alpine
状态: Up 24 hours (healthy)
端口: 127.0.0.1:18080->80/tcp
卷:
  - /opt/hlydwz-blog/current/Caddyfile:/etc/caddy/Caddyfile:ro
  - /opt/hlydwz-blog/current/dist/client:/srv:ro
环境变量:
  - OPENRESTY_TRUSTED_PROXY=10.255.2.1
```

#### blog-admin-auth
```yaml
镜像: current-admin-auth (本地构建)
状态: Up 44 hours (healthy)
端口: 8787/tcp
环境变量:
  - NODE_ENV=production
  - ADMIN_AUTH_INTERNAL_SECRET
  - SMTP_HOST / ALIYUN_SMTP_HOST
```

---

### 3.2 雷池WAF容器

| 容器名称 | 镜像 | 状态 | 说明 |
|---------|------|------|------|
| safeline-mgt | safeline-mgt:9.3.11 | ✅ 运行中 | 管理面板 (9443) |
| safeline-tengine | safeline-tengine:9.3.11 | ✅ 运行中 | Web服务器 (80) |
| safeline-detector | safeline-detector:9.3.11 | ✅ 运行中 | 检测引擎 |
| safeline-luigi | safeline-luigi:9.3.11 | ✅ 运行中 | 规则引擎 |
| safeline-pg | safeline-postgres:15.18 | ✅ 运行中 | PostgreSQL数据库 |
| safeline-fvm | safeline-fvm:9.3.11 | ✅ 运行中 | 文件病毒扫描 |
| safeline-chaos | safeline-chaos:9.3.11 | ✅ 运行中 | 日志分析 |

---

## 四、Systemd服务

### 4.1 blog-astro-ssr.service

**配置文件**: `/etc/systemd/system/blog-astro-ssr.service`

```ini
[Unit]
Description=Blog Astro SSR Server
After=network.target

[Service]
Type=simple
User=root
WorkingDirectory=/opt/hlydwz-blog/current/dist
Environment=NODE_ENV=production
Environment=HOST=0.0.0.0
Environment=PORT=4321
Environment=PUBLIC_POCKETBASE_URL=http://127.0.0.1:8090
ExecStart=/usr/bin/node /opt/hlydwz-blog/current/dist/server/entry.mjs
Restart=always
RestartSec=10

[Install]
WantedBy=multi-user.target
```

**管理命令**:
```bash
# 启动服务
systemctl start blog-astro-ssr

# 停止服务
systemctl stop blog-astro-ssr

# 重启服务
systemctl restart blog-astro-ssr

# 查看状态
systemctl status blog-astro-ssr

# 查看日志
journalctl -u blog-astro-ssr -f

# 开机自启
systemctl enable blog-astro-ssr
```

---

## 五、网络配置

### 5.1 端口监听

| 端口 | 协议 | 进程 | 说明 |
|------|------|------|------|
| 80 | TCP | nginx (雷池) | HTTP入口 |
| 443 | TCP | nginx (雷池) | HTTPS入口 |
| 4321 | TCP | node (SSR) | Astro SSR服务器 |
| 8090 | TCP | 1panel-core | 1Panel管理面板 |
| 18080 | TCP | docker-proxy | Caddy反向代理 |
| 9443 | TCP | docker-proxy | 雷池管理面板 |

### 5.2 防火墙

```bash
# 防火墙状态
firewalld not installed

# 使用阿里云安全组控制
```

---

## 六、部署目录结构

### 6.1 主目录

```
/opt/hlydwz-blog/current/
├── Caddyfile                 # Caddy配置文件
├── .env                      # 环境变量
├── dist/                     # Astro构建产物
│   ├── client/              # 客户端静态文件
│   ├── server/              # SSR服务器文件
│   │   ├── entry.mjs       # SSR入口文件
│   │   └── chunks/         # 服务器代码块
│   ├── package.json         # Node.js依赖
│   └── node_modules/        # Node.js模块
├── pb_hooks/                # PocketBase Hooks
│   ├── search_api.pb.js    # 搜索API
│   └── lib/                # Hooks库
├── pb_migrations/           # PocketBase迁移
└── astro/                   # Astro源码（软链接）
```

### 6.2 备份目录

```
/opt/hlydwz-blog/backups/
└── pb_data/
    ├── pb_data-20260810-0330.tar.gz  # 每日备份
    ├── pb_data-20260811-0330.tar.gz
    ├── pb_data-20260812-0330.tar.gz
    ├── pb_data-20260813-0330.tar.gz
    └── pb_data-20260814-0330.tar.gz
```

**备份策略**:
- 每日凌晨 03:30 自动备份
- 保留最近 14 天
- 使用 SQLite Online Backup API
- 包含 data.db + storage/

---

## 七、环境变量

### 7.1 核心环境变量

**文件**: `/opt/hlydwz-blog/current/.env`

```bash
# 站点配置
PUBLIC_SITE_URL=https://hlydwz.com
ADMIN_IP=***

# 认证服务
ADMIN_AUTH_INTERNAL_SECRET=***
ADMIN_AUTH_HASH_SECRET=***
ADMIN_AUTH_RP_ID=hlydwz.com
ADMIN_AUTH_ORIGIN=https://hlydwz.com
ADMIN_AUTH_SESSION_TTL_SECONDS=900

# SMTP配置（阿里云邮件推送）
ALIYUN_SMTP_HOST=smtpdm.aliyun.com
ALIYUN_SMTP_PORT=465
ALIYUN_SMTP_USER=grbk@yx.hlydwz.com
ALIYUN_SMTP_PASSWORD=***
ALIYUN_FROM_EMAIL=grbk@yx.hlydwz.com
ALIYUN_FROM_NAME=胡巴的博客

# Caddy配置
OPENRESTY_TRUSTED_PROXY=10.255.2.1

# PocketBase配置
PB_ENCRYPTION_KEY=***
```

---

## 八、SSL/TLS配置

### 8.1 证书管理

**当前状态**: 使用阿里云ESA提供的证书

**证书链**:
```
用户 → ESA (阿里云证书) → 雷池WAF → Caddy (HTTP)
```

**说明**:
- ESA层处理HTTPS终止
- 雷池WAF使用HTTP与Caddy通信
- 无需在Caddy配置SSL证书

---

## 九、监控与日志

### 9.1 日志位置

| 服务 | 日志位置 | 查看命令 |
|------|---------|---------|
| **SSR服务器** | systemd journal | `journalctl -u blog-astro-ssr -f` |
| **PocketBase** | Docker logs | `docker logs blog-pocketbase -f` |
| **Caddy** | `/data/access.log` | `docker exec blog-caddy tail -f /data/access.log` |
| **雷池WAF** | 雷池管理面板 | https://47.115.134.238:9443 |

### 9.2 监控指标

**系统资源**:
```bash
# CPU使用率
top

# 内存使用
free -h

# 磁盘使用
df -h

# 网络连接
netstat -tlnp
```

**服务状态**:
```bash
# Docker容器
docker ps

# Systemd服务
systemctl status blog-astro-ssr

# 端口监听
netstat -tlnp | grep LISTEN
```

---

## 十、备份与恢复

### 10.1 自动备份

**备份脚本**: `/opt/hlydwz-blog/current/scripts/backup-pb-data.sh`

**备份内容**:
- PocketBase数据库 (`data.db`)
- 上传的文件 (`storage/`)
- 配置文件

**备份频率**: 每日凌晨 03:30

**保留策略**: 最近 14 天

### 10.2 手动备份

```bash
# 备份PocketBase数据
cd /opt/hlydwz-blog/current
./scripts/backup-pb-data.sh

# 备份整个部署目录
tar -czf /tmp/blog-backup-$(date +%Y%m%d).tar.gz /opt/hlydwz-blog/current/
```

### 10.3 恢复数据

```bash
# 停止服务
docker stop blog-pocketbase

# 恢复备份
cd /opt/hlydwz-blog/backups/pb_data/
tar -xzf pb_data-20260814-0330.tar.gz -C /var/lib/docker/volumes/blog_pb_data/_data/

# 启动服务
docker start blog-pocketbase
```

---

## 十一、常用运维命令

### 11.1 服务管理

```bash
# 重启SSR服务器
systemctl restart blog-astro-ssr

# 重启PocketBase
docker restart blog-pocketbase

# 重启Caddy
docker restart blog-caddy

# 重启所有服务
systemctl restart blog-astro-ssr && docker restart blog-pocketbase blog-caddy
```

### 11.2 日志查看

```bash
# 查看SSR日志
journalctl -u blog-astro-ssr -n 100 --no-pager

# 查看PocketBase日志
docker logs blog-pocketbase --tail 100

# 查看Caddy日志
docker logs blog-caddy --tail 100

# 实时查看所有日志
journalctl -u blog-astro-ssr -f & docker logs blog-pocketbase -f & docker logs blog-caddy -f
```

### 11.3 数据库操作

```bash
# 进入PocketBase容器
docker exec -it blog-pocketbase sh

# 查看数据库
sqlite3 /var/lib/docker/volumes/blog_pb_data/_data/data.db

# 查询文章数量
sqlite3 /var/lib/docker/volumes/blog_pb_data/_data/data.db "SELECT COUNT(*) FROM posts;"

# 查询用户数量
sqlite3 /var/lib/docker/volumes/blog_pb_data/_data/data.db "SELECT COUNT(*) FROM users;"
```

---

## 十二、故障排查

### 12.1 常见问题

#### 问题1: SSR服务器无法启动

**症状**: `systemctl status blog-astro-ssr` 显示 failed

**排查步骤**:
```bash
# 查看详细日志
journalctl -u blog-astro-ssr -n 50 --no-pager

# 检查端口占用
netstat -tlnp | grep 4321

# 检查依赖是否安装
ls -la /opt/hlydwz-blog/current/dist/node_modules

# 手动启动测试
cd /opt/hlydwz-blog/current/dist
node server/entry.mjs
```

#### 问题2: 502 Bad Gateway

**症状**: 访问网站返回502错误

**排查步骤**:
```bash
# 检查SSR服务器状态
systemctl status blog-astro-ssr

# 检查Caddy配置
docker exec blog-caddy cat /etc/caddy/Caddyfile

# 测试SSR服务器
curl http://127.0.0.1:4321/

# 查看Caddy日志
docker logs blog-caddy --tail 50
```

#### 问题3: 文章404

**症状**: 发布的文章返回404

**排查步骤**:
```bash
# 检查文章是否存在
sqlite3 /var/lib/docker/volumes/blog_pb_data/_data/data.db "SELECT * FROM posts WHERE slug='your-slug';"

# 检查文章状态
sqlite3 /var/lib/docker/volumes/blog_pb_data/_data/data.db "SELECT slug, status FROM posts;"

# 测试SSR服务器
curl http://127.0.0.1:4321/posts/your-slug
```

---

## 十三、性能优化

### 13.1 当前性能指标

| 指标 | 值 | 状态 |
|------|-----|------|
| **内存使用** | 2.1 GB / 3.5 GB (60%) | ✅ 正常 |
| **磁盘使用** | 20 GB / 49 GB (43%) | ✅ 正常 |
| **CPU负载** | 0.02, 0.08, 0.05 | ✅ 正常 |
| **SSR内存** | 34 MB | ✅ 正常 |
| **响应时间** | < 100ms | ✅ 正常 |

### 13.2 优化建议

1. **启用Gzip压缩** - Caddy已配置
2. **静态资源缓存** - ESA缓存30天
3. **数据库索引** - PocketBase自动管理
4. **CDN加速** - 阿里云ESA已启用

---

## 十四、安全加固

### 14.1 已实施的安全措施

- ✅ 雷池WAF防护（XSS/SQL注入/CC攻击）
- ✅ Caddy安全头（CSP/HSTS/X-Frame-Options）
- ✅ PocketBase限流（登录/注册/评论）
- ✅ IP白名单（管理后台）
- ✅ 邮箱验证（注册用户）
- ✅ TOTP二次验证（管理员）

### 14.2 安全建议

1. **定期更新依赖** - 每月检查一次
2. **定期备份数据** - 已自动备份
3. **监控异常日志** - 每周检查一次
4. **更新SSL证书** - ESA自动管理

---

## 十五、联系信息

**服务器提供商**: 阿里云  
**域名注册商**: 阿里云  
**CDN服务商**: 阿里云ESA  
**WAF服务商**: 雷池SafeLine

**管理面板**:
- 阿里云控制台: https://ecs.console.aliyun.com/
- ESA控制台: https://esa.console.aliyun.com/
- 雷池管理面板: https://47.115.134.238:9443
- 1Panel面板: http://47.115.134.238:8090

---

**文档生成时间**: 2026-08-14  
**文档版本**: v1.0  
**维护人员**: AI Assistant  
**下次更新**: 2026-09-14
