/**
 * A 组：全站不变量（每条公开路由 × 4 project）。
 * A1 响应 / A2 可见 h1 / A3 控制台 / A4 三段溢出 / A6 令牌生效 / A8 画布色。
 */
import { test, expect } from '@playwright/test';
import {
  CANVAS_RGB,
  PUBLIC_ROUTES,
  TOKENS,
  collectErrors,
  expectCleanErrors,
  expectNoHorizontalOverflow,
  mockPocketBase,
  normalizedHex,
  openRoute,
  scrollThrough,
  themeOf,
  tokenSnapshot,
} from './fixtures';

for (const route of PUBLIC_ROUTES) {
  test(`@invariant ${route} 响应/可见 h1/控制台/溢出/令牌/画布`, async ({ page }, testInfo) => {
    const theme = themeOf(testInfo.project.name);
    const tag = `${route} @ ${testInfo.project.name}`;
    const errors = collectErrors(page);
    await mockPocketBase(page);

    const response = await openRoute(page, theme, route);
    expect(response?.status(), `${tag} HTTP 状态`).toBe(200);

    // A2：恰好 1 个可见 h1
    await expect(page.locator('h1:visible'), `${tag} 可见 h1 数量`).toHaveCount(1);

    // 滚动一遍，触发 client:visible 水合后再做布局/错误断言（避免漏掉水合后溢出）
    await scrollThrough(page);

    // A8：页面画布色 = 规格 canvas
    const snapshot = await tokenSnapshot(page);
    expect(snapshot.bodyBackground, `${tag} body 画布色`).toBe(CANVAS_RGB[theme]);
    expect(snapshot.htmlClasses.includes('dark'), `${tag} html.dark 与主题`).toBe(theme === 'dark');

    // A6：关键令牌取值与规格一致
    for (const [name, expected] of Object.entries(TOKENS[theme])) {
      expect(normalizedHex(snapshot.tokens[name] ?? ''), `${tag} 令牌 ${name}`).toBe(expected);
    }

    // A4 三段溢出
    await expectNoHorizontalOverflow(page, tag);

    // A3 控制台：pageerror 必须为空；console.error 只允许预期 PB/network 失败
    expectCleanErrors(errors, tag);
  });
}
