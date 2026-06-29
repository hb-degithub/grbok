# 部署指南 - 胡巴的博客

## 前提条件
- 服务器 SSH 可连接
- 服务器已运行 Docker + Caddy + PocketBase
- 当前构建已通过 (pm run build\)

## 步骤 1: 推送代码到 GitHub
`ash
git push origin main
`

## 步骤 2: 在服务器拉取代码
`ash
# SSH 连接到服务器后：
cd /opt/hlydwz-blog
git pull origin main
`

## 步骤 3: 运行迁移
`ash
# 验证迁移
bash scripts/verify-pocketbase-migrations-linux.sh

# 迁移文件位于 pb_migrations/
# 重启 PocketBase 容器以应用新迁移
docker restart blog-pb  # 或你的 PocketBase 容器名
`

## 步骤 4: 构建前端
`ash
cd astro
export PUBLIC_SITE_URL=https://hlydwz.com
export PUBLIC_POCKETBASE_URL=https://hlydwz.com
npm run build
`

## 步骤 5: 部署静态文件
`ash
# 替换 dist 目录
rm -rf /opt/hlydwz-blog/current/astro/dist
cp -r astro/dist /opt/hlydwz-blog/current/astro/dist

# 重启 Caddy 使新文件生效
docker restart blog-caddy  # 或你的 Caddy 容器名
`

## 步骤 6: 验证
- https://hlydwz.com/ - 首页
- https://hlydwz.com/login/ - 登录页
- https://hlydwz.com/api/health - 健康检查
- https://hlydwz.com/archive/ - 归档页
- https://hlydwz.com/admin/ - 后台

## 注意事项
- 迁移前先备份生产数据: \docker exec blog-pb tar czf /backup/pb-.tar.gz /pb_data- \.env\ 和私钥不要提交到 git
- 迁移不可逆，请先在临时环境验证

## 新功能说明
- 8 个新 PocketBase 集合: audit_logs, media_assets, friend_links, announcements, post_versions, reactions, comment_reports
- posts 表新增字段: is_pinned, is_featured, seo_title, seo_description, seo_keywords, reading_time, archived_at
- tags 表新增字段: color, sort_order, is_featured
