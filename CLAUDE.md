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
| Email | msmtp + Aliyun push | Magic link / comment notifications |
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
  login_security.pb.js.disabled  # Disabled (caused login 400 errors)
  send_email_comment.pb.js       # Email notification on new comments
  validate_comment.pb.js         # Server-side comment validation + IP logging

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
- Admin pages are guarded by `AdminGuard` (server-side token validation).
- Caddy handles: HSTS, CSP, X-Frame-Options, directory-scan blocking, admin UI IP whitelist.
- `login_security.pb.js` is DISABLED — dont re-enable without testing login flow.
- `validate_comment.pb.js` logs IP address but excludes it from public API responses.

### Environment Variables
| Variable | Used By | Default |
|----------|---------|---------|
| `PUBLIC_SITE_URL` | Astro build | `http://localhost:4321` |
| `PUBLIC_POCKETBASE_URL` | Astro (PB client) | `http://localhost:8090` |
| `PB_ENCRYPTION_KEY` | Docker Compose | (required) |
| `ADMIN_IP` | Caddy | (admin whitelist IP) |
| `TZ` | PocketBase container | `Asia/Shanghai` |

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
- Dont touch `login_security.pb.js.disabled` — re-enabling breaks login.
- React components must use `export default`, never named exports.
- Chinese text in PocketBase rules requires exact matching (past encoding issues).
- `pagefind` runs as a post-build step in `npm run build`.
- Caddy admin UI (`/_/*`) is IP-whitelisted via `ADMIN_IP` env var.
- `astro/dist/` is gitignored; build output only exists locally and in deploy artifacts.
