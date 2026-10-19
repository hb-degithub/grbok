#!/bin/sh
# 雷池(SafeLine)防护统计采集器:每分钟汇总 hlydwz.com 与 img.hlydwz.com
# 最近 24h 的检测(action=0)与拦截(action=1)事件数,POST 到本站 PocketBase。
# action 语义已于 2026-09-18 实测核实(我自己的 XSS 测试拦截记录 action=1)。
# 挑战数社区版无可靠事件流,不上报。
# 只读查询,失败时上报 ok=false(公开端据此显示"数据过期",不冒充零事件)。

ENV_FILE="/opt/hlydwz-blog/current/.env"
INGEST_URL="http://127.0.0.1:18080/api/internal/monitor/protection"

SECRET=$(grep -E '^ADMIN_AUTH_INTERNAL_SECRET=' "$ENV_FILE" | head -1 | cut -d= -f2- | tr -d '"\r')
[ -z "$SECRET" ] && exit 0

SAMPLED_AT=$(date -u +%Y-%m-%dT%H:%M:%SZ)

ROWS=$(docker exec safeline-pg psql -U safeline-ce -d safeline-ce -t -A -F'|' -c \
  "SELECT action, COUNT(*) FROM mgt_detect_log_basic WHERE host IN ('hlydwz.com','img.hlydwz.com') AND timestamp > EXTRACT(EPOCH FROM NOW())::bigint - 86400 GROUP BY action;" 2>/dev/null)

if [ -z "$ROWS" ]; then
  # 采集失败:报 ok=false,公开端会把数据标为过期/不可用而不是显示 0
  curl -s -o /dev/null -m 8 -X POST "$INGEST_URL" \
    -H 'Content-Type: application/json' \
    -H "X-Internal-Secret: $SECRET" \
    -d "{\"ok\":false,\"error\":\"safeline query failed\",\"sampledAt\":\"$SAMPLED_AT\"}"
  exit 0
fi

DETECTED=0
BLOCKED=0
echo "$ROWS" | while IFS='|' read -r action cnt; do
  case "$action" in
    0) DETECTED=$cnt ;;
    1) BLOCKED=$cnt ;;
  esac
done
# 子 shell 变量回传不了,用 awk 重算一次(行数极少,成本可忽略)
DETECTED=$(echo "$ROWS" | awk -F'|' '$1=="0"{print $2}')
BLOCKED=$(echo "$ROWS" | awk -F'|' '$1=="1"{print $2}')
DETECTED=${DETECTED:-0}
BLOCKED=${BLOCKED:-0}

curl -s -o /dev/null -m 8 -X POST "$INGEST_URL" \
  -H 'Content-Type: application/json' \
  -H "X-Internal-Secret: $SECRET" \
  -d "{\"ok\":true,\"detected\":$DETECTED,\"blocked\":$BLOCKED,\"windowHours\":24,\"sampledAt\":\"$SAMPLED_AT\"}"
