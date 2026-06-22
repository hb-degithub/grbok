@echo off
REM ===========================
REM 本地环境一键启动脚本 (Windows)
REM ===========================

echo 🚀 启动本地博客开发环境...
echo.

REM 检查 Docker 是否运行
docker info > nul 2>&1
if errorlevel 1 (
    echo ❌ Docker 未运行，请先启动 Docker Desktop
    exit /b 1
)

echo ✅ Docker 已运行

REM 检查配置文件
if not exist ".env.local" (
    echo ❌ 未找到 .env.local 文件
    exit /b 1
)

if not exist "docker-compose.local.yml" (
    echo ❌ 未找到 docker-compose.local.yml 文件
    exit /b 1
)

echo ✅ 配置文件检查通过

REM 启动服务
echo.
echo 📦 启动 Docker 服务...
docker compose -f docker-compose.local.yml --env-file .env.local up -d

echo.
echo ⏳ 等待服务启动...
timeout /t 5 /nobreak > nul

REM 检查服务状态
echo.
echo 📊 服务状态:
docker compose -f docker-compose.local.yml ps

echo.
echo 🎉 本地环境启动完成！
echo.
echo 📋 访问地址:
echo    • Caddy 代理:     http://localhost:80
echo    • PocketBase:     http://localhost:8090
echo    • Admin UI:       http://localhost:80/_/admin
echo.
echo 📝 常用命令:
echo    • 查看日志:       docker compose -f docker-compose.local.yml logs -f
echo    • 停止服务:       docker compose -f docker-compose.local.yml down
echo    • 重启服务:       docker compose -f docker-compose.local.yml restart
echo.
echo 💡 首次使用请访问 http://localhost:80/_/admin 创建管理员账户
