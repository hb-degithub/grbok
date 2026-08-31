<!--
  SYNC: Every agent turn starts by reading this file.
  PURPOSE: Architecture, conventions, and domain knowledge for "胡巴的博客".
  KEEP SHORT: Link to docs/ for deep dives.
-->

# 胡巴的博客 — AI Agent Context

## Identity
- **Site**: 胡巴的博客 (Huba's Blog)
- **Author**: HB
- **Since**: 2022
- **Domain**: hlydwz.com (production)

## Tech Stack
| Layer | Technology | Role |
|-------|-----------|------|
| Frontend (SSR) | Astro 6 + React 19 + TailwindCSS 4 | SSR pages and React islands |
| Motion | Framer Motion 12 | Client-side animations |
| Search | Pagefind | Offline full-text search |
| Backend | PocketBase 0.22.21 (SQLite) | Auth, DB, API, file storage |
| Reverse Proxy | Caddy 2.8.4-alpine | Local reverse proxy, static assets, security headers |
| Edge Protection | Alibaba Cloud ESA + SafeLine WAF | CDN/WAF and public ingress |
| Email | PocketBase SMTP (Aliyun) + msmtp fallback | Verification, magic link, notifications |
| Deployment | systemd + Docker Compose | Astro SSR process plus containerized services |

## Architecture

```
Browser
  |
  v
Alibaba Cloud ESA (CDN + WAF)
  |
  v
SafeLine WAF (:80/:9443)
  |
  v
Caddy (127.0.0.1:18080 -> container :80)
  |
  | +-- all pages ----------> Astro SSR (systemd, :4321)
  | +-- /api/* and /_/* ----> PocketBase (Docker, :8090)
  | +-- real files only -----> /srv = dist/client (read-only)
```

Production uses Astro SSR. The `blog-astro-ssr` systemd service runs `dist/server/entry.mjs` on port `4321`. The SSR build emits **no prerendered pages** — `dist/client` contains only static assets — so Caddy proxies every page route to SSR and only serves files that actually exist in `/srv` (2026-08-31 routing rework; before that, stale SSG-era page fossils shadowed SSR routes). Caddy remains bound to loopback port `18080` behind SafeLine, while ESA provides the outer CDN/WAF layer.

## Directory Structure

```
astro/                    # Astro frontend (npm workspace)
  src/
    components/           # React islands: admin/ auth/ comments/ layout/ posts/ search/ sidebar/ ui/ effects/
    config/site.ts        # SITE_CONFIG (name, slogan, icp, social links...)
    hooks/                # usePocketBase, useAdminAuth, useComments, useSiteSettings, etc.
    layouts/              # BaseLayout, AdminLayout, AuthLayout, PostLayout
    lib/                  # pocketbase.ts (PB client), security.ts, site-settings.ts, utils.ts
    pages/                # Astro pages: index.astro, posts/[slug].astro, tags/[slug].astro, admin/...
    styles/global.css     # TailwindCSS global styles
    types/pocketbase.ts   # TS type definitions for PB collections
  astro.config.mjs        # Astro config: site URL from PUBLIC_SITE_URL, integrations
  package.json            # Dependencies: astro, react, framer-motion, pocketbase, tailwindcss, pagefind

pb_hooks/                 # PocketBase server-side hooks (.pb.js suffix required)
  guard_user_role.pb.js   # Enforce user role on create/update
  login_security.pb.js           # Per-IP/per-email password-login rate limiting (re-enabled & fixed)
  send_email_comment.pb.js       # Email notification on new comments
  validate_comment.pb.js         # Server-side comment validation + email verification gate
  configure_smtp.pb.js           # Auto-configure SMTP from ALIYUN_SMTP_* env vars on startup
  email_verification.pb.js       # Auto-send verification on registration, rate limit resends, audit log

pb_migrations/            # PocketBase schema migrations
pb_local/                 # Local dev PB data directory

admin-auth/               # Internal service (Node.js >=22 ESM)
  src/
    server.mjs            # Entry (npm start), listens :8787
    mail/                 # Mail gateway (nodemailer 9.0.3)
    esa/                  # ESA cache management client (maxmind GeoIP)
    config.mjs            # Env-driven config
    session-policy.mjs    # Session policy
    step-up-policy.mjs    # WebAuthn passkey MFA step-up policy
  test/                   # node --test: server/mail/esa/session-policy/step-up-policy tests
  Dockerfile              # node:22-alpine, npm ci --omit=dev, non-root USER node, EXPOSE 8787
  # 边界: 内部服务，仅 docker 内部网络 expose :8787（Caddy 不直接暴露）;
  #       PocketBase 通过 ADMIN_AUTH_INTERNAL_URL=http://admin-auth:8787 内部调用
  # 职责: WebAuthn passkey MFA、step-up 认证、邮件网关（SMTP 发送）、ESA 缓存管理

tests/                    # Integration test fixtures (non-production)
  admin-security/         # legacy_session_seed / step_up_fixture .pb.js, webauthn_stub.mjs
  frontend-backend/       # gallery / guestbook / stats fixture .pb.js
  mail-local/             # account fixture + retention contracts
  ops/                    # pytest: test_mail_archive.py, fakes/
  security-rate/          # hook/search/like regression tests + rate/policy/registration fixtures
  # 边界: 仅测试夹具与本地集成测试，不属于部署产物

scripts/                  # Ops / check / test scripts (PowerShell + Python + Shell)
  check-*.ps1             # check-admin-routes, check-mail-config, check-real-ip-chain, check-pb-admin-auth, check-admin-recovery...
  test-*.ps1              # test-mail-gateway-local, test-security-rate-local, test-admin-step-up, test-gallery-local...
  pre-deploy-check.ps1, sensitive-check.ps1, admin-recovery.ps1
  mail-archive.py, verify-pocketbase-migrations-linux.sh, run-mail-archive-1panel.sh
  # 边界: 开发/部署辅助脚本，需 PowerShell (Windows) 或 Python/Shell (Linux)

docs/                     # Reference docs: schema, security rules, rate-limit config
tmp/                      # Temporary deployment artifacts
.claude/                  # Claude Code IDE settings
```

## Key Conventions

### Components
- React components are `.tsx`, Astro pages/layouts are `.astro`.
- Default exports used everywhere (hydration fix in commit `f5c7dfd`).
- Components use `client:visible` for hydration where needed.
- **DO NOT** use named exports for React components — only `export default`.

### Styling
- TailwindCSS 4 with custom design tokens.
- Design system: indigo/zinc palette, glassmorphism, dark hero backgrounds.
- Use `clsx` and `tailwind-merge` for conditional classes.

### PocketBase Client
- Singleton client in `astro/src/lib/pocketbase.ts`.
- `PUBLIC_POCKETBASE_URL` env var (default `http://localhost:8090`).
- PB JS SDK 0.27.0.

### Security
- DOMPurify on rendered user content (comments).
- `security.ts` provides browser fingerprint, CSRF, and rate limiting utilities.
- Admin pages are guarded by `AdminGuard` (server-side token validation + email verification + passkey MFA).
- Caddy handles: HSTS, CSP, directory-scan blocking; X-Frame-Options / X-Content-Type-Options / Referrer-Policy are owned by the ESA edge (removed from Caddy 2026-08-31 to fix double-injection conflicts). `/_/*` + `/api/admins/*` are publicly blocked (404); access only via SSH tunnel (`ssh -L 18080:127.0.0.1:18080`, allowlisted client IPs: docker gateway 10.255.2.1 / loopback) or explicit `ADMIN_IP`.
- `login_security.pb.js` is ENABLED — per-IP (10/15min) + per-email (5/15min) password-login rate limiting. It uses `realIP()` (not the spoofable `X-Forwarded-For`) and a `globalThis`-persisted bucket, which fixed the 400-error regression that originally forced it to be disabled.
- `validate_comment.pb.js` logs IP address but excludes it from public API responses; also enforces email verification for registered commenters.
- `configure_smtp.pb.js` auto-configures SMTP on PB startup from `ALIYUN_SMTP_*` env vars (only if SMTP not already enabled).

### Email Verification
- Policy: "注册即可用，逐步引导验证" — registration works immediately, verification is progressively encouraged.
- Registered users must verify email to comment; anonymous comments are unaffected.
- Admin users must verify email before passkey MFA step (enforced in both backend hook and frontend AdminGuard).
- Flow: register → auto-send verification email → user clicks link → `/verify-email?token=xxx` → `confirmVerification()` + `authRefresh()` → `emailVerified` updated.
- Frontend: `EmailVerificationBanner` (dismissible prompt), `EmailVerificationResult` (confirmation page), `AdminEmailVerificationRequired` (admin gate), `CommentForm` verification prompt.
- Rate limiting: 5/IP/15min, 3/email/15min on resend requests (`email_verification.pb.js`).

### Environment Variables
| Variable | Used By | Default |
|----------|---------|---------|
| `PUBLIC_SITE_URL` | Astro build + SMTP links | `http://localhost:4321` |
| `PUBLIC_POCKETBASE_URL` | Astro (PB client) | `http://localhost:8090` |
| `PB_ENCRYPTION_KEY` | Docker Compose | (required) |
| `ADMIN_IP` | Caddy | (admin whitelist IP) |
| `TZ` | PocketBase container | `Asia/Shanghai` |
| `ALIYUN_SMTP_HOST` | PocketBase (configure_smtp.pb.js) | — |
| `ALIYUN_SMTP_PORT` | PocketBase (configure_smtp.pb.js) | — |
| `ALIYUN_SMTP_USER` | PocketBase (configure_smtp.pb.js) | — |
| `ALIYUN_SMTP_PASSWORD` | PocketBase (configure_smtp.pb.js) | — |
| `ALIYUN_FROM_EMAIL` | PocketBase (configure_smtp.pb.js) | — |
| `ALIYUN_FROM_NAME` | PocketBase (configure_smtp.pb.js) | — |

## Database Schema

Seven core collections, full details in [docs/pocketbase-schema.md](docs/pocketbase-schema.md):

| Collection | Type | Key relations |
|-----------|------|---------------|
| `users` | Auth | roles: admin / author / reader |
| `posts` | Base | author -> users, status: draft / published / archived |
| `comments` | Base | post_id -> posts, parent_id -> comments (nested) |
| `comment_likes` | Base | comment -> comments, unique visitor hash per comment (server-only) |
| `tags` | Base | unique slug |
| `post_tags` | Base | post_id -> posts, tag_id -> tags (many-to-many) |
| `settings` | Base | key-value as JSON |

Access control summary (see schema doc for exact filter rules):
- Anonymous: read published posts, create/view approved comments, view tags/settings.
- Reader: same as anonymous.
- Author: CRUD own posts, manage comments, CRUD tags.
- Admin: full access to everything.

## Development

```bash
# Start backend (PocketBase + Caddy)
docker compose -f docker-compose.local.yml --env-file .env.local up -d

# Start Astro dev server
cd astro && npm run dev            # http://localhost:4321

# Build for production
cd astro && npm run build          # runs: astro build && pagefind --site dist

# Stop
docker compose -f docker-compose.local.yml down
```

Local service addresses:
- Caddy proxy (main): `http://localhost:80`
- PocketBase admin: `http://localhost:80/_/admin`
- PocketBase direct: `http://localhost:8090`
- Astro dev: `http://localhost:4321`

## Deployment

1. Generate encryption key: `openssl rand -hex 32`.
2. Copy `.env.example` to `.env` and set production values.
3. Run `security-check.sh` for pre-deploy validation (keys, IP, domain).
4. Apply PocketBase security rules.
5. Build Astro's SSR output: `cd astro && npm run build`.
6. Deploy the generated `dist/client` and `dist/server` artifacts to `/opt/hlydwz-blog/current/dist`.
7. Start or update Docker services: `docker compose up -d`.
8. Restart the SSR service: `systemctl restart blog-astro-ssr`.
9. Verify the ESA → SafeLine → Caddy → SSR/PocketBase request chain and service logs.

Production serves static assets from `dist/client`, mounted read-only at `/srv` in the Caddy container. Dynamic Astro rendering is provided by `blog-astro-ssr` through `dist/server/entry.mjs`. See `docs/SERVER_DEPLOYMENT_INFO.md` and `docs/OPERATIONS_MANUAL.md` for the current production topology and runbook.

## Git History Summary

快照于 2026-07-30（共 224 commits，2026-06-22 ~ 2026-07-30），作者均为 HB。首个提交 df9962f "chore: init project structure"，最新提交 113dfff "feat: 双模式地图、ESA缓存管理、邮件通知优化"。

演进概览：项目初始化 → Astro 前端搭建 → 功能开发与 UI 迭代 → 管理后台与安全加固；详细分阶段改动（Phase 0 ~ Phase 4）见 [docs/TECHNICAL_EVOLUTION_DOC.md](docs/TECHNICAL_EVOLUTION_DOC.md)（2026-07-24 生成，含"分阶段改动详解"章节）。

## Gotchas
- `login_security.pb.js` was previously disabled (`.disabled` suffix) because an early version caused login 400 errors. The current version is re-enabled and fixed (uses `realIP()` + `globalThis` bucket). If you change its rate-limiting logic, test the password login flow for both `users` and `admins` auth.
- React components must use `export default`, never named exports.
- Chinese text in PocketBase rules requires exact matching (past encoding issues).
- `pagefind` runs as a post-build step in `npm run build`.
- `/_/*` and `/api/admins/*` are publicly blocked (404) at Caddy; use SSH tunnel (`ssh -L 18080:127.0.0.1:18080 root@<server>` → `http://localhost:18080/_/`) or set `ADMIN_IP` in server `.env`. Never set compose `ADMIN_IP` default back to `0.0.0.0/0` — that publicly exposed the PB admin UI until 2026-08-31.
- `astro.config.mjs` must keep object-form export + explicit `loadEnv` — function-form `defineConfig(({command})=>...)` loses the adapter (NoAdapterInstalled), and `.env` files never reach `process.env` on their own. Production builds hard-fail if `site` is localhost (bypass: `ALLOW_LOCALHOST_SITE=1`).
- The SSR build emits no prerendered pages; if old static page fossils appear under the server `/srv` tree they will shadow SSR routes — deploys must not restore `index.html`/page dirs into `astro/dist`.
- `astro/dist/` is gitignored; the SSR build produces both client assets and the server entry, and deployment artifacts live under `/opt/hlydwz-blog/current/dist`.

## Subagents (子智能体优先级约定)

本项目在 `.codebuddy/agents/` 下配置了 16 个自定义子智能体，**优先于系统内置子代理（如内置 `code-explorer`）使用**。当任务与以下任一 description 关键词匹配时，应触发对应的自定义子智能体，而非回退到内置代理或主模型：

| 子智能体 | 模型 | 职责 |
|----------|------|------|
| code-reviewer | Qwen3.8-Max-Preview | 代码审查（质量/安全/可维护性） |
| security-auditor | Qwen3.8-Max-Preview | 安全审计（OWASP/注入/XSS） |
| pb-migration-expert | Qwen3.8-Max-Preview | PocketBase 迁移脚本 |
| frontend-ui-expert | Qwen3.8-Max-Preview | 前端 UI/组件/样式 |
| devops-deployer | Qwen3.8-Max-Preview | Docker/Caddy/部署 |
| test-writer | Qwen3.8-Max-Preview | 单元测试/端到端测试 |
| pb-hooks-expert | Qwen3.8-Max-Preview | PocketBase 后端 hook |
| seo-content-expert | Qwen3.8-Max-Preview | SEO/内容/Pagefind |
| code-explorer | Qwen3.8-Max-Preview | 代码库探索（替代内置 code-explorer） |
| debugger | Qwen3.8-Max-Preview | 调试/报错/堆栈追踪 |
| api-designer | Qwen3.8-Max-Preview | Astro API 路由 / PocketBase 接口 |
| refactoring-expert | Qwen3.8-Max-Preview | 重构/架构优化 |
| documentation-writer | Qwen3.8-Max-Preview | 技术文档/注释 |
| performance-optimizer | Qwen3.8-Max-Preview | 性能优化/加载速度 |
| content-writer | Qwen3.8-Max-Preview | 博客文章/文案 |
| git-workflow | Qwen3.8-Max-Preview | Git 操作/版本管理 |

### 模型约定
- **所有子智能体统一使用 `Qwen3.8-Max-Preview` 模型**，不再使用 `hy3` 或 `xopglm52`。
- `Qwen3.8-Max-Preview` 为通义千问 3.8 Max 预览版模型，具备强大的代码理解和生成能力。
- 主模型仅用于主会话编排，不应在子智能体中直接调用。
- 子智能体配置文件中的 `model` 字段必须使用 **Markdown 链接格式**：
  ```yaml
  model: '[Qwen3.8-Max-Preview](qmodel_preview)'
  ```
- **注意**：直接使用显示名称 `Qwen3.8-Max-Preview` 会导致 40506 错误（model not found）。
- 子智能体可通过 Agent 工具的 `subagent_type` 参数直接调用（如 `code-reviewer`），系统会自动加载配置文件中指定的模型。
