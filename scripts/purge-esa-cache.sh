#!/bin/bash
# 部署后清理 ESA 边缘缓存。
#
# 背景：源站对 HTML 返回 no-store，但 ESA 侧仍按缓存规则把 HTML 缓存较长时间；
# 只重启 SSR 不会让边缘换新，用户会继续拿到旧 HTML 及其引用的旧 _astro 资源
# （旧资源在源站已 404，靠边缘自己的副本才没立刻坏）。因此每次部署后必须主动清缓存。
#
# 凭据来自 admin-auth 容器内的 ESA_ACCESS_KEY_ID / ESA_ACCESS_KEY_SECRET / ESA_SITE_ID，
# 复用该服务已有的 ESA 客户端（PurgeCaches），不在这里另写签名逻辑。
#
# 用法：
#   ./scripts/purge-esa-cache.sh                # 清理默认公开页面
#   ./scripts/purge-esa-cache.sh https://hlydwz.com/posts/foo/
#
# 退出码：0 = 已提交清理任务，或环境不具备清理条件（会明确说明，不阻断部署）；
#         1 = 调用 ESA 失败（部署本身已完成，调用方应告警而不是回滚）。
set -uo pipefail

CONTAINER="${ESA_CONTAINER:-$(docker ps --format '{{.Names}}' 2>/dev/null | grep -m1 'admin-auth' || true)}"
if [ -z "${CONTAINER}" ]; then
  echo "[purge] 未找到 admin-auth 容器，跳过 ESA 清理（部署本身不受影响）"
  exit 0
fi

if ! docker exec "${CONTAINER}" printenv ESA_ACCESS_KEY_ID >/dev/null 2>&1; then
  echo "[purge] 容器 ${CONTAINER} 未配置 ESA 凭据，跳过 ESA 清理"
  exit 0
fi

DEFAULT_URLS=(
  "https://hlydwz.com/"
  "https://hlydwz.com/posts/"
  "https://hlydwz.com/tags/"
  "https://hlydwz.com/archive/"
  "https://hlydwz.com/about/"
  "https://hlydwz.com/links/"
  "https://hlydwz.com/guestbook/"
  "https://hlydwz.com/gallery/"
  "https://hlydwz.com/status/"
  "https://hlydwz.com/stats/"
  "https://hlydwz.com/login"
  "https://hlydwz.com/feed.xml"
  "https://hlydwz.com/sitemap-index.xml"
  "https://hlydwz.com/sitemap-0.xml"
  "https://hlydwz.com/robots.txt"
)

if [ "$#" -gt 0 ]; then
  URLS=("$@")
else
  URLS=("${DEFAULT_URLS[@]}")
fi

# 以换行分隔传给容器内脚本：URL 不含空白，直接按行拆分即可。
PURGE_URLS="$(printf '%s\n' "${URLS[@]}")"

docker exec -e PURGE_URLS="${PURGE_URLS}" "${CONTAINER}" node --input-type=module -e '
import { purgeCaches } from "/app/src/esa/client.mjs";

const urls = String(process.env.PURGE_URLS || "")
  .split("\n")
  .map((value) => value.trim())
  .filter(Boolean);

if (urls.length === 0) {
  console.error("[purge] 没有可清理的 URL");
  process.exit(1);
}

const credentials = {
  accessKeyId: process.env.ESA_ACCESS_KEY_ID,
  accessKeySecret: process.env.ESA_ACCESS_KEY_SECRET,
  siteId: process.env.ESA_SITE_ID,
};

try {
  // ESA 单次最多 100 条；默认清单远小于该上限，分批只是防御。
  let submitted = 0;
  let lastTaskId = "";
  for (let start = 0; start < urls.length; start += 100) {
    const batch = urls.slice(start, start + 100);
    const result = await purgeCaches({ credentials, type: "file", urls: batch });
    submitted += batch.length;
    lastTaskId = result.taskId;
  }
  console.log(`[purge] 已提交 ${submitted} 条 URL，TaskId=${lastTaskId}`);
} catch (error) {
  console.error(`[purge] ESA 清理失败：${error?.code || error?.name || "unknown"}`);
  process.exit(1);
}
'

STATUS=$?
if [ "${STATUS}" -ne 0 ]; then
  echo "[purge] ESA 清理未成功（部署已完成，请人工确认边缘缓存）" >&2
  exit 1
fi
exit 0
