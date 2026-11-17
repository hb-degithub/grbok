/**
 * 空 PB / 错误态专项。
 * 1) 空 PB 的 SSR 层：骨架占位、SSR 空态文案、SSR 计数为整数 0；
 * 2) 空 PB 的浏览器层：mock 空列表后收敛为 EMPTY 空态；
 * 3) 真实 PB 不可达：浏览器进入 ERR 错误态，且 console.error 只能是预期网络失败。
 */
import { test, expect } from '@playwright/test';
import { EXPECTED_CONSOLE_ERRORS, collectErrors, expectCleanErrors, mockPocketBase, openRoute, scrollThrough, themeOf } from './fixtures';

test('@pb-state 空 PB 的 SSR：骨架占位 + 服务端空态 + 计数为整数 0', async ({ request }) => {
  const home = await (await request.get('/')).text();
  expect(home, '首页 SSR 应输出 PostList 骨架占位').toContain('aria-label="加载中"');
  expect(home, '首页 SSR 应包含文章/标签统计标签').toContain('已发布文章');
  expect(home).toContain('内容标签');
  const ssrCounts = [...home.matchAll(/tabular-nums">(\d+)<\/span>/g)].map((m) => m[1]);
  expect(ssrCounts.length, '首页 SSR 应渲染两个统计数字').toBeGreaterThanOrEqual(2);
  for (const value of ssrCounts.slice(0, 2)) {
    expect(value, '空 PB 下 SSR 计数应为 0').toBe('0');
  }

  const posts = await (await request.get('/posts')).text();
  expect(posts, '/posts SSR 应输出骨架占位').toContain('aria-label="加载中"');

  const tags = await (await request.get('/tags')).text();
  expect(tags, '/tags SSR 空态').toContain('暂无标签');

  const archive = await (await request.get('/archive')).text();
  expect(archive, '/archive SSR 空态').toContain('暂无归档文章');
});

test('@pb-state 空 PB 的浏览器层：/posts 与首页收敛为 EMPTY 空态', async ({ page }, testInfo) => {
  const errors = collectErrors(page);
  await mockPocketBase(page);

  await openRoute(page, themeOf(testInfo.project.name), '/posts');
  await scrollThrough(page);
  await expect(page.locator('main')).toContainText('EMPTY / 0', { timeout: 15_000 });
  await expect(page.locator('main')).toContainText('暂无文章');
  await expect(page.getByRole('alert')).toHaveCount(0);
  expectCleanErrors(errors, '空 PB /posts');

  await openRoute(page, themeOf(testInfo.project.name), '/');
  await page.locator('section#latest').scrollIntoViewIfNeeded();
  await expect(page.locator('section#latest')).toContainText('EMPTY / 0', { timeout: 15_000 });
  await expect(page.locator('section#latest')).toContainText('暂无文章');
  expectCleanErrors(errors, '空 PB 首页');
});

test('@pb-state PB 不可达：/posts 进入 ERR 错误态（预期网络失败）', async ({ page }, testInfo) => {
  // 故意不 mock：构建期内联的 localhost:8090 无监听 → 确定性失败
  const errors = collectErrors(page);
  await openRoute(page, themeOf(testInfo.project.name), '/posts');
  await page.evaluate(async () => {
    window.scrollTo(0, document.documentElement.scrollHeight);
    await new Promise((resolve) => setTimeout(resolve, 300));
  });

  const alert = page.getByRole('alert');
  await expect(alert).toBeVisible({ timeout: 20_000 });
  await expect(alert).toContainText('ERR / 取数失败');
  await expect(alert).toContainText('加载失败，请稍后重试');

  // 预期网络失败：pageerror 必须为空；console.error 全部命中允许清单
  expect(errors.pageErrors, 'PB 不可达不应产生 pageerror').toEqual([]);
  expect(errors.consoleErrors.length, '应出现网络失败日志').toBeGreaterThan(0);
  expect(errors.consoleErrors.filter((text) => !EXPECTED_CONSOLE_ERRORS.some((re) => re.test(text))),
    'PB 不可达只允许预期网络失败日志').toEqual([]);
});
