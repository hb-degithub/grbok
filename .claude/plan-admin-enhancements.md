# 后台管理功能完善计划

## 目标
为已有 PocketBase collection 但缺 UI 的功能补全管理页面，并增强现有管理器的可扩展性（分页、搜索、编辑器、预览、封面上传）。所有改动遵循现有约定：`.tsx` + `export default`、`showToast`/`ConfirmDialog` 反馈、glass/card 样式、`AdminLayout requiredRole` 守卫。

---

## 第一部分：新增管理页面（补缺失 collection UI）

### 1.1 友情链接管理（FriendLinksManager）
- **新建** `astro/src/components/admin/FriendLinksManager.tsx`
- **新建** `astro/src/pages/admin/friend-links/index.astro`（`requiredRole="super_admin"`）
- 字段：name, url, description, avatar, status(show/hide), sort_order
- CRUD：列表（拖拽排序可选，先做手动 sort_order 输入）+ 编辑 modal + 删除确认
- 列表规则：super_admin 可见全部（含 hide），其余按 `status="show"`（已在 migration）
- 复用 TagManager 的 modal/ConfirmDialog 模式

### 1.2 公告管理（AnnouncementsManager）
- **新建** `astro/src/components/admin/AnnouncementsManager.tsx`
- **新建** `astro/src/pages/admin/announcements/index.astro`（`requiredRole="super_admin"`）
- 字段：title, content, type(normal/info/warning/important), enabled, start_at, end_at
- CRUD：列表 + 编辑 modal + 删除；type 用颜色徽章（复用 AnnouncementBar 的 typeStyles 思路）；enabled 开关
- 公告前端的 AnnouncementBar 已在使用此 collection，管理器写数据后前端实时显示

### 1.3 媒体库（MediaLibrary）
- **新建** `astro/src/components/admin/MediaLibrary.tsx`
- **新建** `astro/src/pages/admin/media/index.astro`（`requiredRole="author"`）
- 功能：
  - 网格展示已上传图片（`media_assets` collection，`file` 字段 + thumbs）
  - 上传：`pb.collection('media_assets').create(formdata)`，FormData 含 file + uploader + alt
  - 复制图片 URL（`pb.files.getUrl(record, record.file)`）按钮 → `showToast('已复制')`
  - 删除（super_admin 或 owner）
  - 点击插入到 PostManager 封面（见 2.4）
- 权限：author 可上传（createRule=AUTHOR_RULE），uploader 自动填当前用户

### 1.4 侧边栏导航更新
- **修改** `astro/src/components/admin/AdminSidebar.tsx`
- 在 `navItems` 中添加：
  - `{ href: '/admin/friend-links', label: '友链', section: '内容', requiredRole: 'super_admin', ... }`
  - `{ href: '/admin/announcements', label: '公告', section: '系统', requiredRole: 'super_admin', ... }`
  - `{ href: '/admin/media', label: '媒体', section: '内容', requiredRole: 'author', ... }`

---

## 第二部分：增强现有管理器

### 2.1 用户管理增强（UserManager.tsx）
- **搜索框**：按 name/email 过滤（PostManager 已有的模式，复用）
- **邮箱验证状态**：在用户行显示 emailVerified 徽章（已验证/未验证）
- **删除用户**：新增删除按钮（super_admin only，ConfirmDialog 确认，保护最后一个 super_admin）
- 不做"封禁"字段（PocketBase auth 无内置 disabled，避免改 schema；删除即移除）

### 2.2 PostManager 分页
- **修改** `astro/src/components/admin/PostManager.tsx`
- 当前 `getList(1, 80)` → 改为 `getList(page, 20)` + 分页控件（复用 PostList 的分页按钮样式）
- 新增 `page`/`totalPages` state，搜索/筛选重置到第 1 页

### 2.3 PostManager 内容编辑器工具栏 + 预览
- **修改** `astro/src/components/admin/PostManager.tsx`
- 在正文 textarea 上方加格式工具栏：粗体/斜体/标题(H2/H3)/链接/图片/代码块/引用
  - 直接向 HTML content 插入对应标签（`<strong>...</strong>` 等），用 `document.execCommand` 或选区 wrap
  - 保持现有 HTML 存储格式不变（posts.content 是 editor 类型）
- 新增「编辑/预览」切换 tab：预览态用 `dangerouslySetInnerHTML` 渲染 content（已 DOMPurify 风格，预览态本地 sanitize 或直接渲染因为是管理员自写）
- 不引入完整 Markdown 库（避免格式迁移）

### 2.4 PostManager 封面上传（接入媒体库）
- **修改** `astro/src/components/admin/PostManager.tsx`
- 封面字段：保留 URL 输入，新增「从媒体库选择」按钮
- 点击打开 MediaLibrary 的选择模式（返回 URL 填入 cover）
- 实现方式：MediaLibrary 支持 `onSelect?(url) => void` prop；PostManager 传入回调

### 2.5 分页通用化（可选，时间允许）
- CommentModerator 加分页（同 2.2 模式）

---

## 第三部分：收尾

### 3.1 类型补充
- **修改** `astro/src/types/pocketbase.ts`：新增 `MediaAsset` interface（id, file, alt, uploader, size, usage_count, created, updated, expand.uploader?）

### 3.2 构建验证
- `cd astro && npm run build` 确认 0 错误
- 17 → ~20 页（新增 friend-links/announcements/media）

---

## 不做（明确排除）
- 审计日志查看器（audit_logs createRule=null，前端无法创建；需先写 PB hook 记录，工作量大，留后续）
- post_versions 历史/回滚（需在 savePost hook 写版本，复杂）
- comment_reports / reactions 管理器（低优先级）
- recovery codes UI（需 PB hook 生成，复杂）
- 用户创建/密码重置（PocketBase 限制，admin 改他人密码需 super_admin + 复杂流程）
- 完整 Markdown 编辑器（避免内容格式迁移）
- 数据导出 CSV/JSON（低价值）

## 验证方式
- 构建通过
- 手动逻辑检查（无法运行 PB 实例时，确保 API 调用与现有 TagManager/PostManager 模式一致）
