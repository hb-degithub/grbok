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

## 许可

私有项目
