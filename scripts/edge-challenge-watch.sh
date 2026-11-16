#!/bin/sh
# 边缘挑战页看门狗（2026-11-16）
#
# 背景：SafeLine 的 JS 挑战页（HTML 里 <title id="slg-title">）会被阿里云 ESA 当成普通
# HTML 缓存数天到数周（实测 Age 达 2,019,461s ≈ 23 天），且 ESA 忽略源站的
# Cache-Control: no-cache。结果正常用户/爬虫拿到的是挑战页而不是真实页面，
# 且挑战页对已缓存响应不再二次校验 —— 只能靠主动刷新缓存恢复。
#
# 做法：周期性抓取关键页面，命中挑战页标记就对「调用方给的那批 URL」执行 ESA 文件刷新。
# 不打印任何凭据；失败只写 stderr 与状态文件，不静默吞掉。
#
# 用法：edge-challenge-watch.sh            # 检查并自动刷新
#       edge-challenge-watch.sh --dry-run  # 只检查，不刷新
#
# 依赖：curl、grep；ESA 凭据来自 /opt/hlydwz-blog/current/.env 的
#       ESA_ACCESS_KEY_ID / ESA_ACCESS_KEY_SECRET / ESA_SITE_ID。

set -eu

ENV_FILE="${ENV_FILE:-/opt/hlydwz-blog/current/.env}"
SITE="https://hlydwz.com"
PATH_LIST="/about/ /archive/ /tags/ /posts/ /gallery/ /guestbook/ /projects/ /links/ /stats/ /status/"
CHALLENGE_MARK='slg-title'
DRY_RUN=0
[ "${1:-}" = "--dry-run" ] && DRY_RUN=1

if [ ! -f "$ENV_FILE" ]; then
  echo "edge-watch: missing env file $ENV_FILE" >&2
  exit 2
fi

ESA_ID=$(grep -E '^ESA_ACCESS_KEY_ID=' "$ENV_FILE" | head -1 | cut -d= -f2- | tr -d '"\r')
ESA_SECRET=$(grep -E '^ESA_ACCESS_KEY_SECRET=' "$ENV_FILE" | head -1 | cut -d= -f2- | tr -d '"\r')
ESA_SITE=$(grep -E '^ESA_SITE_ID=' "$ENV_FILE" | head -1 | cut -d= -f2- | tr -d '"\r')

if [ -z "$ESA_ID" ] || [ -z "$ESA_SECRET" ] || [ -z "$ESA_SITE" ]; then
  echo "edge-watch: ESA credentials incomplete; skipping" >&2
  exit 2
fi

STAMP=$(date -u +%Y-%m-%dT%H:%M:%SZ)
JUNK=""
COUNT=0

for path in $PATH_LIST; do
  body=$(curl -fsS --max-time 15 "$SITE$path?edge-watch=$STAMP" 2>/dev/null || true)
  if [ -n "$body" ] && printf '%s' "$body" | grep -q "$CHALLENGE_MARK"; then
    echo "edge-watch: challenge page detected at $path" >&2
    JUNK="$JUNK\"$SITE$path\","
    COUNT=$((COUNT + 1))
  fi
done

if [ "$COUNT" -eq 0 ]; then
  echo "edge-watch: clean ($STAMP)"
  exit 0
fi

JUNK=$(printf '%s' "$JUNK" | sed 's/,$//')
echo "edge-watch: $COUNT challenged path(s); purging" >&2

if [ "$DRY_RUN" -eq 1 ]; then
  echo "edge-watch: dry-run, would purge: [$JUNK]"
  exit 0
fi

aliyun --secure esa PurgeCaches \
  --SiteId "$ESA_SITE" --Type file --Content "{\"Files\":[$JUNK]}" \
  --access-key-id "$ESA_ID" --access-key-secret "$ESA_SECRET" >/dev/null 2>&1 \
  && echo "edge-watch: purge submitted for $COUNT path(s)" \
  || { echo "edge-watch: purge failed" >&2; exit 1; }

exit 0
