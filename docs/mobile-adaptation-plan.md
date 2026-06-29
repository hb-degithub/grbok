# Mobile Adaptation Plan

本文档是胡巴的博客移动端适配方案，覆盖前台阅读体验、登录注册、搜索评论、后台管理、UI 设计原则、实施阶段和验收标准。

本计划只描述适配方案，不包含 Git 提交或线上发布动作。后续实施时应保持 `login_security.pb.js.disabled` 禁用，不在移动端改造中重新启用该 hook。

## 1. 当前结论

项目已经具备一部分移动端基础能力：

- 前台有 `meta viewport`。
- 前台 Header 已有移动端汉堡按钮和侧边抽屉。
- 文章列表、后台部分卡片已使用 `sm:`、`lg:` 等 Tailwind 响应式类。
- 搜索、登录、评论区使用 React island，具备单独优化交互的条件。

但整体还不能算完整移动端适配：

- 后台 `AdminLayout` 当前依赖固定侧栏宽度，手机端主内容会被侧栏挤压。
- `AdminSidebar` 是桌面固定侧栏，缺少后台专用移动抽屉和顶部入口。
- 后台文章、用户、评论等列表虽然部分在小屏下变成单列，但还缺少手机端明确的信息层级和操作区。
- 编辑文章弹窗在手机端容易变得过高、操作按钮不够稳定。
- 前台文章详情、代码块、表格、评论回复、搜索弹窗还需要系统化检查。
- 当前没有自动化移动端截图/横向滚动检测作为回归保障。

## 2. 适配目标

移动端不是简单缩小桌面版，而是提供两个明确体验：

1. 前台：舒服阅读、快速搜索、轻量互动。
2. 后台：手机上可以完成高频运维动作，包括看数据、发文章、审评论、改设置、查安全状态。

核心目标：

- 360px 宽度不出现页面级横向滚动。
- 常用按钮触控区域不低于 44px。
- 后台不依赖鼠标 hover 才能完成操作。
- 后台列表在手机端优先用卡片，不强迫用户横向滚动表格。
- 文章编辑、设置保存、评论审核等核心流程能在手机上完整完成。
- 移动端视觉保持安静、精致、可扫描，不做营销页式大装饰。

## 3. 设计方向

### 3.1 前台视觉方向

前台采用“轻量杂志 + 个人书房”的感觉：

- 信息密度适中，阅读优先。
- 视觉保持现在的 stone/zinc 基调，但移动端减少大面积装饰和过强玻璃拟态。
- 首页和文章列表保留精致动效，但小屏减少过多背景层，降低视觉噪音。
- 文章详情应像移动阅读器：标题清晰、正文行宽舒适、段落节奏稳定。

### 3.2 后台视觉方向

后台采用“紧凑控制台”的感觉：

- 手机端是工作界面，不做夸张 hero、不做大片装饰。
- 页面顶部只放当前任务、权限状态、菜单入口和必要动作。
- 列表项改为任务卡片，重点信息第一眼能扫到。
- 危险操作保持克制但醒目，比如删除、标记垃圾评论。
- 超级管理员相关页面用更强的边界提示，但不增加操作阻力。

### 3.3 移动端布局原则

- 手机端优先单列。
- 页面左右 padding 使用 16px，超小屏可降到 12px。
- 卡片圆角不超过现有体系，保持 6-8px。
- 固定元素必须考虑 `safe-area-inset-top` 和 `safe-area-inset-bottom`。
- 弹窗在手机端优先变为全屏 sheet 或底部 sheet。
- 桌面端表格在手机端改卡片，不把表格硬塞进横向滚动容器，除非是代码块或富文本表格。

## 4. 响应式断点

建议统一使用以下断点语义：

| 名称 | 宽度 | 用途 |
| --- | --- | --- |
| `mobile-sm` | 360px | 最小可用手机宽度，重点防溢出 |
| `mobile` | 390px | 主测试宽度，常见 iPhone 宽度 |
| `mobile-lg` | 430px | 大屏手机 |
| `tablet` | 768px | 平板竖屏，允许双列局部布局 |
| `desktop` | 1024px | 桌面后台侧栏恢复固定布局 |
| `wide` | 1280px+ | 现有桌面体验 |

实现上仍使用 Tailwind 默认断点为主：

- `<640px`：手机单列。
- `sm`：大手机/小平板增强。
- `md`：平板。
- `lg`：桌面侧栏和多列布局开始。

## 5. 前台适配方案

### 5.1 全局布局

涉及文件：

- `astro/src/layouts/BaseLayout.astro`
- `astro/src/styles/global.css`
- `astro/src/components/layout/Header.tsx`
- `astro/src/components/layout/SideNav.tsx`
- `astro/src/components/layout/Footer.astro`

改造点：

- `body` 增加移动端横向溢出保护，但不要掩盖组件内部问题。
- `main` 的顶部间距根据 Header 高度做响应式调整。
- Header 在小屏下减少按钮间距，避免登录状态、搜索、主题、菜单同时挤压。
- 移动抽屉保留现有焦点管理和滚动锁定，补充底部安全区。
- Footer 在 360px 下允许备案链接换行，图标和文字不互相压缩。

验收：

- 首页、文章页、登录页在 360px 宽度没有横向滚动。
- Header 所有按钮可点击，文字不挤出容器。
- 抽屉打开后背景不可滚动，关闭后焦点回到触发按钮。

### 5.2 首页

涉及文件：

- `astro/src/pages/index.astro`
- `astro/src/components/posts/PostList.tsx`
- `astro/src/components/sidebar/ProfileCard.tsx`
- `astro/src/components/sidebar/RecentComments.tsx`
- `astro/src/components/sidebar/FriendLinks.tsx`

改造点：

- 首页首屏在手机端不要占满过多高度，保证用户能看到文章入口。
- 侧边栏模块在手机端放到文章列表之后，不作为首屏核心。
- 首页卡片间距在手机端收紧，避免过长滚动。
- 最近评论内容需要 `line-clamp` 或自然换行，防止长文本撑宽。
- 友情链接在手机端使用单列或双列小卡，不使用过宽行布局。

UI 细节：

- 首页手机端标题字号控制在 28-34px。
- 次级文案控制在 14-15px。
- 卡片内部按钮统一 40-44px 高。

验收：

- 390px 宽度首屏能看到站点识别、主操作和下一段内容。
- 文章卡片不会因为标题、摘要或标签撑宽。

### 5.3 文章列表

涉及文件：

- `astro/src/components/posts/PostList.tsx`
- `astro/src/components/posts/PostCard.tsx`
- `astro/src/pages/posts/index.astro`
- `astro/src/pages/tags/[slug].astro`

改造点：

- 手机端文章卡片单列。
- 卡片封面使用稳定比例，如 `aspect-[16/9]`，防止图片加载导致布局跳动。
- 标题最多两行，摘要最多三行。
- 标签列表允许横向轻滚或换行，但不能撑宽页面。
- 分页按钮保持固定尺寸，避免页码变化造成布局跳动。

验收：

- 文章列表在 360px 下无横向滚动。
- 图片加载失败时仍有稳定占位。
- 分页在手机端可准确点击。

### 5.4 文章详情

涉及文件：

- `astro/src/layouts/PostLayout.astro`
- `astro/src/pages/posts/[slug].astro`
- `astro/src/styles/global.css`

改造点：

- 正文容器手机端最大宽度等于屏幕宽度减 32px。
- 正文字号 16px，行高约 1.75。
- 标题根据长度动态换行，避免大标题挤压。
- 代码块 `overflow-x-auto`，不影响整页宽度。
- 富文本表格使用局部横向滚动容器。
- 图片 `max-width: 100%`，并保持圆角和 caption 间距。
- 长链接和英文长词使用 `overflow-wrap: anywhere`。

验收：

- 代码块和表格只在自身区域横向滚动。
- 正文中长 URL 不撑宽页面。
- 评论区入口不会贴得太近。

### 5.5 登录、注册与认证状态

涉及文件：

- `astro/src/pages/login.astro`
- `astro/src/components/auth/AuthPage.tsx`
- `astro/src/components/auth/PasswordLoginForm.tsx`
- `astro/src/components/auth/MagicLinkForm.tsx`
- `astro/src/components/auth/RegisterForm.tsx`
- `astro/src/components/auth/AuthStatusControl.tsx`
- `astro/src/components/auth/HomeAuthQuickEntry.tsx`

改造点：

- 登录卡片手机端占满可用宽度，左右保留 16px 安全边距。
- 登录方式 tabs 在 360px 下仍能完整显示。
- 错误提示使用块级文本，不放进过窄一行。
- 冷却倒计时和 MFA/OTP 状态在按钮附近展示。
- Header 中认证入口在手机端优先显示图标，详细状态放入抽屉。

验收：

- 360px 宽度下登录/注册表单无挤压。
- 错误提示不覆盖输入框。
- 本地登录冷却状态清晰可见。

### 5.6 搜索

涉及文件：

- `astro/src/components/search/SearchModal.tsx`

改造点：

- 手机端搜索弹窗改为全屏 overlay。
- 搜索框 sticky 在顶部，结果列表独立滚动。
- 结果标题两行，摘要两到三行。
- 空状态和加载状态高度稳定，不让弹窗跳动。
- 关闭按钮放在右上角，触控区域至少 44px。

验收：

- 手机端打开搜索后背景不可滚动。
- 输入法弹出时搜索框仍可见。
- 结果列表可滚动，关闭后焦点回到搜索按钮。

### 5.7 评论区

涉及文件：

- `astro/src/components/comments/CommentSection.tsx`
- `astro/src/components/comments/CommentForm.tsx`
- `astro/src/components/comments/CommentItem.tsx`
- `astro/src/components/comments/ReplyForm.tsx`

改造点：

- 评论表单手机端单列，输入框和按钮高度统一。
- 回复表单不要深度缩进过多，嵌套评论在手机端降低缩进。
- 评论内容长文本自动换行。
- 评论操作按钮使用图标或短文本，避免一行挤满。
- 提交中、审核中、失败状态在当前表单附近显示。

验收：

- 360px 下二级回复不挤出屏幕。
- 长评论、长邮箱、长昵称不会造成横向滚动。
- 评论提交失败时提示清晰。

## 6. 后台适配方案

后台是本次移动端适配的最高优先级。

### 6.1 后台 Shell

涉及文件：

- `astro/src/layouts/AdminLayout.astro`
- `astro/src/components/admin/AdminSidebar.tsx`
- `astro/src/components/admin/AdminGuard.tsx`

设计：

- 桌面端：保留固定左侧栏。
- 平板端：默认收起侧栏，保留窄图标栏或抽屉。
- 手机端：完全取消固定侧栏，改为顶部栏 + 抽屉菜单。

改造点：

- `AdminLayout` 的 `main` 在 `<lg` 时不设置 `margin-left`。
- 手机端 topbar 左侧增加菜单按钮。
- `AdminSidebar` 在 `<lg` 时使用 fixed drawer，宽度约 `min(320px, 86vw)`。
- 抽屉打开时加遮罩、锁 body scroll、支持 ESC、焦点循环。
- 侧栏折叠状态只在桌面端写入 localStorage，避免手机端误用桌面宽度。

验收：

- 390px 下后台首页内容从屏幕左边开始，不被侧栏挤压。
- 菜单抽屉打开/关闭顺畅，背景不可滚动。
- 旋转屏幕后布局能恢复正确状态。

### 6.2 后台顶部栏

涉及文件：

- `astro/src/layouts/AdminLayout.astro`

设计：

- 手机端顶部栏分两层：
  - 第一层：菜单按钮、页面标题、返回站点按钮。
  - 第二层：权限标签、当前模块、必要状态。
- 桌面端保持当前横向信息结构。

改造点：

- 标题允许换行或 `truncate`，不能挤压按钮。
- 权限 badge 在手机端缩短文案。
- 返回站点按钮使用图标优先，文本在 `sm` 以上显示。

验收：

- 标题较长时不会把菜单按钮挤出屏幕。
- 顶部栏 sticky 时不遮挡页面第一行内容。

### 6.3 仪表盘

涉及文件：

- `astro/src/components/admin/AdminDashboard.tsx`
- `astro/src/components/admin/StatsCard.tsx`

改造点：

- 手机端统计卡片单列或两列，取决于内容长度。
- 关键指标使用大数字，小标签控制在一行。
- 快捷操作卡片单列排列，按钮触控高度 44px。
- 最近活动列表使用紧凑卡片。

验收：

- 360px 下统计数字不截断。
- 快捷操作不需要横向滚动。

### 6.4 文章管理

涉及文件：

- `astro/src/components/admin/PostManager.tsx`

设计：

- 桌面端：保留类表格列表。
- 手机端：文章卡片流。

手机卡片结构：

1. 顶部：封面缩略图、标题、slug。
2. 中部：状态、更新时间、浏览量。
3. 底部：编辑、发布/撤回、删除按钮。

改造点：

- 工具栏手机端变为：
  - 第一行：状态筛选横向滚动 segmented control。
  - 第二行：搜索框。
  - 第三行：新建文章按钮。
- 移除手机端 `min-w-[220px]` 这类撑宽占位。
- 操作按钮在手机端使用 40-44px 方形图标按钮，并保留 `title`/`aria-label`。
- 编辑弹窗手机端全屏化。

文章编辑移动端：

- 顶部 sticky：标题、关闭。
- 内容区滚动：标题、摘要、正文、slug、状态、封面。
- 底部 sticky：取消、保存。
- 正文 textarea 高度使用 `min-height`，不要固定过大。

验收：

- 手机端可以新建文章、编辑文章、发布、撤回、删除。
- 弹窗打开后底部保存按钮始终容易找到。
- 输入长正文时页面不出现横向滚动。

### 6.5 评论审核

涉及文件：

- `astro/src/components/admin/CommentModerator.tsx`

设计：

- 评论审核是手机端高频操作，应做成“审核队列”。
- 每条评论是一张卡片，操作按钮在底部固定顺序。

手机卡片结构：

1. 作者昵称、邮箱、状态。
2. 评论正文。
3. 所属文章、创建时间。
4. 操作按钮：通过、标记、删除。

改造点：

- 筛选按钮允许横向轻滚。
- 邮箱使用 `break-all` 或 `truncate`。
- 评论内容 `whitespace-pre-wrap` 同时加 `break-words`。
- 操作按钮在手机端三等分，图标 + 短文本。

验收：

- 390px 下可以连续审核多条评论。
- 长邮箱、长评论不撑破卡片。
- 删除确认不会误触，危险按钮视觉明确。

### 6.6 标签管理

涉及文件：

- `astro/src/components/admin/TagManager.tsx`

改造点：

- 手机端标签卡片单列。
- 新建/编辑标签表单放在列表上方或底部 sheet。
- 标签 slug 长文本可换行或省略。
- 色彩预览使用固定尺寸色块。

验收：

- 手机端能创建、编辑、删除标签。
- 标签名称和 slug 不会导致横向滚动。

### 6.7 用户管理

涉及文件：

- `astro/src/components/admin/UserManager.tsx`

设计：

- 桌面端：多列列表。
- 手机端：用户身份卡。

手机卡片结构：

1. 头像/首字母、昵称、邮箱。
2. 角色 badge、验证状态、创建时间。
3. 操作区：角色调整、禁用/启用、删除等。

改造点：

- 角色选择在手机端使用全宽 select 或 sheet。
- 邮箱使用 `break-all`，避免撑宽。
- 危险操作放在卡片底部右侧，不和普通操作混排。
- 若有批量操作，手机端先不做批量，保留单项操作。

验收：

- 超级管理员可在手机上查看和调整用户角色。
- 长邮箱不撑破布局。

### 6.8 设置页

涉及文件：

- `astro/src/components/admin/SettingsForm.tsx`

改造点：

- 设置分组在手机端单列。
- 开关类设置使用清晰 toggle，不使用拥挤文本按钮。
- `debug_protection_enabled` 放在安全/交互相关分组，说明它是干扰项，不是安全边界。
- 保存按钮 sticky 到底部，避免长设置页滚动后找不到提交入口。

验收：

- 手机端能修改并保存站点设置。
- 开关状态一眼可辨认。

### 6.9 安全审计

涉及文件：

- `astro/src/components/admin/SecurityAudit.tsx`

设计：

- 手机端优先显示风险等级和下一步动作。
- 长说明折叠到详情里，避免一屏信息过载。

改造点：

- 风险卡片单列。
- 安全检查结果 badge 固定位置。
- 长命令或配置片段使用局部横向滚动代码块。

验收：

- 390px 下能快速看出高风险项。
- 代码/配置文本不撑宽页面。

## 7. 组件级统一规范

### 7.1 按钮

- 移动端高度：主要按钮 44px，次要图标按钮至少 40px。
- 图标按钮必须有 `aria-label` 或 `title`。
- 危险操作使用现有 danger 色，不扩大为整屏红色。
- 多按钮组在手机端允许换行或改为等分网格。

### 7.2 输入框

- 高度至少 42px。
- 文本输入、textarea、select 宽度 `100%`。
- 错误提示放在字段下方。
- 密码/验证码/邮箱输入不和按钮挤在同一行。

### 7.3 卡片

- 手机端卡片 padding 12-16px。
- 卡片内标题最多两行。
- 次要元信息使用 11-12px，但不能低于可读阈值。
- 卡片内 action 区和内容区分隔清楚。

### 7.4 弹窗与抽屉

- 手机端 modal 优先全屏或底部 sheet。
- 需要滚动时，只有内容区滚动，顶部和底部操作区固定。
- 打开时锁定 body scroll。
- 关闭后恢复焦点。

### 7.5 表格

- 后台业务表格手机端改卡片。
- 文章正文里的富文本表格保留表格，但包裹 `overflow-x-auto`。
- 不允许整页因为表格出现横向滚动。

### 7.6 文本溢出

- 标题：`line-clamp-2` 或明确换行。
- 邮箱、slug、URL：使用 `break-all`、`break-words` 或 `overflow-wrap: anywhere`。
- badge 文案：手机端缩短。

## 8. 全局 CSS 建议

涉及文件：

- `astro/src/styles/global.css`

建议增加或检查：

```css
html {
  overflow-x: clip;
}

body {
  min-width: 320px;
}

img,
video,
canvas,
svg {
  max-width: 100%;
}

.prose {
  overflow-wrap: anywhere;
}

.prose pre,
.prose table {
  max-width: 100%;
}

.safe-bottom {
  padding-bottom: max(1rem, env(safe-area-inset-bottom));
}
```

注意：`overflow-x: hidden` 不能作为主要修复手段。真正的修复应找到撑宽元素。

## 9. 动效策略

移动端动效原则：

- 保留必要反馈，减少大面积动画。
- 抽屉使用 220-280ms spring 或 ease-out。
- 列表卡片进入动画不超过 120ms stagger。
- 尊重 `prefers-reduced-motion`。
- 后台操作成功/失败使用轻提示，不使用遮挡式大动画。

涉及点：

- Header 显隐动画保留。
- 前台首页装饰动画在手机端降低强度。
- 后台列表 `layout` 动画保留，但避免大量数据时卡顿。

## 10. 可访问性

必须覆盖：

- 抽屉和弹窗 `role="dialog"`、`aria-modal="true"`。
- 菜单按钮正确维护 `aria-expanded`。
- 图标按钮有可读标签。
- 键盘可关闭弹窗：ESC。
- Tab 不逃出打开的 modal/drawer。
- 表单错误提示和字段关联。
- 颜色不是唯一状态表达，状态 badge 保留文字。

## 11. 性能策略

- 手机端减少不必要装饰 DOM。
- 图片必须有稳定尺寸或 aspect-ratio。
- 搜索弹窗和后台重组件按需 hydration。
- 大列表保留分页或限制每页数量，避免一次渲染过多。
- 避免在滚动过程中触发昂贵布局计算。

## 12. 测试与验收

### 12.1 手动测试视口

至少覆盖：

- 360 x 740
- 390 x 844
- 430 x 932
- 768 x 1024
- 844 x 390 横屏
- 1024 x 768 平板横屏

### 12.2 页面清单

前台：

- `/`
- `/posts`
- `/posts/demo`
- `/tags`
- `/login`
- 搜索弹窗
- 评论区和回复表单

后台：

- `/admin`
- `/admin/posts`
- `/admin/comments`
- `/admin/tags`
- `/admin/users`
- `/admin/settings`
- `/admin/security`

### 12.3 自动化建议

建议增加 Playwright 脚本检查：

- 每个核心页面在 390px 下截图。
- 检查 `document.documentElement.scrollWidth <= window.innerWidth + 1`。
- 检查核心按钮是否可见。
- 检查抽屉打开后 body 是否锁滚动。
- 检查 modal 打开后焦点是否在 modal 内。

### 12.4 构建验证

每次移动端改造后运行：

```bash
cd astro
npm run build
```

如有 Playwright：

```bash
npx playwright test
```

## 13. 实施阶段

### Phase 0: 基线截图与问题清单

目标：

- 不改代码，先建立当前移动端截图和横向滚动清单。

任务：

- 启动本地 Astro。
- 截图前台和后台核心页面。
- 记录每个页面的溢出元素、遮挡元素、不可点击操作。

产出：

- 移动端问题清单。
- 基线截图。

### Phase 1: 后台 Shell

目标：

- 后台在手机端先能正常打开、导航、切换页面。

任务：

- 改 `AdminLayout` 手机端 margin。
- 改 `AdminSidebar` 为桌面固定 + 手机抽屉。
- 改后台 topbar 手机端结构。

验收：

- 390px 下后台全部页面不被侧栏挤压。
- 菜单抽屉可用。

### Phase 2: 后台高频页面

目标：

- 手机端完成文章和评论核心工作流。

任务：

- 改 `PostManager` 手机卡片流。
- 改文章编辑 modal 为手机全屏 sheet。
- 改 `CommentModerator` 审核队列卡片。

验收：

- 手机端可新建/编辑/发布文章。
- 手机端可审核/删除评论。

### Phase 3: 后台剩余页面

目标：

- 后台管理全覆盖。

任务：

- 改 `UserManager` 用户卡片。
- 改 `TagManager` 标签卡片和表单。
- 改 `SettingsForm` 手机单列表单和 sticky 保存。
- 改 `SecurityAudit` 风险卡片。
- 检查 `AdminDashboard` 和 `StatsCard`。

验收：

- 所有后台页面 390px 下无横向滚动。
- 所有核心操作可完成。

### Phase 4: 前台阅读与互动

目标：

- 前台移动端体验从“能看”提升到“舒服”。

任务：

- 首页移动端首屏和卡片间距。
- 文章列表卡片稳定比例。
- 文章详情 prose、代码块、表格、图片。
- 评论区和回复表单。
- 搜索弹窗全屏化。
- 登录/注册表单细节。

验收：

- 前台页面 360px 下无横向滚动。
- 文章详情长内容表现正常。
- 搜索、登录、评论流程可用。

### Phase 5: 自动化回归

目标：

- 防止后续改动重新破坏移动端。

任务：

- 添加移动端截图测试。
- 添加横向滚动检测。
- 添加核心交互 smoke test。

验收：

- CI 或本地命令能稳定发现移动端溢出。

## 14. 优先级

P0：

- `AdminLayout` 手机端取消固定侧栏 margin。
- `AdminSidebar` 手机抽屉。
- `PostManager` 手机端文章卡片和编辑全屏。
- `CommentModerator` 手机端审核卡片。

P1：

- `UserManager`、`SettingsForm`、`SecurityAudit`、`TagManager`。
- 前台文章详情代码块/表格/长链接。
- 搜索弹窗手机全屏。

P2：

- 首页视觉微调。
- 文章卡片动效和图片占位。
- 自动化截图测试。

## 15. 风险与注意事项

- 不要用简单 `overflow-x: hidden` 掩盖后台侧栏和列表撑宽问题。
- 不要为了移动端删除桌面端已有高效布局，应通过断点切换。
- 不要把后台做成营销式大卡片，后台目标是扫描和操作效率。
- 不要把 F12 干扰项描述成安全能力。
- 不要改动 PocketBase 权限规则，除非移动端功能确实需要新的 API 字段。
- 不要启用 `login_security.pb.js.disabled`。
- 不要在本计划实施中顺手提交或推送 Git，除非另行明确要求。

## 16. 推荐落地顺序

最推荐的实际落地顺序：

1. 后台 Shell。
2. 文章管理。
3. 评论审核。
4. 用户、设置、安全、标签。
5. 前台文章详情、搜索、评论。
6. 首页和视觉细节。
7. 自动化截图和横向滚动检测。

这样可以先解决最容易影响实际管理工作的部分，再逐步打磨前台体验。

## 17. 多智能体补强清单

本章整合三个子智能体从后台管理、前台体验、测试上线三个角度给出的补充建议。它不是替代前文，而是作为实施时的细化检查表使用。

### 17.1 前台全局导航补强

涉及文件：

- `astro/src/layouts/BaseLayout.astro`
- `astro/src/components/layout/Header.tsx`
- `astro/src/components/layout/SideNav.tsx`
- `astro/src/components/auth/AuthStatusControl.tsx`

补充要求：

- Header 当前搜索、主题、菜单等图标按钮多为 `h-9 w-9`，手机端实际触控目标提升到 44px，图标视觉尺寸保持 16-18px。
- `SideNav` 增加 `safe-area-inset-top` 和 `safe-area-inset-bottom`，避免刘海屏和底部手势区遮挡关闭按钮或最后一个导航项。
- Header 自动隐藏时，搜索弹窗、主题菜单、侧边抽屉打开期间不应因为滚动状态变化导致入口消失。
- 主题菜单和账号菜单在手机端设置最大宽度 `calc(100vw - 2rem)`，长昵称、长邮箱、长角色名不能撑宽页面。

验收：

- 360px 下 Header 所有可点控件实际点击区域不小于 44x44。
- 打开 `SideNav` 后，首个可聚焦元素可见，最后一个导航项不被底部安全区遮住。
- 账号昵称超过 20 个中文或邮箱很长时，Header 不出现横向滚动。

### 17.2 前台首页补强

涉及文件：

- `astro/src/pages/index.astro`
- `astro/src/components/effects/ParticleField.tsx`
- `astro/src/components/auth/HomeAuthQuickEntry.tsx`
- 可能存在的 `Typewriter` 或同类 client island

补充要求：

- 首页 hero 如果使用 `min-h-screen`，移动端应限制首屏高度，让 390px 首屏底部露出“最新文章”标题或文章卡片入口。
- client island 的首屏文案需要静态兜底，弱网或 JS 未加载时不能让副标题长期空白。
- `ParticleField`、扫描线、浮动装饰在移动端按 `prefers-reduced-motion`、低性能设备或省流量场景降级。
- 首页移动端排在文章列表后的侧栏模块，应区分加载中、加载失败、真的为空，不只在控制台报错。

验收：

- 390x844 首屏能同时看到站点名、主操作和下一段内容露出。
- 禁用 JS 或 React island 慢加载时，首页核心文案仍可读。
- 模拟 PocketBase 失败时，首页统计、快速入口、侧栏模块显示稳定错误态或降级态。

### 17.3 前台文章列表补强

涉及文件：

- `astro/src/components/posts/PostList.tsx`
- `astro/src/components/posts/PostCard.tsx`
- `astro/src/pages/posts/index.astro`
- `astro/src/pages/tags/[slug].astro`

补充要求：

- `PostCard` 无封面文章需要稳定占位或明确的无图版式，避免列表卡片高度差过大。
- 分页按钮从 `h-9 min-w-[36px]` 提升到至少 40-44px；页数较多时使用省略号或换行策略。
- 翻页请求考虑竞态，快速点击分页时旧请求不能覆盖新页结果。
- 标签详情页纳入文章列表同等验收，检查外层 padding 和最大宽容器。

验收：

- 文章无封面、长标题、长摘要、长标签组合下，360px 无横向滚动。
- 连续快速点击分页，最终展示页码与文章结果一致。
- 分页按钮在 360px 下可准确点击。

### 17.4 前台文章详情补强

涉及文件：

- `astro/src/pages/posts/[slug].astro`
- `astro/src/layouts/PostLayout.astro`
- `astro/src/styles/global.css`

补充要求：

- 当前实际文章详情路由是 `posts/[slug].astro`，计划实施时应确认它是否使用 `PostLayout.astro`；如果未使用，需要统一详情布局入口或分别检查两处。
- `posts/[slug].astro` 的正文容器需要手机端左右 padding，360px 下正文、返回按钮、评论区至少保留 16px 边距。
- 标题若使用 `uppercase` 或较强字距，移动端长英文标题、混排标题要限制字距并允许自然换行。
- `.prose table` 需要局部横向滚动容器，不能只依赖 `width: 100%`。
- 浏览量、作者名、日期等元信息在手机端允许分行，不撑宽标题区。

验收：

- 360px 下文章正文左右至少保留 16px 可读边距。
- 30 字中文标题、长英文标题、长 URL、代码块、表格都不造成页面级横向滚动。
- 评论区与正文之间间距稳定，输入框不贴近屏幕边缘。

### 17.5 前台认证与搜索补强

涉及文件：

- `astro/src/components/auth/AuthPage.tsx`
- `astro/src/components/auth/PasswordLoginForm.tsx`
- `astro/src/components/auth/MagicLinkForm.tsx`
- `astro/src/components/auth/RegisterForm.tsx`
- `astro/src/components/search/SearchModal.tsx`

认证补充：

- `AuthPage` 的玻璃卡片手机端 padding 要检查，360px 下输入框、错误提示、tabs 三列文字不能拥挤。
- OTP/MFA 的“重新发送 / 返回密码 / 更换邮箱”按钮在 360px 下允许单列或等宽换行，不能截断。
- 软键盘弹出时，当前输入框、错误提示和提交按钮仍可滚动到可视区域。
- 本地登录冷却、MFA 发送中、验证中状态保持稳定高度，避免表单跳动。

搜索补充：

- `SearchModal` 增加 body scroll lock，并在关闭后恢复触发按钮焦点。
- 手机端关闭按钮使用 44px 图标按钮，键盘提示可放到底部或辅助区域。
- Pagefind 脚本加载失败不能只 `console.error`，需要显示“搜索暂不可用 / 重试”。
- 搜索结果 URL、标题、高亮摘要使用断行规则，不能撑宽结果卡片。
- 输入法弹出后，搜索框 sticky 在顶部，结果区独立滚动并避开键盘遮挡。

验收：

- 360x740 打开软键盘后，登录、注册、验证码流程都能完成提交。
- 30 字昵称、长邮箱、长错误信息不撑宽 Header、账号菜单或登录卡片。
- 打开搜索后背景不可滚动，关闭后焦点回到搜索按钮。
- 断网或 `/pagefind/pagefind.js` 加载失败时，弹窗显示可理解失败态。

### 17.6 前台评论、页脚与弱网补强

涉及文件：

- `astro/src/components/comments/CommentSection.tsx`
- `astro/src/components/comments/CommentItem.tsx`
- `astro/src/components/comments/CommentForm.tsx`
- `astro/src/components/comments/ReplyForm.tsx`
- `astro/src/components/layout/Footer.astro`
- `astro/src/components/sidebar/ProfileCard.tsx`
- `astro/src/components/sidebar/RecentComments.tsx`

评论补充：

- `ReplyForm` 的昵称/邮箱在 390px 以下改为单列。
- `CommentItem` 子评论每层缩进在手机端降低，例如从 `pl-6` 降到 `pl-3`，或改为浅色分隔线。
- 评论内容、作者名、长 URL 加 `break-words` 或 `overflow-wrap:anywhere`。
- 评论实时订阅失败时保留手动刷新入口或轻提示。
- 评论提交成功后若开启审核，在表单附近说明“审核后展示”，并保持评论列表位置不突跳。

页脚补充：

- 备案链接触控高度纳入 44px 验收。
- 公安备案图标和文字换行时保持基线稳定，不能图标单独悬在上一行。
- 登录页、404、空文章列表页验证页脚上方空白比例。

弱网补充：

- 所有前台 React island 的加载、失败、空态应高度稳定。
- PocketBase 请求失败不能只 `console.error`；首页侧栏、热榜、最近评论至少显示轻量失败态。
- 搜索、评论、认证请求区分正在加载 JS、正在请求接口、接口失败、无数据。
- 建议加入弱网手测：Chrome DevTools Slow 3G、离线、PocketBase 500、Pagefind 404。

验收：

- 360px 下二级、三级回复表单仍可完整填写和提交。
- 评论加载失败、实时连接失败、提交失败三种状态都有可见反馈和重试路径。
- Slow 3G 下首页首屏 2 秒内有可读主体内容或稳定骨架。

### 17.7 后台移动端信息架构补强

涉及文件：

- `astro/src/layouts/AdminLayout.astro`
- `astro/src/components/admin/AdminSidebar.tsx`
- `astro/src/components/admin/AdminDashboard.tsx`
- `astro/src/hooks/useAdminAuth.ts`

补充要求：

- 按角色明确后台移动端入口顺序：`author` 优先文章和标签；`admin` 增加评论，并把待审核评论前置；`super_admin` 才展示用户、设置、安全。
- `AdminSidebar` 当前直接过滤无权限菜单，移动端还应在仪表盘显示“当前角色可做什么/不可做什么”。
- 移动端抽屉内保留分组，每个导航项可包含模块状态，例如“评论 3 待审”“草稿 2”。
- `/admin` 仪表盘的“下一步操作”应成为移动端主入口，高优先级动作使用 44px 高整行列表承载。

验收：

- `author`、`admin`、`super_admin` 三种角色在 390px 下登录后，首屏都能看到最相关的下一步操作。
- 无权限模块不出现在菜单中，但仪表盘能说明当前角色范围。
- 任意后台页面都能通过顶部菜单返回后台首页并切换到可访问模块。

### 17.8 后台 Shell 与侧栏补强

涉及文件：

- `astro/src/layouts/AdminLayout.astro`
- `astro/src/components/admin/AdminSidebar.tsx`

补充要求：

- `AdminLayout.astro` 当前 `main` 使用内联 `margin-left: var(--admin-sidebar-width, 15.5rem)`，移动端不能依赖该 CSS 变量，`margin-left` 只在 `lg` 及以上生效。
- `AdminSidebar.tsx` 当前始终是 `fixed left-0 top-0 h-screen`，移动端实现应拆分为桌面固定侧栏与移动 drawer 两种状态。
- `AdminSidebar` 当前会写入 `localStorage` 和 `--admin-sidebar-width`，应只在桌面媒体查询命中时同步折叠状态。
- 移动 drawer 需要由 `AdminLayout` topbar 控制打开状态，并在路由点击、遮罩点击、ESC、登出后关闭。
- 抽屉底部用户信息和退出登录按钮增加 `safe-area-inset-bottom`。

验收：

- 360px 下 `document.documentElement.scrollWidth <= window.innerWidth + 1`。
- 打开抽屉后 body 不滚动，Tab 焦点不逃出抽屉。
- 从 390px 旋转到 1024px 再回到 390px，侧栏不会残留桌面宽度。

### 17.9 后台触控、表单与确认流补强

涉及文件：

- `astro/src/components/admin/PostManager.tsx`
- `astro/src/components/admin/CommentModerator.tsx`
- `astro/src/components/admin/TagManager.tsx`
- `astro/src/components/admin/UserManager.tsx`
- `astro/src/components/admin/SettingsForm.tsx`

触控补充：

- 后台图标按钮移动端统一提升到最小 40px，主要动作 44px。
- 仅有 `title` 的图标按钮补 `aria-label`。
- `CommentModerator.tsx` 在 `max-lg` 隐藏按钮文字后必须保证图标按钮可读，并让三个操作等宽排列。
- 危险操作不和普通操作贴在一起；删除按钮放到操作组末尾。

表单与弹窗补充：

- `PostManager` 编辑弹窗移动端改为全屏 sheet：顶部标题/关闭 sticky，中间表单滚动，底部取消/保存 sticky。
- `TagManager` 标签弹窗手机端改为底部 sheet 或全屏 sheet。
- 所有 modal/drawer 增加 `role="dialog"`、`aria-modal="true"`、焦点陷阱、关闭后焦点恢复。
- 原生 `confirm()` 可作为临时方案，但最终移动端危险确认使用项目内确认弹窗，展示对象名称和后果。
- `SettingsForm` 保存按钮 sticky 到底部，并显示未保存、保存中、已保存、失败状态。

验收：

- 所有后台核心操作按钮在 390px 下可触控区域不小于 40x40。
- 输入法弹出时，文章保存、标签保存、设置保存按钮仍可访问。
- 保存失败提示出现在当前表单附近，不只用 `alert()`。

### 17.10 后台各页面缺口补强

`PostManager.tsx`：

- 工具栏中的 `min-w-[220px]` spacer 在手机端必须移除。
- 状态筛选、搜索、新建按钮拆成三行。
- 文章 slug、封面 URL、长标题使用 `break-words` 或 clamp。

`CommentModerator.tsx`：

- 筛选栏移除 `min-w-[220px]`。
- 邮箱加 `break-all`。
- 评论正文加 `break-words`。
- 所属文章标题过长时两行截断。

`UserManager.tsx`：

- 移动端隐藏表头，改为用户身份卡。
- 角色 select 全宽。
- 最后一个超级管理员不可降级时给出卡片内说明。

`SettingsForm.tsx`：

- 站点 Logo URL、站点描述、数值输入在 360px 下单列。
- 保存区 sticky。
- `debug_protection_enabled` 保持“干扰项，不是安全边界”的醒目提示。

`SecurityAudit.tsx`：

- 风险项增加“只看警告/失败”的移动筛选。
- 长描述折叠。
- 高风险建议放在卡片顶部。

`TagManager.tsx`：

- 标签 slug 必须可换行。
- 编辑/删除按钮放大。
- 如果未来有颜色字段，色块固定 24px，不参与文本宽度计算。

验收：

- `/admin/posts`、`/admin/comments`、`/admin/users`、`/admin/settings`、`/admin/security`、`/admin/tags` 在 360px 下均无页面级横向滚动。
- 每个页面至少完成一个核心写操作：发文、审评论、改角色、保存设置、查看安全警告、建标签。
- 长邮箱、长 slug、长 URL、长评论、长站点描述不撑破卡片。

### 17.11 后台权限与安全专项验收

权限用例：

- `author`：可访问 `/admin/posts`、`/admin/tags`，不可访问评论、用户、设置、安全。
- `admin`：可访问评论审核，不可访问用户、设置、安全。
- `super_admin`：可访问用户、设置、安全，并能看到“最后一个超级管理员不可降级”的移动端提示。

安全要求：

- `SecurityAudit` 中 localStorage token、httpOnly Cookie 长期加固、`login_security.pb.js.disabled` 禁用状态，在移动端仍清晰可见。
- 不把 `debug_protection_enabled`、F12 干扰、右键拦截图层描述成真实安全能力。
- 无权限访问页面时，`AdminGuard.tsx` 的提示卡片在 360px 下不溢出，并提供返回首页/登录入口。

验收：

- 移动端安全页 390px 首屏能看到警告数量和最高风险项。
- 自动化 smoke test 覆盖角色菜单可见性、无权限提示、危险操作确认、横向滚动检测。

### 17.12 三层测试策略

测试分三层执行：

1. 本地 Astro 开发态。
2. 带 PocketBase 的本地集成环境。
3. 生产近似构建和容器环境。

开发态命令：

```powershell
cd H:\开发\个人博客
docker compose -f docker-compose.local.yml --env-file .env.local up -d
cd astro
$env:PUBLIC_SITE_URL='http://localhost:4321'
$env:PUBLIC_POCKETBASE_URL='http://localhost:8090'
npm run dev -- --host 127.0.0.1 --port 4321
```

构建预览命令：

```powershell
cd H:\开发\个人博客\astro
npm run build
npm run preview -- --host 127.0.0.1 --port 4321
```

生产近似验证：

```powershell
cd H:\开发\个人博客
docker compose --env-file .env.local config
cd astro
$env:PUBLIC_SITE_URL='https://hlydwz.com'
$env:PUBLIC_POCKETBASE_URL='https://hlydwz.com'
npm run build
```

### 17.13 扩展视口矩阵

新增或强调以下视口：

- `320 x 568`：极限兜底，只要求不崩、不横向溢出。
- `360 x 740`：P0 最小验收宽度。
- `390 x 844`：主要验收宽度。
- `430 x 932`：大屏手机。
- `768 x 1024`：平板竖屏。
- `844 x 390`：手机横屏，重点检查顶部栏、弹窗、键盘遮挡。
- `1024 x 768`：平板横屏，检查后台侧栏从抽屉恢复到桌面布局。

自动化检查建议：

- 所有页面执行 `document.documentElement.scrollWidth <= window.innerWidth + 1`。
- 检查 `body`、`main`、后台列表、弹窗内容区中是否存在宽度大于视口的元素，并输出选择器。
- 抽屉/modal 打开后检查 `document.body.style.overflow` 或等效锁滚动状态。
- 检查核心按钮尺寸：核心按钮 `height >= 40px`，主要操作 `height >= 44px`。
- 截图保存路径建议为 `tmp/mobile-baseline/{viewport}/{route}.png` 和 `tmp/mobile-after/{viewport}/{route}.png`。

### 17.14 调整后的实施节奏

建议把自动化的一部分前移到 Phase 0：

1. Phase 0：建立基线截图、横向溢出检测、核心路由清单。
2. Phase 1：后台 Shell，只解决侧栏、顶部栏、抽屉和布局根问题。
3. Phase 2：文章管理和文章编辑 sheet。
4. Phase 3：评论审核，验证连续操作、危险操作确认、长文本卡片。
5. Phase 4：用户、设置、安全、标签，复用稳定的卡片/表单模式。
6. Phase 5：前台文章详情、搜索、评论、登录。
7. Phase 6：首页视觉和动效微调。
8. Phase 7：把检测脚本接入固定本地命令或 CI。

阶段完成条件：

- 每个 Phase 不能只测目标页面，还要回测上一阶段页面。
- 例如改完 `PostManager` 后，必须重新跑 `/admin`、`/admin/comments`、`/admin/posts` 的 390px 溢出检测。
- 截图只作为本地验证资产，默认不提交，除非后续决定纳入文档资产。

### 17.15 风险边界

默认边界：

- 移动端适配默认只改 Astro/React/Tailwind 展示层。
- 不修改 `pb_migrations`、`pb_hooks`、集合规则，除非某个移动端流程确实缺字段或缺 API。
- `login_security.pb.js.disabled` 保持禁用，移动端验收不以重新启用 hook 为前提。
- 后台移动端不能绕过 `AdminGuard`。
- 不为了调试放宽 `/admin` 的 IP 白名单或 Caddy 限制。
- 前台搜索、评论、登录在移动端失败时，应显示可读错误，不吞掉 PocketBase 返回的认证/权限失败。

变更隔离：

- 后台 Shell 改造不要顺手重构前台 Header。
- 移动卡片化不要删除桌面表格结构，优先用断点切换。
- 全局 CSS 只放通用安全规则，组件溢出仍在组件内修。
- 修改 Caddy、Docker、PocketBase hook/migration 时必须在风险章节补充影响说明。

### 17.16 上线前后验证

上线前检查：

- `astro/dist` 已生成，`pagefind` 构建成功。
- `/`、`/posts`、`/login` 静态页面可访问。
- `/api/health` 返回正常。
- `/admin` 在允许 IP 下可访问，在非允许 IP 下仍应被 Caddy 拦截。
- 移动端 390px 下后台登录后可进入 `/admin/posts`、`/admin/comments`。
- 生产 CSP 没有阻止 React island、PocketBase API、搜索资源加载。

上线后 10 分钟内检查：

```powershell
curl.exe -I https://hlydwz.com/
curl.exe -s https://hlydwz.com/api/health
curl.exe -I https://hlydwz.com/login/
```

上线后人工验收：

- 手机真机打开首页、文章详情、登录页、搜索弹窗。
- 管理员手机打开后台，完成一次文章编辑保存和一次评论审核。
- 检查浏览器控制台是否有 hydration、CSP、PocketBase 连接错误。
- 检查 Caddy/PocketBase 容器健康状态和最近日志。

### 17.17 回滚原则

回滚粒度：

- 纯前端回滚：恢复上一版 `astro/dist`，不动 PocketBase 数据卷。
- Docker 回滚：保留 `blog_pb_data` 卷，只回滚 Caddy 静态资源和 Astro 构建产物。
- 禁止用删除 Docker volume 的方式回滚 UI 问题。
- 如果上线后只有后台移动端异常，优先临时回滚相关 Astro 构建，不改 Caddy 的 `/admin` IP 限制。

回滚前确认：

```powershell
docker compose ps
docker compose logs --tail=100 caddy
docker compose logs --tail=100 pocketbase
```

回滚后验收：

- `/api/health` 正常。
- 首页和文章详情正常。
- 管理员后台桌面端可用。
- `login_security.pb.js.disabled` 仍保持禁用。

### 17.18 文档维护记录

每个 Phase 完成后，在本节补充一条记录：

| 日期 | Phase | 涉及文件 | 验证命令 | 失败项 | 遗留问题 |
| --- | --- | --- | --- | --- | --- |
| 待填写 | 待填写 | 待填写 | 待填写 | 待填写 | 待填写 |

维护规则：

- 新增或调整路由时同步更新第 12.2 节页面清单。
- 新增后台组件时同步更新第 6 章后台适配方案和自动化 smoke test。
- 若新增 Playwright，需在 `astro/package.json` 增加固定脚本，例如 `test:mobile`，并在文档只引用该脚本，避免多人使用不同命令。

### 自动化检测落地记录

- 日期：2026-06-28
- 落地内容：新增 `astro/scripts/mobile-viewport-check.mjs`，并在 `astro/package.json` 增加 `check:mobile` 本地命令。
- 覆盖范围：`/`、`/posts`、`/login`、`/tags`，视口为 `320x568`、`360x740`、`390x844`、`430x932`、`768x1024`、`844x390`。
- 检测规则：脚本读取 `document.documentElement.scrollWidth` 与 `document.body.scrollWidth` 的最大值，判断是否超过当前 `window.innerWidth`，并输出包含路由、视口、HTTP 状态、scrollWidth、viewport、溢出像素和疑似元素选择器的报告。
- 使用方式：先启动本地 dev 或 preview 服务，再在 `astro` 目录运行 `npm run check:mobile -- --base-url http://127.0.0.1:4321`。
- 依赖边界：当前项目未声明 Playwright；脚本不会自动下载依赖，缺少 `playwright` 或 `@playwright/test` 时只输出缺依赖提示并退出。
- 本次轻量验证：已执行脚本语法检查；实际多视口浏览器验证需在补充 Playwright 并启动 dev/preview 服务后运行。
