# 留言板（子项目 D）Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 按 `docs/superpowers/specs/2026-07-17-guestbook-design.md` 实现 `/guestbook` 留言板页（匿名表单 + 留言墙 + 分页）与导航入口；后端仅以契约文档交付（用户实现）。

**Architecture:** 三个聚焦组件（Board 容器 / Form 表单 / Wall 列表）+ 页面组合；数据走 `getPocketBase()` 直发集合 API（与评论系统同模式）；集合未创建时所有状态优雅降级。

**Tech Stack:** Astro 6、React 19、framer-motion、Tailwind v4、PocketBase JS SDK（已装）。

## Global Constraints

- **不新增 npm 依赖**；不动后端任何文件（pb_hooks/pb_migrations）。
- `guestbook_messages` 集合尚不存在（后端契约交付用户）：fetch/create 全部失败路径必须优雅降级（错误态/Toast），**不得**出现未捕获异常或白屏。
- reduced-motion / 移动端降级 / 暗色适配：沿用全站既有体系。
- 复用既有组件：`showToast`（`astro/src/components/ui/Toast.tsx:13`，签名 `showToast(text, type: 'info'|'success'|'error')`）、`Button`（`variant="primary" size="lg" loading`）、`Input`（`label/placeholder/required`）、`fadeUp`/`staggerContainer`（`lib/motion.ts`）、`ParticleField`、`ScrollReveal`。
- **测试现实**：无单元测试框架；验证 = `npm run build` + check:visual（加 `/guestbook`）+ Playwright 探针。
- **git commit 需确认**：每个 Task 末尾的 commit 步骤执行前必须向用户确认。
- 代码注释跟随所在文件风格（多为中文）。

## 数据契约

- 集合 `guestbook_messages`（后端未实现，契约见 spec）：字段 `id, nickname, content, status('show'|'hidden'), created, updated`。
- 前端读取：`pb.collection('guestbook_messages').getList(page, 20, { sort: '-created', filter: 'status = "show"' })` → `{ items, page, totalPages }`。
- 前端创建：`pb.collection('guestbook_messages').create({ nickname, content, status: 'show' })` → 返回新记录。

---

### Task 1: 留言板组件 + `/guestbook` 页面

**Files:**
- Create: `astro/src/components/guestbook/GuestbookForm.tsx`
- Create: `astro/src/components/guestbook/GuestbookWall.tsx`
- Create: `astro/src/components/guestbook/GuestbookBoard.tsx`
- Create: `astro/src/pages/guestbook.astro`

**Interfaces:**
- Produces: `/guestbook` 路由（Task 2 加入导航与 check:visual）。
- Consumes: 上方数据契约；`showToast`、`Button`、`Input`、`fadeUp`/`staggerContainer`、`ParticleField`、`ScrollReveal`。

- [ ] **Step 1: `GuestbookForm.tsx`**

```tsx
import React, { useState } from 'react';
import { motion } from 'framer-motion';
import Button from '../ui/Button';
import Input from '../ui/Input';
import { showToast } from '../ui/Toast';
import { getPocketBase } from '../../lib/pocketbase';
import { fadeUp } from '../../lib/motion';

const NICKNAME_MAX = 30;
const CONTENT_MAX = 500;

const textareaClass =
  'w-full rounded-xl border border-zinc-200 bg-white/70 px-4 py-3 text-sm text-zinc-900 placeholder-zinc-400 transition-all duration-200 ease-out outline-none focus-visible:border-teal-500 focus-visible:ring-2 focus-visible:ring-teal-500/35 dark:border-zinc-700 dark:bg-zinc-900/50 dark:text-zinc-100 dark:placeholder-zinc-500 dark:focus-visible:border-teal-400';

interface GuestbookMessage {
  id: string;
  nickname: string;
  content: string;
  created: string;
}

interface GuestbookFormProps {
  /** 提交成功回调：把新留言插入墙顶 */
  onPosted: (message: GuestbookMessage) => void;
}

/** 留言表单：昵称 + 内容（带字数统计），前端预校验，成功后回调插入墙顶 */
export default function GuestbookForm({ onPosted }: GuestbookFormProps) {
  const [nickname, setNickname] = useState('');
  const [content, setContent] = useState('');
  const [submitting, setSubmitting] = useState(false);

  const trimmedNickname = nickname.trim();
  const trimmedContent = content.trim();
  const canSubmit =
    !submitting &&
    trimmedNickname.length > 0 &&
    trimmedNickname.length <= NICKNAME_MAX &&
    trimmedContent.length > 0 &&
    trimmedContent.length <= CONTENT_MAX;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!canSubmit) return;
    setSubmitting(true);
    try {
      const pb = getPocketBase();
      const record = await pb
        .collection('guestbook_messages')
        .create<GuestbookMessage>({ nickname: trimmedNickname, content: trimmedContent, status: 'show' });
      showToast('留言成功，感谢你的到访！', 'success');
      setNickname('');
      setContent('');
      onPosted(record);
    } catch {
      showToast('提交失败，可能是太频繁了，请稍后再试', 'error');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <motion.form variants={fadeUp} initial="hidden" animate="visible" onSubmit={handleSubmit} noValidate
      className="rounded-xl border border-zinc-200 bg-white p-5 shadow-xl shadow-zinc-900/[0.04] dark:border-zinc-800 dark:bg-zinc-900 sm:p-6">
      <h2 className="text-sm font-black tracking-tight text-zinc-950 dark:text-zinc-50">写下留言</h2>
      <p className="mt-1 text-xs text-zinc-400 dark:text-zinc-500">匿名留言，昵称会公开展示</p>
      <div className="mt-4 grid gap-4">
        <Input
          label="昵称"
          placeholder="你的昵称（30 字以内）"
          value={nickname}
          onChange={(e) => setNickname(e.target.value)}
          maxLength={NICKNAME_MAX + 10}
          required
          autoComplete="name"
        />
        <div>
          <label htmlFor="guestbook-content" className="mb-1.5 block text-sm font-medium text-zinc-700 dark:text-zinc-300">
            留言内容
          </label>
          <textarea
            id="guestbook-content"
            value={content}
            onChange={(e) => setContent(e.target.value)}
            placeholder="说点什么吧…（500 字以内）"
            rows={4}
            maxLength={CONTENT_MAX + 50}
            required
            className={textareaClass}
          />
          <div className="mt-1 text-right text-[11px] text-zinc-400 dark:text-zinc-500">
            {trimmedContent.length}/{CONTENT_MAX}
          </div>
        </div>
        <div>
          <Button type="submit" variant="primary" size="lg" loading={submitting} disabled={!canSubmit}>
            发布留言
          </Button>
        </div>
      </div>
    </motion.form>
  );
}
```

- [ ] **Step 2: `GuestbookWall.tsx`**

```tsx
import React from 'react';
import { motion } from 'framer-motion';
import { fadeUp, staggerContainer } from '../../lib/motion';

interface GuestbookMessage {
  id: string;
  nickname: string;
  content: string;
  created: string;
}

interface GuestbookWallProps {
  messages: GuestbookMessage[];
  loading: boolean;
  error: boolean;
  hasMore: boolean;
  loadingMore: boolean;
  onLoadMore: () => void;
  onRetry: () => void;
}

/** 相对时间：x 分钟前 / x 小时前 / x 天前 / 日期 */
function relativeTime(iso: string): string {
  const then = new Date(iso).getTime();
  if (Number.isNaN(then)) return '';
  const diff = Date.now() - then;
  const minutes = Math.floor(diff / 60000);
  if (minutes < 1) return '刚刚';
  if (minutes < 60) return `${minutes} 分钟前`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours} 小时前`;
  const days = Math.floor(hours / 24);
  if (days < 30) return `${days} 天前`;
  return new Date(iso).toLocaleDateString('zh-CN', { year: 'numeric', month: 'long', day: 'numeric' });
}

/** 留言墙：首字母色块 + 昵称 + 相对时间 + 内容（保留换行），分页加载更多 */
export default function GuestbookWall({ messages, loading, error, hasMore, loadingMore, onLoadMore, onRetry }: GuestbookWallProps) {
  if (loading) {
    return (
      <div className="grid gap-4">
        {[0, 1, 2].map((i) => (
          <div key={i} className="skeleton h-24 rounded-xl" />
        ))}
      </div>
    );
  }

  if (error) {
    return (
      <div className="rounded-xl border border-zinc-200 bg-white p-10 text-center dark:border-zinc-800 dark:bg-zinc-900">
        <p className="text-sm text-zinc-500 dark:text-zinc-400">留言加载失败，请稍后再试。</p>
        <button
          type="button"
          onClick={onRetry}
          className="mt-4 inline-flex min-h-10 items-center rounded-lg bg-zinc-900 px-4 py-2 text-sm font-semibold text-white transition-colors hover:bg-zinc-700 dark:bg-zinc-100 dark:text-zinc-950 dark:hover:bg-white"
        >
          重新加载
        </button>
      </div>
    );
  }

  if (messages.length === 0) {
    return (
      <div className="rounded-xl border border-zinc-200 bg-white p-10 text-center text-sm text-zinc-500 dark:border-zinc-800 dark:bg-zinc-900 dark:text-zinc-400">
        还没有留言，来抢沙发～
      </div>
    );
  }

  return (
    <div>
      <motion.ol variants={staggerContainer(0.06)} initial="hidden" animate="visible" className="grid gap-4">
        {messages.map((msg) => (
          <motion.li
            key={msg.id}
            variants={fadeUp}
            className="flex items-start gap-3 rounded-xl border border-zinc-200 bg-white p-4 shadow-xl shadow-zinc-900/[0.04] dark:border-zinc-800 dark:bg-zinc-900"
          >
            <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-zinc-900 text-sm font-bold text-white dark:bg-zinc-100 dark:text-zinc-950" aria-hidden="true">
              {msg.nickname.charAt(0)}
            </span>
            <div className="min-w-0 flex-1">
              <div className="flex items-baseline justify-between gap-3">
                <span className="truncate text-sm font-bold text-zinc-950 dark:text-zinc-50">{msg.nickname}</span>
                <time dateTime={msg.created} className="shrink-0 text-xs text-zinc-400 dark:text-zinc-500">
                  {relativeTime(msg.created)}
                </time>
              </div>
              <p className="mt-1.5 whitespace-pre-wrap break-words text-sm leading-6 text-zinc-600 [overflow-wrap:anywhere] dark:text-zinc-300">
                {msg.content}
              </p>
            </div>
          </motion.li>
        ))}
      </motion.ol>

      {hasMore && (
        <div className="mt-6 text-center">
          <button
            type="button"
            onClick={onLoadMore}
            disabled={loadingMore}
            className="inline-flex min-h-10 items-center gap-2 rounded-full bg-zinc-100 px-5 py-2 text-sm font-medium text-zinc-700 transition-colors hover:bg-zinc-200 disabled:opacity-50 dark:bg-zinc-800 dark:text-zinc-300 dark:hover:bg-zinc-700"
          >
            {loadingMore && <span className="h-4 w-4 animate-spin rounded-full border-2 border-zinc-400 border-t-zinc-600" aria-hidden="true" />}
            {loadingMore ? '加载中…' : '加载更多'}
          </button>
        </div>
      )}
    </div>
  );
}
```

- [ ] **Step 3: `GuestbookBoard.tsx`**

```tsx
import React, { useCallback, useEffect, useState } from 'react';
import { getPocketBase } from '../../lib/pocketbase';
import GuestbookForm from './GuestbookForm';
import GuestbookWall from './GuestbookWall';

const PER_PAGE = 20;

interface GuestbookMessage {
  id: string;
  nickname: string;
  content: string;
  created: string;
}

/** 留言板容器：持有列表状态与分页逻辑，组合表单与留言墙 */
export default function GuestbookBoard() {
  const [messages, setMessages] = useState<GuestbookMessage[]>([]);
  const [page, setPage] = useState(1);
  const [totalPages, setTotalPages] = useState(1);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState(false);

  const fetchPage = useCallback(async (targetPage: number, append: boolean) => {
    const pb = getPocketBase();
    const result = await pb
      .collection('guestbook_messages')
      .getList<GuestbookMessage>(targetPage, PER_PAGE, { sort: '-created', filter: 'status = "show"' });
    setMessages((prev) => (append ? [...prev, ...result.items] : result.items));
    setPage(result.page);
    setTotalPages(result.totalPages || 1);
  }, []);

  const loadFirstPage = useCallback(async () => {
    setLoading(true);
    setError(false);
    try {
      await fetchPage(1, false);
    } catch {
      setError(true);
    } finally {
      setLoading(false);
    }
  }, [fetchPage]);

  useEffect(() => {
    loadFirstPage();
  }, [loadFirstPage]);

  const handleLoadMore = useCallback(async () => {
    if (loadingMore || page >= totalPages) return;
    setLoadingMore(true);
    try {
      await fetchPage(page + 1, true);
    } catch {
      // 加载更多失败不打断已有内容，仅静默（用户可再次点击）
    } finally {
      setLoadingMore(false);
    }
  }, [fetchPage, loadingMore, page, totalPages]);

  const handlePosted = useCallback((message: GuestbookMessage) => {
    setMessages((prev) => [message, ...prev]);
  }, []);

  return (
    <div className="space-y-8">
      <GuestbookForm onPosted={handlePosted} />
      <GuestbookWall
        messages={messages}
        loading={loading}
        error={error}
        hasMore={page < totalPages}
        loadingMore={loadingMore}
        onLoadMore={handleLoadMore}
        onRetry={loadFirstPage}
      />
    </div>
  );
}
```

- [ ] **Step 4: `astro/src/pages/guestbook.astro`**

```astro
---
import BaseLayout from '../layouts/BaseLayout.astro';
import ParticleField from '../components/effects/ParticleField';
import ScrollReveal from '../components/ui/ScrollReveal';
import GuestbookBoard from '../components/guestbook/GuestbookBoard';
---

<BaseLayout title="留言板" description="留下你的足迹">
  <div class="pointer-events-none fixed inset-0 z-0 hidden lg:block" aria-hidden="true">
    <ParticleField client:visible count={36} speed={0.25} />
  </div>
  <section class="relative z-10 mx-auto w-full max-w-3xl px-5 py-16 sm:px-8">
    <div class="mb-10">
      <ScrollReveal client:visible>
        <div class="mb-4 flex items-center gap-3">
          <span class="h-px w-8 bg-zinc-400 dark:bg-zinc-500"></span>
          <span class="font-mono text-[10px] uppercase tracking-widest text-zinc-500 dark:text-zinc-400">Guestbook</span>
        </div>
        <h1 class="text-4xl font-black tracking-tight text-zinc-950 dark:text-zinc-50 sm:text-5xl">留言板</h1>
        <p class="mt-3 max-w-xl text-zinc-500 dark:text-zinc-400">随便写点什么，证明你来过。</p>
      </ScrollReveal>
    </div>
    <GuestbookBoard client:load />
  </section>
</BaseLayout>
```

- [ ] **Step 5: 验证构建**

```bash
cd astro && npm run build
```

预期：构建成功，dist 含 `/guestbook/index.html`。

- [ ] **Step 6: Commit（需用户确认）**

```bash
git add astro/src/components/guestbook/ astro/src/pages/guestbook.astro
git commit -m "feat(astro): guestbook page with anonymous form and message wall"
```

---

### Task 2: 导航入口 + 视觉矩阵 + 交互探针

**Files:**
- Modify: `astro/src/components/layout/Header.tsx`（MORE_LINKS）
- Modify: `astro/src/components/layout/SideNav.tsx`（moreNavItems）
- Modify: `astro/scripts/visual-check.mjs`（ROUTES）

**Interfaces:**
- Consumes: Task 1 的 `/guestbook` 路由

- [ ] **Step 1: Header `MORE_LINKS` 追加（/links 条目后）**

```ts
  { href: '/guestbook', label: '留言板', description: '留下你的足迹', icon: 'M8 12h.01M12 12h.01M16 12h.01M21 12c0 4.418-4.03 8-9 8a9.863 9.863 0 01-4.255-.949L3 20l1.395-3.72C3.512 15.042 3 13.574 3 12c0-4.418 4.03-8 9-8s9 3.582 9 8z' },
```

- [ ] **Step 2: SideNav `moreNavItems` 追加**

```ts
  { href: '/guestbook', label: '留言板', icon: 'M8 12h.01M12 12h.01M16 12h.01M21 12c0 4.418-4.03 8-9 8a9.863 9.863 0 01-4.255-.949L3 20l1.395-3.72C3.512 15.042 3 13.574 3 12c0-4.418 4.03-8 9-8s9 3.582 9 8z' },
```

- [ ] **Step 3: check:visual 路由加 /guestbook**

`astro/scripts/visual-check.mjs` 的 `ROUTES` 数组 `'/links'` 后插入 `'/guestbook'`。

- [ ] **Step 4: 构建 + 视觉矩阵**

```bash
cd astro && npm run build
cd astro && (npm run preview -- --port 4322 > /tmp/astro-preview-4322.log 2>&1 &) && sleep 4
cd astro && npm run check:visual -- --base-url http://127.0.0.1:4322
pkill -f "astro preview -- --port 4322"
```

预期：全部 PASS（70 项：10 路由 × 7 视口）。注意：用户 4321 上有正在运行的 preview，**不要碰它**，只用 4322。

- [ ] **Step 5: 交互探针（Playwright，跑完删除脚本）**

对 4322 preview：
1. 打开 `/guestbook`：表单可见；集合不存在时留言墙显示错误态（"留言加载失败" + 重试按钮）或空态，**页面无未捕获异常**（pageErrors 为空）
2. 表单交互：昵称/内容为空时提交按钮 disabled；输入内容后字数统计变化；按钮变为可用
3. 点击提交（集合不存在，必然失败）：出现 Toast 错误提示（"提交失败"），页面不崩

记录结果。

- [ ] **Step 6: Commit（需用户确认）**

```bash
git add astro/src/components/layout/Header.tsx astro/src/components/layout/SideNav.tsx astro/scripts/visual-check.mjs
git commit -m "feat(astro): guestbook nav entries and visual matrix coverage"
```

---

## Self-Review 记录

- **Spec 覆盖**：表单（预校验/字数统计/Toast/插入墙顶）→ Task 1 Step 1；留言墙（相对时间/stagger/分页/空错误态）→ Task 1 Step 2；容器状态 → Task 1 Step 3；页面与背景 → Task 1 Step 4；导航/验证 → Task 2。后端契约在 spec 中交付用户，不动后端文件。
- **类型一致性**：`GuestbookMessage` 接口（id/nickname/content/created）在 Form/Wall/Board 三文件中逐字一致；`status = "show"` 过滤与 spec 契约一致。
- **降级路径**：集合不存在 → Wall 错误态 + 重试；创建失败 → Toast；加载更多失败 → 静默可重试；空集合 → 空态文案。
