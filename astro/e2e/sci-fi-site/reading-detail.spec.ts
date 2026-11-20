/**
 * G 组：文章详情（阅读路径）浏览器验收。
 *
 * 本套件按设计不 mock SSR 侧的 PocketBase 源站，而详情页正文依赖 SSR 取数，
 * 因此在「无 PB」的验收环境里只能稳定覆盖「文章不存在」分支。
 * 正文排版、目录锚点、评论 live region 等由 jsdom 组件测试
 * （src/components/comments/__tests__、src/components/posts/__tests__）
 * 与静态契约测试覆盖，这里不重复模拟。
 */
import { test, expect } from '@playwright/test';
import {
  collectErrors,
  expectNoHorizontalOverflow,
  installStorage,
  mockPocketBase,
  themeOf,
  unexpectedConsoleErrors,
} from './fixtures';

test('@reading R1 文章不存在：真实 404 状态 + 可读返回路径', async ({ page }, testInfo) => {
  const errors = collectErrors(page);
  await mockPocketBase(page);
  await installStorage(page, themeOf(testInfo.project.name));

  // 不用 openRoute：需要拿到 SSR 响应状态码。加载遮罩已由 installStorage 跳过。
  const response = await page.goto('/posts/this-post-does-not-exist', { waitUntil: 'domcontentloaded' });
  expect(response?.status(), 'SSR 应返回真实 404 而不是软 404').toBe(404);
  expect(response?.statusText(), '404 应带标准状态文本而不是 404 OK').toBe('Not Found');

  await expect(page.locator('main#main-content')).toBeVisible();
  await expect(page.getByRole('heading', { name: '文章不存在' })).toBeVisible();
  await expect(page.getByText('该文章可能已被删除，或链接中的 slug 有误。')).toBeVisible();

  const backLinks = page.getByRole('link', { name: '返回文章列表' });
  const backCount = await backLinks.count();
  expect(backCount).toBeGreaterThanOrEqual(1);
  await expect(backLinks.first()).toBeVisible();

  // 404 分支不应渲染评论表单或正文容器
  await expect(page.locator('textarea#comment-content')).toHaveCount(0);
  await expect(page.locator('.reveal-content')).toHaveCount(0);

  await expectNoHorizontalOverflow(page, 'R1 文章 404');

  // 直接命中 404 文档本身时，浏览器必然把这次导航记成一条 404 资源错误；
  // 只放行这一条，其余（PB 连接失败之外的）console.error 仍算失败。
  expect(errors.pageErrors, 'R1 文章 404 出现 pageerror').toEqual([]);
  const unexpected = unexpectedConsoleErrors(errors).filter(
    (text) => !/status of 404/.test(text),
  );
  expect(unexpected, `R1 文章 404 出现非预期 console.error: ${unexpected.join(' | ')}`).toEqual([]);
});
