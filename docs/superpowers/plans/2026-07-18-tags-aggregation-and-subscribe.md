# 标签聚合改版 + 订阅页（子项目 G）Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 按 `docs/superpowers/specs/2026-07-18-tags-aggregation-and-subscribe-design.md` 把 `/tags` 改版为"标签+文章"聚合视图，新增 `/subscribe` 订阅页（仅 RSS），加导航入口。零后端。

**Architecture:** /tags 构建期拉 `post_tags`（expand=post_id）按标签分组取最新 3 篇；/subscribe 纯静态 + 一个复制按钮小岛屿。

**Tech Stack:** Astro 6、Tailwind v4、既有组件（GlowCard、ScrollReveal、ParticleField）。

## Global Constraints

- **不新增 npm 依赖**；零后端改动。
- 取数失败必须优雅降级（post_tags 失败按 0 篇处理，页面仍渲染标签卡片）。
- reduced-motion / 移动端降级 / 暗色适配：沿用全站既有体系。
- **测试现实**：无单元测试框架；验证 = `npm run build` + check:visual + Playwright 探针。
- **git commit 需确认**：每个 Task 末尾的 commit 步骤执行前必须向用户确认。
- 代码注释跟随所在文件风格（多为中文）。

## 数据契约

- `tags`：`{ id, name, slug, description }`（/tags 现有 fetch，不变）
- `post_tags`：`GET {PB}/api/collections/post_tags/records?perPage=500&expand=post_id&fields=tag_id,expand.post_id.title,expand.post_id.slug,expand.post_id.published_at,expand.post_id.status`
  → items: `{ tag_id: string, expand?: { post_id?: { title: string, slug: string, published_at: string, status: string } } }`

---

### Task 1: `/tags` 聚合改版

**Files:**
- Modify: `astro/src/pages/tags.astro`

**Interfaces:**
- Consumes: 上方数据契约；`/tags/[slug].astro` 路由（"全部 N 篇 →"落点）
- Produces: 聚合视图（保留现有卡片头部样式与 GlowCard）

- [ ] **Step 1: 改 `astro/src/pages/tags.astro`**

当前文件（96 行）结构：frontmatter 拉 tags + tagColors；模板为 ScrollReveal 头部 + 空态/GlowCard 网格。改造：

1. frontmatter 现有 `fetchTags()` 之后，追加聚合取数与分组逻辑（放在 `const tags = await fetchTags();` 之后、`tagColors` 之前）：

```ts
// ---- 标签文章聚合：按标签取最新 3 篇已发布文章 ----
interface PostTagRecord {
  tag_id: string;
  expand?: {
    post_id?: { title: string; slug: string; published_at: string; status: string };
  };
}

interface TagPost {
  title: string;
  slug: string;
  published_at: string;
}

async function fetchTagPostMap(): Promise<Map<string, { posts: TagPost[]; total: number }>> {
  const map = new Map<string, { posts: TagPost[]; total: number }>();
  try {
    const res = await fetch(`${PB_URL}/api/collections/post_tags/records?perPage=500&expand=post_id&fields=tag_id,expand.post_id.title,expand.post_id.slug,expand.post_id.published_at,expand.post_id.status`);
    if (!res.ok) throw new Error(`${res.status}`);
    const data = await res.json();
    const records: PostTagRecord[] = data.items ?? [];
    for (const record of records) {
      const post = record.expand?.post_id;
      if (!post || post.status !== 'published') continue;
      const entry = map.get(record.tag_id) ?? { posts: [], total: 0 };
      entry.posts.push({ title: post.title, slug: post.slug, published_at: post.published_at });
      entry.total += 1;
      map.set(record.tag_id, entry);
    }
    // 每个标签按发布时间降序，只保留前 3 篇展示
    for (const entry of map.values()) {
      entry.posts.sort((a, b) => new Date(b.published_at).getTime() - new Date(a.published_at).getTime());
      entry.posts = entry.posts.slice(0, 3);
    }
  } catch {
    // post_tags 拉取失败时按无文章处理，标签卡片仍正常渲染
  }
  return map;
}

const tagPostMap = await fetchTagPostMap();

function formatMonthDay(iso: string): string {
  if (!iso) return '';
  return new Date(iso).toLocaleDateString('zh-CN', { month: '2-digit', day: '2-digit' });
}
```

2. 模板中，GlowCard 内部 `{tag.description && (...)}` 块之后（卡片内最后）追加聚合区（在 `</GlowCard>` 之前）：

```astro
                  <div class="mt-4 border-t border-zinc-200/60 pt-3 dark:border-zinc-700/50">
                    {(() => {
                      const agg = tagPostMap.get(tag.id);
                      if (!agg || agg.total === 0) {
                        return <p class="text-xs text-zinc-400 dark:text-zinc-500">暂无文章</p>;
                      }
                      return (
                        <>
                          <div class="mb-2 text-xs font-semibold text-zinc-400 dark:text-zinc-500">{agg.total} 篇文章 · 最新</div>
                          <ul class="space-y-1.5">
                            {agg.posts.map((post) => (
                              <li class="flex items-baseline gap-2 text-sm">
                                <a href={`/posts/${post.slug}`} class="min-w-0 flex-1 truncate text-zinc-600 no-underline transition-colors hover:text-teal-600 dark:text-zinc-400 dark:hover:text-teal-400">
                                  {post.title}
                                </a>
                                <time class="shrink-0 text-[11px] text-zinc-400 dark:text-zinc-500">{formatMonthDay(post.published_at)}</time>
                              </li>
                            ))}
                          </ul>
                          {agg.total > 3 && (
                            <a href={`/tags/${tag.slug}`} class="mt-2.5 inline-block text-xs font-semibold text-teal-600 no-underline hover:underline dark:text-teal-400">
                              全部 {agg.total} 篇 →
                            </a>
                          )}
                        </>
                      );
                    })()}
                  </div>
```

3. 注意 Astro 模板中 `.map` 回调里未使用 `index` 变量时保持现状；`tagColors` 逻辑不动。

- [ ] **Step 2: 验证构建**

```bash
cd astro && npm run build
```

预期：构建成功。

- [ ] **Step 3: Commit（需用户确认）**

```bash
git add astro/src/pages/tags.astro
git commit -m "feat(astro): aggregate latest posts into tag cards"
```

---

### Task 2: `/subscribe` 订阅页

**Files:**
- Create: `astro/src/components/subscribe/FeedCopyButton.tsx`
- Create: `astro/src/pages/subscribe.astro`

**Interfaces:**
- Consumes: `Astro.site`（站点根 URL，astro.config 已配 site）
- Produces: `/subscribe` 路由（Task 3 加入导航与 check:visual）

- [ ] **Step 1: 创建 `FeedCopyButton.tsx`**

```tsx
import React, { useState } from 'react';
import { motion } from 'framer-motion';

interface FeedCopyButtonProps {
  /** 要复制的订阅地址 */
  url: string;
}

/** 复制订阅地址按钮：成功显示对勾 1.5s */
export default function FeedCopyButton({ url }: FeedCopyButtonProps) {
  const [copied, setCopied] = useState(false);

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(url);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1500);
    } catch {
      // 剪贴板不可用时静默（按钮仍可用）
    }
  };

  return (
    <motion.button
      type="button"
      onClick={handleCopy}
      whileHover={{ scale: 1.03 }}
      whileTap={{ scale: 0.97 }}
      className="inline-flex min-h-10 items-center gap-2 rounded-lg bg-zinc-900 px-4 py-2 text-sm font-semibold text-white transition-colors hover:bg-zinc-700 dark:bg-zinc-100 dark:text-zinc-950 dark:hover:bg-white"
      aria-live="polite"
    >
      {copied ? (
        <>
          <svg className="h-4 w-4 text-teal-400 dark:text-teal-600" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.2} d="M5 13l4 4L19 7" /></svg>
          已复制
        </>
      ) : (
        <>
          <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor"><rect x="9" y="9" width="13" height="13" rx="2" strokeWidth="2" /><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M5 15H4a2 2 0 01-2-2V4a2 2 0 012-2h9a2 2 0 012 2v1" /></svg>
          复制订阅地址
        </>
      )}
    </motion.button>
  );
}
```

- [ ] **Step 2: 创建 `astro/src/pages/subscribe.astro`**

```astro
---
import BaseLayout from '../layouts/BaseLayout.astro';
import ParticleField from '../components/effects/ParticleField';
import ScrollReveal from '../components/ui/ScrollReveal';
import FeedCopyButton from '../components/subscribe/FeedCopyButton';

const feedUrl = new URL('/feed.xml', Astro.site).href;

const readers = [
  { name: 'Feedly', url: 'https://feedly.com/', desc: '最主流的在线 RSS 阅读器，网页/手机都能用' },
  { name: 'Inoreader', url: 'https://www.inoreader.com/', desc: '功能全面的阅读器，支持过滤与规则' },
  { name: 'NetNewsWire', url: 'https://netnewswire.com/', desc: '苹果生态免费开源阅读器' },
];
---

<BaseLayout title="订阅" description="通过 RSS 订阅博客更新">
  <div class="pointer-events-none fixed inset-0 z-0 hidden lg:block" aria-hidden="true">
    <ParticleField client:visible count={36} speed={0.25} />
  </div>
  <section class="relative z-10 mx-auto w-full max-w-3xl px-5 py-16 sm:px-8">
    <div class="mb-10">
      <ScrollReveal client:visible>
        <div class="mb-4 flex items-center gap-3">
          <span class="h-px w-8 bg-zinc-400 dark:bg-zinc-500"></span>
          <span class="font-mono text-[10px] uppercase tracking-widest text-zinc-500 dark:text-zinc-400">Subscribe</span>
        </div>
        <h1 class="text-4xl font-black tracking-tight text-zinc-950 dark:text-zinc-50 sm:text-5xl">订阅</h1>
        <p class="mt-3 max-w-xl text-zinc-500 dark:text-zinc-400">通过 RSS 订阅，新文章会第一时间出现在你的阅读器里。</p>
      </ScrollReveal>
    </div>

    <div class="grid gap-5">
      <ScrollReveal client:visible>
        <div class="rounded-xl border border-zinc-200 bg-white p-6 dark:border-zinc-800 dark:bg-zinc-900">
          <h2 class="text-sm font-black tracking-tight text-zinc-950 dark:text-zinc-50">RSS 订阅地址</h2>
          <p class="mt-2 text-sm leading-7 text-zinc-500 dark:text-zinc-400">
            RSS 是一种内容订阅协议。把下面的地址粘贴到任意 RSS 阅读器，即可订阅本博客的全部文章。
          </p>
          <div class="mt-4 flex items-center gap-2 rounded-lg border border-zinc-200 bg-zinc-50 px-3 py-2.5 dark:border-zinc-700 dark:bg-zinc-950/50">
            <svg class="h-4 w-4 shrink-0 text-teal-500" fill="none" viewBox="0 0 24 24" stroke="currentColor" aria-hidden="true">
              <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M6 5c7.18 0 13 5.82 13 13M6 11a7 7 0 017 7m-6 0a1 1 0 11-2 0 1 1 0 012 0z" />
            </svg>
            <code class="min-w-0 flex-1 truncate font-mono text-xs text-zinc-600 dark:text-zinc-300">{feedUrl}</code>
          </div>
          <div class="mt-4 flex flex-wrap items-center gap-3">
            <FeedCopyButton client:load url={feedUrl} />
            <a href="/feed.xml" target="_blank" rel="noopener noreferrer" class="inline-flex min-h-10 items-center rounded-lg border border-zinc-200 px-4 py-2 text-sm font-semibold text-zinc-600 no-underline transition-colors hover:border-zinc-300 hover:text-zinc-900 dark:border-zinc-700 dark:text-zinc-300 dark:hover:text-zinc-100">
              打开 feed.xml
            </a>
          </div>
        </div>
      </ScrollReveal>

      <ScrollReveal delay={0.1} client:visible>
        <div class="rounded-xl border border-zinc-200 bg-white p-6 dark:border-zinc-800 dark:bg-zinc-900">
          <h2 class="text-sm font-black tracking-tight text-zinc-950 dark:text-zinc-50">推荐阅读器</h2>
          <div class="mt-4 grid gap-3 sm:grid-cols-3">
            {readers.map((reader) => (
              <a href={reader.url} target="_blank" rel="noopener noreferrer" class="group rounded-lg border border-zinc-200 p-4 no-underline transition-all hover:-translate-y-0.5 hover:border-teal-500/40 dark:border-zinc-700 dark:hover:border-teal-400/40">
                <div class="text-sm font-bold text-zinc-900 transition-colors group-hover:text-teal-600 dark:text-zinc-100 dark:group-hover:text-teal-400">{reader.name}</div>
                <div class="mt-1 text-xs leading-5 text-zinc-500 dark:text-zinc-400">{reader.desc}</div>
              </a>
            ))}
          </div>
        </div>
      </ScrollReveal>
    </div>
  </section>
</BaseLayout>
```

- [ ] **Step 3: 验证构建**

```bash
cd astro && npm run build
```

预期：构建成功，dist 含 `/subscribe/index.html`。

- [ ] **Step 4: Commit（需用户确认）**

```bash
git add astro/src/components/subscribe/ astro/src/pages/subscribe.astro
git commit -m "feat(astro): RSS subscribe page with copy button"
```

---

### Task 3: 导航入口 + 视觉矩阵 + 复制探针

**Files:**
- Modify: `astro/src/components/layout/Header.tsx`（MORE_LINKS）
- Modify: `astro/src/components/layout/SideNav.tsx`（moreNavItems）
- Modify: `astro/scripts/visual-check.mjs`（ROUTES）

**Interfaces:**
- Consumes: Task 2 的 `/subscribe` 路由

- [ ] **Step 1: Header `MORE_LINKS` 追加（/projects 条目后）**

```ts
  { href: '/subscribe', label: '订阅', description: 'RSS 订阅更新', icon: 'M6 5c7.18 0 13 5.82 13 13M6 11a7 7 0 017 7m-6 0a1 1 0 11-2 0 1 1 0 012 0z' },
```

- [ ] **Step 2: SideNav `moreNavItems` 追加**

```ts
  { href: '/subscribe', label: '订阅', icon: 'M6 5c7.18 0 13 5.82 13 13M6 11a7 7 0 017 7m-6 0a1 1 0 11-2 0 1 1 0 012 0z' },
```

- [ ] **Step 3: check:visual 路由加 /subscribe + 验证**

`astro/scripts/visual-check.mjs` 的 `ROUTES` 数组 `'/projects'` 后插入 `'/subscribe'`。

```bash
cd astro && npm run build
cd astro && (npm run preview -- --port 4322 > /tmp/astro-preview-4322.log 2>&1 &) && sleep 4
cd astro && npm run check:visual -- --base-url http://127.0.0.1:4322
```

预期：全部 PASS（91 项：13 路由 × 7 视口）。用户 4321 的 preview 不要碰。

- [ ] **Step 4: 复制按钮探针（Playwright，跑完删除脚本）**

对 4322 preview（`addInitScript` 预设 `blog-splash-seen`/`blog-welcomed`）：
1. 打开 `/subscribe`，授予剪贴板权限（`browser.newContext({ permissions: ['clipboard-read', 'clipboard-write'] })`）
2. 点击"复制订阅地址"按钮
3. 断言：按钮文案变为"已复制"；`navigator.clipboard.readText()` 内容以 `/feed.xml` 结尾
4. /tags 页面渲染正常（聚合区存在或标签空态存在），无 pageErrors

- [ ] **Step 5: 清理 + Commit（需用户确认）**

杀掉 4322 preview（按端口 PID 精确 taskkill，不动 4321）。

```bash
git add astro/src/components/layout/Header.tsx astro/src/components/layout/SideNav.tsx astro/scripts/visual-check.mjs
git commit -m "feat(astro): subscribe nav entries and visual matrix coverage"
```

---

## Self-Review 记录

- **Spec 覆盖**：聚合取数/分组/最新 3 篇/计数/全部链接 → Task 1；订阅页三区块 → Task 2；导航/验证 → Task 3。零后端。
- **类型一致性**：`PostTagRecord`/`TagPost` 与数据契约逐字一致；`/tags/{slug}` 链接与现有 `[slug].astro` 路由一致；feedUrl 由 `Astro.site` 推导（astro.config 已配 site）。
- **降级路径**：post_tags 失败 → catch 返回空 map（卡片显示"暂无文章"）；tags 失败 → 现有空态；剪贴板不可用 → 静默。
