import { defineConfig } from '@playwright/test';
import path from 'node:path';

/**
 * 全站科幻简约改造 · 浏览器验收套件配置。
 *
 * 运行方式：
 *   cd astro
 *   ALLOW_LOCALHOST_SITE=1 npm run build
 *   npx playwright test --config e2e/sci-fi-site/playwright.config.ts
 *
 * 设计说明：
 * - 不连真实 PocketBase。浏览器侧的 PB 请求由 fixtures 的 route mock 拦截；
 *   SSR 侧的 PB_SERVER_URL 指向一个「不监听」的本地端口（默认 8199），
 *   从而稳定复现「空数据」与「PB 不可达」两种状态。
 * - 由 Playwright 独占拉起/回收 dist/server/entry.mjs，reuseExistingServer=false，
 *   端口被占用即失败退出，不会影响其它正在运行的服务。
 * - 4 个 project 覆盖 桌面/移动 × 浅色/深色，与设计规格的验收矩阵一致。
 *
 * 注意：astro/package.json 为 type=module，本文件按 ESM 加载，
 * 因此用 import.meta.dirname（Node >= 22）而不是 __dirname。
 */
const SITE_DIR = import.meta.dirname;
const ASTRO_DIR = path.join(SITE_DIR, '..', '..');
const PORT = Number(process.env.SCI_FI_E2E_PORT ?? 4338);
const BASE_URL = `http://127.0.0.1:${PORT}`;

export default defineConfig({
  testDir: SITE_DIR,
  outputDir: path.join(ASTRO_DIR, 'test-results', 'sci-fi-site'),
  timeout: 90_000,
  expect: { timeout: 10_000 },
  fullyParallel: false,
  workers: 1,
  retries: 1,
  forbidOnly: true,
  reporter: [['list']],
  use: {
    baseURL: BASE_URL,
    serviceWorkers: 'block',
    locale: 'zh-CN',
    timezoneId: 'Asia/Shanghai',
    screenshot: 'only-on-failure',
    trace: 'retain-on-failure',
    video: 'off',
    launchOptions: { args: ['--force-color-profile=srgb'] },
  },
  webServer: {
    // 先校验 dist 不比 src 旧，避免验收对着旧构建「全绿」。
    command: 'node scripts/assert-fresh-dist.mjs && node dist/server/entry.mjs',
    cwd: ASTRO_DIR,
    url: `${BASE_URL}/login`,
    reuseExistingServer: false,
    timeout: 120_000,
    env: {
      NODE_ENV: 'production',
      HOST: '127.0.0.1',
      PORT: String(PORT),
      PB_SERVER_URL: 'http://127.0.0.1:8199',
      PUBLIC_POCKETBASE_URL: 'http://127.0.0.1:8199',
    },
  },
  projects: [
    { name: 'desktop-light', use: { viewport: { width: 1440, height: 900 }, colorScheme: 'light' } },
    { name: 'desktop-dark', use: { viewport: { width: 1440, height: 900 }, colorScheme: 'dark' } },
    { name: 'mobile-light', use: { viewport: { width: 390, height: 844 }, colorScheme: 'light', isMobile: true, hasTouch: true } },
    { name: 'mobile-dark', use: { viewport: { width: 390, height: 844 }, colorScheme: 'dark', isMobile: true, hasTouch: true } },
  ],
});
