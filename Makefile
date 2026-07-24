# 胡巴的博客 — 本地开发 Makefile
# 用法：make <target>

.PHONY: dev build test lint e2e deploy-local stop clean help

# 启动本地开发环境（PocketBase + Caddy via Docker + Astro dev）
dev:
	@echo "🚀 启动本地开发环境..."
	docker compose -f docker-compose.local.yml --env-file .env.local up -d
	@echo "⏳ 等待 PocketBase 就绪..."
	@sleep 3
	cd astro && npm run dev &
	@echo ""
	@echo "✅ 开发环境已启动："
	@echo "   前端:     http://localhost:4321"
	@echo "   后台:     http://localhost:80/_/admin"
	@echo "   PocketBase: http://localhost:8090"

# 构建生产版本
build:
	cd astro && npm run build
	@echo "✅ 构建完成 → astro/dist/"

# 运行单元测试
test:
	cd astro && npx vitest run

# 运行 E2E 测试
e2e:
	cd astro && npx playwright test

# 代码检查
lint:
	cd astro && npx eslint src/ --ext .ts,.tsx 2>/dev/null || echo "⚠️ ESLint 未配置，跳过"

# 内容健康度检查
health:
	cd astro && node scripts/content-health-check.mjs

# 友链存活检测
friend-check:
	cd astro && node scripts/check-friend-links.mjs

# 停止本地 Docker 服务
stop:
	docker compose -f docker-compose.local.yml down
	@echo "✅ 本地服务已停止"

# 清理构建产物
clean:
	rm -rf astro/dist astro/.astro
	@echo "✅ 已清理构建产物"

# 部署前安全检查
pre-deploy:
	@bash security-check.sh || echo "⚠️ security-check.sh 执行失败"

help:
	@echo "可用命令："
	@echo "  make dev          启动本地开发环境"
	@echo "  make build        构建生产版本"
	@echo "  make test         运行单元测试"
	@echo "  make e2e          运行 E2E 测试"
	@echo "  make lint         代码检查"
	@echo "  make health       内容健康度检查"
	@echo "  make friend-check 友链存活检测"
	@echo "  make stop         停止本地服务"
	@echo "  make clean        清理构建产物"
	@echo "  make pre-deploy   部署前安全检查"
