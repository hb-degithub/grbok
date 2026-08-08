#!/usr/bin/env bash
# Minimal monitor for hlydwz blog stack (v1.0)
# Deploy: /opt/hlydwz-blog/scripts/monitor.sh (chmod 700)
# Schedule: crontab every 5 min (root).
# Mail unavailable (no msmtp) -> alert log + polling fallback.
# Checks: containers, disk>80%, mem<150M, mysql restart spike, site http.
# Dedup: same alert 1h via state files. Silent when healthy.
set -u
SD=/opt/hlydwz-blog/scripts
LOG=${SD}/monitor.log
ST=${SD}/.monitor-state
DEDUP=3600
RECIPIENT=ops@example.com
mkdir -p ${ST}
log(){ echo "[$(date \"+%F %T\")] $*" >> ${LOG}; }
should_alert(){ local k=$1 now ts; now=$(date +%s); if [ -f ${ST}/${k}.ts ]; then ts=$(cat ${ST}/${k}.ts); if [ $((now-ts)) -lt ${DEDUP} ]; then return 1; fi; fi; echo ${now} > ${ST}/${k}.ts; return 0; }
clear_state(){ rm -f ${ST}/$1.ts; }
alert(){ local k=$1 m=$2; if should_alert ${k}; then log "ALERT[${k}] ${m} recipient:${RECIPIENT}"; fi; }
# 1. container status
for c in blog-caddy blog-pocketbase blog-admin-auth gatus; do
  s=$(docker inspect -f "{{.State.Status}}" ${c} 2>/dev/null || echo missing)
  if [ "${s}" != running ]; then alert container-${c} "status=${s}"; else clear_state container-${c}; fi
done
for c in blog-caddy blog-pocketbase blog-admin-auth gatus; do
  h=$(docker inspect -f "{{if .State.Health}}{{.State.Health.Status}}{{else}}none{{end}}" ${c} 2>/dev/null || echo missing)
  if [ "${h}" = unhealthy ]; then alert health-${c} "health=unhealthy"; else clear_state health-${c}; fi
done
# 2. disk
dp=$(df -P / | tail -1 | tr -s " " | cut -d" " -f5 | tr -d "%")
if [ "${dp}" -gt 80 ]; then alert disk-root "root usage ${dp}%>80%"; else clear_state disk-root; fi
# 3. mem
mkb=$(grep MemAvailable /proc/meminfo | tr -s " " | cut -d" " -f2)
ma=$((mkb/1024))
if [ "${ma}" -lt 150 ]; then alert mem-avail "avail mem ${ma}MB<150MB"; else clear_state mem-avail; fi
# 4. mysql restart spike (>=3 since last run)
rc=$(docker inspect -f "{{.RestartCount}}" 1Panel-mysql-zIf9 2>/dev/null || echo 0)
if [ -f ${ST}/mysql-rc.ts ]; then p=$(cat ${ST}/mysql-rc.ts); if [ "${rc}" -ge $((p+3)) ]; then alert mysql-restart "RestartCount ${p}->${rc}"; else clear_state mysql-restart; fi; fi
echo ${rc} > ${ST}/mysql-rc.ts
# 5. site http fallback (2 consecutive failed polls)
chk(){ local k=$1 u=$2 e=$3 c; c=$(curl -s -o /dev/null -w "%{http_code}" --max-time 10 ${u}); if [ "${c}" != "${e}" ]; then if [ -f ${ST}/http-${k}.fail ]; then alert http-${k} "HTTP ${u} rc=${c} expect=${e}"; else date +%s > ${ST}/http-${k}.fail; fi; else rm -f ${ST}/http-${k}.fail; clear_state http-${k}; fi; }
chk home https://hlydwz.com/ 200
chk health https://hlydwz.com/api/health 200
