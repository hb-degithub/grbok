#!/bin/sh
# 雷池(SafeLine)防护统计采集器(V2,API 版):每分钟汇总 hlydwz.com 与 img.hlydwz.com
# 最近 24h 的检测(action=0)与拦截(action=1)事件数,POST 到本站 PocketBase。
# 数据来源:雷池 mgt 开放 API  GET /api/open/records(Authorization: Bearer <JWT>)
#   - 时间参数 start/end 为毫秒时间戳;page_size 上限 100,按 total 分页拉全(最多 10 页)
#   - 只读查询;失败上报 ok=false,公开端显示"数据过期"而不是冒充 0

ENV_FILE="/opt/hlydwz-blog/current/.env"
INGEST_URL="http://127.0.0.1:18080/api/internal/monitor/protection"
API_BASE="https://127.0.0.1:9443"
TMPD=$(mktemp -d)
trap 'rm -rf "$TMPD"' EXIT

SECRET=$(grep -E '^ADMIN_AUTH_INTERNAL_SECRET=' "$ENV_FILE" | head -1 | cut -d= -f2- | tr -d '"\r')
TOKEN=$(grep -E '^SAFELINE_API_TOKEN=' "$ENV_FILE" | head -1 | cut -d= -f2- | tr -d '"\r')
[ -z "$SECRET" ] && exit 0

SAMPLED_AT=$(date -u +%Y-%m-%dT%H:%M:%SZ)
NOW_MS=$(($(date +%s) * 1000))
START_MS=$((NOW_MS - 86400000))
PS=100

fetch_page() {
  curl -sk -m 15 -H "Authorization: Bearer $TOKEN" \
    "$API_BASE/api/open/records?page=$1&page_size=$PS&start=$START_MS&end=$NOW_MS" -o "$TMPD/p$1.json"
}

fetch_page 1
TOTAL=$(python3 -c "
import sys,json
try:
  d=json.load(open('$TMPD/p1.json')); print((d.get('data') or {}).get('total') or 0)
except Exception: print(-1)
")
if [ "$TOTAL" = "-1" ]; then
  curl -s -o /dev/null -m 8 -X POST "$INGEST_URL" -H 'Content-Type: application/json' -H "X-Internal-Secret: $SECRET" \
    -d "{\"ok\":false,\"error\":\"safeline api failed\",\"sampledAt\":\"$SAMPLED_AT\"}"
  exit 0
fi

PAGES=1
[ "$TOTAL" -gt "$PS" ] && PAGES=$(( (TOTAL + PS - 1) / PS ))
[ "$PAGES" -gt 10 ] && PAGES=10
i=2
while [ "$i" -le "$PAGES" ]; do fetch_page "$i"; i=$((i+1)); done

COUNTS=$(python3 -c "
import glob,json
rows=[]
for f in sorted(glob.glob('$TMPD/p*.json')):
    try:
        d=json.load(open(f)); rows += (d.get('data') or {}).get('data') or []
    except Exception: pass
hosts={'hlydwz.com','img.hlydwz.com'}
det=sum(1 for r in rows if r.get('host') in hosts and r.get('action')==0)
blk=sum(1 for r in rows if r.get('host') in hosts and r.get('action')==1)
print(f'{det} {blk} {len(rows)}')
" 2>/dev/null)

if [ -z "$COUNTS" ]; then
  curl -s -o /dev/null -m 8 -X POST "$INGEST_URL" -H 'Content-Type: application/json' -H "X-Internal-Secret: $SECRET" \
    -d "{\"ok\":false,\"error\":\"parse failed\",\"sampledAt\":\"$SAMPLED_AT\"}"
  exit 0
fi

DETECTED=$(echo "$COUNTS" | awk '{print $1}'); BLOCKED=$(echo "$COUNTS" | awk '{print $2}')
DETECTED=${DETECTED:-0}; BLOCKED=${BLOCKED:-0}

curl -s -o /dev/null -m 8 -X POST "$INGEST_URL" -H 'Content-Type: application/json' -H "X-Internal-Secret: $SECRET" \
  -d "{\"ok\":true,\"detected\":$DETECTED,\"blocked\":$BLOCKED,\"windowHours\":24,\"sampledAt\":\"$SAMPLED_AT\"}"
