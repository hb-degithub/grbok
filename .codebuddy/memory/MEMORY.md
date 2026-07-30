# MEMORY.md

## 项目概述
- **胡巴博客**：基于Astro(SSG+React islands) + PocketBase(内置SQLite/认证/REST API) + Caddy(HTTPS/反向代理/安全头) 的个人技术博客系统
- 项目根目录：`h:\开发\个人博客\astro`
- 域名：`hlydwz.com`，站点URL：`https://hlydwz.com`

## 生产服务器
- 地址：`root@47.115.134.238`
- SSH密钥：`C:\tmp\blog-ssh\blog_deploy_ed25519`，参数：`-o IdentitiesOnly=yes`
- 部署目录：`/opt/hlydwz-blog/current/`

## 本地开发环境
- 启动：`docker compose -f docker-compose.local.yml --env-file .env.local up -d` + `cd astro && npm run dev`
- 端口：Astro dev→4321，PocketBase→8090，Caddy→80（映射宿主机18080）
- 环境变量：`.env.local`（PocketBase/Caddy）、`.env.astro`（Astro）

## PocketBase迁移规范
- `pb_migrations`目录仅允许`.pb.js`文件，非JS文件会导致容器重启循环
- 迁移脚本禁用原生数组方法，使用`getFieldByName()`和`addField(new SchemaField())`
- 必须在pocketbase.exe所在目录执行命令：`cd h:\开发\个人博客\pb_local && .\pocketbase.exe migrate up`

## Windows PowerShell注意事项
- tar不可用，用`Compress-Archive`替代
- 执行.ps1脚本：`powershell -ExecutionPolicy Bypass -File "脚本路径"`（不能用pwsh）
- SSH含$(date)的远程命令需用单引号包裹或转义$

## Caddy与CSP配置
- CSP style-src必须包含`'unsafe-inline'`，本地Caddyfile：`h:\开发\个人博客\Caddyfile`
- 挂载路径：`/opt/hlydwz-blog/current/astro/dist:/srv:ro`
- hlydwz.com非根路径必须尾随斜杠（如`/posts/`、`/about/`），否则308

## 阿里云ESA标头与缓存（重要）
- 客户端IP：`ali-real-client-ip`，国家：`ali-ip-country`，地区：`ali-ip-region`，城市：`ali-ip-city`
- **ESA 边缘无视源站 `no-store` 长期缓存 HTML**（2026-07-28 实测 Age≈47h）。重新部署后旧 HTML 引用已删除的 hash chunks → React 岛屿 404 → 页面组件空白（曾导致 /stats/ 访问统计空白事故）
- 处置：ESA 控制台→缓存→刷新预热→刷新 HTML/全站；根治：ESA 缓存规则将 HTML 设为不缓存/遵循源站，`/_astro/*`、`/pagefind/*` 等 hash 资源保留长缓存
- 诊断方法：带随机 query（如 `?fresh=<timestamp>`）绕过边缘缓存获取源站 HTML，对比边缘与源站引用的 chunk hash 是否一致
- sw.js 无责：已设计为不缓存 HTML、导航请求 network-first

## 构建与运维命令
- 构建：`npm run build`（astro目录）
- Makefile：`make dev`/`make build`/`make test`/`make e2e`/`make lint`/`make health`/`make friend-check`/`make stop`/`make clean`
- 搜索方案：Pagefind

## 代码规范
- 组件独立、低耦合、高可维护
- 数据访问逻辑抽离到Service层和自定义Hooks，组件只关注UI渲染和用户交互
- 领域服务封装业务逻辑，避免组件直接操作数据层
- 确保组件可独立测试和复用

## 核心功能
- 邮件限频：60次/分钟（覆盖登录/注册/验证码/评论通知/评论回复通知）
- 用户通知偏好：评论回复邮件通知、文章评论邮件通知
- 前台：文章管理、标签云、Pagefind搜索、深浅色主题、评论审核、RSS/Sitemap
- 后台：仪表盘、文章/评论/标签/用户/站点设置/安全中心/操作日志CRUD与权限控制
