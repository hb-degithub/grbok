# Orbital-log Frontend Foundation and Homepage Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 为已批准的全站轻科幻「轨道日志」重构建立可验证的基线、共享设计基础与首页样板，不改变现有 URL、真实数据、业务功能或认证/权限边界。

**Architecture:** 保留 Astro SSR + React islands + Tailwind 4 + 现有 hooks/services。静态外壳与展示区块优先 Astro；需要状态/动效的组件保留 React。保留 `--sf-*` 语义命名空间并更新其值，在 `astro/src/styles/global.css` 集中记录唯一令牌真值。首页 `RequestPath` 保留真实链路/API 数据，新增装饰图形必须 `aria-hidden` 且不冒充指标。

**Tech Stack:** Astro 7 SSR、React 19、Tailwind CSS 4、Framer Motion 13、PocketBase JS SDK、Vitest/Testing Library、Playwright。

**上游设计：** `docs/superpowers/specs/2026-11-19-orbital-log-frontend-redesign.md`（用户已批准，提交 `05b2a10`）。

## Global Constraints

- 先读 `AGENTS.md` 与 `CLAUDE.md`，但以实际代码/配置为准；React 组件必须 `export default`。
- 本期只覆盖基线、共享基础、首页和必要的直接测试；不重写其他展示页、文章详情、认证或后台。
- 不改 URL、PocketBase 集合/字段/API、认证逻辑、`pb_hooks/**`、`pb_migrations/**`、`Caddyfile*`、部署配置；不新增依赖或 API 端点。
- 保留首页所有真实功能区块：最新文章、热榜、最近评论、作者、友链、站内导航、站点状态、统计、登录入口和真实请求链路。
- 装饰轨道/光带为 `aria-hidden="true"`、不附数字/伪图注、不遮挡输入；有数据的链路继续标明“未采集”等真实状态。
- 明暗主题、移动端、键盘焦点、`prefers-reduced-motion` 与无 JS 可读性不得退化。
- 静态 Astro 原语与 React 交互组件不得跨框架互相导入；共享视觉只复用 class/token。
- 不把审计推断写成已复现缺陷；行为修复必须独立测试和说明。
- 所有测试/构建须实际运行并记录结果，失败不得靠删除断言、跳过或覆盖截图解决。
- 本地验收用 `ALLOW_LOCALHOST_SITE=1`；浏览器测试使用独立端口和 mock，禁止连接/重启用户的 4321 或生产服务。
- 每项任务由匹配子智能体实现，测试子智能体验证，主智能体审查 diff 后提交；只提交本任务列出的文件。
- 主智能体负责具体视觉与交互定稿：页面构图、层级、色彩、动效、响应式和验收；子智能体按设计实现，不自行改变风格或扩张功能。

## File Map

| 文件 | 职责 |
|---|---|
| `astro/src/styles/global.css` | 唯一设计令牌、主题、共享视觉类与减少动效定义 |
| `astro/src/styles/orbital.ts` | 可供 Astro/React 共享的纯 class 常量；不含运行时数据或 JSX |
| `astro/src/components/layout/PageShell.astro` | 静态内容页的容器/页头槽位，后续计划复用 |
| `astro/src/components/layout/SectionHeading.astro` | 静态区块标题、说明与操作槽位 |
| `astro/src/components/home/OrbitalScene.astro` | 首页静态装饰轨道/光带，不含伪造数据；浏览器验证可访问性和点击穿透 |
| `astro/src/components/home/HomeHero.astro` | 首页 Hero 布局、真实站点文案、CTA 与 RequestPath 的挂载 |
| `astro/src/hooks/usePublicStatus.ts` | 首页公开状态共享数据、可见性暂停与卸载清理；接口形状不变 |
| `astro/src/components/layout/RequestPath.tsx` | 真实链路数据展示，保留未采集/失败语义 |
| `astro/src/components/sidebar/StatusMini.tsx` | 复用公开状态数据，保留状态页入口与三项指标 |
| `astro/src/pages/index.astro` | 首页编排与既有计数 SSR；不新增数据端点 |
| `astro/src/__tests__/sci-fi-layout.test.ts` | 首页结构/旧视觉断言迁移；保留真实模块、数据源与可访问性契约 |
| `astro/src/__tests__/sci-fi-content.test.ts` | 仅移除被新设计明确取代的 hex 锁死；保留内容、字段、默认导出等契约 |
| `astro/e2e/sci-fi-site/fixtures.ts` | 浏览器夹具、非固定色值令牌采样与证据路径 |
| `astro/e2e/sci-fi-site/contrast.spec.ts` | 明暗主题对比度门禁 |
| `astro/e2e/sci-fi-site/interactions.spec.ts` | 导航/主题/键盘/减少动效行为 |
| `astro/e2e/sci-fi-site/screenshots.spec.ts` | 首页截图证据，不作为未经确认的像素基线 |
| `astro/src/components/sidebar/StatusMini.test.tsx` | 共享状态、接口容错、清理/暂停行为 |


后续独立计划：阅读路径（列表 SSR/分页、文章、评论）、认证账号、后台共享基础与 21 个页面、全站收尾。不得在本期顺手展开。

---

### Task 1: 冻结可复现基线与测试执行边界

**Files:**
- Read: `astro/package.json`, `astro/vitest.config.ts`, `astro/astro.config.mjs`
- Read: `astro/e2e/sci-fi-site/playwright.config.ts`, `fixtures.ts`, `authz.spec.ts`
- Create: `astro/test-results/orbital-log/baseline.md`（若被忽略，以主智能体验收记录保存摘要，不修改 `.gitignore`）

**Interfaces:**
- Produces: 基线提交、实际命令与退出码、历史产物/环境失败的区分；不提供产品 API。

- [ ] **Step 1: 记录基线并检查测试服务隔离**

```bash
git status --short
git rev-parse HEAD
cd astro && node -v && npm -v
```

预期：工作区仅有本任务明确允许的产物；基线为已批准设计之后的提交。确认 Playwright `webServer` 使用 `SCI_FI_E2E_PORT ?? 4338`、`reuseExistingServer:false`，不连接 4321。

- [ ] **Step 2: 执行不启动服务的基线门禁**

```bash
cd astro && npm run lint
cd astro && npm run check
cd astro && npm run test:admin-auth
cd astro && npx vitest run
cd astro && ALLOW_LOCALHOST_SITE=1 npm run build
```

预期：逐条记录真实 exit code；若失败，保存错误并区分当前缺陷与任务回归，禁止宣称“基线通过”。

- [ ] **Step 3: 执行既有浏览器基线**

```bash
cd astro && SCI_FI_E2E_PORT=4338 npm run test:e2e:site
```

若 4338 被占用，选择一个明确空闲的高位端口重跑，不杀掉占用者。预期：Playwright 先运行 `assert-fresh-dist`，再启动 `dist/server/entry.mjs`；输出报告真实通过/失败数。

- [ ] **Step 4: 固化浏览器测试输入/输出约定**

在基线记录中写明以下真实契约：

```text
构建先于 E2E；Vitest 仅匹配 src/**/*.test.{ts,tsx}。
astro/test/ 的 Node 测试必须登记进 package.json 对应脚本。
保留匿名后台 SSR 无敏感数据、noindex、step-up 不泄漏和真实 404 断言。
令牌真值仅为 src/styles/global.css；E2E 不另存一份色值真值。
```

- [ ] **Step 5: 主智能体审查并提交可共享的基线说明**

只提交确有长期价值的基线/契约文档；测试报告和截图留在测试产物目录，不纳入版本库。若基线失败，先决定独立修复任务，不继续覆盖问题。

### Task 2: 用行为测试定义共享公开状态

**Files:**
- Create: `astro/src/hooks/usePublicStatus.ts`
- Create: `astro/src/hooks/usePublicStatus.test.ts`
- Test: `astro/src/components/sidebar/StatusMini.test.tsx`

**Interfaces:**
- Produces:

```ts
export interface PublicStatusService {
  key: string;
  ok: boolean | null;
  avgLatency24h: number | null;
  uptime24h: number | null;
}
export interface PublicStatusSnapshot {
  status: { overall?: string; services?: PublicStatusService[] } | null;
  statusPhase: 'loading' | 'ready' | 'failed';
  protectionPhase: 'loading' | 'ready' | 'failed';
  pingPhase: 'loading' | 'ready' | 'failed';
  blocked24h: number | null;
  pingMs: number | null;
  safelineState: 'ok' | 'stale' | 'unavailable' | null;
}
export function usePublicStatus(): PublicStatusSnapshot;
// 模块级公开状态 store 内部维护单份请求/轮询与订阅引用计数；
// hook 只订阅该快照，多个消费者不重复发请求。
```

- Consumes: 既有 `/api/public/status`、`/api/public/protection`、`/api/public/ping`；不修改其响应。

- [ ] **Step 1: 写失败的共享 hook 行为测试**

```tsx
import { act, renderHook, waitFor } from '@testing-library/react';

it('两个消费者共享一次状态请求，最后一个卸载才清理', async () => {
  const fetchMock = vi.fn(async (input: RequestInfo | URL) => ({
    ok: true,
    json: async () => String(input).startsWith('/api/public/status')
      ? { overall: 'operational', services: [] }
      : { safeline: { state: 'ok', blocked: 3 } },
  }) as Response);
  vi.stubGlobal('fetch', fetchMock);
  const first = renderHook(() => usePublicStatus());
  const second = renderHook(() => usePublicStatus());
  await waitFor(() => expect(first.result.current.statusPhase).toBe('ready'));
  expect(second.result.current.statusPhase).toBe('ready');
  expect(fetchMock.mock.calls.filter((call) => String(call[0]).startsWith('/api/public/status'))).toHaveLength(1);
  first.unmount();
  expect(second.result.current.statusPhase).toBe('ready');
  second.unmount();
});

it('三个来源分别保留失败，并拒绝不可信防护与非 2xx ping', async () => {
  vi.stubGlobal('fetch', vi.fn(async () => ({ ok: false, json: async () => ({}) }) as Response));
  const { result } = renderHook(() => usePublicStatus());
  await waitFor(() => expect(result.current.pingPhase).toBe('failed'));
  expect(result.current.statusPhase).toBe('failed');
  expect(result.current.protectionPhase).toBe('failed');
  expect(result.current.blocked24h).toBeNull();
  expect(result.current.safelineState).toBeNull();
  expect(result.current.pingMs).toBeNull();
});
```

另用 `vi.useFakeTimers()`、`act()` 和真实 `visibilitychange` 分别断言：hidden 时无新请求、visible 时立即刷新、仅剩一个订阅者时继续服务、最后卸载后 timer 为 0。测试不得只写注释；实现前运行并确认因模块不存在而失败。

状态 store 测试须同时验证模块级去重、加载/失败与清理；导航集中配置不在首期创建，留待实际改造 Header/SideNav/Footer 的外壳任务，避免产出未消费配置。

- [ ] **Step 2: 运行测试并验证因模块不存在而失败**

```bash
cd astro && npx vitest run src/hooks/usePublicStatus.test.ts
```

预期：FAIL，原因是新模块/导出尚不存在；若是语法或 mock 配置错误先修测试。

- [ ] **Step 3: 实现最小共享状态 store**

```ts
export function usePublicStatus(): PublicStatusSnapshot {
  // 使用 useSyncExternalStore 订阅模块级单例 store，提供 SSR 初始快照 getServerSnapshot。
  // document/timer 仅在浏览器订阅时访问；SSR 不发起请求、不访问 window。
  // 第一个订阅者开始加载；请求序号/AbortController 防乱序覆盖。
  // 30s 定时；hidden 暂停，visible 立即刷新；最后卸载清理 timer/监听。
}
```

`StatusMini` 保持 `overall` 容错、24h 延迟/可用率/你的延迟、真实拦截数和 `/status` 链接；接口失败回退 unknown，不造数据。本任务只新增共享 store 与其测试，不改组件实现；StatusMini 接入及对应测试迁移统一在 Task 5 完成。

- [ ] **Step 4: 重跑聚焦测试与全量 Vitest**

```bash
cd astro && npx vitest run src/hooks/usePublicStatus.test.ts
cd astro && npx vitest run
```

预期：PASS；任何原有数据/认证测试失败必须停止并报告。

- [ ] **Step 5: 主智能体审查并提交**

```bash
git add astro/src/hooks/usePublicStatus.ts astro/src/hooks/usePublicStatus.test.ts
git commit -m "test: define shared public status contracts"
```

### Task 3: 建立「轨道日志」令牌与跨框架视觉原语

**Files:**
- Modify: `astro/src/styles/global.css`
- Create: `astro/src/styles/orbital.ts`
- Create: `astro/src/styles/orbital.test.ts`
- Create: `astro/src/components/layout/PageShell.astro`
- Create: `astro/src/components/layout/SectionHeading.astro`
- Modify: `astro/e2e/sci-fi-site/fixtures.ts`
- Modify: `astro/e2e/sci-fi-site/playwright.config.ts`
- Modify: `astro/e2e/sci-fi-site/contrast.spec.ts`
- Modify: `astro/e2e/sci-fi-site/invariants.spec.ts`
- Modify: `astro/e2e/sci-fi-site/pb-states.spec.ts`
- Modify: `astro/e2e/sci-fi-site/routes.spec.ts`
- Modify: `astro/src/__tests__/sci-fi-content.test.ts`

**Interfaces:**
- Produces:

```ts
export const orbitalClasses = Object.freeze({
  shell: 'orbital-shell',
  panel: 'orbital-panel',
  eyebrow: 'orbital-eyebrow',
  action: 'orbital-action',
} as const);
```

```astro
<PageShell title="页面标题" eyebrow="内容索引" description="说明">
  <slot />
</PageShell>
<SectionHeading eyebrow="最新文章" title="最新文章" description="最近发布的内容">
  <a slot="action" href="/posts">查看全部</a>
</SectionHeading>
```

- Produces 令牌：`--sf-canvas/surface/ink/ink-2/ink-3/line/line-strong/line-soft/line-control/accent/accent-ink/on-accent/danger/focus-ring/scrim/pad` 继续存在；新增 `--sf-success`、`--sf-warning`、`--sf-info`、`--sf-glow`、`--sf-orbit`。
- Consumes: 既有 `html.dark`、`data-theme`、`data-theme-mode` 和 `blog-theme-mode`；不改主题 key/事件。

- [ ] **Step 1: 先添加令牌结构与共享 class 的失败测试**

```ts
import { orbitalClasses } from './orbital';
it('暴露稳定的跨框架 class 契约', () => {
  expect(orbitalClasses.panel).toBe('orbital-panel');
  expect(Object.isFrozen(orbitalClasses)).toBe(true);
});
```

用 Node `process.getBuiltinModule('node:fs')` 只读 `global.css`，断言新增语义令牌在 `:root` 和 `.dark` 都有定义，禁止复制色值作为断言。

- [ ] **Step 2: 验证测试失败**

```bash
cd astro && npx vitest run src/styles/orbital.test.ts
```

预期：FAIL（模块或新令牌不存在）。

- [ ] **Step 3: 实现集中令牌和静态原语**

在 `global.css` 中确定浅色雾白/蓝灰、暗色深空蓝灰与青蓝强调；正文对比 ≥4.5:1，控件边界 ≥3:1。示意接口：

```css
.orbital-panel {
  border: 1px solid var(--sf-line-soft);
  border-radius: var(--radius-lg);
  background: var(--sf-surface);
  box-shadow: inset 0 1px 0 rgb(255 255 255 / 0.04);
}
```

实际色值必须经浏览器对比度测试确定，不能只在计划里声称达标。`PageShell`/`SectionHeading` 输出一个清晰 h1/h2 层级，保留 slot 和 `id`，不包含 React 或 PB 请求。

- [ ] **Step 4: 将 E2E 从旧色值锁死改为令牌与对比度断言**

```ts
export async function tokenSnapshot(page: Page) {
  return page.evaluate((names) => {
    const styles = getComputedStyle(document.documentElement);
    return {
      tokens: Object.fromEntries(names.map((name) => [name, styles.getPropertyValue(name).trim()])),
      bodyBackground: getComputedStyle(document.body).backgroundColor,
      htmlClasses: document.documentElement.className,
    };
  }, names);
}
```

`fixtures.ts` 移除旧 `TOKENS`/`CANVAS_RGB` 作为真值，改从渲染后的根元素采样；保留真实 body 画布、明暗主题、无溢出断言。新增 320/768/1024 视口通过 `screenshots.spec.ts` 内的 `test.describe('@shots')` + `test.use({ viewport })` 限定于首页截图，不扩展其他 spec 的 project 矩阵；截图文件名使用 `testInfo.project.name` + 当前 viewport 宽度，避免覆盖。`SCI_FI_SHOTS_DIR` 默认 `astro/artifacts/orbital-log/home/`，不属于 Playwright 自动清理目录，按测试产物管理、不提交截图。`contrast.spec.ts` 增加 success/warning/info/danger 与画布/表面的对比检查，并采样 `/login` 及隔离后台工作页，避免全局令牌变更未经验证。`invariants.spec.ts` 的 A6 改为“所需令牌存在且非空、主题 class 与当前模式一致”，不再遍历旧 `TOKENS[theme]`；对比度由 contrast.spec 把关。`pb-states.spec.ts`/`routes.spec.ts` 改用 `data-state`、`data-ssr-count`、`data-stat-value` 等稳定语义，不依赖 Tailwind 类名或装饰性文本。

`sci-fi-content.test.ts` 只把 global.css 的固定 hex 断言改为“两个主题令牌均存在”，保留内容页 h1、真实取数、字段消费和默认导出契约；本任务不改这些页面。旧视觉禁令不得被误当成安全规则，新视觉由设计文档授权；保留的无旧调色板约束在对应页面改造时再评审。

- [ ] **Step 5: 运行单测和静态门禁**

```bash
cd astro && npx vitest run src/styles/orbital.test.ts
cd astro && npm run lint && npm run check
cd astro && npx vitest run
```

预期：PASS；若其他页面因全局令牌出现可读性回退，调整令牌而非跳过检查。

- [ ] **Step 6: 主智能体审查并提交**

```bash
git add astro/src/styles/global.css astro/src/styles/orbital.ts astro/src/styles/orbital.test.ts astro/src/components/layout/PageShell.astro astro/src/components/layout/SectionHeading.astro astro/e2e/sci-fi-site/fixtures.ts astro/e2e/sci-fi-site/playwright.config.ts astro/e2e/sci-fi-site/contrast.spec.ts astro/e2e/sci-fi-site/invariants.spec.ts astro/e2e/sci-fi-site/pb-states.spec.ts astro/e2e/sci-fi-site/routes.spec.ts astro/src/__tests__/sci-fi-content.test.ts
git commit -m "feat: add orbital-log design foundation"
```

### Task 4: 重做首页 Hero 与装饰场景，保留真实链路

**Files:**
- Create: `astro/src/components/home/OrbitalScene.astro`
- Create: `astro/src/components/home/HomeHero.astro`
- Create: `astro/src/components/layout/RequestPath.test.tsx`
- Modify: `astro/src/components/layout/RequestPath.tsx`
- Modify: `astro/src/pages/index.astro`
- Modify: `astro/src/__tests__/sci-fi-layout.test.ts`
- Modify: `astro/e2e/sci-fi-site/interactions.spec.ts`
- Modify: `astro/e2e/sci-fi-site/screenshots.spec.ts`

**Interfaces:**
- Consumes: `RequestPath` 的真实公开状态接口；`SITE_CONFIG.name/slogan/description/since`；Task 3 的 class/token。
- Produces:

```astro
<HomeHero />
```

首页 `index.astro` 继续负责 SSR 计数；`HomeHero` 不包含计数 props、不发起 PB 请求，统计继续留在首页原有状态区块。`RequestPath` 继续导出默认 React 组件，无 props 破坏。

- [ ] **Step 1: 先写真实链路渲染测试与装饰层浏览器断言**

`RequestPath.test.tsx` 用 `usePublicStatus` mock 覆盖 ok/outage/unknown/无 services/失败、gateway 有/无、safeline 各状态；断言未采集不显示估算值、错误不显示运行正常。E2E 对 `[data-orbital-decoration]` 断言 `aria-hidden=true`、计算样式 `pointer-events:none`、不遮挡 CTA、无横向溢出。

- [ ] **Step 2: 运行测试并验证失败**

```bash
cd astro && npx vitest run src/components/layout/RequestPath.test.tsx
```

预期：FAIL（真实状态测试尚未建立/组件尚未接入共享契约）。

- [ ] **Step 3: 实现新首页 Hero 与纯展示场景**

```astro
<div class="orbital-hero">
  <div class="orbital-hero__copy">
    <!-- 直接消费 SITE_CONFIG，保留现有 h1、简介、/posts 与 /about CTA -->
  </div>
  <div class="orbital-hero__telemetry"><RequestPath client:visible /></div>
  <OrbitalScene />
</div>
```

`OrbitalScene` 只输出 CSS/SVG 轨道、光带和坐标纹理，使用 `pointer-events:none`、`aria-hidden`，减少动效时静止；不使用 WebGL、外部资源、伪造数字或图表标题。Hero 在移动端先文案后真实链路，320px 无横向滚动；保留 `/about` CTA 与真实链路的 figcaption/未采集说明。

`RequestPath` 只改布局与状态视觉，不改变公开接口、真实 RTT、防护、可用率或“未采集”逻辑。

- [ ] **Step 4: 重做首页分区而保留全部业务模块**

`index.astro` 使用 `HomeHero`、共享容器和 `SectionHeading`，保留 `PostList`、`HotArticles`、`RecentComments`、`ProfileCard`、`FriendLinks`、`HomeSideNav`、`StatusMini`、`CountUp` 和 `HomeAuthQuickEntry`。采用分栏/层次/留白建立新构图，不删除功能或改数据语义。

同步迁移 `sci-fi-layout.test.ts`：保留站点配置来源、真实岛屿、公开数据源、无局部令牌覆盖、键盘/导航等有效断言；将旧 `sf-btn-primary`、固定两栏、旧 Dock 尺寸和禁止新视觉形状等断言改为首页分区、CTA、岛屿和实际浏览器行为断言。不能用删除整个文件或忽略失败代替迁移。

- [ ] **Step 5: 执行聚焦测试、构建和浏览器验证**

```bash
cd astro && npx vitest run src/components/layout/RequestPath.test.tsx src/components/posts/PostList.test.tsx src/components/sidebar/StatusMini.test.tsx
cd astro && npm run lint && npm run check && npx vitest run
cd astro && ALLOW_LOCALHOST_SITE=1 npm run build
cd astro && SCI_FI_E2E_PORT=4338 npm run test:e2e:site
```

预期：全部 PASS；浏览器报告无意外错误、无横向溢出、明暗对比达标。失败时保存报告并修复，不刷新截图掩盖。

- [ ] **Step 6: 主智能体审查并提交**

```bash
git add astro/src/components/home astro/src/components/layout/RequestPath.tsx astro/src/components/layout/RequestPath.test.tsx astro/src/pages/index.astro astro/src/__tests__/sci-fi-layout.test.ts astro/e2e/sci-fi-site/interactions.spec.ts astro/e2e/sci-fi-site/screenshots.spec.ts
git commit -m "feat: redesign homepage as orbital log"
```

### Task 5: 收敛首页特效和状态请求，并完成样板验收

**Files:**
- Modify: `astro/src/layouts/BaseLayout.astro`
- Modify: `astro/src/components/sidebar/StatusMini.tsx`
- Modify: `astro/src/components/layout/RequestPath.tsx`
- Modify: `astro/src/components/effects/CursorGlow.tsx`
- Modify: `astro/src/components/effects/CursorAim.tsx`
- Modify: `astro/src/components/effects/SplashOverlay.tsx`
- Modify: `astro/src/components/effects/WelcomeOverlay.tsx`
- Modify: `astro/src/components/layout/SideNav.tsx`
- Test: `astro/src/components/layout/__tests__/SideNav.interaction.test.tsx`
- Create: `astro/src/components/effects/WelcomeOverlay.test.tsx`
- Test: `astro/e2e/sci-fi-site/interactions.spec.ts`

**Interfaces:**
- Consumes: Task 2 的 `usePublicStatus()`；现有 `blog-theme-mode`、`blog-splash-seen`、`blog-welcomed`。
- Produces: 首页单一公开状态 store；新展示特效仅作用于展示场景；WelcomeOverlay 保留完整注册/验证入口与既有 `useUser`/限流调用，只重做视觉、出现场景和焦点/键盘体验，不删除或复制认证逻辑。

- [ ] **Step 1: 为共享状态、减少动效和旧特效路径写失败测试**

```tsx
const { registerReader, requestVerification } = vi.hoisted(() => ({
  registerReader: vi.fn(async () => ({ success: true })),
  requestVerification: vi.fn(async () => ({ success: true })),
}));
vi.mock('../../hooks/usePocketBase', () => ({
  useUser: () => ({ registerReader, requestVerification }),
}));

it('保留原有注册与验证服务调用', async () => {
  render(<WelcomeOverlay />);
  fireEvent.click(screen.getByRole('button', { name: /注册|开始使用/ }));
  fireEvent.change(screen.getByLabelText(/邮箱/), { target: { value: 'reader@example.com' } });
  fireEvent.click(screen.getByRole('button', { name: /注册|发送/ }));
  await waitFor(() => expect(registerReader).toHaveBeenCalled());
  fireEvent.click(screen.getByRole('button', { name: /重发|重新发送/ }));
  await waitFor(() => expect(requestVerification).toHaveBeenCalledWith('reader@example.com'));
});
```

同时断言对话框 focus trap/Esc/焦点归还；mock 既有 `RateLimiter` 配置但不断言放宽限流。若当前实际按钮/字段名不同，按当前 UI 查询，不删除调用断言。

E2E 新增不预置 `blog-welcomed` 的用例，断言欢迎 dialog、焦点/Esc 和注册/重发入口仍在；展示页以外不阻断内容。移动导航补齐归档/状态链接，并保留现有键盘/焦点契约。减少动效时轨道无持续动画；主题切换后 `.dark` 与实际背景一致。

- [ ] **Step 2: 运行测试，记录当前实现失败点**

```bash
cd astro && npx vitest run src/components/sidebar/StatusMini.test.tsx src/components/effects/WelcomeOverlay.test.tsx src/components/layout/__tests__/SideNav.interaction.test.tsx
```

预期：新增共享/减少动效断言 FAIL；原有焦点归还、Esc、真实状态容错仍须 PASS。

- [ ] **Step 3: 接入共享 hook 并重做特效使用场景**

`RequestPath` 与 `StatusMini` 用同一 hook，共享快照、保持真实未采集/错误状态。组件仍负责各自的展示语义，禁止把请求失败显示成“运行正常”。

旧 CursorGlow/CursorAim/SplashOverlay/WelcomeOverlay 按已确认“特效改了”重做：以展示页轻场景替代全站持续跟随/双层阻断；WelcomeOverlay 保留原注册、验证重发和限流流程，仅更新视觉与出现场景，不改为另一个认证入口。`DebugProtection` 属功能开关，不作为装饰删除。`SideNav` 补齐归档/状态入口并沿用其焦点/键盘机制。

- [ ] **Step 4: 执行完整首期硬门禁**

```bash
cd astro && npm run lint
cd astro && npm run check
cd astro && npm run test:admin-auth
cd astro && npx vitest run
cd astro && ALLOW_LOCALHOST_SITE=1 npm run build
cd astro && SCI_FI_E2E_PORT=4338 npm run test:e2e:site
```

所有命令必须 exit 0。截图通过 `SCI_FI_SHOTS_DIR=$PWD/artifacts/orbital-log/home` 写入 `astro/artifacts/orbital-log/home/`，包含 320/390/768/1024/1440 代表性视口 × 明/暗；此目录不被 Playwright 清理且截图不提交。无预置主题存储、无预置 welcomed 和 reduced-motion 用例必须有实际断言。

- [ ] **Step 5: 独立审查与人工视觉验收**

审查子智能体只读 diff、运行聚焦验证并报告功能/安全/响应式问题；主智能体检查截图、退出码、所有首页模块及真实数据语义。视觉基线首次由用户确认，禁止实现者自行更新失败基线。

- [ ] **Step 6: 提交并衔接后续独立计划**

```bash
git add astro/src/layouts/BaseLayout.astro astro/src/components/sidebar/StatusMini.tsx astro/src/components/layout/RequestPath.tsx astro/src/components/layout/SideNav.tsx astro/src/components/effects astro/src/components/effects/WelcomeOverlay.test.tsx astro/src/components/layout/__tests__/SideNav.interaction.test.tsx astro/e2e/sci-fi-site/interactions.spec.ts astro/e2e/sci-fi-site/screenshots.spec.ts
git commit -m "feat: refine homepage effects and shared status"
```

后续分别为阅读路径、认证/账号、后台编写计划并执行；本期完成不代表全站重构已完成。

## Self-Review

- 规格覆盖：本期只实现基线、共享基础、首页和特效策略；其他区域明确由后续独立计划覆盖，不虚报全站完成。
- 测试归属：Vitest 只收 `src/**`；Node 测试须登记；浏览器先构建后执行，且只用隔离端口。
- 安全边界：不改 PB/Caddy/认证核心；共享公开状态只读公开接口；无伪造数据。
- 接口一致性：`--sf-*` 真值集中于 global.css；静态 Astro 原语不用于 React 后台；共享 hook 在消费前定义；导航配置留待实际外壳任务。
- 范围控制：任何新发现业务 bug 另建任务，先复现和测试，不顺手混入视觉提交。
