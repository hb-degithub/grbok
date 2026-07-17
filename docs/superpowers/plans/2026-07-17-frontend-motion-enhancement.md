# 全站前端动态效果增强 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 按 `docs/superpowers/specs/2026-07-17-frontend-motion-enhancement-design.md` 为全站（含 admin）增加动态效果与响应式适配，重点重做首页固定侧栏。

**Architecture:** 共享动效预设（`lib/motion.ts`）+ GSAP ScrollTrigger 页面脚本（`scripts/*.ts`，按页面拆分、带 `astro:page-load`/`astro:before-swap` 生命周期）+ framer-motion 岛屿组件 + 少量 CSS。不新增 npm 依赖。

**Tech Stack:** Astro 6、React 19、framer-motion 12、gsap 3（ScrollTrigger）、Tailwind CSS v4、Playwright（验证）。

## Global Constraints

- **不新增 npm 依赖**；只用已有的 gsap、framer-motion 和现有组件。
- **reduced-motion 双重熔断**：每个新 JS 动画入口检查 `window.matchMedia('(prefers-reduced-motion: reduce)')`，每个新 CSS 动画配 `@media (prefers-reduced-motion: reduce)` 关停规则。
- **移动端降级**：粒子背景一律 `hidden lg:block` 包装；滚动视差脚本内做 `min-width` 断点门；`<640px` 不新增任何重动画。
- **断点体系统一**：`<640` 移动 / `640–1023` 平板 / `1024–1279` 窄桌面（简化效果）/ `≥1280` 桌面全量。
- **流体单位**：新布局值用 `clamp()` / `calc(50% - N)`，禁止新写死的大 padding 断点值。
- **测试现实**：本项目无单元测试框架（无 vitest/jest），验证方式 = `npm run build` 通过 + `npm run check:mobile` 无水平溢出 + Task 9 的 Playwright 截图脚本。每个 Task 以此代替传统单测。
- **git commit 需确认**：每个 Task 末尾的 commit 步骤，执行前必须向用户逐次确认（环境规则优先于本计划）。
- 代码注释语言跟随所在文件现有风格（本仓库组件注释多为中文）。

---

### Task 1: 共享动效库 `lib/motion.ts` + 清理 GridFloor 死代码

**Files:**
- Create: `astro/src/lib/motion.ts`
- Delete: `astro/src/components/effects/GridFloor.astro`
- Modify: `astro/src/pages/posts/demo.astro`

**Interfaces:**
- Produces: `EASE_OUT_EXPO`（`[number, number, number, number]`）、`fadeUp`（`Variants`）、`staggerContainer(staggerChildren?, delayChildren?)`（`Variants`）、`springPop`（`Transition`）、`hoverLift`、`tapPress`。Task 4 的 `HomeSideNav` 会 import 这些。

- [ ] **Step 1: 创建共享动效库**

创建 `astro/src/lib/motion.ts`：

```ts
// 共享动效预设：全站统一的缓动、时长与 framer-motion variants。
// 新增动画组件优先复用本文件，避免每处各写一套参数。
import type { Variants, Transition } from 'framer-motion';

/** 全站主缓动（与 global.css 的 --ease-out-expo 一致） */
export const EASE_OUT_EXPO: [number, number, number, number] = [0.16, 1, 0.3, 1];

/** 入场：上浮 + 淡入 */
export const fadeUp: Variants = {
  hidden: { opacity: 0, y: 16 },
  visible: {
    opacity: 1,
    y: 0,
    transition: { duration: 0.5, ease: EASE_OUT_EXPO },
  },
};

/** 错峰容器：配合 fadeUp 等子项 variants 使用 */
export const staggerContainer = (
  staggerChildren = 0.08,
  delayChildren = 0,
): Variants => ({
  hidden: {},
  visible: { transition: { staggerChildren, delayChildren } },
});

/** 弹性按压/回弹过渡 */
export const springPop: Transition = { type: 'spring', stiffness: 400, damping: 17 };

/** 悬停上浮 / 按压缩放（配合 whileHover / whileTap） */
export const hoverLift = { y: -4 } as const;
export const tapPress = { scale: 0.98 } as const;
```

- [ ] **Step 2: 删除 GridFloor 并修复 demo 页**

`GridFloor.astro` 只渲染一个没有 CSS 定义的 `grid-floor` div（不可见残留），demo 页的 `animate-float` 类也缺少 keyframes。

删除文件：

```bash
rm astro/src/components/effects/GridFloor.astro
```

修改 `astro/src/pages/posts/demo.astro`：

删除第 4 行 import：

```astro
import GridFloor from '../../components/effects/GridFloor.astro';
```

删除第 10 行用法：

```astro
    <GridFloor />
```

在文件末尾（`</BaseLayout>` 之后）追加：

```astro
<style>
  @keyframes float {
    0%, 100% { transform: translateY(0); }
    50% { transform: translateY(-14px); }
  }
  .animate-float { animation: float 7s ease-in-out infinite; }
  @media (prefers-reduced-motion: reduce) {
    .animate-float { animation: none; }
  }
</style>
```

确认 `GridFloor` 没有其他引用：

```bash
cd astro && grep -rn "GridFloor" src/ || echo "no references"
```

预期输出：`no references`

- [ ] **Step 3: 验证构建**

```bash
cd astro && npm run build
```

预期：构建成功，无 TS/导入错误。

- [ ] **Step 4: Commit（需用户确认）**

```bash
git add astro/src/lib/motion.ts astro/src/pages/posts/demo.astro astro/src/components/effects/GridFloor.astro
git commit -m "feat(astro): add shared motion presets, remove dead GridFloor"
```

---

### Task 2: 全站接通 CursorGlow（桌面端鼠标光晕）

**Files:**
- Modify: `astro/src/components/effects/CursorGlow.tsx`
- Modify: `astro/src/layouts/BaseLayout.astro`

**Interfaces:**
- Consumes: `useBreakpoint()`（已有，返回 `{ isMobile, isTablet, isDesktop, currentBreakpoint, prefersReducedMotion }`）
- Produces: 无新接口；BaseLayout 全站挂载，移动端/reduced-motion 自动不渲染。

- [ ] **Step 1: 给 CursorGlow 补 reduced-motion 检查**

`CursorGlow.tsx` 目前只检查 `isMobile`。修改三处：

第 21 行：

```tsx
  const { isMobile } = useBreakpoint();
```

改为：

```tsx
  const { isMobile, prefersReducedMotion } = useBreakpoint();
```

第 28-29 行 effect 入口：

```tsx
  useEffect(() => {
    if (isMobile) return;
```

改为：

```tsx
  useEffect(() => {
    if (isMobile || prefersReducedMotion) return;
```

该 effect 的依赖数组（第 60 行 `[isMobile]`）改为：

```tsx
  }, [isMobile, prefersReducedMotion]);
```

第 62 行渲染守卫：

```tsx
  if (isMobile) return null;
```

改为：

```tsx
  if (isMobile || prefersReducedMotion) return null;
```

- [ ] **Step 2: BaseLayout 挂载 CursorGlow**

`astro/src/layouts/BaseLayout.astro` 第 19 行后（`import WelcomeOverlay ...` 之后）加 import：

```astro
import CursorGlow from '../components/effects/CursorGlow';
```

第 184 行 `<WelcomeOverlay client:load />` 之后加：

```astro
    <CursorGlow client:only="react" />
```

用 `client:only="react"` 避免 SSR 输出无用节点（组件在移动端本就返回 null）。

- [ ] **Step 3: 验证构建**

```bash
cd astro && npm run build
```

预期：构建成功。

- [ ] **Step 4: Commit（需用户确认）**

```bash
git add astro/src/components/effects/CursorGlow.tsx astro/src/layouts/BaseLayout.astro
git commit -m "feat(astro): enable CursorGlow site-wide on desktop"
```

---

### Task 3: 文章页增强（阅读进度条 + 标题/封面滚动视差 + h2 标记 + 代码块复制）

**Files:**
- Create: `astro/src/scripts/post-motion.ts`
- Modify: `astro/src/pages/posts/[slug].astro`

**Interfaces:**
- Consumes: `astro/src/components/effects/ReadingProgress.tsx`（默认导出，无 props）
- Produces: DOM 钩子类名 `.post-hero`、`.post-title`、`.post-cover`（供 post-motion.ts 查询）；`.code-copy-btn`（复制按钮）。Task 9 验证依赖这些类名存在。

- [ ] **Step 1: 创建 GSAP 滚动脚本**

创建 `astro/src/scripts/post-motion.ts`：

```ts
// 文章页滚动动效：标题随滚动淡出缩小、封面轻微视差。
// 通过 astro:page-load / astro:before-swap 适配 ClientRouter 客户端导航。
import gsap from 'gsap';
import { ScrollTrigger } from 'gsap/ScrollTrigger';

gsap.registerPlugin(ScrollTrigger);

let ctx: gsap.Context | undefined;

function setup() {
  ctx?.revert();
  if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;

  ctx = gsap.context(() => {
    const header = document.querySelector('.post-hero');
    const title = document.querySelector('.post-title');
    if (header && title) {
      gsap.to(title, {
        opacity: 0.25,
        scale: 0.96,
        transformOrigin: 'left top',
        ease: 'none',
        scrollTrigger: {
          trigger: header,
          start: 'top top+=96',
          end: 'bottom top+=160',
          scrub: true,
        },
      });
    }

    const coverImg = document.querySelector('.post-cover img');
    if (coverImg) {
      gsap.fromTo(
        coverImg,
        { yPercent: -5, scale: 1.08 },
        {
          yPercent: 5,
          scale: 1.08,
          ease: 'none',
          scrollTrigger: {
            trigger: '.post-cover',
            start: 'top bottom',
            end: 'bottom top',
            scrub: true,
          },
        },
      );
    }
  });
}

setup();
document.addEventListener('astro:page-load', setup);
document.addEventListener('astro:before-swap', () => ctx?.revert());
```

- [ ] **Step 2: 接通 ReadingProgress 并加 DOM 钩子类名**

`astro/src/pages/posts/[slug].astro` frontmatter（第 6 行 `import TableOfContents ...` 后）加：

```ts
import ReadingProgress from '../../components/effects/ReadingProgress';
```

第 84-86 行附近，把：

```astro
<BaseLayout title={post?.title || '文章'} description={post?.excerpt || ''} image={post?.cover}>
  {post ? (
    <article class="mx-auto w-full max-w-5xl px-[var(--page-pad,1rem)] py-8 sm:py-10">
```

改为：

```astro
<BaseLayout title={post?.title || '文章'} description={post?.excerpt || ''} image={post?.cover}>
  {post ? (
    <>
    <ReadingProgress client:load />
    <article class="mx-auto w-full max-w-5xl px-[var(--page-pad,1rem)] py-8 sm:py-10">
```

对应的闭合（第 175 行附近 `</article>` 后）：

```astro
    </article>
  ) : (
```

改为：

```astro
    </article>
    </>
  ) : (
```

三处钩子类名：

- 第 106 行 `<header class="mb-12">` → `<header class="post-hero mb-12">`
- 第 112 行 h1 的 class 开头加 `post-title`：`<h1 class="post-title mb-6 break-words ...">`
- 第 131 行封面容器：`<div class="mt-8 overflow-hidden rounded-xl ...">` → `<div class="post-cover mt-8 overflow-hidden rounded-xl ...">`

- [ ] **Step 3: h2 左侧 teal 标记条**

`[slug].astro` 现有 `<style>` 块内（`.reveal-content` 规则区域）追加：

```css
  .reveal-content h2 {
    position: relative;
    padding-left: 0.875rem;
  }
  .reveal-content h2::before {
    content: "";
    position: absolute;
    left: 0;
    top: 0.18em;
    bottom: 0.18em;
    width: 3px;
    border-radius: 9999px;
    background: linear-gradient(to bottom, #14b8a6, #2dd4bf);
    transform: scaleY(0);
    transform-origin: top;
    transition: transform 0.45s cubic-bezier(0.16, 1, 0.3, 1);
  }
  .reveal-content h2.revealed::before {
    transform: scaleY(1);
  }
```

并在该 `<style>` 的 `@media (prefers-reduced-motion: reduce)` 块内追加：

```css
    .reveal-content h2::before {
      transition: none;
      transform: scaleY(1);
    }
```

（原理：现有 IntersectionObserver 脚本已给每个直接子元素加 `.revealed`，h2 是直接子元素，纯 CSS 即可联动，无需改 JS。）

- [ ] **Step 4: 代码块悬浮复制按钮**

在 `[slug].astro` 末尾现有 `<script>` 块内（IO 逻辑之后）追加：

```ts
  // 代码块悬浮复制按钮（正文是构建期注入的 HTML，用客户端脚本挂载）
  function initCodeCopy() {
    document.querySelectorAll<HTMLElement>('.reveal-content pre').forEach((pre) => {
      if (pre.querySelector('.code-copy-btn')) return;
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'code-copy-btn';
      btn.setAttribute('aria-label', '复制代码');
      const copyIcon =
        '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="9" y="9" width="13" height="13" rx="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/></svg>';
      const checkIcon =
        '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M20 6 9 17l-5-5"/></svg>';
      btn.innerHTML = copyIcon;
      btn.addEventListener('click', async () => {
        const code = pre.querySelector('code')?.innerText ?? pre.innerText;
        try {
          await navigator.clipboard.writeText(code);
          btn.classList.add('copied');
          btn.innerHTML = checkIcon;
          window.setTimeout(() => {
            btn.classList.remove('copied');
            btn.innerHTML = copyIcon;
          }, 1400);
        } catch {
          // 剪贴板不可用（非安全上下文等）时静默失败
        }
      });
      pre.appendChild(btn);
    });
  }
  initCodeCopy();
  document.addEventListener('astro:page-load', initCodeCopy);
```

同一 `<style>` 块内追加按钮样式（代码块是固定深色 Catppuccin 风格，按钮不随主题切换）：

```css
  .reveal-content pre {
    position: relative;
  }
  .code-copy-btn {
    position: absolute;
    top: 0.5rem;
    right: 0.5rem;
    display: flex;
    align-items: center;
    justify-content: center;
    width: 2rem;
    height: 2rem;
    border-radius: 0.5rem;
    border: 1px solid rgba(205, 214, 244, 0.16);
    background: rgba(30, 30, 46, 0.85);
    color: #a6adc8;
    cursor: pointer;
    opacity: 0;
    transform: translateY(-2px);
    transition: opacity 0.2s ease, transform 0.2s ease, color 0.2s ease;
  }
  .code-copy-btn svg {
    width: 0.95rem;
    height: 0.95rem;
  }
  .reveal-content pre:hover .code-copy-btn,
  .code-copy-btn:focus-visible {
    opacity: 1;
    transform: translateY(0);
  }
  .code-copy-btn:hover {
    color: #cdd6f4;
  }
  .code-copy-btn.copied {
    color: #a6e3a1;
    opacity: 1;
    transform: translateY(0);
  }
  @media (hover: none) {
    .code-copy-btn {
      opacity: 0.85;
      transform: none;
    }
  }
```

reduced-motion 块内再追加：

```css
    .code-copy-btn {
      transition: none;
    }
```

- [ ] **Step 5: 页脚导航 hover 微交互 + 挂载 post-motion 脚本**

第 149 行 `<nav class="grid gap-4 sm:grid-cols-2" aria-label="文章导航">` 加类名：

```astro
<nav class="post-footer-nav grid gap-4 sm:grid-cols-2" aria-label="文章导航">
```

`<style>` 内追加：

```css
  .post-footer-nav a {
    transition: transform 0.25s cubic-bezier(0.16, 1, 0.3, 1), border-color 0.2s ease, color 0.2s ease;
  }
  .post-footer-nav a:hover {
    transform: translateY(-2px);
  }
```

reduced-motion 块内追加：

```css
    .post-footer-nav a {
      transition: none;
    }
    .post-footer-nav a:hover {
      transform: none;
    }
```

文件末尾（现有 `</script>` 之后）新增一个脚本块引入 GSAP 滚动脚本：

```astro
<script>
  import '../../scripts/post-motion';
</script>
```

- [ ] **Step 6: 验证构建**

```bash
cd astro && npm run build
```

预期：构建成功。

- [ ] **Step 7: Commit（需用户确认）**

```bash
git add astro/src/scripts/post-motion.ts "astro/src/pages/posts/[slug].astro"
git commit -m "feat(astro): article page reading progress, scroll parallax, code copy"
```

---

### Task 4: 首页侧栏重做（流体定位 + lg 图标轨 + HomeSideNav scrollspy + 滚动视差）

**Files:**
- Create: `astro/src/components/sidebar/HomeSideNav.tsx`
- Create: `astro/src/scripts/sidebar-motion.ts`
- Modify: `astro/src/pages/index.astro`

**Interfaces:**
- Consumes: Task 1 的 `EASE_OUT_EXPO`、`fadeUp`、`staggerContainer`（来自 `astro/src/lib/motion.ts`）
- Produces: DOM 钩子 `.sidebar-parallax-left` / `.sidebar-parallax-right`（sidebar-motion.ts 查询）；`HomeSideNav`（默认导出，无 props）。Task 5 会继续修改 `index.astro`，但不动本 Task 的 aside 结构。

背景：现状 `astro/src/pages/index.astro:38-82` 两侧栏 `fixed left-6/right-6 + w-72` 写死、仅 `xl` 显示；hero 与两个内容 section 用 `xl:px-[21rem]` 硬撑。超宽屏侧栏贴屏幕边缘、内容列被拉得过长；1280px 附近又挤。改造：侧栏跟随内容列（内容列上限 84rem 居中，侧栏贴在内容列外侧 1.5rem 处），1024–1279 显示简化图标轨。

- [ ] **Step 1: 创建 HomeSideNav 组件（scrollspy + 滑动 pill）**

创建 `astro/src/components/sidebar/HomeSideNav.tsx`：

```tsx
import React, { useEffect, useState } from 'react';
import { motion } from 'framer-motion';
import { EASE_OUT_EXPO, fadeUp, staggerContainer } from '../../lib/motion';

const NAV_ITEMS = [
  { id: 'top', href: '/', label: '首页', num: '01' },
  { id: 'latest', href: '#latest', label: '最新文章', num: '02' },
  { id: 'posts', href: '/posts', label: '全部文章', num: '03' },
  { id: 'tags', href: '/tags', label: '标签索引', num: '04' },
] as const;

type NavId = (typeof NAV_ITEMS)[number]['id'];

/**
 * 首页左侧固定导航（xl 以上显示）。
 * Scrollspy：滚动经过 #latest 后高亮「最新文章」，回到顶部高亮「首页」；
 * 当前项指示 pill 用 layoutId 在项间滑动，配合逐项 stagger 入场。
 */
export default function HomeSideNav() {
  const [active, setActive] = useState<NavId>('top');

  useEffect(() => {
    const latest = document.getElementById('latest');
    if (!latest) return;
    let raf = 0;
    const update = () => {
      raf = 0;
      const passed = window.scrollY + window.innerHeight * 0.35 >= latest.offsetTop;
      setActive(passed ? 'latest' : 'top');
    };
    const onScroll = () => {
      if (!raf) raf = requestAnimationFrame(update);
    };
    update();
    window.addEventListener('scroll', onScroll, { passive: true });
    return () => {
      window.removeEventListener('scroll', onScroll);
      if (raf) cancelAnimationFrame(raf);
    };
  }, []);

  return (
    <motion.nav
      variants={staggerContainer(0.06, 0.1)}
      initial="hidden"
      animate="visible"
      aria-label="分区导航"
      className="grid gap-2 text-sm"
    >
      {NAV_ITEMS.map((item) => {
        const isActive = active === item.id;
        return (
          <motion.a
            key={item.id}
            variants={fadeUp}
            href={item.href}
            whileHover={{ x: 4 }}
            whileTap={{ scale: 0.98 }}
            transition={{ type: 'spring', stiffness: 400, damping: 25 }}
            className={`group relative flex items-center justify-between rounded-lg px-4 py-3 font-semibold no-underline transition-colors ${
              isActive
                ? 'text-white dark:text-zinc-950'
                : 'bg-zinc-50 text-zinc-700 hover:text-zinc-950 dark:bg-zinc-950/50 dark:text-zinc-300 dark:hover:text-zinc-50'
            }`}
          >
            {isActive && (
              <motion.span
                layoutId="home-side-nav-pill"
                transition={{ duration: 0.3, ease: EASE_OUT_EXPO }}
                className="absolute inset-0 rounded-lg bg-zinc-900 dark:bg-zinc-100"
                aria-hidden="true"
              />
            )}
            <span className="relative z-10">{item.label}</span>
            <span
              className={`relative z-10 font-mono text-xs transition-colors ${
                isActive
                  ? 'text-teal-400 dark:text-teal-600'
                  : 'text-zinc-400 group-hover:text-teal-500 dark:group-hover:text-teal-400'
              }`}
            >
              {item.num}
            </span>
          </motion.a>
        );
      })}
    </motion.nav>
  );
}
```

- [ ] **Step 2: 创建侧栏视差脚本**

创建 `astro/src/scripts/sidebar-motion.ts`：

```ts
// 首页固定侧栏滚动视差：侧栏以低于内容的速率上移，消除「钉死」感。
// 外层 aside 负责入场动画（sidebar-rise，会写 transform），
// 所以视差作用在内层 .sidebar-parallax-* 包装上，避免变换冲突。
import gsap from 'gsap';
import { ScrollTrigger } from 'gsap/ScrollTrigger';

gsap.registerPlugin(ScrollTrigger);

let ctx: gsap.Context | undefined;

function setup() {
  ctx?.revert();
  if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;
  if (!window.matchMedia('(min-width: 1280px)').matches) return;

  ctx = gsap.context(() => {
    gsap.to('.sidebar-parallax-left', {
      y: -28,
      ease: 'none',
      scrollTrigger: { trigger: document.body, start: 'top top', end: 'max', scrub: 0.6 },
    });
    gsap.to('.sidebar-parallax-right', {
      y: -14,
      ease: 'none',
      scrollTrigger: { trigger: document.body, start: 'top top', end: 'max', scrub: 0.6 },
    });
  });
}

setup();
document.addEventListener('astro:page-load', setup);
document.addEventListener('astro:before-swap', () => ctx?.revert());
```

- [ ] **Step 3: 改 index.astro frontmatter 与左侧栏**

frontmatter 加 import（放在第 10 行 `import FriendLinks ...` 之后）：

```ts
import HomeSideNav from '../components/sidebar/HomeSideNav';
```

第 38 行左侧 aside 整段替换。原代码（第 38-57 行）：

```astro
  <aside class="floating-sidebar sidebar-left fixed left-6 top-28 z-30 hidden w-72 space-y-5 xl:block" aria-label="固定分区导航">
    <section class="side-panel rounded-xl border border-zinc-200 bg-white p-5 shadow-xl shadow-zinc-900/[0.04] backdrop-blur-xl dark:border-zinc-800 dark:bg-zinc-900">
      <h3 class="text-sm font-black tracking-tight text-zinc-950 dark:text-zinc-50">站内导航</h3>
      <nav class="mt-4 grid gap-2 text-sm" aria-label="分区导航">
        <a href="/" class="side-link ..."><span>首页</span><span>01</span></a>
        ...（4 个 side-link，略，以实际文件为准）
      </nav>
    </section>

    <section class="side-panel ...">
      ...专题分类 chips，保持不变...
    </section>
  </aside>
```

替换为（注意：aside 去掉 `space-y-5`，新增内层 parallax 包装；nav 换成 HomeSideNav 岛屿；专题分类 section 原样保留）：

```astro
  <aside class="floating-sidebar sidebar-left fixed top-28 z-30 hidden w-[clamp(15rem,20vw,18rem)] xl:block xl:left-[max(1.5rem,calc(50%-61.5rem))]" aria-label="固定分区导航">
    <div class="sidebar-parallax-left space-y-5">
    <section class="side-panel rounded-xl border border-zinc-200 bg-white p-5 shadow-xl shadow-zinc-900/[0.04] backdrop-blur-xl dark:border-zinc-800 dark:bg-zinc-900">
      <h3 class="text-sm font-black tracking-tight text-zinc-950 dark:text-zinc-50">站内导航</h3>
      <div class="mt-4">
        <HomeSideNav client:visible />
      </div>
    </section>

    <section class="side-panel rounded-xl border border-zinc-200 bg-white p-5 shadow-xl shadow-zinc-900/[0.04] backdrop-blur-xl dark:border-zinc-800 dark:bg-zinc-900">
      <h3 class="text-sm font-black tracking-tight text-zinc-950 dark:text-zinc-50">专题分类</h3>
      <div class="mt-4 flex flex-wrap gap-2">
        <a href="/tags" class="topic-chip rounded-full bg-zinc-100 px-3 py-1.5 text-xs font-semibold text-zinc-600 no-underline dark:bg-zinc-800 dark:text-zinc-300">技术记录</a>
        <a href="/tags" class="topic-chip rounded-full bg-zinc-100 px-3 py-1.5 text-xs font-semibold text-zinc-600 no-underline dark:bg-zinc-800 dark:text-zinc-300">生活随笔</a>
        <a href="/tags" class="topic-chip rounded-full bg-zinc-100 px-3 py-1.5 text-xs font-semibold text-zinc-600 no-underline dark:bg-zinc-800 dark:text-zinc-300">部署运维</a>
      </div>
    </section>
    </div>
  </aside>
```

`calc(50%-61.5rem)` 的含义：内容列上限 84rem（=42rem×2）居中后，侧栏（18rem）+ 间距（1.5rem）贴在内容列外侧；视口不足时 `max()` 回退到 1.5rem 屏幕边距，与现状一致。

- [ ] **Step 4: 插入 lg–xl 图标轨 aside**

在左侧 aside 之后（右侧 aside 之前）插入：

```astro
  <aside class="floating-sidebar fixed left-4 top-28 z-30 hidden lg:block xl:hidden" aria-label="分区导航">
    <nav class="side-panel flex flex-col gap-1 rounded-xl border border-zinc-200 bg-white p-2 shadow-xl shadow-zinc-900/[0.04] backdrop-blur-xl dark:border-zinc-800 dark:bg-zinc-900" aria-label="分区导航">
      <a href="/" title="首页" aria-label="首页" class="rail-link flex h-11 w-11 items-center justify-center rounded-lg text-zinc-500 transition-all hover:bg-zinc-900 hover:text-white dark:text-zinc-400 dark:hover:bg-zinc-100 dark:hover:text-zinc-950">
        <svg class="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" aria-hidden="true"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="1.8" d="M3 12l9-9 9 9M5 10v10a1 1 0 001 1h4m9-11v10a1 1 0 01-1 1h-4" /></svg>
      </a>
      <a href="#latest" title="最新文章" aria-label="最新文章" class="rail-link flex h-11 w-11 items-center justify-center rounded-lg text-zinc-500 transition-all hover:bg-zinc-900 hover:text-white dark:text-zinc-400 dark:hover:bg-zinc-100 dark:hover:text-zinc-950">
        <svg class="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" aria-hidden="true"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="1.8" d="M13 10V3L4 14h7v7l9-11h-7z" /></svg>
      </a>
      <a href="/posts" title="全部文章" aria-label="全部文章" class="rail-link flex h-11 w-11 items-center justify-center rounded-lg text-zinc-500 transition-all hover:bg-zinc-900 hover:text-white dark:text-zinc-400 dark:hover:bg-zinc-100 dark:hover:text-zinc-950">
        <svg class="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" aria-hidden="true"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="1.8" d="M19 20H5a2 2 0 01-2-2V6a2 2 0 012-2h10a2 2 0 012 2v1m2 13a2 2 0 01-2-2V7m2 13a2 2 0 002-2V9a2 2 0 00-2-2h-2" /></svg>
      </a>
      <a href="/tags" title="标签索引" aria-label="标签索引" class="rail-link flex h-11 w-11 items-center justify-center rounded-lg text-zinc-500 transition-all hover:bg-zinc-900 hover:text-white dark:text-zinc-400 dark:hover:bg-zinc-100 dark:hover:text-zinc-950">
        <svg class="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" aria-hidden="true"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="1.8" d="M7 7h.01M7 3h5c.512 0 1.024.195 1.414.586l7 7a2 2 0 010 2.828l-7 7a2 2 0 01-2.828 0l-7-7A1.994 1.994 0 013 12V7a4 4 0 014-4z" /></svg>
      </a>
    </nav>
  </aside>
```

页面 `<style>` 内（`.side-link` 规则附近）追加：

```css
  .rail-link {
    transform: translateX(0);
  }
  .rail-link:hover {
    transform: translateX(3px);
  }
```

并在 `<style>` 的 `@media (prefers-reduced-motion: reduce)` 块的列表里加上 `.rail-link`（与 `.side-link` 等并列，关闭 transition）。

- [ ] **Step 5: 改右侧栏结构**

第 59 行右侧 aside：

```astro
  <aside class="floating-sidebar sidebar-right fixed right-6 top-28 z-30 hidden w-72 space-y-5 xl:block" aria-label="固定资料侧栏">
```

改为：

```astro
  <aside class="floating-sidebar sidebar-right fixed top-28 z-30 hidden w-[clamp(15rem,20vw,18rem)] xl:block xl:right-[max(1.5rem,calc(50%-61.5rem))]" aria-label="固定资料侧栏">
    <div class="sidebar-parallax-right space-y-5">
```

其 `</aside>` 闭合前（第 81 行 `</section>` 与第 82 行 `</aside>` 之间）补闭合 div：

```astro
    </section>
    </div>
  </aside>
```

（内部两个 section 的内容完全不动；同样注意 aside 上去掉了 `space-y-5`，移到内层包装。）

- [ ] **Step 6: 内容区流体 padding（3 处）+ lg 防图标轨遮挡**

三处 section 的 padding 统一改造：`xl:px-[21rem]` → 流体 clamp，超宽屏改用内容列居中；`lg:px-12` → `lg:px-20` 给图标轨腾位。

第 84 行 hero：

```astro
  <section class="journal-hero relative min-h-[var(--hero-min-h,100svh)] w-full overflow-hidden border-b border-zinc-200/70 px-[var(--page-pad,1rem)] pb-16 pt-[calc(var(--header-offset,4rem)+1.5rem)] shadow-sm dark:border-zinc-800/70 sm:px-6 lg:px-12 lg:pb-20 lg:pt-24 xl:px-16 xl:px-[21rem]">
```

改为（仅尾部 padding 类变化）：

```astro
  <section class="journal-hero relative min-h-[var(--hero-min-h,100svh)] w-full overflow-hidden border-b border-zinc-200/70 px-[var(--page-pad,1rem)] pb-16 pt-[calc(var(--header-offset,4rem)+1.5rem)] shadow-sm dark:border-zinc-800/70 sm:px-6 lg:px-20 lg:pb-20 lg:pt-24 xl:px-[clamp(19rem,26vw,21rem)] min-[1920px]:px-[calc(50%-42rem)]">
```

第 124 行 `#latest` section：

```astro
  <section id="latest" class="w-full px-[var(--page-pad,1rem)] py-12 sm:px-8 sm:py-16 lg:px-12 xl:px-16 xl:px-[21rem]">
```

改为：

```astro
  <section id="latest" class="w-full px-[var(--page-pad,1rem)] py-12 sm:px-8 sm:py-16 lg:px-20 xl:px-[clamp(19rem,26vw,21rem)] min-[1920px]:px-[calc(50%-42rem)]">
```

第 175 行「探索更多」section（padding 部分与上一处文本相同，注意带上一行前文区分）：

```astro
  <section class="w-full px-[var(--page-pad,1rem)] py-12 sm:px-8 sm:py-16 lg:px-12 xl:px-16 xl:px-[21rem]">
```

改为：

```astro
  <section class="w-full px-[var(--page-pad,1rem)] py-12 sm:px-8 sm:py-16 lg:px-20 xl:px-[clamp(19rem,26vw,21rem)] min-[1920px]:px-[calc(50%-42rem)]">
```

- [ ] **Step 7: 挂载 sidebar-motion 脚本**

`</BaseLayout>` 之后、`<style>` 之前加：

```astro
<script>
  import '../scripts/sidebar-motion';
</script>
```

- [ ] **Step 8: 验证构建与移动端溢出**

```bash
cd astro && npm run build
```

预期：构建成功。

有 PocketBase 环境时（或 dev server 已在跑）再执行：

```bash
cd astro && (npm run preview &) && sleep 3 && npm run check:mobile; kill %1 2>/dev/null || true
```

预期：无水平溢出的 FAIL 行。

- [ ] **Step 9: Commit（需用户确认）**

```bash
git add astro/src/components/sidebar/HomeSideNav.tsx astro/src/scripts/sidebar-motion.ts astro/src/pages/index.astro
git commit -m "feat(astro): rebuild home sidebars with fluid position, scrollspy, parallax"
```

---

### Task 5: 首页 hero 视差 + section 标题入场 + PostCard 标题 hover 变 teal

**Files:**
- Create: `astro/src/scripts/hero-motion.ts`
- Modify: `astro/src/pages/index.astro`
- Modify: `astro/src/components/posts/PostCard.tsx`

**Interfaces:**
- Consumes: 无（独立于 Task 4 的 sidebar-motion.ts，两个脚本并存）
- Produces: DOM 钩子 `.hero-particles`、`.section-head`

说明：PostCard 已有 hover 上浮（`whileHover={{ y: -4 }}`）和封面放大（`whileHover={{ scale: 1.05 }}`），本 Task 只补标题 hover 变 teal，不重复造已有效果。

- [ ] **Step 1: 创建 hero-motion 脚本**

创建 `astro/src/scripts/hero-motion.ts`：

```ts
// 首页 hero 视差与 section 标题入场。
// hero 内容上移淡出、粒子背景反向慢移形成双层视差；section 标题滚动到视口时上浮入场。
import gsap from 'gsap';
import { ScrollTrigger } from 'gsap/ScrollTrigger';

gsap.registerPlugin(ScrollTrigger);

let ctx: gsap.Context | undefined;

function setup() {
  ctx?.revert();
  if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;

  ctx = gsap.context(() => {
    const heroContent = document.querySelector('.journal-hero-content');
    if (heroContent) {
      gsap.to(heroContent, {
        y: -56,
        opacity: 0.2,
        ease: 'none',
        scrollTrigger: { trigger: '.journal-hero', start: 'top top', end: 'bottom top', scrub: true },
      });
    }

    const particles = document.querySelector('.hero-particles');
    if (particles) {
      gsap.to(particles, {
        y: 64,
        ease: 'none',
        scrollTrigger: { trigger: '.journal-hero', start: 'top top', end: 'bottom top', scrub: true },
      });
    }

    // section 标题入场（移动端保持轻量，跳过）
    if (window.matchMedia('(min-width: 640px)').matches) {
      gsap.utils.toArray<HTMLElement>('.section-head').forEach((el) => {
        gsap.from(el, {
          y: 36,
          opacity: 0,
          duration: 0.7,
          ease: 'power3.out',
          scrollTrigger: { trigger: el, start: 'top 88%', once: true },
        });
      });
    }
  });
}

setup();
document.addEventListener('astro:page-load', setup);
document.addEventListener('astro:before-swap', () => ctx?.revert());
```

- [ ] **Step 2: index.astro 加钩子类名与脚本**

第 86 行粒子容器：

```astro
    <div class="absolute inset-0 overflow-hidden">
```

改为：

```astro
    <div class="hero-particles absolute inset-0 overflow-hidden">
```

第 126 行 `#latest` 的标题容器：

```astro
      <div class="mb-8 flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
```

改为：

```astro
      <div class="section-head mb-8 flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
```

第 176 行「探索更多」的标题容器：

```astro
    <div class="mb-8">
```

改为：

```astro
    <div class="section-head mb-8">
```

Task 4 添加的脚本块（`import '../scripts/sidebar-motion';`）内追加一行，变成：

```astro
<script>
  import '../scripts/sidebar-motion';
  import '../scripts/hero-motion';
</script>
```

- [ ] **Step 3: PostCard 标题 hover 变 teal**

`astro/src/components/posts/PostCard.tsx` 第 84 行：

```tsx
            <h3 className="mb-2 flex-1 break-words text-lg font-semibold leading-snug text-zinc-900 transition-colors duration-200 [overflow-wrap:anywhere] group-hover:text-zinc-600 dark:text-zinc-100 dark:group-hover:text-zinc-400">
```

改为：

```tsx
            <h3 className="mb-2 flex-1 break-words text-lg font-semibold leading-snug text-zinc-900 transition-colors duration-200 [overflow-wrap:anywhere] group-hover:text-teal-600 dark:text-zinc-100 dark:group-hover:text-teal-400">
```

- [ ] **Step 4: 验证构建**

```bash
cd astro && npm run build
```

预期：构建成功。

- [ ] **Step 5: Commit（需用户确认）**

```bash
git add astro/src/scripts/hero-motion.ts astro/src/pages/index.astro astro/src/components/posts/PostCard.tsx
git commit -m "feat(astro): home hero parallax, section head entrances, teal card titles"
```

---

### Task 6: 归档 / 标签 / 关于 / 404 氛围背景与动效

**Files:**
- Modify: `astro/src/pages/archive.astro`
- Modify: `astro/src/pages/tags.astro`
- Modify: `astro/src/pages/about.astro`
- Modify: `astro/src/pages/404.astro`

**Interfaces:**
- Consumes: `astro/src/components/effects/ParticleField.tsx`（props：`count?: number`、`color?: string`、`speed?: number`、`className?: string`，内置 `document.hidden` 跳帧与 reduced-motion 跳过）；`astro/src/components/effects/Starfield.tsx`（默认导出，无 props，星色固定浅蓝，只适合暗色背景）
- Produces: 无新接口

统一模式：页面加固定定位的 ParticleField 背景包装（`hidden lg:block`，移动端不渲染；组件自身再处理 reduced-motion），内容层补 `relative z-10`。归档页额外加时间轴，404 额外加 Starfield（仅暗色）与 404 漂浮动画。

- [ ] **Step 1: 归档页**

`astro/src/pages/archive.astro` frontmatter 加 import：

```ts
import ParticleField from '../components/effects/ParticleField';
```

`<BaseLayout ...>` 之后、`<section ...>` 之前插入背景，section 加 `relative z-10`，月份容器加 `archive-month` 类：

```astro
<BaseLayout title="文章归档" description="按时间归档">
<div class="pointer-events-none fixed inset-0 z-0 hidden lg:block" aria-hidden="true">
  <ParticleField client:visible count={36} speed={0.25} />
</div>
<section class="relative z-10 mx-auto max-w-4xl px-5 py-16">
```

第 30 行月份容器：

```astro
  {y.months.map(m => <div key={m.month} class="ml-4 mt-4">
```

改为：

```astro
  {y.months.map(m => <div key={m.month} class="archive-month ml-4 mt-4">
```

`</BaseLayout>` 前加 `<style>`：

```astro
<style>
  .archive-month {
    position: relative;
    border-left: 1px solid rgba(161, 161, 170, 0.35);
    padding-left: 1rem;
  }
  .archive-month a {
    position: relative;
  }
  .archive-month a::before {
    content: "";
    position: absolute;
    left: calc(-1rem - 3px);
    top: 50%;
    width: 5px;
    height: 5px;
    margin-top: -2.5px;
    border-radius: 9999px;
    background: #a1a1aa;
    transition: background 0.2s ease, transform 0.2s ease;
  }
  .archive-month a:hover::before {
    background: #14b8a6;
    transform: scale(1.5);
  }
  :global(.dark) .archive-month {
    border-left-color: rgba(82, 82, 91, 0.6);
  }
  :global(.dark) .archive-month a::before {
    background: #52525b;
  }
  :global(.dark) .archive-month a:hover::before {
    background: #2dd4bf;
  }
  @media (prefers-reduced-motion: reduce) {
    .archive-month a::before {
      transition: none;
    }
  }
</style>
```

- [ ] **Step 2: 标签页**

`astro/src/pages/tags.astro` frontmatter 加 import：

```ts
import ParticleField from '../components/effects/ParticleField';
```

`<BaseLayout ...>` 之后插入背景，section 加 `relative z-10`：

```astro
<BaseLayout title="标签分类" description="按标签筛选文章">
  <div class="pointer-events-none fixed inset-0 z-0 hidden lg:block" aria-hidden="true">
    <ParticleField client:visible count={36} speed={0.25} />
  </div>
  <section class="relative z-10 mx-auto w-full max-w-5xl px-5 py-16 sm:px-8 lg:px-10">
```

（标签卡片的错峰入场已由现有 `ScrollReveal delay={index * 0.1}` 提供，不重复加。）

- [ ] **Step 3: 关于页**

`astro/src/pages/about.astro` frontmatter 加 import：

```ts
import ParticleField from '../components/effects/ParticleField';
```

`<BaseLayout ...>` 之后插入背景，内容容器加 `relative z-10`：

```astro
<BaseLayout title="关于" description="关于这个博客和作者">
  <div class="pointer-events-none fixed inset-0 z-0 hidden lg:block" aria-hidden="true">
    <ParticleField client:visible count={36} speed={0.25} />
  </div>
  <div class="relative z-10 max-w-3xl mx-auto">
```

（关于页已有 BlurText/Typewriter/GlareHover/ScrollReveal 编排，只补氛围背景。）

- [ ] **Step 4: 404 页（Starfield 仅暗色 + 404 漂浮）**

`astro/src/pages/404.astro` frontmatter 加 import：

```ts
import Starfield from '../components/effects/Starfield';
```

`<BaseLayout ...>` 之后插入背景，内容容器加 `relative z-10`，标题包装加 `float-404`：

```astro
<BaseLayout title="404" description="页面未找到">
  <div class="pointer-events-none fixed inset-0 z-0 hidden dark:block" aria-hidden="true">
    <Starfield client:visible />
  </div>
  <div class="relative z-10 flex flex-col items-center justify-center min-h-[60vh] text-center">
```

第 9 行标题包装：

```astro
      <div class="mb-8">
```

改为：

```astro
      <div class="float-404 mb-8">
```

现有 `<style>` 块内（`@keyframes glow` 之后）追加：

```css
    .animate-glow {
      animation: glow 3s ease-in-out infinite;
    }
    @keyframes float-y {
      0%, 100% { transform: translateY(0); }
      50% { transform: translateY(-12px); }
    }
    .float-404 {
      animation: float-y 5s ease-in-out infinite;
    }
    @media (prefers-reduced-motion: reduce) {
      .animate-glow,
      .float-404 {
        animation: none;
      }
    }
```

（`.animate-glow` 的 keyframes 在页面里已存在但类规则缺失，顺手补上；若 global.css 已有同名规则，scoped 样式会覆盖为相同效果，无副作用。）

- [ ] **Step 5: 验证构建**

```bash
cd astro && npm run build
```

预期：构建成功。

- [ ] **Step 6: Commit（需用户确认）**

```bash
git add astro/src/pages/archive.astro astro/src/pages/tags.astro astro/src/pages/about.astro astro/src/pages/404.astro
git commit -m "feat(astro): ambient particle backgrounds for archive/tags/about/404"
```

---

### Task 7: 登录页输入框 focus teal 辉光

**Files:**
- Modify: `astro/src/components/ui/Input.tsx`

**Interfaces:**
- Consumes: 无
- Produces: 无；改动作用于所有使用 `Input` 的表单（登录/注册/MagicLink/评论/Passkey）

说明：AuthPage 的面板入场编排（staggerChildren + spring logo + tab 滑动 pill）已存在且质量足够，本 Task 只做 Input 焦点辉光，不改动 AuthPage。

- [ ] **Step 1: 修改 Input 焦点样式**

`astro/src/components/ui/Input.tsx` 第 53-56 行，原代码：

```tsx
            error
              ? 'border-red-400 focus-visible:border-red-500'
              : 'border-zinc-200 focus-visible:border-zinc-500 dark:border-zinc-700 dark:focus-visible:border-zinc-400',
            'outline-none focus-visible:ring-2 focus-visible:ring-zinc-500/40 focus-visible:ring-offset-0',
```

改为：

```tsx
            error
              ? 'border-red-400 focus-visible:border-red-500 focus-visible:ring-red-500/30'
              : 'border-zinc-200 focus-visible:border-teal-500 dark:border-zinc-700 dark:focus-visible:border-teal-400 focus-visible:ring-teal-500/35',
            'outline-none focus-visible:ring-2 focus-visible:ring-offset-0',
```

- [ ] **Step 2: 验证构建**

```bash
cd astro && npm run build
```

预期：构建成功。

- [ ] **Step 3: Commit（需用户确认）**

```bash
git add astro/src/components/ui/Input.tsx
git commit -m "feat(astro): teal focus glow for inputs"
```

---

### Task 8: Admin 后台动效（纯 CSS，克制版）

**Files:**
- Modify: `astro/src/layouts/AdminLayout.astro`

**Interfaces:**
- Consumes: 无
- Produces: 无

说明：AdminSidebar 已有 framer-motion 抽屉 spring、宽度动画和当前项静态指示条。后台页面是 MPA 跳转，侧边栏每次重新挂载，「当前项指示条滑动」在跨页导航下无法实现，故不做。本 Task 用一段全局 CSS 覆盖：页面主体入场、表格行错峰、按钮 hover/按压反馈、侧边导航链接错峰入场。零 JS、零性能风险。

- [ ] **Step 1: AdminLayout 加全局动效样式**

`astro/src/layouts/AdminLayout.astro` 文件末尾（`</BaseLayout>` 之后）追加：

```astro
<style is:global>
  @keyframes admin-rise {
    from { opacity: 0; transform: translateY(10px); }
    to { opacity: 1; transform: translateY(0); }
  }

  /* 页面主体入场（topbar 除外，保持定位稳定） */
  .admin-shell main .mx-auto > :not(.admin-topbar) {
    animation: admin-rise 0.4s cubic-bezier(0.16, 1, 0.3, 1) both;
  }

  /* 表格行错峰入场（12 行封顶，避免长列表拖延） */
  .admin-shell table tbody tr {
    animation: admin-rise 0.35s cubic-bezier(0.16, 1, 0.3, 1) both;
  }
  .admin-shell table tbody tr:nth-child(1) { animation-delay: 30ms; }
  .admin-shell table tbody tr:nth-child(2) { animation-delay: 60ms; }
  .admin-shell table tbody tr:nth-child(3) { animation-delay: 90ms; }
  .admin-shell table tbody tr:nth-child(4) { animation-delay: 120ms; }
  .admin-shell table tbody tr:nth-child(5) { animation-delay: 150ms; }
  .admin-shell table tbody tr:nth-child(6) { animation-delay: 180ms; }
  .admin-shell table tbody tr:nth-child(7) { animation-delay: 210ms; }
  .admin-shell table tbody tr:nth-child(8) { animation-delay: 240ms; }
  .admin-shell table tbody tr:nth-child(9) { animation-delay: 270ms; }
  .admin-shell table tbody tr:nth-child(10) { animation-delay: 300ms; }
  .admin-shell table tbody tr:nth-child(11) { animation-delay: 330ms; }
  .admin-shell table tbody tr:nth-child(n+12) { animation-delay: 360ms; }

  /* 侧边导航链接错峰入场 */
  .admin-shell aside nav .space-y-1 a {
    animation: admin-rise 0.3s cubic-bezier(0.16, 1, 0.3, 1) both;
  }
  .admin-shell aside nav .space-y-1 a:nth-child(1) { animation-delay: 20ms; }
  .admin-shell aside nav .space-y-1 a:nth-child(2) { animation-delay: 40ms; }
  .admin-shell aside nav .space-y-1 a:nth-child(3) { animation-delay: 60ms; }
  .admin-shell aside nav .space-y-1 a:nth-child(4) { animation-delay: 80ms; }
  .admin-shell aside nav .space-y-1 a:nth-child(5) { animation-delay: 100ms; }
  .admin-shell aside nav .space-y-1 a:nth-child(n+6) { animation-delay: 120ms; }

  /* 按钮统一 hover / 按压反馈 */
  .admin-shell button:not(:disabled) {
    transition: transform 0.18s ease, background-color 0.18s ease, color 0.18s ease,
      border-color 0.18s ease, box-shadow 0.18s ease;
  }
  .admin-shell button:not(:disabled):hover {
    transform: translateY(-1px);
  }
  .admin-shell button:not(:disabled):active {
    transform: translateY(0) scale(0.98);
  }

  @media (prefers-reduced-motion: reduce) {
    .admin-shell main .mx-auto > :not(.admin-topbar),
    .admin-shell table tbody tr,
    .admin-shell aside nav .space-y-1 a {
      animation: none;
    }
    .admin-shell button:not(:disabled) {
      transition: none;
    }
    .admin-shell button:not(:disabled):hover,
    .admin-shell button:not(:disabled):active {
      transform: none;
    }
  }
</style>
```

- [ ] **Step 2: 验证构建**

```bash
cd astro && npm run build
```

预期：构建成功。

- [ ] **Step 3: Commit（需用户确认）**

```bash
git add astro/src/layouts/AdminLayout.astro
git commit -m "feat(astro): admin entrance, table stagger, button feedback"
```

---

### Task 9: 视觉验证脚本与全量回归

**Files:**
- Create: `astro/scripts/visual-check.mjs`
- Modify: `astro/package.json`（scripts 节）
- Modify: `astro/.gitignore`

**Interfaces:**
- Consumes: Task 1-8 的全部产物
- Produces: `npm run check:visual` 命令；截图输出到 `astro/tmp-visual/`（gitignore）

- [ ] **Step 1: 创建视觉验证脚本**

创建 `astro/scripts/visual-check.mjs`（模式复用 `scripts/mobile-viewport-check.mjs`，增加截图与控制台错误收集）：

```js
#!/usr/bin/env node

// 视觉验证：多路由 × 多视口截图 + 控制台错误 + 水平溢出检测。
// 用法：npm run check:visual [-- --base-url http://127.0.0.1:4321]
// 截图输出到 astro/tmp-visual/<route>-<viewport>.png，需人工过目。

const DEFAULT_BASE_URL = 'http://127.0.0.1:4321';

const ROUTES = ['/', '/posts', '/tags', '/archive', '/about', '/login', '/404'];

const VIEWPORTS = [
  { name: '375x667', width: 375, height: 667 },
  { name: '768x1024', width: 768, height: 1024 },
  { name: '1024x768', width: 1024, height: 768 },
  { name: '1280x800', width: 1280, height: 800 },
  { name: '1440x900', width: 1440, height: 900 },
  { name: '1920x1080', width: 1920, height: 1080 },
  { name: '2560x1080', width: 2560, height: 1080 },
];

const OUT_DIR = new URL('../tmp-visual/', import.meta.url);

function parseBaseUrl(argv) {
  for (let i = 0; i < argv.length; i += 1) {
    if (argv[i] === '--base-url') return argv[i + 1];
    if (argv[i].startsWith('--base-url=')) return argv[i].slice('--base-url='.length);
  }
  return process.env.BASE_URL || DEFAULT_BASE_URL;
}

async function loadPlaywright() {
  for (const name of ['playwright', '@playwright/test']) {
    try {
      const mod = await import(name);
      const chromium = mod.chromium || mod.default?.chromium;
      if (chromium) return chromium;
    } catch (error) {
      const message = String(error?.message || '');
      if (!(error?.code === 'ERR_MODULE_NOT_FOUND' && message.includes(name))) throw error;
    }
  }
  return null;
}

function pageUrl(baseUrl, route) {
  const base = baseUrl.endsWith('/') ? baseUrl : `${baseUrl}/`;
  return new URL(route.replace(/^\//, ''), base).href;
}

async function scrollThrough(page) {
  await page.evaluate(
    () =>
      new Promise((resolve) => {
        let y = 0;
        const step = () => {
          y += window.innerHeight * 0.8;
          window.scrollTo(0, y);
          if (y < document.body.scrollHeight) {
            setTimeout(step, 60);
          } else {
            window.scrollTo(0, 0);
            setTimeout(resolve, 400);
          }
        };
        step();
      }),
  );
}

async function checkRoute(context, route, viewport, baseUrl, outDirPath) {
  const page = await context.newPage();
  const consoleErrors = [];
  page.on('console', (msg) => {
    if (msg.type() === 'error') consoleErrors.push(msg.text());
  });
  page.on('pageerror', (err) => consoleErrors.push(String(err)));

  try {
    const response = await page.goto(pageUrl(baseUrl, route), {
      waitUntil: 'domcontentloaded',
      timeout: 30000,
    });
    await page.waitForLoadState('networkidle', { timeout: 5000 }).catch(() => {});
    await page.waitForTimeout(1200); // 等入场动画与 client:visible 水合
    await scrollThrough(page);

    const status = response?.status() ?? 0;
    const statusOk = route === '/404' ? status === 404 : status < 400;

    const metrics = await page.evaluate(() => {
      const root = document.documentElement;
      const scrollWidth = Math.ceil(Math.max(root.scrollWidth, document.body?.scrollWidth || 0));
      const viewportWidth = Math.ceil(window.innerWidth);
      return { scrollWidth, viewportWidth, overflowBy: Math.max(0, scrollWidth - viewportWidth) };
    });

    const fileName = `${route === '/' ? 'home' : route.replace(/\//g, '').replace(/_/g, '-')}-${viewport.name}.png`;
    await page.screenshot({ path: `${outDirPath}/${fileName}` });

    return {
      route,
      viewport: viewport.name,
      status,
      statusOk,
      overflowBy: metrics.overflowBy,
      consoleErrors,
      passed: statusOk && metrics.overflowBy === 0 && consoleErrors.length === 0,
    };
  } catch (error) {
    return {
      route,
      viewport: viewport.name,
      status: '-',
      statusOk: false,
      overflowBy: '-',
      consoleErrors: [String(error?.message || error)],
      passed: false,
    };
  } finally {
    await page.close();
  }
}

async function main() {
  const baseUrl = parseBaseUrl(process.argv.slice(2));
  const { mkdirSync } = await import('node:fs');
  const { fileURLToPath } = await import('node:url');
  const outDirPath = fileURLToPath(OUT_DIR);
  mkdirSync(outDirPath, { recursive: true });

  const chromium = await loadPlaywright();
  if (!chromium) {
    console.error('Playwright 未安装，无法执行视觉验证。');
    process.exitCode = 1;
    return;
  }

  console.log(`Visual check → ${baseUrl}`);
  console.log(`Screenshots → ${outDirPath}\n`);

  const browser = await chromium.launch({ headless: true });
  const results = [];
  try {
    for (const viewport of VIEWPORTS) {
      const context = await browser.newContext({
        viewport: { width: viewport.width, height: viewport.height },
        deviceScaleFactor: 1,
        hasTouch: viewport.width < 768,
        isMobile: viewport.width < 768,
      });
      for (const route of ROUTES) {
        const result = await checkRoute(context, route, viewport, baseUrl, outDirPath);
        results.push(result);
        const flag = result.passed ? 'PASS' : 'FAIL';
        const extra = result.consoleErrors.length
          ? ` console:${result.consoleErrors[0].slice(0, 120)}`
          : '';
        console.log(
          `${flag} ${viewport.name} ${route} http=${result.status} overflow=${result.overflowBy}${extra}`,
        );
      }
      await context.close();
    }
  } finally {
    await browser.close();
  }

  const failures = results.filter((r) => !r.passed);
  console.log('');
  if (failures.length === 0) {
    console.log(`PASS: ${results.length} 项检查全部通过，请人工过目 tmp-visual/ 截图。`);
  } else {
    console.log(`FAIL: ${failures.length}/${results.length} 项失败，见上方明细。`);
    process.exitCode = 1;
  }
}

main().catch((error) => {
  console.error(error?.stack || error?.message || String(error));
  process.exitCode = 1;
});
```

- [ ] **Step 2: 注册 npm script 与 gitignore**

`astro/package.json` 的 `scripts` 节，`"check:mobile"` 之后加一行：

```json
    "check:visual": "node scripts/visual-check.mjs",
```

`astro/.gitignore` 追加一行（先读文件确认无重复）：

```
tmp-visual/
```

- [ ] **Step 3: 全量验证**

```bash
cd astro && npm run build
```

预期：构建成功（含 pagefind 与 sw 注入）。

启动 preview 并跑全部检查：

```bash
cd astro && (npm run preview &) && sleep 3 && npm run check:mobile && npm run check:visual; kill %1 2>/dev/null || true
```

预期：
- `check:mobile` 全部 PASS
- `check:visual` 全部 PASS（无控制台错误、无水平溢出、/404 返回 404）

人工过目 `astro/tmp-visual/` 截图，重点核对：
- 1280×800 / 1920×1080 / 2560×1080 首页：侧栏与内容列间距一致、超宽屏侧栏不贴屏幕边缘
- 1024×768 首页：左侧出现图标轨且不压内容
- 375×667：无粒子背景、无错位

注意：`check:visual` 需要 PocketBase 数据（/posts 有内容时效果最好）；PocketBase 未启动时页面会渲染空态，检查仍然有效（状态码与布局不变）。

- [ ] **Step 4: Commit（需用户确认）**

```bash
git add astro/scripts/visual-check.mjs astro/package.json astro/.gitignore
git commit -m "test(astro): add visual-check screenshot matrix script"
```

---

## Self-Review 记录

- **Spec 覆盖**：spec 第一~十节 → Task 1（基础设施/清理）、Task 2（CursorGlow）、Task 3（文章页）、Task 4-5（首页/侧栏）、Task 6（归档等四页）、Task 7（登录）、Task 8（后台）、Task 9（验证矩阵）。spec「明确不做」项已遵守（文章页无 WebGL、不改 GridScan、不删未接线组件）。
- **调查修正**（已反映在各 Task「说明」中）：AuthPage 入场编排、PostCard hover、AdminSidebar 动画均已存在，对应 Task 缩减为增量改动；admin 跨页 MPA 无法做指示条滑动，已注明放弃。
- **类型一致性**：`motion.ts` 导出名（`EASE_OUT_EXPO`/`fadeUp`/`staggerContainer`）与 Task 4 HomeSideNav 的 import 一致；`ReadingProgress`/`ParticleField`/`Starfield` 均为默认导出，与源码一致；`.post-hero`/`.post-title`/`.post-cover`/`.hero-particles`/`.section-head`/`.sidebar-parallax-*` 钩子类名在生产与消费 Task 间一致。
