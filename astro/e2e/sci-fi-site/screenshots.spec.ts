/**
 * F 组：人工过目截图（不做像素门禁）。
 * 桌面/移动 × light/dark 的首页与登录页，输出到 tmp/sci-fi-visual/shots/。
 */
import { test } from '@playwright/test';
import { join } from 'node:path';
import { SHOTS, isMobileProject, mockPocketBase, openRoute, scrollThrough, themeOf } from './fixtures';

for (const [path, name] of [['/', 'home'], ['/login', 'login']] as const) {
  test(`@shots ${name} 截图`, async ({ page }, testInfo) => {
    const theme = themeOf(testInfo.project.name);
    const viewport = isMobileProject(testInfo.project.name) ? 'mobile' : 'desktop';
    await mockPocketBase(page);
    await openRoute(page, theme, path);
    // 先滚一遍触发 client:visible 水合，避免整页截图停在骨架/空白态
    await scrollThrough(page);
    await page.evaluate(() => window.scrollTo(0, 0));
    await page.waitForTimeout(800);
    await page.screenshot({
      path: join(SHOTS, `${name}-${viewport}-${theme}.png`),
      fullPage: name === 'home',
      animations: 'disabled',
    });
  });
}

/**
 * 320 / 768 / 1024 三个关键视口的首页人工过目截图。
 * 只在 desktop-light project 采样一次（test.use 覆盖视口），避免 4 project × 3 视口重复。
 * 文件名带宽度与主题，避免覆盖默认 project 截图。
 */
const KEY_VIEWPORTS = [
  { width: 320, height: 900 },
  { width: 768, height: 1024 },
  { width: 1024, height: 768 },
] as const;

for (const viewport of KEY_VIEWPORTS) {
  test.describe(`@shots 首页 ${viewport.width}px`, () => {
    test.use({ viewport });

    for (const theme of ['light', 'dark'] as const) {
      test(`${viewport.width}px · ${theme}`, async ({ page }, testInfo) => {
        test.skip(testInfo.project.name !== 'desktop-light', '关键视口只采样一次');
        await mockPocketBase(page);
        await openRoute(page, theme, '/');
        await scrollThrough(page);
        await page.evaluate(() => window.scrollTo(0, 0));
        await page.waitForTimeout(800);
        await page.screenshot({
          path: join(SHOTS, `home-${viewport.width}-${theme}.png`),
          fullPage: true,
          animations: 'disabled',
        });
      });
    }
  });
}
