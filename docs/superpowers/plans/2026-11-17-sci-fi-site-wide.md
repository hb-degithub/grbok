# 全站科幻简约改造实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**目标：** 把科幻简约设计从 Demo 迁移到全站与后台。

**架构：** 共享设计令牌 + 页面级局部样式；保留现有组件接口与数据流。

**技术栈：** Astro、React、TailwindCSS 4、Framer Motion、现有字体。

## 全局约束

- 不修改业务逻辑、接口、鉴权、数据流。
- 不新增依赖。
- React 组件必须 `export default`。
- 深浅主题均需可读。
- 遵循 `docs/superpowers/specs/2026-11-17-sci-fi-site-wide-design.md`。

---

### 任务 1：首页与共享布局

**文件：**
- 修改：`astro/src/pages/index.astro`
- 修改：`astro/src/components/layout/Header.tsx`
- 修改：`astro/src/components/layout/Footer.astro`
- 修改：`astro/src/styles/global.css`（追加令牌；链接默认色移入 `@layer base`）

- [x] 首页 Hero 改为左文右轨道；保留真实 PostList、统计、登录入口。
- [x] 删除重复轮播/装饰；侧栏信息合并为简洁区块。
- [x] Header/Footer 使用统一令牌。
- [x] 浏览器截图与溢出检查。

### 任务 2：内容页与组件

**文件：**
- 修改：`astro/src/components/posts/PostCard.tsx`
- 修改：`astro/src/components/posts/PostList.tsx`
- 修改：`astro/src/pages/posts/index.astro`、`tags.astro`、`archive.astro`、`links.astro`、`guestbook.astro`、`gallery.astro`、`about.astro`

- [x] 文章卡片改为编号行/细线分隔；保留封面缩略。
- [x] 各内容页统一细线与网格语言。
- [x] 保留交互与空态。

### 任务 2b：文章详情页与配套组件（评审补充范围）

**文件：**
- 修改：`astro/src/pages/posts/[slug].astro`
- 修改：`astro/src/components/posts/PostActions.tsx`、`TableOfContents.tsx`
- 修改：`astro/src/components/effects/ReadingProgress.tsx`
- 修改：`astro/src/components/ui/ShareButton.tsx`
- 修改：`astro/src/components/comments/{CommentSection,CommentItem,CommentForm,ReplyForm}.tsx`

- [x] 详情页细线分区 + 编号短标签，保留取数/作者回退/净化/目录/评论。
- [x] 点赞收藏、目录、阅读进度、分享、评论四态统一令牌，业务逻辑不变。
- [x] 正文无 JS 可读（reveal 由 `.is-reveal-ready` 门控）。

### 任务 3：后台与登录

**文件：**
- 修改：`astro/src/components/admin/AdminSidebar.tsx`
- 修改：`astro/src/components/admin/StatsCard.tsx`
- 修改：`astro/src/layouts/AdminLayout.astro`
- 修改：`astro/src/components/auth/AuthPage.tsx` 与各认证表单

- [x] 统一后台令牌；减少阴影与玻璃拟态。
- [x] 登录页与全站风格一致（移除 WebGL 装饰，保留密码/验证码/注册三模式）。

### 任务 4：验证

- [x] `npx vitest run` 通过。
- [x] `npm run build` 通过。
- [x] 关键路由截图与溢出检查。
- [x] 移动菜单、登录入口可用。
- [ ] 后台真角色导航可用 —— **未验证**：缺少可登录管理员账号（PB + 邮箱验证 + TOTP），仅验证未登录跳转与无敏感数据泄露。

---

## 验收记录（2026-11-17 最终构建）

| 项目 | 结果 |
|---|---|
| `npx vitest run` | **24 files / 373 tests passed**，exit 0 |
| `npm run test:admin-auth` | **14/14 passed**，exit 0 |
| `ALLOW_LOCALHOST_SITE=1 npm run check` | 0 errors / 0 warnings / 145 hints，exit 0 |
| `npx tsc --noEmit` | exit 0 |
| `ALLOW_LOCALHOST_SITE=1 npm run build` | **成功**（新产物 `ce73c133…`） |
| 浏览器矩阵（4 视口/主题 × 公开路由/交互/空态/鉴权边界） | 见 `tmp/sci-fi-visual-final/logs/` 与报告 |
| 专项（真实文章 SSR/岛屿 ID/主题持久化/320 溢出/像素对比度） | 见 `tmp/sci-fi-visual-final/logs/final*.log` |
| 截图 | `tmp/sci-fi-visual-final/shots/`（4 页面 × 4 组合） |

说明：
- 契约测试包含源码静态断言与 jsdom 交互测试，不能替代浏览器行为；浏览器证据单独保存在 `tmp/` 报告与截图中。
- `/admin` 的 SSR 字节流包含 `client:only` 惰性 `<template>` 静态壳，但 DOM 无 `.admin-shell`、无数据、水合后跳转 `/login`。
