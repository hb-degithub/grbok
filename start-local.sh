#!/bin/bash
# ===========================
# 本地环境一键启动脚本
# ===========================

set -e

echo "🚀 启动本地博客开发环境..."
echo ""

# 检查 Docker 是否运行
if ! docker info > /dev/null 2>&1; then
    echo "❌ Docker 未运行，请先启动 Docker Desktop 或 OrbStack"
    exit 1
fi

echo "✅ Docker 已运行"

# 检查配置文件
if [ ! -f ".env.local" ]; then
    echo "❌ 未找到 .env.local 文件"
    exit 1
fi

if [ ! -f "docker-compose.local.yml" ]; then
    echo "❌ 未找到 docker-compose.local.yml 文件"
    exit 1
fi

if [ ! -f "Caddyfile.local" ]; then
    echo "❌ 未找到 Caddyfile.local 文件"
    exit 1
fi

echo "✅ 配置文件检查通过"

# 启动服务
echo ""
echo "📦 启动 Docker 服务..."
docker compose -f docker-compose.local.yml --env-file .env.local up -d

echo ""
echo "⏳ 等待服务启动..."
sleep 5

# 检查服务状态
echo ""
echo "📊 服务状态:"
docker compose -f docker-compose.local.yml ps

# 健康检查
echo ""
echo "🏥 健康检查..."

# PocketBase
if curl -s http://localhost:8090/api/health | grep -q "OK"; then
    echo "✅ PocketBase 运行正常"
else
    echo "⚠️  PocketBase 启动中，请稍等..."
fi

# Caddy
if curl -s http://localhost:80 > /dev/null 2>&1; then
    echo "✅ Caddy 运行正常"
else
    echo "⚠️  Caddy 启动中，请稍等..."
fi

echo ""
echo "🎉 本地环境启动完成！"
echo ""
echo "📋 访问地址:"
echo "   • Caddy 代理:     http://localhost:80"
echo "   • PocketBase:     http://localhost:8090"
echo "   • Admin UI:       http://localhost:80/_/admin"
echo ""
echo "📝 常用命令:"
echo "   • 查看日志:       docker compose -f docker-compose.local.yml logs -f"
echo "   • 停止服务:       docker compose -f docker-compose.local.yml down"
echo "   • 重启服务:       docker compose -f docker-compose.local.yml restart"
echo ""
echo "💡 首次使用请访问 http://localhost:80/_/admin 创建管理员账户"
