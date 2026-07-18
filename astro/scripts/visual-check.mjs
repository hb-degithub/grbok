#!/usr/bin/env node

// 视觉验证：多路由 × 多视口截图 + 控制台错误 + 水平溢出检测。
// 用法：npm run check:visual [-- --base-url http://127.0.0.1:4321]
// 截图输出到 astro/tmp-visual/<route>-<viewport>.png，需人工过目。

const DEFAULT_BASE_URL = 'http://127.0.0.1:4321';

const ROUTES = ['/', '/posts', '/tags', '/archive', '/about', '/stats', '/links', '/guestbook', '/gallery', '/projects', '/subscribe', '/login', '/404'];

const VIEWPORTS = [
  { name: '375x667', width: 375, height: 667 },
  { name: '768x1024', width: 768, height: 1024 },
  { name: '1024x768', width: 1024, height: 768 },
  { name: '1280x800', width: 1280, height: 800 },
  { name: '1440x900', width: 1440, height: 900 },
  { name: '1920x1080', width: 1920, height: 1080 },
  { name: '2560x1080', width: 2560, height: 1080 },
];

const OUT_DIR = new URL('../tmp-visual/', import.meta.url);

function parseBaseUrl(argv) {
  for (let i = 0; i < argv.length; i += 1) {
    if (argv[i] === '--base-url') return argv[i + 1] ?? process.env.BASE_URL ?? DEFAULT_BASE_URL;
    if (argv[i].startsWith('--base-url=')) return argv[i].slice('--base-url='.length);
  }
  return process.env.BASE_URL || DEFAULT_BASE_URL;
}

async function loadPlaywright() {
  for (const name of ['playwright', '@playwright/test']) {
    try {
      const mod = await import(name);
      const chromium = mod.chromium || mod.default?.chromium;
      if (chromium) return chromium;
    } catch (error) {
      const message = String(error?.message || '');
      if (!(error?.code === 'ERR_MODULE_NOT_FOUND' && message.includes(name))) throw error;
    }
  }
  return null;
}

function pageUrl(baseUrl, route) {
  const base = baseUrl.endsWith('/') ? baseUrl : `${baseUrl}/`;
  return new URL(route.replace(/^\//, ''), base).href;
}

async function scrollThrough(page) {
  await page.evaluate(
    () =>
      new Promise((resolve) => {
        let y = 0;
        const step = () => {
          y += window.innerHeight * 0.8;
          window.scrollTo(0, y);
          if (y < document.body.scrollHeight) {
            setTimeout(step, 60);
          } else {
            window.scrollTo(0, 0);
            setTimeout(resolve, 400);
          }
        };
        step();
      }),
  );
}

// 已知噪音（与本计划无关的既有/环境问题），过滤后任何新报错都会使检查失败：
// 1. SearchModal 以 classic script 加载 ESM pagefind.js 的 import.meta 语法错误（既有 bug）
// 2. 本地 preview 访问生产 PocketBase 的 CORS/网络错误（环境性）——网络错误仅在报文
//    引用 PocketBase 主机（hlydwz.com）时才豁免，不得用宽泛的 net::ERR / Failed to fetch 匹配
const NOISE_PATTERNS = [/import\.meta/i, /pagefind/i, /Access-Control-Allow-Origin/i, /CORS/i, /hlydwz\.com/i];
const isNoise = (text) => NOISE_PATTERNS.some((pattern) => pattern.test(text));

async function checkRoute(context, route, viewport, baseUrl, outDirPath) {
  const page = await context.newPage();
  const consoleErrors = [];
  page.on('console', (msg) => {
    if (msg.type() !== 'error') return;
    const text = msg.text();
    // Chromium 的 "Failed to load resource" 类消息文本不含 URL，URL 仅在 location 中；
    // 对两者都做主机收窄匹配，保持"仅豁免指向 PocketBase 主机的网络噪音"的语义
    const url = msg.location()?.url || '';
    if (!isNoise(text) && !isNoise(url)) consoleErrors.push(text);
  });
  page.on('pageerror', (err) => {
    const text = String(err);
    if (!isNoise(text)) consoleErrors.push(text);
  });

  try {
    const response = await page.goto(pageUrl(baseUrl, route), {
      waitUntil: 'domcontentloaded',
      timeout: 30000,
    });
    await page.waitForLoadState('networkidle', { timeout: 5000 }).catch(() => {});
    await page.waitForTimeout(1200); // 等入场动画与 client:visible 水合
    await scrollThrough(page);

    const status = response?.status() ?? 0;
    // astro preview 对 /404 路由本身返回 200（只有不存在的路径才返回 404），两种语义都接受
    const statusOk = route === '/404' ? status === 200 || status === 404 : status >= 200 && status < 400;

    const metrics = await page.evaluate(() => {
      const root = document.documentElement;
      const scrollWidth = Math.ceil(Math.max(root.scrollWidth, document.body?.scrollWidth || 0));
      const viewportWidth = Math.ceil(window.innerWidth);
      return { scrollWidth, viewportWidth, overflowBy: Math.max(0, scrollWidth - viewportWidth) };
    });

    const fileName = `${route === '/' ? 'home' : route.replace(/\//g, '').replace(/_/g, '-')}-${viewport.name}.png`;
    await page.screenshot({ path: `${outDirPath}/${fileName}` });

    return {
      route,
      viewport: viewport.name,
      status,
      statusOk,
      overflowBy: metrics.overflowBy,
      consoleErrors,
      passed: statusOk && metrics.overflowBy === 0 && consoleErrors.length === 0,
    };
  } catch (error) {
    return {
      route,
      viewport: viewport.name,
      status: '-',
      statusOk: false,
      overflowBy: '-',
      consoleErrors: [String(error?.message || error)],
      passed: false,
    };
  } finally {
    await page.close();
  }
}

async function main() {
  const baseUrl = parseBaseUrl(process.argv.slice(2));
  const { mkdirSync } = await import('node:fs');
  const { fileURLToPath } = await import('node:url');
  const outDirPath = fileURLToPath(OUT_DIR);
  mkdirSync(outDirPath, { recursive: true });

  const chromium = await loadPlaywright();
  if (!chromium) {
    console.error('Playwright 未安装，无法执行视觉验证。');
    process.exitCode = 1;
    return;
  }

  console.log(`Visual check → ${baseUrl}`);
  console.log(`Screenshots → ${outDirPath}\n`);

  const browser = await chromium.launch({ headless: true });
  const results = [];
  try {
    for (const viewport of VIEWPORTS) {
      const context = await browser.newContext({
        viewport: { width: viewport.width, height: viewport.height },
        deviceScaleFactor: 1,
        hasTouch: viewport.width < 768,
        isMobile: viewport.width < 768,
      });
      for (const route of ROUTES) {
        const result = await checkRoute(context, route, viewport, baseUrl, outDirPath);
        results.push(result);
        const flag = result.passed ? 'PASS' : 'FAIL';
        const extra = result.consoleErrors.length
          ? ` console:${result.consoleErrors[0].slice(0, 120)}`
          : '';
        console.log(
          `${flag} ${viewport.name} ${route} http=${result.status} overflow=${result.overflowBy}${extra}`,
        );
      }
      await context.close();
    }
  } finally {
    await browser.close();
  }

  const failures = results.filter((r) => !r.passed);
  console.log('');
  if (failures.length === 0) {
    console.log(`PASS: ${results.length} 项检查全部通过，请人工过目 tmp-visual/ 截图。`);
  } else {
    console.log(`FAIL: ${failures.length}/${results.length} 项失败，见上方明细。`);
    process.exitCode = 1;
  }
}

main().catch((error) => {
  console.error(error?.stack || error?.message || String(error));
  process.exitCode = 1;
});
