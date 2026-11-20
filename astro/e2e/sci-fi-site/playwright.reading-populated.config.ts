import { defineConfig } from '@playwright/test';
import path from 'node:path';

/**
 * Task D · 阅读详情「有真实数据」浏览器验收配置（独立于 sci-fi-site 主配置）。
 *
 * 与主配置的差别只有数据层：
 * - 主配置把 SSR 的 PB_SERVER_URL 指向一个不监听端口，只覆盖「文章不存在」；
 * - 本配置在 8199 拉起只读 Node PocketBase 夹具（posts / public authors / tags /
 *   announcements / SSE 传输），SSR 4338 指向它，于是已发布文章、作者回退、
 *   TOC 与 404 分支都能对着同一份夹具数据验证。
 * - 浏览器侧数据面由 spec 内的 route mock 提供（settings / public_comments /
 *   posts 列表），实时评论的 SSE 交给 8199 夹具真实维持。
 *
 * 运行（webServer 会自己执行构建，构建期内联浏览器 PB 地址 = 夹具端口）：
 *   npx playwright test --config e2e/sci-fi-site/playwright.reading-populated.config.ts
 *
 * 两个 webServer 均 reuseExistingServer=false：端口被占用即失败退出，
 * 不会误连到别的服务，也不会把「连错数据源」当成通过。
 */
const SITE_DIR = import.meta.dirname;
const ASTRO_DIR = path.join(SITE_DIR, '..', '..');
const PORT = Number(process.env.READING_E2E_PORT ?? 4338);
const PB_PORT = Number(process.env.READING_FIXTURE_PORT ?? 8199);
const BASE_URL = `http://127.0.0.1:${PORT}`;
const PB_URL = `http://127.0.0.1:${PB_PORT}`;

export default defineConfig({
  testDir: SITE_DIR,
  // 只跑本任务新增的 spec，避免把主配置的用例重复跑一遍。
  testMatch: /reading-populated\.spec\.ts/,
  outputDir: path.join(ASTRO_DIR, 'test-results', 'reading-populated'),
  timeout: 90_000,
  expect: { timeout: 10_000 },
  fullyParallel: false,
  workers: 1,
  retries: 0,
  forbidOnly: true,
  reporter: [['list']],
  use: {
    baseURL: BASE_URL,
    serviceWorkers: 'block',
    locale: 'zh-CN',
    timezoneId: 'Asia/Shanghai',
    // 分享按钮的「复制链接」只有在 clipboard 可写时才会切到「已复制」；
    // 127.0.0.1 属于安全上下文，显式授权让该断言可重复。
    permissions: ['clipboard-read', 'clipboard-write'],
    screenshot: 'only-on-failure',
    trace: 'retain-on-failure',
    video: 'off',
    launchOptions: { args: ['--force-color-profile=srgb'] },
  },
  webServer: [
    {
      command: 'node e2e/sci-fi-site/reading-populated-pb-fixture.mjs',
      cwd: ASTRO_DIR,
      url: `${PB_URL}/health`,
      reuseExistingServer: false,
      timeout: 30_000,
      env: {
        READING_FIXTURE_PORT: String(PB_PORT),
      },
    },
    {
      // 先校验 dist 不比 src 旧，避免对着旧构建「全绿」；
      // 再把 dist 复制到独立目录后启动，避免其它 agent 并发 `npm run build`
      // 原地改写 dist 时，运行中的 SSR 把 /_astro/* 读成 500（实测过的噪声来源）。
      // 构建、校验、复制、启动都在 webServer 里一次完成：
      // 仓库里多个 agent 并发改 src/build，若复用外部预先构建的 dist，
      // 从构建到断言之间仍可能被别人改旧（实测 2~25s 的竞态）。
      command:
        'ALLOW_LOCALHOST_SITE=1 PUBLIC_POCKETBASE_URL=http://127.0.0.1:8199 npm run build && node scripts/assert-fresh-dist.mjs && node e2e/sci-fi-site/reading-populated-prepare-dist.mjs && node tmp/reading-populated/dist/server/entry.mjs',
      cwd: ASTRO_DIR,
      url: `${BASE_URL}/login`,
      reuseExistingServer: false,
      timeout: 120_000,
      env: {
        NODE_ENV: 'production',
        HOST: '127.0.0.1',
        PORT: String(PORT),
        PB_SERVER_URL: PB_URL,
        PUBLIC_POCKETBASE_URL: PB_URL,
        TZ: 'Asia/Shanghai',
      },
    },
  ],
  // 至少覆盖 desktop light / desktop dark / mobile light；mobile dark 一并保留，
  // 让目录与评论区的深色态也有截图证据。
  projects: [
    { name: 'desktop-light', use: { viewport: { width: 1440, height: 900 }, colorScheme: 'light' } },
    { name: 'desktop-dark', use: { viewport: { width: 1440, height: 900 }, colorScheme: 'dark' } },
    { name: 'mobile-light', use: { viewport: { width: 390, height: 844 }, colorScheme: 'light', isMobile: true, hasTouch: true } },
    { name: 'mobile-dark', use: { viewport: { width: 390, height: 844 }, colorScheme: 'dark', isMobile: true, hasTouch: true } },
  ],
});
