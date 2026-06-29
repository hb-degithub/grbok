#!/usr/bin/env bash
# Production deployment safety checks.
# Run before docker compose up. This script does not read or print passwords.

set -euo pipefail

RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m'

fail=0
warn=0

ok() {
    echo -e "${GREEN}OK${NC} $1"
}

bad() {
    echo -e "${RED}FAIL${NC} $1"
    fail=1
}

note() {
    echo -e "${YELLOW}WARN${NC} $1"
    warn=$((warn + 1))
}

echo "Production security check..."
echo ""

if [ ! -f ".env" ]; then
    bad "Missing .env. Production should not use .env.local."
else
    ok "Found .env"

    KEY=$(grep -E "^PB_ENCRYPTION_KEY=" .env | cut -d= -f2- || true)
    if [ -z "$KEY" ] || [ "$KEY" = "your_32_byte_hex_key_here" ] || [ "$KEY" = "a1b2c3d4e5f6a7b8c9d0e1f2a3b4c5d6e7f8a9b0c1d2e3f4a5b6c7d8e9f0a1b2" ]; then
        bad "PB_ENCRYPTION_KEY is missing or still uses a default/test value."
    elif [ ${#KEY} -ne 64 ]; then
        note "PB_ENCRYPTION_KEY length is not 64 hex characters."
    else
        ok "PB_ENCRYPTION_KEY is configured and non-default"
    fi

    ADMIN_IP=$(grep -E "^ADMIN_IP=" .env | cut -d= -f2- || true)
    if [ "$ADMIN_IP" = "0.0.0.0" ] || [ -z "$ADMIN_IP" ]; then
        bad "ADMIN_IP must be a concrete trusted IP in production."
    else
        ok "ADMIN_IP is restricted"
    fi

    DOMAIN=$(grep -E "^DOMAIN=" .env | cut -d= -f2- || true)
    if [ "$DOMAIN" = "blog.example.com" ] || [ -z "$DOMAIN" ]; then
        bad "DOMAIN is missing or still uses blog.example.com."
    else
        ok "DOMAIN is configured"
    fi

    SMTP_USER=$(grep -E "^ALIYUN_SMTP_USER=" .env | cut -d= -f2- || true)
    if [ -z "$SMTP_USER" ] || [ "$SMTP_USER" = "smtp_xxx@xxx.example.com" ]; then
        note "ALIYUN_SMTP_USER is not configured; OTP/magic-link email may be unavailable."
    fi
fi

for hook in guard_user_role.pb.js validate_comment.pb.js send_email_comment.pb.js; do
    if [ ! -f "pb_hooks/$hook" ]; then
        bad "Missing pb_hooks/$hook"
    fi
done

if [ -f "pb_hooks/login_security.pb.js" ]; then
    bad "pb_hooks/login_security.pb.js must stay disabled; use OpenResty login endpoint rate limits instead."
elif [ -f "pb_hooks/login_security.pb.js.disabled" ]; then
    ok "PocketBase login_security hook is disabled"
else
    note "pb_hooks/login_security.pb.js.disabled was not found; ensure the login hook is not deployed under the active .pb.js name."
fi

for caddyfile in Caddyfile Caddyfile.local; do
    if [ -f "$caddyfile" ] && grep -Eq '^[[:space:]]*rate_limit\b' "$caddyfile"; then
        bad "$caddyfile contains rate_limit, but caddy:2.8.4-alpine does not support that directive."
    fi
done

if grep -Fq 'handle /api/admins/*' Caddyfile && grep -Fq 'PocketBase admin API is restricted' Caddyfile; then
    ok "Caddy restricts PocketBase admin API by ADMIN_IP"
else
    bad "Caddyfile must restrict /api/admins/* before the generic /api/* proxy."
fi

if grep -Fq 'X-Robots-Tag "noindex, nofollow, noarchive"' Caddyfile; then
    ok "Caddy sends noindex headers for sensitive static routes"
else
    bad "Caddyfile should send noindex headers for /admin* and /login*."
fi

if grep -Fq 'handle /admin*' Caddyfile && grep -Fq 'Forbidden: admin pages are restricted' Caddyfile; then
    ok "Caddy restricts static admin pages by ADMIN_IP"
else
    bad "Caddyfile must restrict /admin* static pages by ADMIN_IP."
fi

if grep -Fq 'Strict-Transport-Security' Caddyfile; then
    ok "Caddy sends HSTS"
else
    bad "Caddyfile should send Strict-Transport-Security in production."
fi

if [ -f "astro/public/robots.txt" ] && grep -Fq 'Disallow: /admin/' astro/public/robots.txt && grep -Fq 'Disallow: /api/' astro/public/robots.txt; then
    ok "robots.txt excludes sensitive routes from crawlers"
else
    bad "astro/public/robots.txt should disallow /admin/, /login/, /api/, and /_/ ."
fi

if grep -Fq "'/admin/'" astro/astro.config.mjs && grep -Fq "'/login/'" astro/astro.config.mjs; then
    ok "Astro sitemap excludes admin and login routes"
else
    bad "Astro sitemap must exclude /admin/* and /login/."
fi

if [ ! -f "docs/openresty-login-rate-limit.conf" ]; then
    bad "Missing docs/openresty-login-rate-limit.conf"
else
    for path in \
        "/api/collections/users/auth-with-password" \
        "/api/admins/auth-with-password" \
        "/api/collections/users/request-otp" \
        "/api/collections/users/auth-with-otp" \
        "/api/collections/users/records" \
        "/api/collections/users/request-password-reset" \
        "/api/collections/users/confirm-password-reset" \
        "/api/collections/users/request-verification" \
        "/api/collections/users/confirm-verification" \
        "/api/collections/users/request-email-change" \
        "/api/collections/users/confirm-email-change" \
        "/api/collections/comments/records"; do
        if ! grep -Fq "$path" docs/openresty-login-rate-limit.conf; then
            bad "OpenResty login rate-limit config does not cover $path"
        fi
    done
    ok "OpenResty auth rate-limit config covers login, OTP, registration, email actions, and comments"
    note "Before public production traffic, include docs/openresty-login-rate-limit.conf in the external OpenResty/1Panel site config."
fi

if [ -f "docs/apply_security_rules.pb.js" ]; then
    note "Copy docs/apply_security_rules.pb.js to pb_migrations/ before the first production start."
fi

echo ""
if [ "$fail" -ne 0 ]; then
    echo -e "${RED}Security check failed. Fix the FAIL items before deployment.${NC}"
    exit 1
fi

if [ "$warn" -ne 0 ]; then
    echo -e "${YELLOW}Security check passed with $warn warning(s).${NC}"
else
    echo -e "${GREEN}Security check passed.${NC}"
fi

echo "Next: docker compose up -d"