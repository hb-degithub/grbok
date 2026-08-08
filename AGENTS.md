<!-- AGENTS.md: coding agent 核心指令。变更流程、核心路径边界、验收标准与回滚路径。 -->

# AGENTS.md — Coding Agent 核心指令

本文件是 coding agent 在本仓库工作的核心指令，定义核心路径边界、变更流程、验收标准与回滚路径。所有 agent 在执行变更前必须阅读并遵守本文件。

## 1. 核心路径边界 (Core Path Boundaries)

以下路径为**核心路径**，任何变更需额外审查：

- `astro/src/` — Astro 前端源码（React 岛屿、页面、布局、hooks、lib）
- `pb_hooks/` — PocketBase 服务端 hooks（`.pb.js` 后缀，涉及安全/邮件/验证逻辑）
- `pb_migrations/` — PocketBase 数据库 schema 迁移（仅允许 `.js` 文件）
- `Caddyfile` / `Caddyfile.local` — Caddy 反向代理与安全标头配置
- `docker-compose.yml` / `docker-compose.local.yml` — 容器编排
- `.github/workflows/` — CI/CD 流水线
- `astro/src/lib/pocketbase.ts` — PocketBase 客户端单例
- `astro/src/lib/security.ts` — 前端安全工具（CSRF、指纹、限流）
- `astro/src/config/site.ts` — 站点全局配置

非核心路径（如 `docs/`、`tmp/`、`astro/public/` 静态资源）变更流程较宽松，但仍需保持代码质量与一致性。

## 2. 变更流程 (Change Process)

- **核心路径变更**：必须先说明变更理由与影响范围，优先派遣匹配的自定义子智能体（见 CLAUDE.md 的子智能体表）执行，变更后必须通过验收标准。
- **`pb_migrations/` 变更**：仅允许新增迁移文件，禁止修改已应用的迁移；禁用原生数组方法（参考项目已知陷阱）。
- **`pb_hooks/` 变更**：修改限流/安全逻辑后必须本地验证登录与评论流程。
- **`astro/src/` React 组件**：必须使用 `export default`，禁止命名导出。
- **CI 配置变更**：必须确认测试步骤为硬门禁（无 `continue-on-error: true`）。

## 3. 验收标准 (Acceptance Criteria)

核心路径变更完成前必须满足：

- `cd astro && npm run build` 构建成功
- `cd astro && npx vitest run` 单元测试通过（硬门禁，不允许跳过）
- `cd astro && npm run test:admin-auth` 认证生命周期测试通过（涉及 auth/admin 变更时）
- 涉及 PocketBase schema 变更时，迁移脚本在本地 PB 实例应用成功
- 涉及 Caddy/部署变更时，`docker compose config` 校验通过

## 4. 回滚路径 (Rollback Path)

- **代码变更**：通过 `git revert <commit>` 或 `git checkout -- <path>` 回滚到上一稳定状态。
- **PocketBase 迁移**：迁移脚本需配套提供 down 迁移或在变更前备份 `pb_data`（生产为 Docker volume）；回滚时恢复备份并重启容器。
- **Caddy/部署配置**：保留上一版本配置文件副本，回滚后执行 `docker compose up -d --force-recreate caddy` 使配置生效。
- **静态站点**：重新构建上一版本的 `astro/dist/` 并重新部署即可回滚前台。
