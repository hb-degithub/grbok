# 胡巴的博客

基于 Astro + PocketBase 的个人博客系统。

## 技术栈

- **前端框架**: Astro (SSG + React islands)
- **后端/数据**: PocketBase (SQLite + Auth + API)
- **Web 服务器**: Caddy (HTTPS + 反向代理)
- **邮件通知**: msmtp
- **安全部署**: Docker Compose

## 目录结构

```
个人博客/
├── docker-compose.yml       # 生产环境 Docker 配置
├── docker-compose.local.yml # 本地开发 Docker 配置
├── Caddyfile                # 生产 Caddy 配置
├── Caddyfile.local          # 本地 Caddy 配置
├── .env.local               # PocketBase/Caddy 环境变量
├── .env.astro               # Astro 环境变量
├── start-local.sh           # 本地启动脚本 (Linux/macOS)
├── start-local.bat          # 本地启动脚本 (Windows)
├── astro/                   # Astro 前端项目
│   ├── src/                 # 源代码
│   │   ├── components/      # React 组件 (admin, auth, comments, effects, layout, posts, search, sidebar, ui)
│   │   ├── layouts/         # 布局 (BaseLayout, AdminLayout, AuthLayout, PostLayout)
│   │   ├── hooks/           # 自定义 hooks (认证、设置、评论)
│   │   ├── lib/             # 工具库 (安全清理、PocketBase 客户端)
│   │   ├── pages/           # 页面路由
│   │   ├── styles/          # 全局样式
│   │   ├── types/           # 类型定义
│   │   └── config/          # 站点配置
│   └── package.json
├── pb_hooks/                # PocketBase Hooks
├── pb_migrations/           # PocketBase 迁移脚本
├── docs/                    # 文档
└── scripts/                 # 运维脚本
```

## 本地开发

```bash
# Windows
start-local.bat

# Linux/macOS
chmod +x start-local.sh && ./start-local.sh

# 手动控制 Docker
docker compose -f docker-compose.local.yml --env-file .env.local up -d
```

后台地址: http://localhost:8090/_/admin

## 生产部署

### 标准化部署脚本（推荐）

**重要：2025-07-29 全站 404 事故根因是部署时删除重建了 `/opt/hlydwz-blog/current/astro/dist` 目录，导致 blog-caddy 的 bind mount (`./astro/dist:/srv`) inode 悬空，前台全站 404 持续 5.7 天。**

整改方案：使用 `rsync -a --delete` 原地更新（只同步差异，目录 inode 不变，容器无需因挂载问题重启）。

**严禁使用任何 `rm -rf dist` 或删除重建目录的命令。**

#### 使用方法

```bash
# 1. 构建 Astro 静态文件
cd astro && npm run build && cd ..

# 2. 执行部署脚本（推荐，含完整自检）
bash scripts/deploy-dist.sh ./astro/dist

# Windows PowerShell 包装（自动检测 Git Bash，无则提供 scp 兜底）
powershell -ExecutionPolicy Bypass -File scripts/deploy-dist.ps1 ./astro/dist
```

#### 部署流程

脚本自动执行以下步骤：

1. **前置检查**：验证 dist 目录存在且包含 `index.html`
2. **环境检查**：验证 rsync、ssh、SSH 密钥可用
3. **SSH 连接测试**：确保能连接到生产服务器
4. **远端环境检查**：验证远端 rsync、dist 目录、Caddy 容器状态
5. **rsync 原地同步**：`rsync -a --delete <dist>/ root@47.115.134.238:/opt/hlydwz-blog/current/astro/dist/`
6. **远端自检**：
   - Caddy 容器内 `/srv` 目录非空校验
   - 源站探活：`curl -sf http://127.0.0.1:18080/`
   - 外网探活：`curl -sf https://hlydwz.com/`（注意尾随斜杠）
7. **任一自检失败**：明确报错退出非零码，并提示恢复命令

#### 为什么禁止删除重建挂载目录？

Docker bind mount 通过 inode 关联宿主机目录和容器内挂载点。当执行 `rm -rf dist && mkdir dist` 或 `mv dist dist.bak && mv dist.new dist` 时：

- 原目录 inode 被删除，新目录获得新 inode
- 容器内 `/srv` 仍指向已删除的旧 inode（悬空挂载）
- Caddy 无法访问新文件，返回 404
- 必须重启容器才能重新绑定新 inode

`rsync -a --delete` 原地更新只同步文件差异，目录 inode 保持不变，bind mount 持续有效，无需重启容器。

#### 回滚方法

**方法 1：重新部署上一版本（推荐）**

```bash
# 如果有上一版本的 dist 备份
bash scripts/deploy-dist.sh /path/to/previous/dist

# 或从 Git 历史重新构建
git checkout <previous-commit>
cd astro && npm run build && cd ..
bash scripts/deploy-dist.sh ./astro/dist
```

**方法 2：紧急重启 Caddy（仅当 bind mount 已失效时）**

```bash
ssh root@47.115.134.238
cd /opt/hlydwz-blog/current
docker compose restart caddy
```

**注意**：重启 Caddy 会导致短暂服务中断（通常 < 5 秒），仅在 bind mount 已失效（容器内 `/srv` 为空）时使用。

#### SSH 密钥配置

脚本默认使用密钥 `C:\tmp\blog-ssh\blog_deploy_ed25519`（Windows）或对应 Linux 路径。

如需修改，可通过环境变量覆盖：

```bash
# Git Bash / Linux
SSH_KEY=/path/to/your/key bash scripts/deploy-dist.sh

# PowerShell
$env:SSH_KEY="C:\path\to\your\key"; powershell -ExecutionPolicy Bypass -File scripts/deploy-dist.ps1
```

#### 故障排查

| 问题 | 可能原因 | 解决方案 |
|------|----------|----------|
| rsync 同步失败 | 网络不通、磁盘满、权限不足 | 检查网络、磁盘空间、SSH 密钥权限 |
| Caddy 容器内 /srv 为空 | bind mount 失效（inode 悬空） | `docker compose restart caddy` |
| 源站探活失败 | Caddy 未正确加载文件 | 检查 Caddy 日志：`docker logs blog-caddy` |
| 外网探活失败 | CDN 缓存、DNS 问题、源站异常 | 检查 ESA/CDN 缓存、手动访问确认 |

## 功能特性

### 前台
- 文章列表、详情、归档
- 标签云与标签筛选
- 全文搜索 (Pagefind)
- 响应式布局（桌面端 + 移动端适配）
- 深色/浅色主题
- 评论系统（需审核）
- RSS / Sitemap

### 后台
- 仪表盘
- 文章管理（编辑、发布、草稿、归档、批量操作）
- 评论审核（待审、已通过、垃圾、批量操作）
- 标签管理
- 用户管理（角色权限分层）
- 站点设置
- 安全中心
- 操作日志

### 安全
- Caddy 安全头（HSTS、CSP、X-Frame-Options）
- 后台管理端 IP 白名单
- 登录限流（OpenResty）
- 评论 XSS 清理
- 角色权限保护（PocketBase rules + hooks）
- 敏感扫描路径拦截
- 危险操作二次确认

## 文档

- [补全路线图](/docs/blog-completion-roadmap.md) — 项目开发计划
- [移动端适配方案](/docs/mobile-adaptation-plan.md) — 移动端适配策略
- [PocketBase 数据结构](/docs/pocketbase-schema.md) — 数据库表结构
- [安全配置](/docs/pocketbase-security-rules.json) — PocketBase 安全规则
- [迁移验证](/docs/migration-validation.md) — 数据库迁移验证
- [管理员认证加固运维手册](/docs/admin-auth-hardening-runbook.md) — 部署、注册、恢复与回滚

## 许可

私有项目

