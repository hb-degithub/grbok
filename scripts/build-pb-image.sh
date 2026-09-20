#!/bin/bash
# 构建 PocketBase 0.22.48 安全补丁镜像（2026-09-20 审计修复）
#
# 背景：ghcr.io/muchobien/pocketbase 镜像线最高只到 0.22.32，未包含
#   - v0.22.42: GHSA-pq7p-mc74-g65w / CVE-2026-44166（OAuth2 预劫持，本站未用 OAuth2）
#   - v0.22.48: CVE-2026-82410（panic-recovery DoS，适用）
# 因此直接用 PocketBase 官方 release 二进制构建等价镜像，入口参数与
# muchobien 0.22.21 容器完全一致（serve --http=0.0.0.0:8090 --dir=/pb_data
# --publicDir=/pb_public --hooksDir=/pb_hooks，无 --migrationsDir，默认 /pb_migrations）。
#
# 用法（服务器上）：bash scripts/build-pb-image.sh [版本号，默认 0.22.48]
# 产出本地镜像 tag：pocketbase:<版本>-hlydwz（docker-compose.yml 引用）
set -euo pipefail

VER="${1:-0.22.48}"
TAG="pocketbase:${VER}-hlydwz"
WORK=$(mktemp -d)

echo "[1/4] 下载 PocketBase v${VER} 官方二进制..."
curl -sfL -o "${WORK}/pb.zip" \
  "https://github.com/pocketbase/pocketbase/releases/download/v${VER}/pocketbase_${VER}_linux_amd64.zip"
unzip -oq "${WORK}/pb.zip" -d "${WORK}"
ACTUAL=$("${WORK}/pocketbase" --version | grep -o '[0-9][0-9.]*' | head -1)
if [ "${ACTUAL}" != "${VER}" ]; then
  echo "FATAL: 版本校验失败，期望 ${VER} 实际 ${ACTUAL}" >&2
  exit 1
fi
echo "      版本校验通过: ${ACTUAL}"

echo "[2/4] 写 Dockerfile..."
mkdir -p "${WORK}/image"
cp "${WORK}/pocketbase" "${WORK}/image/"
cat > "${WORK}/image/Dockerfile" <<'EOF'
FROM alpine:3.20
RUN apk add --no-cache ca-certificates tzdata
COPY pocketbase /bin/pocketbase
EXPOSE 8090
ENTRYPOINT ["pocketbase"]
CMD ["serve", "--http=0.0.0.0:8090", "--dir=/pb_data", "--publicDir=/pb_public", "--hooksDir=/pb_hooks"]
EOF

echo "[3/4] docker build ${TAG}..."
docker build -t "${TAG}" "${WORK}/image"

echo "[4/4] 完成：${TAG}"
docker image inspect "${TAG}" --format '镜像: {{.RepoTags}} 大小: {{.Size}}'
