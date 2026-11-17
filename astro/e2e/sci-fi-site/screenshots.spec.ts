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
