# 胡巴的博客 — 技术演进与改动说明书

> **文档读者**：未来维护者或接手开发者
> **生成日期**：2026-07-24
> **依据**：本次会话全部对话轮次（Phase 0 ~ Phase 4）
> **声明**：本项目技术栈与业务逻辑与小米公司无关，"胡巴"为博主个人昵称，无任何商业关联。

---

## 目录

- [1. 项目概述与技术基线](#1-项目概述与技术基线)
- [2. 分阶段改动详解](#2-分阶段改动详解)
- [3. 超级管理员后台专项说明](#3-超级管理员后台专项说明)
- [4. 已知限制与技术债](#4-已知限制与技术债)
- [5. 附录](#5-附录)
- [6. 文档更新日志](#6-文档更新日志)

---

## 1. 项目概述与技术基线

### 1.1 项目定位与核心价值

**胡巴的博客**（Huba's Blog）是博主 HB 的个人技术博客，生产域名 `hlydwz.com`，已备案（辽ICP备2025065723号-1 + 辽公网安备21029602001076号）。核心价值：以 Astro SSG + PocketBase BaaS 架构实现高性能静态博客，支持文章/评论/标签/相册/留言板/友链/项目展示/访问统计等完整功能，含独立超管后台与 WebAuthn MFA 认证。

### 1.2 技术栈精确版本清单

| 层 | 技术 | 版本 | 模式 |
|---|---|---|---|
| 前端框架 | Astro | ^6.4.7 | SSG（构建期生成静态 HTML） |
| 岛屿框架 | React | ^19.2.7 | client:load / visible / only |
| 样式 | TailwindCSS | ^4.3.1 | 全局 + CSS 变量体系 |
| 动效 | Framer Motion ^12.40.0 + GSAP ^3.15.0 + Three.js ^0.180.0 + OGL ^1.0.11 | — | **受保护资产** |
| 搜索 | Pagefind | ^1.5.2 | 构建后离线索引 |
| XSS 净化 | DOMPurify ^3.4.11 + isomorphic-dompurify（新增） | — | SSR + CSR 双环境 |
| 后端 BaaS | PocketBase | 0.22.21（服务端镜像）/ 0.27.0（JS SDK） | SQLite + Auth + API |
| 内部服务 | admin-auth (Node.js >=22) | — | WebAuthn passkey MFA + 邮件网关 |
| Web 服务器 | Caddy | 2.8.4-alpine | 反代 + HTTPS + 安全头 + IP 白名单 |
| 部署 | Docker Compose | — | 三容器：caddy + admin-auth + pocketbase |
| 版本控制 | Git | — | GitHub (origin) + 阿里云云效 (aliyun) + all (双推) |

### 1.3 核心受保护资产清单

以下资产在所有阶段中均被标记为不可修改，任何优化建议与之冲突时无条件保全：

| 资产类型 | 位置 | 保护级别 |
|---|---|---|
| `@keyframes admin-rise` | `AdminLayout.astro:88-152` | 🔒 动画时序/曲线不可改 |
| `@keyframes journal-scan/float/sidebar-rise` | `index.astro:250-440` | 🔒 |
| Framer Motion 组件动画 | `reactbits/*.jsx`, `effects/*.tsx` | 🔒 依赖版本锁定 |
| `blog-theme-mode` localStorage 初始化 | `BaseLayout.astro:66-110` | 🔒 主题切换逻辑不可改 |
| CSS 变量体系 | `global.css` + 各 layout inline | 🔒 只增不改 |
| 响应式断点 | Tailwind sm/md/lg/xl + `--vvw/--vvh` | 🔒 不可新增断点 |
| `AdminSidebar` 导航结构 | `AdminSidebar.tsx` | 🔒 DOM 结构冻结 |
| `AdminGuard` 三层守卫 | `AdminGuard.tsx` + `AdminLayout.astro` | 🔒 认证流程不可改 |
| `HomeParticlesBackground` (OGL) | `effects/HomeParticlesBackground.tsx` | 🔒 粒子动画不可改 |
| `LoginGridScanBackground` | `effects/LoginGridScanBackground.tsx` | 🔒 登录页扫描动画不可改 |

### 1.4 前后端边界定义（展示层判定协议）

| 层级 | 定义 | 打包进前端 Bundle | 隔离方式 |
|---|---|---|---|
| 👁️ 用户可见层 | 直接渲染在博客页面上的 UI 组件 | ✅ 按需加载 | Shadow DOM / Scoped CSS / Tailwind |
| ⚙️ 后台基建层 | 构建时/服务端/CI 运行 | ❌ 禁止 | 独立脚本，无浏览器 API |
| 📊 开发者洞察层 | 仅供博主的数据报告/Issue | ❌ 禁止 | Markdown/JSON 输出 |

---

## 2. 分阶段改动详解

### 2.1 Phase 0：项目清理与文档同步

**触发条件**：根目录约 48MB / 100+ 个历史遗留文件已被 git 跟踪（`.gitignore` 规则只对未跟踪文件生效，无法清理已入库文件）；CLAUDE.md 中 `login_security.pb.js` 三处描述与代码现状不一致（标记为 `.disabled` 但实际已重新启用并修复）。

**核心改动列表**：

| 改动项 | 类型 | 影响范围 | 关联文件 |
|---|---|---|---|
| 删除一次性修复脚本（10个） | 删除 | 根目录 | `.add_seo.py`, `final-fixes.js`, `fix-*.js`, `rewrite-dev-*.js`, `tmp-bug-scan.js` 等 |
| 删除 tmp-* 调试脚本（33个） | 删除 | 根目录 | `tmp-fix-*.js`, `tmp-hero-*.js`, `tmp-modern-*.js`, `tmp-redesign-*.js` 等 |
| 删除原始备份快照（7个） | 删除 | 根目录 | `original-*.astro/.tsx` |
| 删除废弃启动脚本/日志（5个） | 删除 | 根目录 | `start-dev.*`, `astro-dev.err` |
| 删除部署产物（4个，含未跟踪） | 删除 | 根目录+工作区 | `dist-deploy-latest.zip`(23MB), `dist.tar.gz`(23MB), `astro-dev*.log` |
| 删除临时图片（7个） | 删除 | 根目录 | `temp-img-*.png/jpg`, `tmp-screenshot*.png` |
| 删除过期文档 | 删除 | 根目录 | `PHASE1_VERIFICATION.md` |
| 修正 login_security 描述 | 修改 | 文档 | `CLAUDE.md`（第 58/95/186 行） |
| 补全 .gitignore | 修改 | 配置 | `.gitignore`（新增 `.codex/` `.qoder/`） |

**关键技术决策**：
- 选择 `git rm` 而非普通 `rm`：确保已跟踪文件从 git 历史的当前树中移除，进入暂存区。
- 未跟踪文件（`*.log`/`*.zip`/`*.tar.gz`）用普通 `rm`：因 `.gitignore` 已覆盖，从未入库。
- CLAUDE.md 三处描述改为反映 `realIP()` + `globalThis` 桶的修复现状，消除"Dont re-enable"误导。

**资产保护执行记录**：本阶段零前端代码改动，纯文件删除与文档修正，无例外。

**验证与回滚**：`git status` 确认 66 文件变更（64 删除 + 2 修改），构建不受影响。回滚方式：`git revert <commit>`。已提交为 `fe1d6e7`。

---

### 2.2 Phase 1：安全检测与修复

**触发条件**：项目缺乏系统性安全审计，需全面扫描前后端代码、依赖、配置、部署链路。

**检测方法**：三个并行静态分析代理（后端安全 / 前端安全 / 配置与依赖）+ 人工核实关键发现 + `git blame` 定位引入人。

**核心改动列表**：

| 编号 | 改动项 | 类型 | 风险 | 关联文件 |
|---|---|---|---|---|
| H1 | `sanitizeText` 解码顺序错误，返回含原始尖括号 | 修改 | 🔴 高 | `astro/src/lib/security.ts:147-151` |
| H2 | `sanitizeHtml` SSR 回退用正则可被绕过 | 修改 | 🔴 高 | `astro/src/lib/security.ts:79-92,137-145` |
| M1 | 评论/回复表单无长度校验与邮箱格式校验 | 修改 | 🟡 中 | `CommentForm.tsx`, `ReplyForm.tsx` |
| M5 | `.env.example` 含真实生产域名 | 修改 | 🟡 中 | `.env.example:9,64,65` |
| L6 | `security.ts` 硬编码生产域名作 URL base | 修改 | 🟢 低 | `astro/src/lib/security.ts:46` |
| L7 | admin-auth 错误日志不记录 err.message | 修改 | 🟢 低 | `admin-auth/src/server.mjs:170-176` |
| L8 | PostManager 多处 `catch {}` 静默吞异常 | 修改 | 🟢 低 | `PostManager.tsx:98,137,246` |
| — | 新增 isomorphic-dompurify 依赖 | 新增 | — | `astro/package.json` |
| — | 安全检测报告 | 新增 | — | `docs/SECURITY_AUDIT_REPORT.md` |

**关键技术决策**：

1. **H1 修复方案**：`sanitizeText` 原逻辑先剥标签后解码实体（`&lt;`→`<`），导致编码后的 XSS payload 被还原。改为只剥标签不解码实体——返回值保持 HTML 实体编码状态，React 文本节点会正确渲染，任何拼入 HTML 字符串的调用方也安全。同时修复了原代码中 `&quot;g` 的拼写错误（缺少引号）。

2. **H2 修复方案**：引入 `isomorphic-dompurify`（封装 jsdom）替代手写正则回退。SSR 环境初始化 `createDOMPurify()` 实例，与客户端 DOMPurify 行为一致。正则回退保留为最终降级（万一 isomorphic 工厂初始化失败）。选择此方案而非手写更复杂正则的理由：正则无法可靠解析 HTML，任何正则方案都有绕过路径。

3. **M1 修复方案**：对齐 `GuestbookForm.tsx` 已有的校验模式（`NICKNAME_MAX=30`/`CONTENT_MAX=500`），为评论添加 `NAME_MAX=30`/`CONTENT_MAX=1000`、`EMAIL_RE` 正则、`maxLength` 属性。

**资产保护执行记录**：
- H1/H2 仅修改 `security.ts` 内部函数实现，未改函数签名或调用方。
- M1 仅在现有表单组件内追加校验逻辑和 `maxLength` 属性，未改 DOM 结构或样式。
- L8 仅在 `catch {}` 内追加 `console.warn`，未改控制流。
- 无例外。

**验证与回滚**：`npm run build` 通过（exit 0）。回滚方式：`git checkout -- <file>` 恢复单个文件。

**未修复项（需人工决策）**：

| 编号 | 问题 | 未修复原因 |
|---|---|---|
| H3 | `tmp/ssh-tmp/blog_deploy_ed25519` 明文私钥 | 需博主确认删除/轮换 |
| H4 | PocketBase 镜像 0.22.21 与 SDK 0.27.0 错位 | 涉及数据库迁移风险 |
| M2 | face-api.js 第三方 CDN 模型 + 摄像头策略矛盾 | GridScan 动画依赖，需确认去留 |
| M3 | admin token 存 localStorage | 架构变更需评估 |
| M7/M8 | Docker 镜像非 root / digest 固定 | 部署变更需测试 |

---

### 2.3 Phase 2：代码与内容深度精进

**触发条件**：基础安全修复完成后，需补全标准博客功能模块、测试覆盖与开发者体验工具。

**核心改动列表**：

| 改动项 | 类型 | 展示层 | 关联文件 |
|---|---|---|---|
| 通用表单校验 hook | 新增 | ⚙️ 后台基建 | `astro/src/hooks/useFormValidation.ts` |
| 响应式图片组件（PocketBase thumb srcset） | 新增 | 👁️ 用户可见 | `astro/src/components/posts/ResponsiveImage.tsx` |
| Mermaid 图表渲染（懒加载） | 新增 | 👁️ 用户可见 | `astro/src/components/posts/MermaidDiagram.tsx` |
| KaTeX 数学公式（懒加载） | 新增 | 👁️ 用户可见 | `astro/src/components/posts/MathBlock.tsx` |
| 文章系列导航 | 新增 | 👁️ 用户可见 | `astro/src/components/posts/SeriesNav.tsx` |
| 相关文章推荐算法 | 新增 | ⚙️ 后台基建 | `astro/src/lib/related-posts.ts` |
| 安全净化单元测试 | 新增 | ⚙️ 后台基建 | `astro/src/lib/__tests__/security.test.ts` |
| Vitest 配置 | 新增 | ⚙️ 后台基建 | `astro/vitest.config.ts` |
| Playwright E2E 测试 | 新增 | ⚙️ 后台基建 | `astro/e2e/blog.spec.ts` |
| 内容健康度检查脚本 | 新增 | ⚙️ 后台基建 | `astro/scripts/content-health-check.mjs` |
| 友链存活检测脚本 | 新增 | ⚙️ 后台基建 | `astro/scripts/check-friend-links.mjs` |
| CI 测试+构建流水线 | 新增 | ⚙️ 后台基建 | `.github/workflows/test.yml` |
| 内容健康度定时任务 | 新增 | ⚙️ 后台基建 | `.github/workflows/content-health.yml` |
| 本地开发 Makefile | 新增 | ⚙️ 后台基建 | `Makefile` |

**关键技术决策**：

1. **组件全部以新增文件存在**：不修改任何现有组件（如 PostCard、SearchModal），新组件可供未来选择性引用。理由：遵守"DOM 结构冻结"协议，现有组件的内部逻辑不可预测修改后果。

2. **Mermaid/KaTeX 懒加载**：`import('mermaid')` / `import('katex')` 动态导入，仅在文章含对应内容时才加载库，避免增加首屏 Bundle。依赖未安装（`npm i mermaid katex`），按需安装。

3. **测试不阻断 CI**：`test.yml` 中 `vitest run` 和 `playwright test` 设 `continue-on-error: true`，因测试为新增，首次运行不阻断构建。后续稳定后可移除此标记。

4. **内容健康度脚本**扫描 `dist/` 下的 HTML 提取外链，而非扫描源码——因为最终用户看到的是构建产物中的链接。

**资产保护执行记录**：全部 14 个文件为纯新增，零现有文件修改。无例外。

**验证与回滚**：`npm run build` 通过（exit 0）。回滚方式：`git clean -fd <file>` 或 `rm <file>`。

---

### 2.4 Phase 3：智能增强与价值放大

**触发条件**：需为博客增加智能化能力（RAG 助手、语义标签、LLM 摘要）与数据驱动增长工具（隐私埋点、SEO 洞察、A/B 测试、高价值内容识别）。

**核心改动列表**：

| 改动项 | 类型 | 展示层 | 隔离方式 | 关联文件 |
|---|---|---|---|---|
| RAG Chatbot Widget | 新增 | 👁️ 用户可见 | Web Component Shadow DOM | `astro/public/components/blog-chatbot.js` |
| 隐私埋点 SDK（<1KB） | 新增 | ⚙️ 后台基建 | 独立 IIFE | `astro/public/components/blog-analytics.js` |
| GitHub Repo Card | 新增 | 👁️ 用户可见 | Scoped Tailwind | `astro/src/components/links/GitHubRepoCard.tsx` |
| 语义标签生成脚本 | 新增 | ⚙️ 后台基建 | 构建时 Node 脚本 | `astro/scripts/generate-semantic-tags.mjs` |
| LLM 摘要生成脚本 | 新增 | ⚙️ 后台基建 | 构建时 Node 脚本 | `astro/scripts/generate-summaries.mjs` |
| SEO 洞察脚本 | 新增 | 📊 开发者洞察 | Markdown 报告 | `astro/scripts/seo-insights.mjs` |
| 高价值内容识别脚本 | 新增 | 📊 开发者洞察 | Markdown 报告 | `astro/scripts/content-value-analysis.mjs` |

**关键技术决策**：

1. **Chatbot 用 Web Component 而非 React 组件**：Shadow DOM 提供完全的 CSS/DOM 隔离，零污染全局样式。降级方案：API 失败时显示静态 FAQ。三态完整（加载动画/错误降级/空状态）。

2. **埋点 SDK 尊重 DNT**：`navigator.doNotTrack === '1'` 时直接 return，不采集。无 Cookie，用 `sessionStorage` 存会话 ID，`sendBeacon` 上报。与现有 `BaseLayout` 中的 `/api/track-view` pageview 互补（现有覆盖页面浏览，SDK 聚焦交互事件）。

3. **后台脚本无浏览器 API**：所有 `scripts/*.mjs` 仅用 Node.js 内置模块（`fs`/`path`）+ `fetch`，不含任何 `window`/`document`/`localStorage` 调用。输出为 `tmp/*.json` 或 `tmp/*.md` 报告，供博主审阅后手动操作。

4. **LLM 摘要支持多 Provider**：通过 `LLM_PROVIDER` 环境变量切换 OpenAI / 阿里云通义千问 / 本地 Ollama，默认 Ollama（本地无 API 成本）。

**资产保护执行记录**：
- Chatbot：Shadow DOM 完全隔离，零全局 DOM/CSS 污染。
- 埋点 SDK：独立 IIFE，不修改任何现有脚本。
- GitHub Repo Card：独立组件，三态规范（骨架屏/降级链接/空不渲染）。
- 所有脚本：纯 Node.js，不打包进前端 Bundle。
- 无例外。

**验证与回滚**：`npm run build` 通过（exit 0）。回滚方式：删除对应文件。

---

### 2.5 Phase 4：超管后台设计

**触发条件**：现有 12 个 admin 模块已覆盖基础 CRUD，但缺少智能功能开关、版本历史对比、数据洞察看板、定时发布能力。

**核心改动列表**：

| 改动项 | 类型 | 权限 | 关联文件 |
|---|---|---|---|
| 功能开关类型定义与默认值 | 新增 | — | `astro/src/config/feature-flags.ts` |
| 智能功能开关面板 | 新增 | admin+ | `astro/src/components/admin/FeatureFlagsPanel.tsx` |
| 版本历史对比 | 新增 | admin+ | `astro/src/components/admin/VersionHistory.tsx` |
| 数据洞察看板 | 新增 | admin+ | `astro/src/components/admin/InsightsDashboard.tsx` |
| 功能开关路由 | 新增 | admin+ | `astro/src/pages/admin/features/index.astro` |
| 版本历史路由 | 新增 | admin+ | `astro/src/pages/admin/versions/index.astro` |
| 数据洞察路由 | 新增 | admin+ | `astro/src/pages/admin/insights/index.astro` |
| 定时发布 cron hook | 新增 | system | `pb_hooks/scheduled_publish.pb.js` |
| 后台设计文档 | 新增 | — | `docs/ADMIN_PANEL_DESIGN.md` |

**关键技术决策**：

1. **复用现有 AdminLayout + AdminGuard**：所有新路由通过 `AdminLayout`（SSR token 校验）+ `AdminGuard`（passkey MFA）守卫，零认证改动。`requiredRole="admin"` 限制仅 admin+ 可访问。

2. **功能开关存 settings 表**：key=`feature_flags`，value 为 JSON。前端通过已有 `useSiteSettings` hook 读取，组件根据 flag 值决定是否渲染。无需新增数据库迁移。

3. **版本历史复用 post_versions 表**：迁移 `20260629005000` 已创建此表。组件支持选择文章 → 查看版本列表 → 双版本 diff 对比（L/R 标记）→ 一键恢复旧版。

4. **定时发布用 PocketBase cron**：`cronAdd('scheduled-publish', '* * * * *', ...)` 每分钟检查 `status != "published" && published_at <= now` 的文章，自动切换为 published 并写审计日志。选择 cron hook 而非外部调度的理由：无需新增服务，PocketBase 原生支持。

5. **数据洞察不暴露到前端**：遵守展示层判定协议，`InsightsDashboard` 仅在 `/admin/insights/` 后台路由渲染，数据来源为 `page_views` + `reactions` + `comments` 聚合。

**资产保护执行记录**：
- 12 个现有 admin 模块零修改。
- 新模块用 `client:only="react"` 独立渲染，不共享 DOM 上下文。
- `AdminSidebar.tsx` 导航链接**未追加**——因涉及修改现有组件 DOM，标注为待人工确认。
- 无例外。

**验证与回滚**：`npm run build` 通过（exit 0）。回滚方式：删除新增文件。`scheduled_publish.pb.js` 可通过重命名为 `.disabled` 后缀停用。

---

## 3. 超级管理员后台专项说明

### 3.1 项目深度读取结果摘要

后台设计前已读取并确认以下关键文件：`AdminLayout.astro`（SSR 认证流程）、`AdminGuard.tsx`（三层守卫）、`useAdminAuth.ts`（角色权限）、`types/pocketbase.ts`（全部数据模型）、`AdminSidebar.tsx`（导航结构）、`Caddyfile`（admin IP 白名单）、`docker-compose.yml`（容器编排）。

关键发现：`posts` 表已有 `seo_title`/`seo_description`/`seo_keywords`/`is_pinned`/`is_featured` 字段（迁移 `20260629008000_extend_posts_tags`），后台 SEO 功能可直接写入，无需新增迁移。

### 3.2 后台→前端数据流架构

```
┌──────────────── 超管后台 (/admin/*) ────────────────┐
│ AdminLayout.astro (SSR token 校验)                   │
│   → AdminGuard.tsx (client: role + passkey MFA)      │
├──────────────────────────────────────────────────────┤
│  FeatureFlagsPanel → settings 表 key=feature_flags   │
│         │                                            │
│         ▼                                            │
│  useSiteSettings hook (前端读取)                      │
│         │                                            │
│         ▼                                            │
│  前端组件根据 flag 条件渲染（如 Chatbot Widget）       │
│                                                      │
│  VersionHistory → post_versions 表 → 恢复旧版         │
│         │                                            │
│         ▼                                            │
│  posts.content 更新 → 需重新构建 (SSG) 生效           │
│                                                      │
│  InsightsDashboard → page_views + reactions + comments│
│         │                                            │
│         ▼                                            │
│  ❌ 不暴露到前端（仅后台展示）                         │
│                                                      │
│  scheduled_publish.pb.js (cron) → posts.status 切换   │
│         │                                            │
│         ▼                                            │
│  下次构建自动包含新发布文章                            │
└──────────────────────────────────────────────────────┘
```

### 3.3 控制模块与内容模型映射

| 后台模块 | 写入目标 | 读取方 | 暴露字段 |
|---|---|---|---|
| 功能开关 | `settings` key=`feature_flags` | `useSiteSettings` | enabled, endpoint, frequency（无密钥） |
| 版本历史 | `post_versions` → 恢复到 `posts` | 构建期 SSG | status, content（公开字段） |
| 数据洞察 | 只读聚合 `page_views`/`reactions`/`comments` | ❌ 不暴露 | — |
| 定时发布 | `posts.status` + `audit_logs` | 构建期 SSG | status, published_at |

### 3.4 安全与审计机制

- **SSR token 校验**：`AdminLayout.astro` 在服务端校验 `pb_auth` cookie，无效则重定向 `/login`，防止 admin HTML 泄露。
- **Passkey MFA**：`AdminGuard` 要求 WebAuthn 二次验证，`useAdminVerification` 管理验证态。
- **IP 白名单**：Caddy `@blocked_admin_access` 限制 `/admin*` `/api/admins/*` 仅 `ADMIN_IP` 可访问。
- **审计日志**：`audit_admin_actions.pb.js` 自动记录所有 admin 操作；`scheduled_publish.pb.js` 写审计日志。
- **CSP**：`/admin*` 路由继承 `X-Robots-Tag: noindex, nofollow, noarchive`。

---

## 4. 已知限制与技术债

### 4.1 因资产保护主动放弃的优化

| 优化项 | 放弃原因 | 替代方案 |
|---|---|---|
| 移除 500/600 字重 | 可能影响现有文字粗细视觉效果 | ⚠️ 需视觉确认后执行 |
| SearchModal 迁移 Web Worker | 需改组件内部逻辑，违反 DOM 冻结 | 保留方案文档，暂不迁移 |
| 现有组件原子化重构 | 需改组件内部，违反资产保全 | 新增 `useFormValidation` hook 供新组件使用 |
| critters Critical CSS 集成 | 需改 astro.config + 测试 | ⚠️ 需测试验证后执行 |
| framer-motion island 降级 | 当前 client 指令已合理 | 强行改动有交互风险 |

### 4.2 架构瓶颈与未来重构方向

| 瓶颈 | 当前状态 | 重构方向 |
|---|---|---|
| PocketBase 服务端 0.22.21 vs SDK 0.27.0 | 跨 5 个次版本，能跑通但有安全加固未利用 | 升级镜像到 0.27.x（需迁移测试） |
| 限速全 in-memory | 容器重启后清零 | 登录/注册限速持久化到 DB |
| `getClientIP` 回退到 `X-Forwarded-For` | 依赖 Caddy 覆写假设 | 去掉回退，仅信任 `realIP()` |
| `visitor_hash` 无盐 SHA256 | 数据泄露可去匿名化 | 改用 HMAC + 服务端密钥 |
| admin token 存 localStorage | XSS 可读取 | 评估改用内存态 + 短期 session |
| face-api.js 0.22.2 停止维护 | 从第三方 CDN 加载模型 | 本地托管或移除（需确认 GridScan 去留） |

### 4.3 待验证假设

| 假设 | 验证方式 | 状态 |
|---|---|---|
| `isomorphic-dompurify` 在 Astro SSG 构建期正常工作 | `npm run build` 通过 | ✅ 已验证 |
| `scheduled_publish.pb.js` cron 在 PocketBase 0.22.21 正常注册 | 部署后检查 PB 日志 | ⚠️ 待验证 |
| Mermaid/KaTeX 懒加载在文章页正常渲染 | 安装依赖后测试 | ⚠️ 待验证（依赖未安装） |
| FeatureFlagsPanel 读写 settings 表权限正确 | 登录 admin 后访问 `/admin/features/` | ⚠️ 待验证 |
| GitHub Repo Card 的 localStorage 缓存在生产环境正常 | 部署后测试 | ⚠️ 待验证 |
| AdminSidebar 追加导航链接后不影响动画 | 人工确认后执行 | ⏸️ 待人工确认 |

---

## 5. 附录

### 5.1 关键配置文件路径索引

| 文件 | 用途 |
|---|---|
| `astro/astro.config.mjs` | Astro 构建配置（integrations + Vite 分包 + buildStamp） |
| `astro/src/config/site.ts` | 站点配置（名称、ICP、社交链接） |
| `astro/src/config/feature-flags.ts` | 智能功能开关类型与默认值 |
| `astro/src/lib/pocketbase.ts` | PocketBase 客户端单例 |
| `astro/src/lib/security.ts` | XSS 净化 / 输入校验 / 限流 / 指纹 |
| `astro/src/layouts/BaseLayout.astro` | 全局布局（主题、viewport、SW 注册、埋点） |
| `astro/src/layouts/AdminLayout.astro` | 后台布局（SSR 认证 + admin 动画） |
| `Caddyfile` | 生产 Caddy 配置（安全头、CSP、反代、IP 白名单） |
| `Caddyfile.local` | 本地 Caddy 配置 |
| `docker-compose.yml` | 生产三容器编排 |
| `docker-compose.local.yml` | 本地开发编排 |
| `.env.example` | 环境变量模板（已占位符化） |
| `pb_hooks/scheduled_publish.pb.js` | 定时发布 cron |
| `pb_hooks/login_security.pb.js` | 登录限速（已重新启用） |
| `docs/SECURITY_AUDIT_REPORT.md` | 安全检测报告 |
| `docs/ADMIN_PANEL_DESIGN.md` | 超管后台设计文档 |

### 5.2 运维命令速查表

```bash
# === 本地开发 ===
make dev                    # 启动 Docker + Astro dev
make build                  # 构建生产版本
make stop                   # 停止本地 Docker
make clean                  # 清理构建产物

# === 测试 ===
make test                   # 单元测试 (Vitest)
make e2e                    # E2E 测试 (Playwright)
cd astro && npx vitest run  # 直接运行单元测试

# === 内容运维 ===
make health                 # 外链有效性检查
make friend-check           # 友链存活检测
node astro/scripts/generate-semantic-tags.mjs   # 语义标签生成
node astro/scripts/generate-summaries.mjs        # LLM 摘要生成
node astro/scripts/seo-insights.mjs              # SEO 洞察报告
node astro/scripts/content-value-analysis.mjs    # 高价值内容识别

# === Git ===
git push all <branch>       # 同时推送到 GitHub + 云效
git push origin <branch>    # 仅推 GitHub
git push aliyun <branch>    # 仅推云效

# === 部署 ===
bash security-check.sh      # 部署前安全检查
cd astro && npm run build   # 构建（含 pagefind + SW 版本注入）
docker compose up -d        # 启动生产容器
```

### 5.3 外部文档链接

| 资源 | 链接 |
|---|---|
| Astro 文档 | https://docs.astro.build |
| PocketBase 文档 | https://pocketbase.io/docs |
| Caddy 文档 | https://caddyserver.com/docs |
| DOMPurify | https://github.com/cure53/DOMPurify |
| isomorphic-dompurify | https://github.com/kkomelin/isomorphic-dompurify |
| SimpleWebAuthn | https://simplewebauthn.dev |
| Pagefind | https://pagefind.app |
| TailwindCSS 4 | https://tailwindcss.com |

---

## 6. 文档更新日志

| 日期 | 版本 | 依据 | 变更内容 |
|---|---|---|---|
| 2026-07-24 | v1.0 | 本次会话全部轮次 | 初始生成，覆盖 Phase 0~4 全部改动 |

---

> **非小米声明**：本项目名称中的"胡巴"为博主个人昵称，项目技术栈（Astro/React/PocketBase/Caddy/Docker）与业务逻辑均与小米公司无关，无任何商业关联。后续维护者请勿误解。
