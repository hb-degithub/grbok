# 友链体系（子项目 C）Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 按 `docs/superpowers/specs/2026-07-17-friend-links-design.md` 实现友链页（卡片网格 + 点击排行 + 申请说明）、Footer 友链行与导航入口；后端仅以契约文档交付（用户实现）。

**Architecture:** 前端 React 岛屿复用现有 `getPocketBase()` 与 `friend_links` 集合公开读规则；点击上报走 `lib/track.ts`（sendBeacon → 已存在的 track-view 接口）；排行区按契约拉 `GET /api/friend-link-stats`，未就绪时空态降级。

**Tech Stack:** Astro 6、React 19、framer-motion、Tailwind v4、PocketBase JS SDK（已装）。

## Global Constraints

- **不新增 npm 依赖**；不动后端任何文件（pb_hooks/pb_migrations）。
- 后端契约已写入 `docs/superpowers/specs/2026-07-17-friend-links-design.md`「后端接口契约」节，前端严格按契约编码；接口 404/报错时排行区显示"排行数据积累中"空态，**不得**在页面制造报错。
- 隐私：点击上报尊重 DNT、静默失败；沿用 track-view 既有隐私约定。
- reduced-motion / 移动端降级 / 暗色适配：沿用全站既有体系（ParticleField `hidden lg:block`、framer variants、`.dark` 类）。
- **测试现实**：无单元测试框架；验证 = `npm run build` + check:visual（加 `/links`）+ Playwright 探针（点击上报抓取）。
- **git commit 需确认**：每个 Task 末尾的 commit 步骤执行前必须向用户确认。
- 代码注释跟随所在文件风格（多为中文）。

## 接口契约（跨 Task 依赖）

- `getPocketBase()`（`astro/src/lib/pocketbase.ts`）→ PocketBase 客户端；`friend_links.getList(1, 50, { sort: 'sort_order,-created' })` → `FriendLink[]`（`astro/src/types/pocketbase.ts:119`：`{ id, name, url, description?, avatar?, status, sort_order?, created, updated }`），过滤 `status === 'show'`。
- `trackLinkClick(target: string): void`（Task 1 产出）→ Grid 组件消费（Task 2）。
- `GET ${PUBLIC_POCKETBASE_URL}/api/friend-link-stats` → `{ range: string, top: Array<{ target: string, clicks: number }> }`（契约；后端未实现时任意非 200/网络错误 → 空态）。

---

### Task 1: 点击上报工具 `lib/track.ts` + Footer 友链行

**Files:**
- Create: `astro/src/lib/track.ts`
- Create: `astro/src/components/links/FooterFriendLinks.tsx`
- Modify: `astro/src/components/layout/Footer.astro`

**Interfaces:**
- Produces: `trackLinkClick(target: string): void`（Task 2 的 Grid 点击时调用）；`FooterFriendLinks`（默认导出，无 props）。
- Consumes: `getPocketBase()`、`FriendLink` 类型。

- [ ] **Step 1: 创建 `astro/src/lib/track.ts`**

```ts
// 友链点击上报：sendBeacon 异步发送，不阻塞跳转；尊重 DNT；静默失败。
export function trackLinkClick(target: string): void {
  try {
    if (typeof navigator === 'undefined') return;
    if (navigator.doNotTrack === '1') return;
    const pbBase = import.meta.env.PUBLIC_POCKETBASE_URL || '';
    if (!pbBase) return;
    const body = JSON.stringify({ path: window.location.pathname, event: 'link_click', target });
    navigator.sendBeacon(`${pbBase}/api/track-view`, new Blob([body], { type: 'application/json' }));
  } catch (_) {
    // 上报失败不影响任何功能
  }
}
```

- [ ] **Step 2: 创建 `astro/src/components/links/FooterFriendLinks.tsx`**

```tsx
import React, { useEffect, useState } from 'react';
import { getPocketBase } from '../../lib/pocketbase';
import type { FriendLink } from '../../types/pocketbase';

const MAX_LINKS = 10;

function isSafeLinkUrl(url: string): boolean {
  try {
    const parsed = new URL(url);
    return parsed.protocol === 'http:' || parsed.protocol === 'https:';
  } catch {
    return false;
  }
}

/**
 * Footer 紧凑友链行：前 10 个文本链接 + 超出时「全部 →」跳 /links。
 * 无数据时不渲染（避免空标题）。
 */
export default function FooterFriendLinks() {
  const [links, setLinks] = useState<FriendLink[] | null>(null);

  useEffect(() => {
    const pb = getPocketBase();
    pb.collection('friend_links')
      .getList<FriendLink>(1, 50, { sort: 'sort_order,-created' })
      .then((r) => setLinks(r.items.filter((i) => i.status === 'show' && isSafeLinkUrl(i.url))))
      .catch(() => setLinks([]));
  }, []);

  if (!links || links.length === 0) return null;

  const shown = links.slice(0, MAX_LINKS);
  const hasMore = links.length > MAX_LINKS;

  return (
    <div className="mt-8 flex flex-wrap items-center justify-center gap-x-4 gap-y-2 text-xs text-zinc-400 dark:text-zinc-500">
      <span className="shrink-0 font-semibold text-zinc-500 dark:text-zinc-400">友情链接：</span>
      {shown.map((link) => (
        <a
          key={link.id}
          href={link.url}
          target="_blank"
          rel="noopener noreferrer"
          className="transition-colors hover:text-teal-600 dark:hover:text-teal-400"
        >
          {link.name}
        </a>
      ))}
      {hasMore && (
        <a href="/links" className="font-semibold text-zinc-500 transition-colors hover:text-teal-600 dark:text-zinc-400 dark:hover:text-teal-400">
          全部 →
        </a>
      )}
    </div>
  );
}
```

- [ ] **Step 3: Footer.astro 集成**

`astro/src/components/layout/Footer.astro`：
- frontmatter 加 import：`import FooterFriendLinks from '../links/FooterFriendLinks';`
- 在主内容行（站点信息+社交链接的 `</div>` 之后）与 `<!-- 备案链接 -->` 注释之间插入：`<FooterFriendLinks client:visible />`

- [ ] **Step 4: 验证构建**

```bash
cd astro && npm run build
```

预期：构建成功。

- [ ] **Step 5: Commit（需用户确认）**

```bash
git add astro/src/lib/track.ts astro/src/components/links/FooterFriendLinks.tsx astro/src/components/layout/Footer.astro
git commit -m "feat(astro): footer friend-links row and click tracking helper"
```

---

### Task 2: `/links` 友链页（卡片网格 + 排行区 + 申请说明）

**Files:**
- Create: `astro/src/components/links/FriendLinksGrid.tsx`
- Create: `astro/src/components/links/FriendLinkLeaderboard.tsx`
- Create: `astro/src/pages/links.astro`

**Interfaces:**
- Consumes: Task 1 的 `trackLinkClick`；`getPocketBase()` + `FriendLink`；`fadeUp`/`staggerContainer`（`astro/src/lib/motion.ts`）；`ParticleField`、`ScrollReveal`（既有组件）
- Produces: `/links` 路由（Task 3 加入导航与 check:visual）

- [ ] **Step 1: 创建 `FriendLinksGrid.tsx`**

```tsx
import React, { useEffect, useState } from 'react';
import { motion } from 'framer-motion';
import { getPocketBase } from '../../lib/pocketbase';
import { trackLinkClick } from '../../lib/track';
import { fadeUp, staggerContainer } from '../../lib/motion';
import type { FriendLink } from '../../types/pocketbase';

function isSafeLinkUrl(url: string): boolean {
  try {
    const parsed = new URL(url);
    return parsed.protocol === 'http:' || parsed.protocol === 'https:';
  } catch {
    return false;
  }
}

function hostname(url: string): string {
  try {
    return new URL(url).hostname;
  } catch {
    return url;
  }
}

/** 友链卡片网格：头像/首字母 + 名称 + 简介 + 域名；点击上报后新标签打开 */
export default function FriendLinksGrid() {
  const [links, setLinks] = useState<FriendLink[] | null>(null);

  useEffect(() => {
    const pb = getPocketBase();
    pb.collection('friend_links')
      .getList<FriendLink>(1, 50, { sort: 'sort_order,-created' })
      .then((r) => setLinks(r.items.filter((i) => i.status === 'show' && isSafeLinkUrl(i.url))))
      .catch(() => setLinks([]));
  }, []);

  if (links === null) {
    return (
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {[0, 1, 2, 3, 4, 5].map((i) => (
          <div key={i} className="skeleton h-28 rounded-xl" />
        ))}
      </div>
    );
  }

  if (links.length === 0) {
    return (
      <div className="rounded-xl border border-zinc-200 bg-white p-10 text-center text-sm text-zinc-500 dark:border-zinc-800 dark:bg-zinc-900 dark:text-zinc-400">
        暂无友链，欢迎通过下方邮箱申请互换。
      </div>
    );
  }

  return (
    <motion.div variants={staggerContainer(0.06)} initial="hidden" animate="visible" className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
      {links.map((link) => (
        <motion.a
          key={link.id}
          variants={fadeUp}
          href={link.url}
          target="_blank"
          rel="noopener noreferrer"
          onClick={() => trackLinkClick(link.url)}
          whileHover={{ y: -4 }}
          whileTap={{ scale: 0.98 }}
          className="group flex items-start gap-3 rounded-xl border border-zinc-200 bg-white p-4 no-underline shadow-xl shadow-zinc-900/[0.04] transition-colors hover:border-teal-500/50 dark:border-zinc-800 dark:bg-zinc-900 dark:hover:border-teal-400/50"
        >
          {link.avatar ? (
            <img src={link.avatar} alt="" loading="lazy" className="h-10 w-10 shrink-0 rounded-lg object-cover" />
          ) : (
            <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-zinc-900 text-sm font-bold text-white dark:bg-zinc-100 dark:text-zinc-950">
              {link.name.charAt(0)}
            </span>
          )}
          <span className="min-w-0 flex-1">
            <span className="block truncate text-sm font-bold text-zinc-950 transition-colors group-hover:text-teal-600 dark:text-zinc-50 dark:group-hover:text-teal-400">
              {link.name}
            </span>
            {link.description && (
              <span className="mt-0.5 block truncate text-xs text-zinc-500 dark:text-zinc-400">{link.description}</span>
            )}
            <span className="mt-1 block truncate font-mono text-[11px] text-zinc-400 dark:text-zinc-500">{hostname(link.url)}</span>
          </span>
        </motion.a>
      ))}
    </motion.div>
  );
}
```

- [ ] **Step 2: 创建 `FriendLinkLeaderboard.tsx`**

```tsx
import React, { useEffect, useState } from 'react';
import { motion } from 'framer-motion';
import { fadeUp } from '../../lib/motion';

interface FriendLinkStats {
  range: string;
  top: Array<{ target: string; clicks: number }>;
}

const PB_URL = import.meta.env.PUBLIC_POCKETBASE_URL || '';

const MEDALS = ['bg-amber-400', 'bg-zinc-300', 'bg-amber-700'];

function hostname(url: string): string {
  try {
    return new URL(url).hostname;
  } catch {
    return url;
  }
}

/**
 * 热门友链点击排行：按契约拉 GET /api/friend-link-stats。
 * 接口未就绪（404/网络错误/空数据）时显示「排行数据积累中」空态，不报错。
 */
export default function FriendLinkLeaderboard() {
  const [stats, setStats] = useState<FriendLinkStats | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    if (!PB_URL) {
      setFailed(true);
      return;
    }
    fetch(`${PB_URL}/api/friend-link-stats`)
      .then((res) => {
        if (!res.ok) throw new Error(String(res.status));
        return res.json();
      })
      .then((json: FriendLinkStats) => {
        if (!json || !Array.isArray(json.top) || json.top.length === 0) {
          setFailed(true);
          return;
        }
        setStats(json);
      })
      .catch(() => setFailed(true));
  }, []);

  return (
    <motion.section variants={fadeUp} initial="hidden" whileInView="visible" viewport={{ once: true, margin: '-40px' }} className="rounded-xl border border-zinc-200 bg-white p-5 dark:border-zinc-800 dark:bg-zinc-900">
      <h2 className="text-sm font-black tracking-tight text-zinc-950 dark:text-zinc-50">热门友链</h2>
      <p className="mt-1 text-xs text-zinc-400 dark:text-zinc-500">近 30 天点击排行</p>
      {failed || !stats ? (
        <p className="py-8 text-center text-sm text-zinc-400 dark:text-zinc-500">排行数据积累中，敬请期待。</p>
      ) : (
        <ol className="mt-4 space-y-2 text-sm">
          {stats.top.map((item, i) => (
            <li key={item.target} className="flex items-center gap-3">
              <span className={`flex h-5 w-5 shrink-0 items-center justify-center rounded-full text-[10px] font-bold text-white ${MEDALS[i] || 'bg-zinc-500'}`}>
                {i + 1}
              </span>
              <a
                href={item.target}
                target="_blank"
                rel="noopener noreferrer"
                className="min-w-0 flex-1 truncate text-zinc-700 no-underline hover:text-teal-600 dark:text-zinc-300 dark:hover:text-teal-400"
              >
                {hostname(item.target)}
              </a>
              <span className="shrink-0 font-mono text-xs text-zinc-500 dark:text-zinc-400">{item.clicks} 次</span>
            </li>
          ))}
        </ol>
      )}
    </motion.section>
  );
}
```

- [ ] **Step 3: 创建 `astro/src/pages/links.astro`**

```astro
---
import BaseLayout from '../layouts/BaseLayout.astro';
import ParticleField from '../components/effects/ParticleField';
import ScrollReveal from '../components/ui/ScrollReveal';
import FriendLinksGrid from '../components/links/FriendLinksGrid';
import FriendLinkLeaderboard from '../components/links/FriendLinkLeaderboard';
---

<BaseLayout title="友情链接" description="朋友们的站点与点击排行">
  <div class="pointer-events-none fixed inset-0 z-0 hidden lg:block" aria-hidden="true">
    <ParticleField client:visible count={36} speed={0.25} />
  </div>
  <section class="relative z-10 mx-auto w-full max-w-5xl px-5 py-16 sm:px-8 lg:px-10">
    <div class="mb-10">
      <ScrollReveal client:visible>
        <div class="mb-4 flex items-center gap-3">
          <span class="h-px w-8 bg-zinc-400 dark:bg-zinc-500"></span>
          <span class="font-mono text-[10px] uppercase tracking-widest text-zinc-500 dark:text-zinc-400">Links</span>
        </div>
        <h1 class="text-4xl font-black tracking-tight text-zinc-950 dark:text-zinc-50 sm:text-5xl">友情链接</h1>
        <p class="mt-3 max-w-xl text-zinc-500 dark:text-zinc-400">朋友们的站点，欢迎串门。</p>
      </ScrollReveal>
    </div>

    <FriendLinksGrid client:load />

    <div class="mt-10 grid gap-4 lg:grid-cols-2">
      <FriendLinkLeaderboard client:load />

      <!-- 申请友链 -->
      <ScrollReveal client:visible>
        <div class="rounded-xl border border-zinc-200 bg-white p-5 dark:border-zinc-800 dark:bg-zinc-900">
          <h2 class="text-sm font-black tracking-tight text-zinc-950 dark:text-zinc-50">申请友链</h2>
          <p class="mt-3 text-sm leading-7 text-zinc-500 dark:text-zinc-400">
            欢迎互换友情链接。请按以下格式发送邮件，通过后会尽快添加：
          </p>
          <ul class="mt-3 space-y-1.5 text-sm text-zinc-500 dark:text-zinc-400">
            <li>· 站名：你的站点名称</li>
            <li>· 地址：站点 URL（https）</li>
            <li>· 简介：一句话介绍你的站点</li>
          </ul>
          <a href="mailto:670486183@qq.com?subject=%E5%8F%8B%E9%93%BE%E7%94%B3%E8%AF%B7" class="btn-primary mt-5 inline-flex items-center gap-2 no-underline">
            邮件申请
          </a>
        </div>
      </ScrollReveal>
    </div>
  </section>
</BaseLayout>
```

- [ ] **Step 4: 验证构建**

```bash
cd astro && npm run build
```

预期：构建成功，dist 含 `/links/index.html`。

- [ ] **Step 5: Commit（需用户确认）**

```bash
git add astro/src/components/links/ astro/src/pages/links.astro
git commit -m "feat(astro): friend links page with leaderboard and apply section"
```

---

### Task 3: 导航入口 + 视觉矩阵 + 点击上报探针验证

**Files:**
- Modify: `astro/src/components/layout/Header.tsx`（MORE_LINKS）
- Modify: `astro/src/components/layout/SideNav.tsx`（moreNavItems）
- Modify: `astro/scripts/visual-check.mjs`（ROUTES）

**Interfaces:**
- Consumes: Task 2 的 `/links` 路由
- Produces: 导航「更多」中的友链入口

- [ ] **Step 1: Header `MORE_LINKS` 追加**

`astro/src/components/layout/Header.tsx` 的 `MORE_LINKS` 数组中，`/stats` 条目后追加：

```ts
  { href: '/links', label: '友情链接', description: '朋友们的站点', icon: 'M13.828 10.172a4 4 0 00-5.656 0l-4 4a4 4 0 105.656 5.656l1.102-1.101m-.758-4.899a4 4 0 005.656 0l4-4a4 4 0 00-5.656-5.656l-1.1 1.1' },
```

- [ ] **Step 2: SideNav `moreNavItems` 追加**

`astro/src/components/layout/SideNav.tsx` 的 `moreNavItems` 数组中追加：

```ts
  { href: '/links', label: '友情链接', icon: 'M13.828 10.172a4 4 0 00-5.656 0l-4 4a4 4 0 105.656 5.656l1.102-1.101m-.758-4.899a4 4 0 005.656 0l4-4a4 4 0 00-5.656-5.656l-1.1 1.1' },
```

- [ ] **Step 3: check:visual 路由加 /links**

`astro/scripts/visual-check.mjs` 的 `ROUTES` 数组 `'/stats'` 后插入 `'/links'`。

- [ ] **Step 4: 构建 + 视觉矩阵**

```bash
cd astro && npm run build
cd astro && (npm run preview > /tmp/astro-preview.log 2>&1 &) && sleep 4 && npm run check:visual; pkill -f "astro preview"
```

预期：全部 PASS（新增 /links 行无溢出、无控制台错误）。

- [ ] **Step 5: 点击上报探针（Playwright）**

写一个临时探针（astro/tmp-visual/，跑完删除）：启动 preview，打开 `/links`，监听所有请求，点击第一个友链卡片，验证：
1. 有一个 POST 请求打到 `${PB}/api/track-view`（或 sendBeacon 触发的同 URL 请求），body 含 `"event":"link_click"` 与 `"target":"http`
2. 卡片以新标签打开（`target="_blank"`）
3. 排行区在接口 404 时显示"排行数据积累中"而非报错

记录结果到报告。

- [ ] **Step 6: Commit（需用户确认）**

```bash
git add astro/src/components/layout/Header.tsx astro/src/components/layout/SideNav.tsx astro/scripts/visual-check.mjs
git commit -m "feat(astro): friend links nav entries and visual matrix coverage"
```

---

## Self-Review 记录

- **Spec 覆盖**：lib/track.ts（spec 点击上报节）→ Task 1；Footer 友链行 → Task 1；/links 三区块（网格/排行/申请）→ Task 2；导航入口 → Task 3；验证（含点击探针）→ Task 3。后端契约不动后端文件，已含在 spec 中交付用户。
- **类型一致性**：`trackLinkClick(target)` 签名 Task 1 产出 / Task 2 消费一致；`friend-link-stats` 响应 `{ range, top: [{ target, clicks }] }` 在 spec 契约与 Task 2 `FriendLinkStats` 接口中逐字一致。
- **降级路径**：friend-link-stats 404/错误/空 → 空态（Task 2 组件与 Task 3 探针双重覆盖）；friend_links 集合为空 → 网格空态文案；Footer 无数据不渲染。
