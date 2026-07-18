# 全站前端动态效果增强设计

日期：2026-07-17
状态：待评审

## 背景与目标

Astro 博客（`astro/`，Astro 6 + React 19 岛屿 + Tailwind v4）现有效果集中在首页和登录页，文章页/归档/标签/后台偏静态，且存在一批写好未接线的组件。本次目标：**让全站 UI"活"起来**，同时保证不同设备、不同屏幕比例下的适配。

已确认的决策：

- 取向：**大胆新增动态效果**（微交互 + 滚动叙事 + 氛围背景全栈组合）
- 范围：**全部页面，含 admin 后台**（后台克制，只加过渡与反馈，不加粒子/WebGL）
- 移动端：**桌面全量，移动降级**（粒子减量或关闭，动画简化）
- 补充需求：① 适配不同设备与屏幕比例；② 首页左右固定侧栏目前很僵硬，重点优化

## 技术路线

- 滚动叙事：GSAP ScrollTrigger（复用现有 `gsap-vendor` chunk，不新增依赖）
- 微交互：framer-motion（已有）+ 少量 CSS transition/keyframes
- 氛围背景：复用现有 canvas/ogl 组件（`ParticleField`、`Starfield`），不引入新 WebGL 库
- 降级闸门：统一走 `useBreakpoint` hook（mobile/tablet/desktop/reduced-motion）+ global.css 的 `prefers-reduced-motion` 熔断

## 一、基础设施（共享层）

1. 新建 `astro/src/lib/motion.ts`：集中管理共享 framer-motion variants（入场、stagger 容器/子项、悬停/按压）与缓动常量，各组件引用同一份，避免每处各写一套参数。
2. 接通死代码：
   - `ReadingProgress` → 文章页顶部
   - `CursorGlow` → `BaseLayout`（仅桌面 + 非 reduced-motion）
   - `ParticleField` → 归档/标签/关于/404 的氛围背景
   - `CodeBlockCopy` 的思路 → 文章页代码块复制按钮（实现为客户端脚本，作用于 sanitize 后的 prose HTML，因为正文是构建期注入的 HTML 而非 React 树）
3. 清理 `GridFloor.astro`（无 CSS 定义的残留），demo 页相关引用一并移除或改用同页已在用的 `Starfield`；demo 页的 `animate-float` 无 keyframes 问题顺手修掉。
4. `PageTransition`、`VideoBackground`、`Stack` 保持不接线（页面过渡已由 ClientRouter 承担；视频背景无素材），本次不删除，仅不扩散。

## 二、首页侧栏重做（重点）

现状问题（`astro/src/pages/index.astro:38-82`）：

- `fixed left-6/right-6 + w-72` 写死：1280px 附近挤占内容（hero 用 `xl:px-[21rem]` 硬撑），超宽屏侧栏贴屏幕边缘、远离内容列
- 只在 `xl` 显示，1024–1280 区间体验断档
- 显示后完全静态，无滚动联动、无状态反馈，"僵硬"感主要来自这里

改造方案：

1. **流式定位**：侧栏位置改为跟随内容列而非屏幕边缘，用 `calc(50% - N)` 推算左右偏移（内容列最大宽度为设计令牌定值），宽度用 `clamp(15rem, 20vw, 18rem)` 流体化；hero 的 `xl:px-[21rem]` 改为对应的 `clamp()` 内边距，保证 1280px、1440px、1920px、超宽屏下内容列始终居中、侧栏与内容间距一致。
2. **断档补全**：`lg`–`xl` 区间（1024–1280）显示简化版左侧导航（窄宽度、仅站内导航一个面板），`xl` 以上恢复双侧完整版；`lg` 以下维持现有内联面板不变。
3. **滚动联动（消除僵硬的核心）**：
   - 侧栏整体轻微视差：滚动时以低于内容的速率 `translateY`（GSAP ScrollTrigger scrub，幅度 ≤30px）
   - Scrollspy：监听 `#latest` 等锚点区域，左侧导航当前项高亮，指示 pill 用 framer-motion `layoutId` 滑动
4. **微交互增强**：
   - 入场改为逐面板 stagger（现有 sidebar-rise 保留，加每面板 80ms 递增延迟 + spring 回弹）
   - 导航项编号（01–04）hover 时数字翻转为 teal；链接 hover 的 `translateX(4px)` 保留并加 spring 化
   - 资料卡头像/Logo hover 时轻微旋转回弹；stat-tile 数字已有 CountUp，补 hover 时放大 1.05
   - topic-chip hover 加按压回弹（scale 0.96 → 1）
5. 移动端与 reduced-motion：以上滚动联动与 hover 效果全部关闭，仅保留入场淡入。

## 三、首页其余增量

- hero 区 GSAP ScrollTrigger 视差：滚动时标语/CTA 不同速率上移淡出，粒子背景反向慢移
- 各 section 之间补 section 级错峰上浮入场（标题已有 ScrollFloat）
- 文章卡片（PostList/Masonry 项）悬停：封面微放大 + 标题变 teal + 卡片浮起，spring 过渡
- ScrollVelocity、MagicBento 维持现状

## 四、文章页 `[slug].astro`

- 顶部接通 `ReadingProgress`（zinc→teal 渐变 + 发光端点，组件已写好）
- 文章头滚动驱动：大标题随滚动缩小淡出，封面图轻微视差（GSAP ScrollTrigger）
- 正文 h2 进入视口时左侧 teal 标记条滑入（IntersectionObserver + CSS）
- 代码块悬浮复制按钮：客户端脚本在 prose HTML 的 `pre` 上注入按钮，点击复制 + 对勾反馈
- 评论区、上下篇导航入场补 stagger
- 文章页保持零 WebGL，以上全部为 ScrollTrigger/IO/CSS 级别

## 五、归档 / 标签 / 关于 / 404

- 统一加 `ParticleField` 轻量 canvas 氛围背景：桌面全量，移动端关闭，`document.hidden` 跳帧，reduced-motion 不渲染（组件已具备前两项能力，需确认 reduced-motion 检查）
- 归档页：时间轴节点沿滚动逐个弹入（ScrollReveal 已有，改 stagger + 节点 scale 回弹）
- 标签页：标签 chip 错峰入场（GlowCard 已有 hover 光晕）
- 关于页：维持 BlurText/GlareHover，补 section 入场编排
- 404：星空 `Starfield` 背景 + 大字号 404 漂浮动画

## 六、登录页

- GridScan 背景不动；面板入场编排改为 logo → 标题 → 表单依次 spring 浮现
- tab 切换的 `AnimatePresence mode="wait"` 保留，补共享布局的指示 pill 过渡连贯性检查
- 输入框 focus 时边框 teal 辉光扩散（CSS `box-shadow` 过渡，`:focus-visible`）

## 七、Admin 后台（克制）

- `AdminLayout` 页面切换淡入位移过渡（ClientRouter 已具备则只统一参数）
- 列表/表格行 stagger 入场（每行 30ms 递增，仅首次挂载）
- 卡片、按钮统一 hover（浮起/变色）与按压（scale 0.98）反馈；侧边导航当前项指示条滑动
- 表单提交、删除确认等操作反馈沿用 Toast，不加新效果
- 无粒子、无 WebGL、无滚动视差

## 八、响应式与屏幕比例适配（贯穿全站）

- 新增效果一律使用流体单位：`clamp()` 尺寸、现有 `--vvw/--vvh/--page-pad/--header-h` CSS 变量体系，禁止写死 px 断点值
- 断点策略统一：`<640` 移动 / `640–1023` 平板 / `1024–1279` 窄桌面（简化效果）/ `≥1280` 全量桌面；横屏手机（高 <520px）沿用现有压缩规则
- 触控目标 ≥44px、`touch-action: manipulation`、safe-area inset 等现有约束不被新效果破坏
- 验证矩阵（Playwright 截图）：375×667、768×1024、1024×768、1280×800、1440×900、1920×1080、2560×1080（超宽）

## 九、性能约束

- 新重组件全部 `client:visible` 或 `client:only="react"`；GSAP ScrollTrigger 按需动态 import，不进首屏关键路径
- canvas 组件沿用 `document.hidden` 跳帧；移动端粒子数量减半或关闭
- 不新增 npm 依赖；包体增量仅限 gsap 的 ScrollTrigger 插件（约 10KB，且 gsap-vendor chunk 已存在）
- reduced-motion：global.css 全局熔断 + 每个新组件独立检查，双重保险

## 十、验证

1. `cd astro && npm run build` 通过（含 pagefind、sw 注入）
2. `npm run check:mobile` 通过
3. Playwright 脚本对首页、文章页、归档、标签、关于、404、登录、admin 首页按第七节验证矩阵截图，人工核对效果与布局
4. 确认无控制台报错、无水平滚动条、暗色模式下效果颜色正确

## 明确不做

- 不引入新的 3D/粒子库；不给文章页加 WebGL；不改 GridScan 参数
- 不做与效果无关的重构（组件拆分、样式重写等）
- `PageTransition`/`VideoBackground`/`Stack` 保持未接线状态，不删除
