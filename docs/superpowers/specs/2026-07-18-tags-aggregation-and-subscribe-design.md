# 标签聚合改版 + 订阅页设计（子项目 G）

日期：2026-07-18
状态：已批准（用户"可以"确认）

## 范围

- Part 1：`/tags` 改版为"标签+文章"聚合视图（纯前端，构建期取数，零后端改动）
- Part 2：`/subscribe` 订阅页（纯静态，零后端）
- 导航入口：`/subscribe` 加入 Dock 更多 / SideNav 更多功能

已确认决策：

- 标签聚合：**改版 /tags**（每个标签卡片列出最新 3 篇文章），不另建专题页
- 订阅页：**仅 RSS**（无邮件订阅），纯前端
- `post_tags` 中间表（`post_id` + `tag_id` 关系字段，公开可读）已存在，无需后端改动

## Part 1：/tags 改版

构建期取数（frontmatter）：

1. 拉 `tags`（现有逻辑不变：`sort=-created`）
2. 拉 `post_tags`：`perPage=500&expand=post_id&fields=tag_id,expand.post_id.title,expand.post_id.slug,expand.post_id.published_at,expand.post_id.status`
3. 按 `tag_id` 分组 → 只保留 `status="published"` → 按 `published_at` 降序 → 取前 3 篇 + 统计总数

标签卡片（沿用 GlowCard + 现有卡片头部样式）：

- 现有部分（chip 徽章 + 名称 + 简介）保持
- 新增：文章计数（"N 篇"）+ 最新 3 篇标题链接（truncate + 月-日）+ 有 3 篇以上时"全部 N 篇 →"链接到 `/tags/{slug}`
- 无文章标签：显示"暂无文章"
- 取数失败（PB 不可达）：tags 为空的现有空态已覆盖；post_tags 失败时按 0 篇处理（页面仍渲染标签卡片）

## Part 2：/subscribe 订阅页

`astro/src/pages/subscribe.astro`（ParticleField 背景 + ScrollReveal 头部，kicker "Subscribe"）：

1. **RSS 卡片**：一句话说明（RSS 是什么）+ 订阅地址展示（`{SITE_CONFIG.url}/feed.xml` 或 `new URL('/feed.xml', Astro.site)`）+ 复制按钮（小岛屿 `components/subscribe/FeedCopyButton.tsx`：点击复制地址，对勾反馈 1.5s）+ "打开 feed.xml" 链接
2. **推荐阅读器**：Feedly / Inoreader / NetNewsWire 三张链接卡片（名称 + 一句话 + 外链）
3. 说明文案：把地址粘贴到阅读器即可，新文章会自动出现

## 导航入口

- `Header.tsx` `MORE_LINKS` 追加 `{ href: '/subscribe', label: '订阅', ... }`（RSS 图标）
- `SideNav.tsx` `moreNavItems` 追加 `/subscribe`

## 明确不做

- 不做邮件订阅（用户决策）
- 不做按标签的 RSS 源（单一全站 feed）
- 不做后端改动

## 验证

- `npm run build` + check:visual 加 `/subscribe`（/tags 已在矩阵中）
- /tags 聚合区在无 PB 数据时优雅渲染（tags 空态已有）
- 复制按钮探针：点击后剪贴板内容为 feed 地址（Playwright 授予剪贴板权限）
