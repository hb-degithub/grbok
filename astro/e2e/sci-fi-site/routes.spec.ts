/**
 * B 组：路由级基本渲染（空 PB + 浏览器空态）。
 * 断言分两层：SSR 直出结构（page.request）与浏览器水合后的空/骨架/错误态。
 */
import { test, expect } from '@playwright/test';
import {
  collectErrors,
  expectCleanErrors,
  installStorage,
  mockPocketBase,
  openRoute,
  scrollThrough,
  themeOf,
} from './fixtures';

test('@route B1 首页：品牌/Hero/主 CTA/最新文章三态/统计整数', async ({ page }, testInfo) => {
  const errors = collectErrors(page);
  await mockPocketBase(page);
  await openRoute(page, themeOf(testInfo.project.name), '/');

  await expect(page.locator('h1:visible')).toHaveText('胡巴的博客');
  await expect(page.locator('main')).toContainText('分享技术、思考与生活。把折腾过的东西写清楚。');

  const cta = page.locator('main a[href="/posts"]').first();
  await expect(cta).toBeVisible();
  await expect(cta).toContainText('浏览全部文章');

  await expect(page.locator('section#latest')).toBeVisible();

  // 统计数字为整数（空 PB 下 SSR 计数为 0，不断言具体值）。
  // 用语义标签定位，不依赖 Tailwind 工具类名。
  for (const label of ['已发布文章', '内容标签']) {
    const block = page.getByText(label, { exact: true }).locator('..');
    await expect(block).toBeVisible();
    await expect(block).toContainText(/\d+/);
    const value = (await block.innerText()).match(/\d+/)?.[0] ?? '';
    expect(value, `${label} 应为整数`).toMatch(/^\d+$/);
  }

  // client:visible 水合后：#latest 出现空态（mock 空数据）
  await scrollThrough(page);
  await expect(page.locator('section#latest')).toContainText('暂无文章', { timeout: 15_000 });

  expectCleanErrors(errors, 'B1 首页');
});

test('@route B2 /posts：所有文章 + 空态', async ({ page }, testInfo) => {
  const errors = collectErrors(page);
  await mockPocketBase(page);
  await openRoute(page, themeOf(testInfo.project.name), '/posts');

  await expect(page.locator('h1:visible')).toHaveText('所有文章');
  await scrollThrough(page);
  await expect(page.locator('main')).toContainText('暂无文章', { timeout: 15_000 });

  expectCleanErrors(errors, 'B2 /posts');
});

test('@route B3 /tags：标签分类 + 空态', async ({ page }, testInfo) => {
  const errors = collectErrors(page);
  await mockPocketBase(page);
  await openRoute(page, themeOf(testInfo.project.name), '/tags');

  await expect(page.locator('h1:visible')).toHaveText('标签分类');
  await expect(page.locator('main')).toContainText('暂无标签');

  expectCleanErrors(errors, 'B3 /tags');
});

test('@route B4 /archive：文章归档 + 空态', async ({ page }, testInfo) => {
  const errors = collectErrors(page);
  await mockPocketBase(page);
  await openRoute(page, themeOf(testInfo.project.name), '/archive');

  await expect(page.locator('h1:visible')).toHaveText('文章归档');
  await expect(page.locator('main')).toContainText('暂无归档文章');

  expectCleanErrors(errors, 'B4 /archive');
});

test('@route B5 /about：关于博客 + Tech/Feature 按钮契约', async ({ page }, testInfo) => {
  const errors = collectErrors(page);
  await mockPocketBase(page);
  await openRoute(page, themeOf(testInfo.project.name), '/about');

  await expect(page.locator('h1:visible')).toHaveText('关于博客');

  const techButtons = page.locator('button[aria-controls^="tech-detail-"]');
  const featureButtons = page.locator('button[aria-controls^="feature-detail-"]');
  expect(await techButtons.count()).toBeGreaterThanOrEqual(1);
  expect(await featureButtons.count()).toBeGreaterThanOrEqual(1);
  await expect(techButtons.first()).toHaveAttribute('aria-expanded', 'false');
  const controls = await techButtons.first().getAttribute('aria-controls');
  expect(controls && controls.length > 0).toBeTruthy();

  expectCleanErrors(errors, 'B5 /about');
});

test('@route B6 /links：友情链接 + 友链空态', async ({ page }, testInfo) => {
  const errors = collectErrors(page);
  await mockPocketBase(page);
  await openRoute(page, themeOf(testInfo.project.name), '/links');

  await expect(page.locator('h1:visible')).toHaveText('友情链接');
  await expect(page.locator('main')).toContainText('申请友链');

  await scrollThrough(page);
  await expect(page.locator('main')).toContainText('暂无友链', { timeout: 15_000 });

  expectCleanErrors(errors, 'B6 /links');
});

test('@route B7 /guestbook：留言板 + 表单 + 空态', async ({ page }, testInfo) => {
  const errors = collectErrors(page);
  await mockPocketBase(page);
  await openRoute(page, themeOf(testInfo.project.name), '/guestbook');

  await expect(page.locator('h1:visible')).toHaveText('留言板');
  await expect(page.locator('main textarea')).toBeVisible();

  await scrollThrough(page);
  await expect(page.locator('main')).toContainText('还没有留言，来抢沙发～', { timeout: 15_000 });

  expectCleanErrors(errors, 'B7 /guestbook');
});

test('@route B8 /gallery：相册 + 空态', async ({ page }, testInfo) => {
  const errors = collectErrors(page);
  await mockPocketBase(page);
  await openRoute(page, themeOf(testInfo.project.name), '/gallery');

  await expect(page.locator('h1:visible')).toHaveText('相册');
  await scrollThrough(page);
  await expect(page.locator('main')).toContainText('相册还是空的', { timeout: 15_000 });

  expectCleanErrors(errors, 'B8 /gallery');
});

test('@route B9 /login：欢迎标题 + 三个认证 tab', async ({ page }, testInfo) => {
  const errors = collectErrors(page);
  await mockPocketBase(page);
  await openRoute(page, themeOf(testInfo.project.name), '/login');

  await expect(page.locator('h1:visible')).toHaveText('欢迎来到博客');
  await expect(page.getByRole('tablist', { name: '认证方式' })).toBeVisible();
  await expect(page.getByRole('tab')).toHaveCount(3);
  await expect(page.getByRole('tab')).toHaveText(['密码登录', '验证码', '注册']);

  expectCleanErrors(errors, 'B9 /login');
});

test('@route B10 /admin：200 + SSR 无后台数据正文 + 水合后收敛到 /login', async ({ page }, testInfo) => {
  const errors = collectErrors(page);
  await installStorage(page, themeOf(testInfo.project.name)); // 跳过 WelcomeOverlay（自带一个 h1）
  await mockPocketBase(page);
  const response = await page.goto('/admin', { waitUntil: 'domcontentloaded' });
  expect(response?.status(), '/admin 状态（客户端守卫，服务端 200 是设计）').toBe(200);

  await page.waitForURL(/\/login$/, { timeout: 20_000 });
  await expect(page.locator('#auth-heading')).toHaveText('欢迎来到博客');
  // 跳转后 DOM 中不存在后台壳（client:only + 未登录）
  expect(await page.locator('.admin-shell').count(), '跳转后 .admin-shell 数量').toBe(0);

  expectCleanErrors(errors, 'B10 /admin');
});
