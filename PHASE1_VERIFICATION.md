# Phase 1 本地验证清单

## 📁 已生成文件

| 文件 | 用途 |
|------|------|
| `.env.local` | PocketBase/Caddy 本地环境变量 |
| `.env.astro` | Astro 开发服务器环境变量 |
| `docker-compose.local.yml` | 本地 Docker Compose 配置 |
| `Caddyfile.local` | 本地 Caddy 配置（HTTP，无 HTTPS） |
| `start-local.sh` | 一键启动脚本 |

---

## 🚀 快速启动

### 方式一: 一键启动（推荐）

```bash
# Linux/macOS
chmod +x start-local.sh && ./start-local.sh

# Windows (Git Bash)
bash start-local.sh
```

### 方式二: 手动启动

```bash
# 1. 启动 PocketBase + Caddy
docker compose -f docker-compose.local.yml --env-file .env.local up -d

# 2. 查看日志
docker compose -f docker-compose.local.yml logs -f

# 3. 新终端窗口 - 启动 Astro（后续 Phase 2）
# cd astro && npm run dev
```

---

## ✅ 验证检查点

### 1. PocketBase 服务

```bash
# 检查容器状态
docker compose -f docker-compose.local.yml ps

# 健康检查
curl http://localhost:8090/api/health
# 预期响应: {"code":200,"message":"OK","data":{}}
```

- [ ] PocketBase 容器运行正常
- [ ] API 健康检查通过

### 2. Caddy 反向代理

```bash
# 通过 Caddy 访问 PocketBase
curl http://localhost:80/api/health
# 预期响应: 与上面相同

# 检查响应头
curl -I http://localhost:80
# 预期: 看到安全头 (X-Frame-Options, X-Content-Type-Options 等)
```

- [ ] Caddy 反向代理正常工作
- [ ] 安全头已生效

### 3. PocketBase Admin UI

浏览器访问: **http://localhost:80/_/admin**

- [ ] 页面正常加载
- [ ] 创建管理员账户（首次访问会提示）
- [ ] 登录成功，能看到后台界面

### 4. PocketBase 直连（绕过 Caddy）

浏览器访问: **http://localhost:8090/_/admin**

- [ ] 直连访问正常
- [ ] 与通过 Caddy 访问一致

### 5. 创建管理员账户

#### 方式一: Web UI（推荐）
1. 访问 http://localhost:80/_/admin
2. 填写邮箱和密码
3. 点击 "Create account"

#### 方式二: CLI 命令
```bash
# 进入容器
docker compose -f docker-compose.local.yml exec pocketbase sh

# 创建管理员
/pb/pocketbase admin create admin@test.com your_password

# 退出
exit
```

- [ ] 管理员账户创建成功
- [ ] 能用管理员账户登录

---

## 🔧 常见问题排查

### PocketBase 启动失败

```bash
# 查看详细日志
docker compose -f docker-compose.local.yml logs pocketbase

# 检查数据目录权限
docker compose -f docker-compose.local.yml exec pocketbase ls -la /pb/pb_data
```

### Caddy 启动失败

```bash
# 查看详细日志
docker compose -f docker-compose.local.yml logs caddy

# 验证配置语法
docker compose -f docker-compose.local.yml exec caddy caddy validate --config /etc/caddy/Caddyfile
```

### 端口被占用

```bash
# Windows
netstat -ano | findstr :8090
netstat -ano | findstr :80

# Linux/macOS
lsof -i :8090
lsof -i :80

# 停止占用进程或修改 docker-compose.local.yml 端口映射
```

### 数据重置

```bash
# 停止服务并删除数据
docker compose -f docker-compose.local.yml down -v

# 重新启动
docker compose -f docker-compose.local.yml --env-file .env.local up -d
```

---

## 📊 服务访问地址

| 服务 | 地址 | 说明 |
|------|------|------|
| Caddy 代理 | http://localhost:80 | 主入口 |
| PocketBase Admin | http://localhost:80/_/admin | 管理后台 |
| PocketBase API | http://localhost:80/api/ | API 端点 |
| PocketBase 直连 | http://localhost:8090 | 绕过 Caddy |
| Astro Dev（Phase 2） | http://localhost:4321 | 前端开发服务器 |

---

## 🛑 停止服务

```bash
# 停止所有服务
docker compose -f docker-compose.local.yml down

# 停止并删除数据卷（慎用！会丢失数据）
docker compose -f docker-compose.local.yml down -v
```

---

## ✨ 验证完成

完成以上所有检查点后，请回复：

> **本地验证通过**

我将继续 Phase 2：Astro 项目脚手架与 PocketBase SDK 集成。
