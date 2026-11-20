/**
 * Task D · 阅读详情验收（SSR + 真实浏览器，使用有数据的夹具）。
 *
 * 与 `reading-detail.spec.ts` 的区别：
 * - 那边 PB 不可达，只能稳定覆盖「文章不存在」；本文件用 8199 的只读 Node PB
 *   夹具让 SSR 真的取到已发布文章，因此能验证正文、作者回退、目录、评论、
 *   互动与「草稿 / 不存在的标签」的真实 404。
 * - 浏览器侧数据面（settings / public_comments / posts / tags / post_tags）
 *   复用 e2e fixtures 的 route mock 思路，但用本文件的夹具数据；
 *   `/api/realtime` 不拦，交给 8199 夹具真实维持 SSE，避免 SDK 断线重连噪音。
 *
 * 运行：
 *   cd astro
 *   ALLOW_LOCALHOST_SITE=1 PUBLIC_POCKETBASE_URL=http://127.0.0.1:8199 npm run build
 *   npx playwright test --config e2e/sci-fi-site/playwright.reading-populated.config.ts
 */
import { test, expect, type Page, type Route } from '@playwright/test';
import { mkdirSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';
import {
  collectErrors,
  expectNoHorizontalOverflow,
  installStorage,
  isMobileProject,
  openRoute,
  scrollThrough,
  themeOf,
  unexpectedConsoleErrors,
  type ErrorBucket,
} from './fixtures';

interface FixtureComment {
  id: string;
  post_id: string;
  author_name: string;
  content: string;
  parent_id: string | null;
  status: 'pending' | 'approved' | 'spam';
  created: string;
  updated: string;
  likes?: number;
  edited?: boolean;
  edited_at?: string;
  deleted?: boolean;
  author_level?: number;
  is_ai?: boolean;
}

interface FixturePost {
  id: string;
  title: string;
  slug: string;
  excerpt: string;
  content: string;
  status: string;
  published_at: string;
  views: number;
  likes: number;
  author: string;
  expand: unknown;
}

interface FixtureDataset {
  author: { id: string; name: string; avatar: string };
  publishedPost: FixturePost;
  draftPost: { slug: string; title: string; content: string; status: string };
  tag: { id: string; name: string; slug: string; description: string };
  missingTagSlug: string;
  comments: FixtureComment[];
  settings: Array<{ key: string; value: unknown }>;
}

const DATASET: FixtureDataset = JSON.parse(
  readFileSync(fileURLToPath(new URL('./reading-populated-dataset.json', import.meta.url)), 'utf8'),
);

const PB_BASE = 'http://127.0.0.1:8199';
const BASE_URL = `http://127.0.0.1:${process.env.READING_E2E_PORT ?? 4338}`;
const SHOTS = fileURLToPath(new URL('../../../tmp/task-reading-browser/shots/', import.meta.url));
mkdirSync(SHOTS, { recursive: true });

const POST_URL = `/posts/${DATASET.publishedPost.slug}`;
const DRAFT_URL = `/posts/${DATASET.draftPost.slug}`;
const AUTHOR = DATASET.author;

const CORS: Record<string, string> = {
  'access-control-allow-origin': '*',
  'access-control-allow-methods': 'GET,POST,PATCH,DELETE,OPTIONS',
  'access-control-allow-headers': '*',
};

function listBody(items: unknown[], perPage = 20) {
  return {
    page: 1,
    perPage,
    totalItems: items.length,
    totalPages: items.length ? Math.max(1, Math.ceil(items.length / perPage)) : 0,
    items,
  };
}

async function fulfillJson(route: Route, body: unknown, status = 200) {
  if (route.request().method() === 'OPTIONS') {
    await route.fulfill({ status: 204, headers: CORS });
    return;
  }
  await route.fulfill({
    status,
    headers: { ...CORS, 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
}

/** public_comments 是视图：生产 SQL 已限定 status="approved" AND deleted=false。 */
const APPROVED_COMMENTS = DATASET.comments
  .filter((comment) => comment.status === 'approved' && !comment.deleted)
  .sort((a, b) => b.created.localeCompare(a.created));

/**
 * 浏览器侧 PocketBase 数据面（只 mock JSON 集合接口）。
 *
 * 注意不 mock `/api/realtime`：该路径交给 8199 夹具维持 SSE，否则 EventSource
 * 会因 route.fulfill 立即断流而反复重连，把 SDK 的 subscribe 失败噪音写进
 * console.error，掩盖真正的缺陷。
 */
async function mockReadingBrowserApis(page: Page) {
  await page.route(/\/api\/collections\/settings\/records(\?.*)?$/, (route) =>
    fulfillJson(route, listBody(DATASET.settings, 500)));

  await page.route(/\/api\/collections\/public_comments\/records(\?.*)?$/, (route) =>
    fulfillJson(route, listBody(APPROVED_COMMENTS, 20)));

  await page.route(/\/api\/collections\/posts\/records(\?.*)?$/, (route) =>
    fulfillJson(route, listBody([DATASET.publishedPost], 12)));

  await page.route(/\/api\/collections\/tags\/records(\?.*)?$/, (route) =>
    fulfillJson(route, listBody([DATASET.tag], 1)));

  await page.route(/\/api\/collections\/post_tags\/records(\?.*)?$/, (route) =>
    fulfillJson(route, listBody([
      { id: 'post_tag-e2e-fixture', post_id: DATASET.publishedPost.id, tag_id: DATASET.tag.id },
    ], 500)));
}

async function openPublished(page: Page, theme: 'light' | 'dark') {
  const response = await openRoute(page, theme, POST_URL);
  expect(response?.status(), '已发布详情页 SSR 应返回 200，而不是软 404').toBe(200);
  await expect(page.locator('header.post-hero h1')).toBeVisible();
  return response;
}

function expectCleanErrors(errors: ErrorBucket, tag: string, allow: RegExp[] = []) {
  expect(errors.pageErrors, `${tag} 出现 pageerror`).toEqual([]);
  const unexpected = unexpectedConsoleErrors(errors).filter((text) => !allow.some((re) => re.test(text)));
  expect(unexpected, `${tag} 出现非预期 console.error: ${unexpected.join(' | ')}`).toEqual([]);
}

test('@reading-populated R1 已发布正文与作者回退来自真实 SSR 取数', async ({ page, request }, testInfo) => {
  const errors = collectErrors(page);
  await mockReadingBrowserApis(page);
  const project = testInfo.project.name;
  await openPublished(page, themeOf(project));

  const hero = page.locator('header.post-hero');
  await expect(page.getByRole('heading', { level: 1, name: DATASET.publishedPost.title })).toBeVisible();
  await expect(hero.getByText(DATASET.publishedPost.excerpt, { exact: true })).toBeVisible();

  // 正文（已发布，非草稿）：真实 content 里的段落与 h2/h3 都渲染出来。
  const prose = page.locator('.reveal-content');
  await expect(prose).toBeVisible();
  await expect(prose.locator('p').first()).toContainText('SSR 在请求时真实取数并渲染');
  await expect(prose.locator('h2').filter({ hasText: '一、轨道与读数' })).toBeVisible();
  await expect(prose.locator('h3').filter({ hasText: '1.1 观测窗口' })).toBeVisible();
  await expect(prose).not.toContainText('DRAFT_BODY_SENTINEL');
  await expect(page.getByText('DRAFT_TITLE_SENTINEL')).toHaveCount(0);

  // 作者回退：夹具文章 expand=null，作者名只可能来自 /api/public/authors/:id。
  await expect(hero.getByText(AUTHOR.name, { exact: true })).toBeVisible();
  await expect(hero.locator('time')).toContainText('2026年11月1日');
  await expect(hero.getByText(/\d+ 分钟阅读/)).toBeVisible();
  await expect(hero.getByText(`${DATASET.publishedPost.views} 次浏览`)).toBeVisible();

  const actions = page.getByRole('button', { name: '收藏', exact: true }).locator('xpath=..');
  await expect(actions.getByRole('button', { name: '点赞', exact: true })).toHaveText(
    String(DATASET.publishedPost.likes),
  );
  await expect(page.getByRole('button', { name: '收藏', exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: '复制链接' })).toBeVisible();

  // 证据链：SSR 真的按 slug+published 过滤取数，并调用了公开作者接口。
  const log = await (await request.get(`${PB_BASE}/__requests`)).json();
  const urls: string[] = log.requests.map((entry: { url: string }) => entry.url);
  expect(
    urls.some((url) => url.startsWith('/api/collections/posts/records') && url.includes('status%3D%22published%22')),
    `SSR 未按 published 过滤取数：${urls.join(', ')}`,
  ).toBe(true);
  expect(
    urls.some((url) => url.startsWith(`/api/public/authors/${AUTHOR.id}`)),
    `SSR 未走作者回退：${urls.join(', ')}`,
  ).toBe(true);
  // 只审计本验收进程的请求。仓库里同时有别的 agent 在跑 4329 端口的页面，
  // 它们的浏览器会连到共享的 8199 夹具（实测 referer=http://127.0.0.1:4329/），
  // 属于外部噪声，不是本套件的数据泄漏或静默 404。
  const ourUnmatched = (log.unmatched as Array<{ url: string; referer: string }>).filter(
    (entry) => !entry.referer || entry.referer.startsWith(BASE_URL),
  );
  expect(
    ourUnmatched,
    `夹具出现本套件未覆盖的请求：${JSON.stringify(ourUnmatched)}（外部请求：${JSON.stringify(
      (log.unmatched as Array<{ url: string; referer: string }>).length - ourUnmatched.length,
    )} 条）`,
  ).toEqual([]);

  await expectNoHorizontalOverflow(page, 'R1 已发布详情');
  await scrollThrough(page);
  await page.evaluate(() => window.scrollTo(0, 0));
  await page.waitForTimeout(400);
  await page.screenshot({
    path: join(SHOTS, `reading-${project}.png`),
    fullPage: true,
    animations: 'disabled',
  });

  expectCleanErrors(errors, 'R1 已发布详情');
});

test('@reading-populated R2 目录：桌面侧栏/移动端展开 + 锚点跳转，无横向溢出', async ({ page }, testInfo) => {
  const errors = collectErrors(page);
  await mockReadingBrowserApis(page);
  const project = testInfo.project.name;
  const mobile = isMobileProject(project);
  await openPublished(page, themeOf(project));

  const headingTexts = ['一、轨道与读数', '1.1 观测窗口', '二、评论与互动', '2.1 审核边界'];

  if (mobile) {
    // 移动端目录由 client:idle 水合后才从「桌面侧栏」切换为「目录」按钮。
    // 页面上有两份目录岛：移动端那份（lg:hidden）+ 桌面侧栏那份（hidden lg:block）。
    // 移动端水合后两者都会渲染同名按钮，只有移动端容器里的那个可见。
    const toggle = page.locator('button[aria-controls="toc-mobile-panel"]:visible');
    await expect(toggle).toBeVisible();
    await expect(toggle).toHaveAttribute('aria-expanded', 'false');
    await toggle.click();
    await expect(toggle).toHaveAttribute('aria-expanded', 'true');

    const panel = page.locator('#toc-mobile-panel');
    await expect(panel).toBeVisible();
    for (const text of headingTexts) {
      const link = panel.getByRole('link', { name: text });
      await expect(link).toBeVisible();
      await expect(link).toHaveAttribute('href', /^#heading-\d+$/);
    }
    await expectNoHorizontalOverflow(page, 'R2 移动端目录展开');
    await page.screenshot({
      path: join(SHOTS, `toc-open-${project}.png`),
      animations: 'disabled',
    });

    const link = panel.getByRole('link', { name: '1.1 观测窗口' });
    const target = await link.getAttribute('href');
    expect(target).toBeTruthy();
    await expect(page.locator(target!)).toHaveCount(1);
    await expect(page.locator(target!)).toHaveText('1.1 观测窗口');

    // 从页面顶部开始，确保点击前目标标题不在视口内，下面的「进入视口」才有意义。
    await page.evaluate(() => window.scrollTo(0, 0));
    await expect(page.locator(target!)).not.toBeInViewport();

    await link.click();
    await expect(toggle).toHaveAttribute('aria-expanded', 'false');

    // 竞态回归（task-reading-browser-report.md §7.1）：旧实现在同一 handler 里
    // 先 scrollIntoView({behavior:'smooth'}) 再 setMobileOpen(false)，面板收起
    // 卸载被点击的链接会取消平滑滚动，页面停在顶部。现在应当等面板收起后再滚动，
    // 因此这里恢复强断言：目标标题必须真的进入视口。
    await expect(page.locator(target!)).toBeInViewport();
  } else {
    const aside = page.locator('aside').filter({ hasText: 'Contents / 目录' });
    await expect(aside).toBeVisible();
    for (const text of headingTexts) {
      await expect(aside.getByRole('link', { name: text })).toBeVisible();
    }
    const link = aside.getByRole('link', { name: '二、评论与互动' });
    const target = await link.getAttribute('href');
    expect(target).toBeTruthy();
    await link.click();
    await expect(page.locator(target!)).toBeInViewport();
    await expectNoHorizontalOverflow(page, 'R2 桌面目录');
    await page.screenshot({
      path: join(SHOTS, `toc-${project}.png`),
      fullPage: true,
      animations: 'disabled',
    });
  }

  expectCleanErrors(errors, 'R2 目录');
});

test('@reading-populated R3 评论只展示 approved + 表单/互动加载', async ({ page }, testInfo) => {
  const errors = collectErrors(page);
  await mockReadingBrowserApis(page);
  const project = testInfo.project.name;
  await openPublished(page, themeOf(project));

  const comments = page
    .getByRole('heading', { name: '评论区' })
    .locator('xpath=ancestor::section[1]');
  await comments.scrollIntoViewIfNeeded();

  // approved 主评论 + approved 嵌套回复 = 2 条；pending / 已删除不得出现。
  await expect(comments.getByText('2 条评论', { exact: true })).toBeVisible({ timeout: 20_000 });
  await expect(comments.getByText(/APPROVED_ROOT/)).toBeVisible();
  await expect(comments.getByText(/APPROVED_REPLY/)).toBeVisible();
  await expect(comments.getByText(/PENDING_SENTINEL/)).toHaveCount(0);
  await expect(comments.getByText(/DELETED_SENTINEL/)).toHaveCount(0);
  await expect(comments.locator('article')).toHaveCount(2);

  // 评论表单加载
  await expect(comments.locator('#comment-content')).toBeVisible();
  await expect(comments.getByLabel('昵称')).toBeVisible();
  await expect(comments.getByLabel('邮箱（可选）')).toBeVisible();
  await expect(comments.getByRole('button', { name: '发表评论' })).toBeVisible();

  // 点赞 / 收藏 / 分享：游客点击点赞只提示登录，不做本地 +1。
  const actions = page.getByRole('button', { name: '收藏', exact: true }).locator('xpath=..');
  const like = actions.getByRole('button', { name: '点赞', exact: true });
  await expect(like).toHaveText(String(DATASET.publishedPost.likes));
  await like.click();
  await expect(page.getByRole('alert')).toContainText('请先登录后再点赞或收藏');
  await expect(like).toHaveText(String(DATASET.publishedPost.likes));

  const copy = page.getByRole('button', { name: '复制链接' });
  await copy.click();
  await expect(page.getByRole('button', { name: '链接已复制' })).toBeVisible();

  await expectNoHorizontalOverflow(page, 'R3 评论区');
  await comments.scrollIntoViewIfNeeded();
  await page.screenshot({
    path: join(SHOTS, `comments-${project}.png`),
    animations: 'disabled',
  });

  expectCleanErrors(errors, 'R3 评论区');
});

test('@reading-populated R4 草稿不可读：published 过滤返回真实 404', async ({ page }, testInfo) => {
  const errors = collectErrors(page);
  await mockReadingBrowserApis(page);
  await installStorage(page, themeOf(testInfo.project.name));

  const response = await page.goto(DRAFT_URL, { waitUntil: 'domcontentloaded' });
  expect(response?.status(), '草稿 slug 不能被当成已发布文章').toBe(404);
  expect(response?.statusText()).toBe('Not Found');
  await expect(page.getByRole('heading', { name: '文章不存在' })).toBeVisible();
  await expect(page.getByText('DRAFT_TITLE_SENTINEL')).toHaveCount(0);
  await expect(page.getByText('DRAFT_BODY_SENTINEL')).toHaveCount(0);
  await expect(page.locator('.reveal-content')).toHaveCount(0);

  await page.screenshot({
    path: join(SHOTS, `draft-404-${testInfo.project.name}.png`),
    animations: 'disabled',
  });

  // 直接命中 404 文档本身，浏览器必然记录一条 404 资源错误；只放行这一条。
  expectCleanErrors(errors, 'R4 草稿 404', [/status of 404/]);
});

test('@reading-populated R5 标签不存在 404；存在的标签仍可读', async ({ page }, testInfo) => {
  const errors = collectErrors(page);
  await mockReadingBrowserApis(page);
  const theme = themeOf(testInfo.project.name);
  await installStorage(page, theme);

  const missing = await page.goto(`/tags/${DATASET.missingTagSlug}`, { waitUntil: 'domcontentloaded' });
  expect(missing?.status(), '不存在的标签应返回真实 404').toBe(404);
  await expect(page.getByText('标签不存在', { exact: true }).first()).toBeVisible();
  await expect(page.getByRole('link', { name: '返回标签列表' })).toBeVisible();
  await page.screenshot({
    path: join(SHOTS, `tag-404-${testInfo.project.name}.png`),
    animations: 'disabled',
  });

  // 同一轮里存在的标签必须是 200 且能加载文章，证明 404 不是「环境全挂」。
  const known = await page.goto(`/tags/${DATASET.tag.slug}`, { waitUntil: 'domcontentloaded' });
  expect(known?.status(), '存在的标签应返回 200').toBe(200);
  await expect(page.getByRole('heading', { name: DATASET.tag.name })).toBeVisible();
  await page.locator('#tag-posts-title').scrollIntoViewIfNeeded();
  await expect(
    page.getByRole('link', { name: `阅读文章：${DATASET.publishedPost.title}` }),
  ).toBeVisible({ timeout: 20_000 });

  expectCleanErrors(errors, 'R5 标签', [/status of 404/]);
});

test.describe('@reading-populated R6 320px 窄屏', () => {
  test.use({ viewport: { width: 320, height: 900 } });

  test('R6 阅读页与移动端目录在 320px 无横向溢出', async ({ page }, testInfo) => {
    test.skip(testInfo.project.name !== 'mobile-light', '320px 只在 mobile-light 采样一次');
    const errors = collectErrors(page);
    await mockReadingBrowserApis(page);
    await openPublished(page, themeOf(testInfo.project.name));

    // 页面上有两份目录岛：移动端那份（lg:hidden）+ 桌面侧栏那份（hidden lg:block）。
    // 移动端水合后两者都会渲染同名按钮，只有移动端容器里的那个可见。
    const toggle = page.locator('button[aria-controls="toc-mobile-panel"]:visible');
    await expect(toggle).toBeVisible();
    await toggle.click();
    await expect(page.locator('#toc-mobile-panel')).toBeVisible();
    await expectNoHorizontalOverflow(page, 'R6 320px 移动目录');
    await page.screenshot({
      path: join(SHOTS, 'reading-320-mobile-light.png'),
      animations: 'disabled',
    });

    expectCleanErrors(errors, 'R6 320px');
  });
});
