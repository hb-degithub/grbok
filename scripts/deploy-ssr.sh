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
curl -s -o /dev/null -w 'SSR 首页: %{http_code}\n' http://127.0.0.1:4321/
curl -s http://127.0.0.1:4321/ | grep -o 'PostActions\.[A-Za-z0-9_-]*\.js' | head -1

echo ""
echo "=== 6. 冒烟：静态资产（经 Caddy）==="
curl -s -o /dev/null -w 'Caddy 源站: %{http_code}\n' http://127.0.0.1:18080/

echo ""
echo "=== 7. 冒烟：外网 ==="
curl -s -o /dev/null -w '外网首页: %{http_code}\n' https://hlydwz.com/

echo ""
echo "=== 清理 ==="
rm -rf /tmp/dist_pkg /tmp/dist_pkg.tar.gz
echo "ALL DONE"
