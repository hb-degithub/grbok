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
| Frontend (SSG) | Astro 6 + React 19 + TailwindCSS 4 | Static site, islands architecture |
| Motion | Framer Motion 12 | Client-side animations |
| Search | Pagefind | Offline full-text search |
| Backend | PocketBase 0.22.21 (SQLite) | Auth, DB, API, file storage |
| Web Server | Caddy 2.8.4-alpine | Auto HTTPS, reverse proxy, security headers |
| Email | PocketBase SMTP (Aliyun) + msmtp fallback | Verification, magic link, notifications |
| Deployment | Docker Compose | Unified orchestration |

## Architecture

```
Browser
  |
  v
Caddy (:80/:443)  ----------> Astro static files (/srv = astro/dist)
  |                             (try_files -> SPA fallback /index.html)
  |   /api/*  ----------> PocketBase :8090 (BaaS)
  |   /_/*    ----------> PocketBase :8090 (admin UI, IP whitelist only)
```

Caddy applies security headers on every response. Astro is SSG — the build outputs pure static HTML/CSS/JS into `astro/dist/`.

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
- Caddy handles: HSTS, CSP, X-Frame-Options, directory-scan blocking, admin UI IP whitelist.
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

Six collections, full details in [docs/pocketbase-schema.md](docs/pocketbase-schema.md):

| Collection | Type | Key relations |
|-----------|------|---------------|
| `users` | Auth | roles: admin / author / reader |
| `posts` | Base | author -> users, status: draft / published / archived |
| `comments` | Base | post_id -> posts, parent_id -> comments (nested) |
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

1. Generate encryption key: `openssl rand -hex 32`
2. Copy `.env.example` -> `.env`, fill real values
3. Run `security-check.sh` for pre-deploy validation (keys, IP, domain)
4. Apply PocketBase security rules
5. Enable OpenResty login rate limiting on public gateway
6. Build Astro: `cd astro && npm run build`
7. Start: `docker compose up -d`

Static files are served from `astro/dist/`, mounted read-only at `/srv` in Caddy container.

## Git History Summary

27 commits (2026-06-22 ~ 2026-06-24), all authored by HB. Major phases:
1. Init — project structure, Docker, Caddy, PB schema
2. Astro scaffold — tailwind, mdx, sitemap, pocketbase SDK
3. Features — auth (magic link + password), nested comments, pagefind search
4. UI overhaul — animation system, glassmorphism, dark hero, premium design
5. Admin panel — CRUD for posts/comments/tags/users/settings, security audit
6. Bug fixes — hydration issues, encoding, Chinese error messages, CSS aliases

## Gotchas
- `login_security.pb.js` was previously disabled (`.disabled` suffix) because an early version caused login 400 errors. The current version is re-enabled and fixed (uses `realIP()` + `globalThis` bucket). If you change its rate-limiting logic, test the password login flow for both `users` and `admins` auth.
- React components must use `export default`, never named exports.
- Chinese text in PocketBase rules requires exact matching (past encoding issues).
- `pagefind` runs as a post-build step in `npm run build`.
- Caddy admin UI (`/_/*`) is IP-whitelisted via `ADMIN_IP` env var.
- `astro/dist/` is gitignored; build output only exists locally and in deploy artifacts.

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
