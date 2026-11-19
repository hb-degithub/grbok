/**
 * F 组：人工过目截图（不做像素门禁）。
 *
 * 输出目录：
 * - 默认 `tmp/sci-fi-visual/shots/`（旧临时验收目录）；
 * - 可用 `SCI_FI_SHOTS_DIR` 覆盖，Task 5 首期验收写入
 *   `astro/artifacts/orbital-log/home/`（Playwright 不清理该目录，截图不提交）。
 *
 * 关键视口矩阵固定为 320 / 390 / 768 / 1024 / 1440 × 明暗，共 10 张首页截图。
 */
import { test } from '@playwright/test';
import { mkdirSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { ARTIFACTS, isMobileProject, mockPocketBase, openRoute, scrollThrough, themeOf } from './fixtures';

const SHOTS = process.env.SCI_FI_SHOTS_DIR
  ? resolve(process.env.SCI_FI_SHOTS_DIR)
  : join(ARTIFACTS, 'shots');

// Playwright 会为 screenshot 创建父目录，但显式创建让 SCI_FI_SHOTS_DIR 缺失时也能给出清晰错误。
mkdirSync(SHOTS, { recursive: true });

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
 * 320 / 390 / 768 / 1024 / 1440 五个关键视口的首页人工过目截图。
 * 只在 desktop-light project 采样一次（test.use 覆盖视口），避免 4 project 重复。
 * 文件名带宽度与主题，避免覆盖默认 project 截图。
 */
const KEY_VIEWPORTS = [
  { width: 320, height: 900 },
  { width: 390, height: 844 },
  { width: 768, height: 1024 },
  { width: 1024, height: 768 },
  { width: 1440, height: 900 },
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
