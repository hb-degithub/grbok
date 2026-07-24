# 超级管理员后台设计方案

> 基于项目深度读取后的真实架构设计。所有模块复用现有 AdminLayout + AdminGuard + PocketBase 认证体系。

## 一、后台→前端数据流图

```
┌─────────────────────────────────────────────────────────────┐
│                      超管后台 (/admin/*)                      │
│   AdminLayout.astro (SSR token 校验) → AdminGuard (client)   │
│   → AdminPasskeyStep (WebAuthn MFA)                          │
├─────────────────────────────────────────────────────────────┤
│                                                              │
│  ┌──────────────┐  ┌──────────────┐  ┌───────────────────┐  │
│  │ FeatureFlags │  │ VersionHistory│  │ InsightsDashboard │  │
│  │    Panel     │  │              │  │                   │  │
│  │ (新增)       │  │ (新增)       │  │ (新增)            │  │
│  └──────┬───────┘  └──────┬───────┘  └────────┬──────────┘  │
│         │                  │                    │             │
│         ▼                  ▼                    ▼             │
│  settings 表          post_versions 表    page_views 表       │
│  key=feature_flags    (已有迁移)          +reactions+comments │
│         │                  │                    │             │
└─────────┼──────────────────┼────────────────────┼────────────┘
          │                  │                    │
          ▼                  │                    │ ❌ 不暴露到前端
   useSiteSettings           │                    │   (仅后台展示)
   hook 读取                  │
          │                  ▼
          ▼            恢复版本 → posts.content 更新
   前端组件根据                │
   flag 决定渲染               ▼
                              重新构建 (SSG) → 前端更新
```

### 安全暴露字段标注

| 数据 | 后台写入 | 前端读取 | 暴露字段 | 安全评估 |
|------|---------|---------|---------|---------|
| feature_flags | settings 表 | useSiteSettings | enabled, endpoint, frequency | ✅ 仅配置项，无密钥 |
| post_versions | post_versions 表 | ❌ 不暴露 | — | ✅ 仅后台可见 |
| page_views | 自动采集 | ❌ 不暴露 | — | ✅ 仅后台可见 |
| scheduled_publish | posts.status | 构建期读取 | status, published_at | ✅ 公开字段 |

## 二、新增后台模块清单

### 模块 1：智能功能开关（`/admin/features/`）

| 项 | 内容 |
|---|---|
| 路由 | `/admin/features/` |
| 组件 | `src/components/admin/FeatureFlagsPanel.tsx` |
| 配置 | `src/config/feature-flags.ts` |
| 存储 | PocketBase `settings` 表，key=`feature_flags` |
| 权限 | `admin+`（AdminGuard requiredRole） |
| 管控功能 | RAG Chatbot / 隐私埋点 / Newsletter / A/B 测试 |
| 前端联动 | `useSiteSettings` hook 读取 → 组件条件渲染 |
| 依赖文件 | `lib/pocketbase.ts`, `hooks/useSiteSettings.ts`, `ui/Toast.tsx` |

### 模块 2：版本历史对比（`/admin/versions/`）

| 项 | 内容 |
|---|---|
| 路由 | `/admin/versions/` |
| 组件 | `src/components/admin/VersionHistory.tsx` |
| 存储 | PocketBase `post_versions` 表（迁移 20260629005000） |
| 权限 | `admin+` |
| 功能 | 选择文章 → 查看版本列表 → 双版本对比（L/R）→ 恢复旧版本 |
| 前端联动 | 恢复操作更新 `posts.content` → 需重新构建生效 |
| 依赖文件 | `lib/pocketbase.ts`, `ui/Toast.tsx` |

### 模块 3：数据洞察看板（`/admin/insights/`）

| 项 | 内容 |
|---|---|
| 路由 | `/admin/insights/` |
| 组件 | `src/components/admin/InsightsDashboard.tsx` |
| 存储 | `page_views`(迁移 20260717120000) + `reactions` + `comments` |
| 权限 | `admin+` |
| 功能 | 时间范围切换(7d/30d/all) → 概览卡片 → 页面浏览 TOP10 → 文章互动价值 TOP10 |
| 前端联动 | ❌ **不暴露到前端**（展示层判定：📊 开发者洞察层） |
| 依赖文件 | `lib/pocketbase.ts` |

### 模块 4：定时发布（PocketBase cron）

| 项 | 内容 |
|---|---|
| Hook | `pb_hooks/scheduled_publish.pb.js` |
| 触发 | 每分钟 cron 检查 |
| 逻辑 | 找 `status != "published" && published_at <= now` 的文章 → 切换为 published → 写审计日志 |
| 前端联动 | 文章状态变更后，下次构建自动包含 |
| 依赖文件 | `pb_migrations/001_init_blog_collections.pb.js`（posts 表 published_at 字段） |

## 三、现有 12 个后台模块（未修改）

| 路由 | 组件 | 状态 |
|---|---|---|
| `/admin/` | AdminDashboard | ✅ 已有 |
| `/admin/posts/` | PostManager（含 SEO 字段） | ✅ 已有 |
| `/admin/comments/` | CommentModerator | ✅ 已有 |
| `/admin/tags/` | TagManager | ✅ 已有 |
| `/admin/users/` | UserManager | ✅ 已有 |
| `/admin/settings/` | SettingsForm | ✅ 已有 |
| `/admin/security/` | SecurityAudit | ✅ 已有 |
| `/admin/audit/` | AuditLogViewer | ✅ 已有 |
| `/admin/media/` | MediaLibrary | ✅ 已有 |
| `/admin/friend-links/` | FriendLinksManager | ✅ 已有 |
| `/admin/announcements/` | AnnouncementsManager | ✅ 已有 |
| `/admin/stats/` | StatsDashboard | ✅ 已有 |

## 四、资产保护合规声明

- ✅ **零现有模块修改**：12 个已有 admin 组件/路由完全未触碰
- ✅ **零 DOM/CSS/动画改动**：新模块用 `client:only="react"` 独立渲染
- ✅ **复用现有认证**：AdminLayout + AdminGuard + passkey MFA 三层守卫
- ✅ **复用现有数据结构**：settings 表、post_versions 表、page_views 表均为已有迁移
- ✅ **审计日志**：定时发布 hook 自动写 audit_logs；功能开关保存经 PocketBase 规则触发审计

## 五、AdminSidebar 集成说明

新增 3 个路由需要在 `AdminSidebar.tsx` 中追加导航链接。
**此项需修改现有组件**，标注为「待人工确认」——遵守资产保护协议，不擅自修改 AdminSidebar DOM 结构。

建议追加方式（diff，非完整文件）：
```diff
+ { href: '/admin/features', label: '功能开关', icon: '⚡' },
+ { href: '/admin/versions', label: '版本历史', icon: '📋' },
+ { href: '/admin/insights', label: '数据洞察', icon: '📊' },
```

## 六、新增文件清单

| 文件 | 类型 | 用途 |
|---|---|---|
| `astro/src/config/feature-flags.ts` | 配置 | 功能开关类型定义与默认值 |
| `astro/src/components/admin/FeatureFlagsPanel.tsx` | 组件 | 智能功能开关面板 |
| `astro/src/components/admin/VersionHistory.tsx` | 组件 | 版本历史对比 |
| `astro/src/components/admin/InsightsDashboard.tsx` | 组件 | 数据洞察看板 |
| `astro/src/pages/admin/features/index.astro` | 路由 | 功能开关页 |
| `astro/src/pages/admin/versions/index.astro` | 路由 | 版本历史页 |
| `astro/src/pages/admin/insights/index.astro` | 路由 | 数据洞察页 |
| `pb_hooks/scheduled_publish.pb.js` | Hook | 定时发布 cron |
