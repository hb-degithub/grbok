# 个人博客系统

基于 Astro + PocketBase 的自托管个人博客系统。

## 🏗️ 技术栈

- **前端 SSG**: Astro (Content Layer API)
- **后端 BaaS**: PocketBase (SQLite + Auth + API)
- **Web Server**: Caddy (自动 HTTPS + 反向代理)
- **邮件中继**: msmtp + 阿里云邮件推送
- **部署方式**: Docker Compose 统一编排

## 📁 项目结构

```
个人博客/
├── docker-compose.local.yml    # 本地测试 Docker 配置
├── Caddyfile.local             # 本地测试 Caddy 配置
├── .env.local                  # PocketBase/Caddy 环境变量
├── .env.astro                  # Astro 环境变量
├── start-local.sh              # 启动脚本 (Linux/macOS)
├── start-local.bat             # 启动脚本 (Windows)
├── pb_hooks/                   # PocketBase Hooks
├── docs/                       # 文档
└── astro/                      # Astro 项目 (Phase 2)
```

## 🚀 快速开始

```bash
# Windows
start-local.bat

# Linux/macOS
chmod +x start-local.sh && ./start-local.sh

# 或手动启动
docker compose -f docker-compose.local.yml --env-file .env.local up -d
```

访问 http://localhost:80/_/admin 创建管理员账户

## 📚 文档

- [PocketBase 数据模型设计](docs/pocketbase-schema.md)
- [Phase 1 验证清单](PHASE1_VERIFICATION.md)
