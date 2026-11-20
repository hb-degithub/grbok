#!/bin/bash
# SSR 前端部署：静态资产 → Caddy /srv + Astro SSR（client+server）→ 重启 ssr 服务
# 严禁 rm -rf 重建目录（bind mount inode 悬空事故教训），一律 rsync 原地更新
set -e
CUR=/opt/hlydwz-blog/current

echo "=== 1. 解压构建产物 ==="
rm -rf /tmp/dist_pkg && mkdir -p /tmp/dist_pkg
tar xzf /tmp/dist_pkg.tar.gz -C /tmp/dist_pkg
ls /tmp/dist_pkg/client | head -3
ls /tmp/dist_pkg/server | head -3

echo ""
echo "=== 2. 同步 Caddy 静态目录（/srv bind mount 源）==="
# 排除 404.html（Caddy handle_errors 依赖，构建不产出）与 pagefind（独立生成的搜索索引）
rsync -a --delete --exclude='404.html' --exclude='404.html.bak*' --exclude='pagefind/' /tmp/dist_pkg/client/ $CUR/astro/dist/
echo "astro/dist OK"

echo ""
echo "=== 3. 同步 SSR 应用目录 ==="
rsync -a --delete /tmp/dist_pkg/client/ $CUR/dist/client/
rsync -a --delete /tmp/dist_pkg/server/ $CUR/dist/server/
# 顶层静态文件副本（现状结构）：只增不删，保护 node_modules/package.json/client/server
rsync -a /tmp/dist_pkg/client/ $CUR/dist/
echo "dist OK"

echo ""
echo "=== 4. 重启 SSR 服务 ==="
systemctl restart blog-astro-ssr
sleep 4
systemctl is-active blog-astro-ssr
systemctl status blog-astro-ssr --no-pager | head -5

echo ""
echo "=== 5. 冒烟：SSR 首页 ==="
# SSR 的监听地址由 systemd 单元的 Environment 决定,并非总是 loopback:
# 生产实测为 HOST=10.255.0.1(见 .superpowers/sdd/task-production-prep-report.md),
# 此时按 loopback 访问 4321 会 connection refused,而本脚本是 set -e,
# 会在「文件已同步、服务已重启」之后误判为部署失败。故从 unit 里读取真实监听地址。
# systemctl show 失败(如 unit 名变更)不阻断脚本,退回 127.0.0.1 的保守缺省。
SSR_ENV=$(systemctl show -p Environment blog-astro-ssr 2>/dev/null || true)
# 输出形如 Environment=HOST=10.255.0.1 PORT=4321 ...:
# 先去掉整行的双/单引号(systemd 输出带引号时,引号会粘在 token 上导致 ^HOST= 失配;
# HOST 作为主机名/地址不含引号,删除引号不会损坏它),
# 再去掉行首的 "Environment=" (否则它会和第一个赋值粘成同一个空白分隔 token),
# 最后按空白拆词取 HOST= 的值;多行时取最后一个匹配。
SSR_HOST=$(printf '%s\n' "$SSR_ENV" | tr -d "\"'" | sed -n 's/^Environment=//p' \
  | tr ' ' '\n' | sed -n 's/^HOST=//p' | tail -1)
# 空值或通配绑定(0.0.0.0/::/*)一律走 loopback 访问
case "$SSR_HOST" in ''|0.0.0.0|::|'*') SSR_HOST=127.0.0.1 ;; esac
echo "SSR 监听地址: ${SSR_HOST}:4321"
curl -s -o /dev/null -w 'SSR 首页: %{http_code}\n' "http://${SSR_HOST}:4321/"
curl -s "http://${SSR_HOST}:4321/" | grep -o 'PostActions\.[A-Za-z0-9_-]*\.js' | head -1

echo ""
echo "=== 6. 冒烟：静态资产（经 Caddy）==="
curl -s -o /dev/null -w 'Caddy 源站: %{http_code}\n' http://127.0.0.1:18080/

echo ""
echo "=== 7. 冒烟：外网 ==="
curl -s -o /dev/null -w '外网首页: %{http_code}\n' https://hlydwz.com/

echo ""
echo "=== 8. 清理 ESA 边缘缓存 ==="
# 源站已换新，但边缘仍可能返回旧 HTML（其引用的旧 _astro 资源在源站已 404）。
# 本脚本常以 `ssh ... 'bash -s' < deploy-ssr.sh` 执行，$0 不是脚本路径，
# 因此这里内联调用容器内的 ESA 客户端，不依赖脚本文件位置。
# 清理失败不回滚部署：服务已经起来，只是边缘可能短暂滞后；这里只告警。
ESA_CONTAINER="${ESA_CONTAINER:-$(docker ps --format '{{.Names}}' 2>/dev/null | grep -m1 'admin-auth' || true)}"
if [ -n "${ESA_CONTAINER}" ] && docker exec "${ESA_CONTAINER}" printenv ESA_ACCESS_KEY_ID >/dev/null 2>&1; then
  docker exec -e PURGE_URLS="https://hlydwz.com/
https://hlydwz.com/posts/
https://hlydwz.com/tags/
https://hlydwz.com/archive/
https://hlydwz.com/about/
https://hlydwz.com/links/
https://hlydwz.com/guestbook/
https://hlydwz.com/gallery/
https://hlydwz.com/status/
https://hlydwz.com/stats/
https://hlydwz.com/login
https://hlydwz.com/feed.xml
https://hlydwz.com/sitemap-index.xml
https://hlydwz.com/sitemap-0.xml
https://hlydwz.com/robots.txt" "${ESA_CONTAINER}" node --input-type=module -e '
import { purgeCaches } from "/app/src/esa/client.mjs";
const urls = String(process.env.PURGE_URLS || "").split("\n").map((v) => v.trim()).filter(Boolean);
const credentials = {
  accessKeyId: process.env.ESA_ACCESS_KEY_ID,
  accessKeySecret: process.env.ESA_ACCESS_KEY_SECRET,
  siteId: process.env.ESA_SITE_ID,
};
try {
  const result = await purgeCaches({ credentials, type: "file", urls });
  console.log(`[purge] 已提交 ${urls.length} 条 URL，TaskId=${result.taskId}`);
} catch (error) {
  console.error(`[purge] ESA 清理失败：${error?.code || error?.name || "unknown"}`);
  process.exit(1);
}
' || echo "WARN: ESA 缓存清理失败，请人工确认边缘是否仍返回旧版本"
else
  echo "WARN: 未找到可用的 admin-auth/ESA 配置，跳过边缘缓存清理"
fi


echo ""
echo "=== 清理 ==="
rm -rf /tmp/dist_pkg /tmp/dist_pkg.tar.gz
echo "ALL DONE"
