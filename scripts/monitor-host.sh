#!/bin/sh
# 宿主机性能采样:CPU / 内存 / 磁盘 / 网络速率 / load1
# 由 cron 每分钟执行,POST 到本站 PocketBase 的 /api/internal/monitor/host
# (该接口仅接受回环地址 + X-Internal-Secret 校验)

ENV_FILE="/opt/hlydwz-blog/current/.env"
INGEST_URL="http://127.0.0.1:18080/api/internal/monitor/host"

SECRET=$(grep -E '^ADMIN_AUTH_INTERNAL_SECRET=' "$ENV_FILE" | head -1 | cut -d= -f2- | tr -d '"\r')
[ -z "$SECRET" ] && exit 0

# --- 第一次采样:CPU jiffies 与网卡字节数 ---
read cpu u1 n1 s1 i1 io1 irq1 sirq1 rest < /proc/stat
RX1=$(awk -F'[: ]+' '/:/{if($2!="lo"){rx+=$3;tx+=$11}} END{print rx+0}' /proc/net/dev)
TX1=$(awk -F'[: ]+' '/:/{if($2!="lo"){rx+=$3;tx+=$11}} END{print tx+0}' /proc/net/dev)

sleep 1

# --- 第二次采样 ---
read cpu u2 n2 s2 i2 io2 irq2 sirq2 rest < /proc/stat
RX2=$(awk -F'[: ]+' '/:/{if($2!="lo"){rx+=$3;tx+=$11}} END{print rx+0}' /proc/net/dev)
TX2=$(awk -F'[: ]+' '/:/{if($2!="lo"){rx+=$3;tx+=$11}} END{print tx+0}' /proc/net/dev)

# CPU 使用率 = 1 - idle增量/total增量
CPU_PCT=$(awk -v a1=$((u1+n1+s1+i1+io1+irq1+sirq1)) -v a2=$((u2+n2+s2+i2+io2+irq2+sirq2)) \
  -v d1=$((i1+io1)) -v d2=$((i2+io2)) \
  'BEGIN{t=a2-a1; if(t<=0){print 0}else{printf "%.1f", (1-(d2-d1)/t)*100}}')

RX_KBPS=$(( (RX2 - RX1) / 1024 ))
TX_KBPS=$(( (TX2 - TX1) / 1024 ))
[ "$RX_KBPS" -lt 0 ] && RX_KBPS=0
[ "$TX_KBPS" -lt 0 ] && TX_KBPS=0

# 内存
MEM_TOTAL=$(awk '/^MemTotal:/{print int($2/1024)}' /proc/meminfo)
MEM_AVAIL=$(awk '/^MemAvailable:/{print int($2/1024)}' /proc/meminfo)
MEM_USED=$((MEM_TOTAL - MEM_AVAIL))
MEM_PCT=$(awk -v u="$MEM_USED" -v t="$MEM_TOTAL" 'BEGIN{if(t<=0){print 0}else{printf "%.1f", u/t*100}}')

# 磁盘(根分区)
DISK_PCT=$(df -P / | awk 'NR==2{gsub(/%/,"",$5); print $5}')

# load1
LOAD1=$(awk '{print $1}' /proc/loadavg)

curl -s -o /dev/null -m 5 -X POST "$INGEST_URL" \
  -H 'Content-Type: application/json' \
  -H "X-Internal-Secret: $SECRET" \
  -d "{\"cpuPct\":$CPU_PCT,\"memPct\":$MEM_PCT,\"memUsedMb\":$MEM_USED,\"memTotalMb\":$MEM_TOTAL,\"rxKbps\":$RX_KBPS,\"txKbps\":$TX_KBPS,\"diskPct\":$DISK_PCT,\"load1\":$LOAD1}"
