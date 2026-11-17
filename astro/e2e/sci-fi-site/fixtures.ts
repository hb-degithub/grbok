/**
 * 全站科幻简约改造 · 真实浏览器验收共享夹具（临时文件，仅本次验收使用）。
 *
 * 约束：
 * - 不修改产品代码；本目录与 tmp/ 下的文件均为新增临时资产。
 * - PB 只 mock PocketBase 源站（构建期内联的 localhost:8090 / 运行期 SSR 的 127.0.0.1:8199），
 *   不 mock 同源 /api/public/*、/api/blog-admin/*（那些是真实请求，用于鉴权/状态边界断言）。
 * - 溢出探针为三段式：文档 scrollWidth + clip/hidden 容器 scrollWidth + 元素 rect 越界。
 */
import { expect, type Page } from '@playwright/test';
import { fileURLToPath } from 'node:url';

export const ARTIFACTS = fileURLToPath(new URL('../../../tmp/sci-fi-visual/', import.meta.url));
export const SHOTS = fileURLToPath(new URL('../../../tmp/sci-fi-visual/shots/', import.meta.url));

/** 验收路由（/admin 单独在 authz 中断言，这里只列公开页）。 */
export const PUBLIC_ROUTES = ['/', '/posts', '/tags', '/archive', '/about', '/links', '/guestbook', '/gallery', '/login'] as const;

export const TOKENS = {
  light: {
    '--sf-canvas': '#f1f3f5',
    '--sf-surface': '#ffffff',
    '--sf-ink': '#16191d',
    '--sf-ink-2': '#454f59',
    '--sf-ink-3': '#5f6a75',
    '--sf-line-control': '#7f8b97',
    '--sf-accent': '#0b6d76',
    '--sf-accent-ink': '#085159',
    '--sf-on-accent': '#ffffff',
  },
  dark: {
    '--sf-canvas': '#0e1114',
    '--sf-surface': '#161a1e',
    '--sf-ink': '#e8ecf0',
    '--sf-ink-2': '#a8b4bd',
    '--sf-ink-3': '#7a8791',
    '--sf-line-control': '#5a6a77',
    '--sf-accent': '#3fa8b2',
    '--sf-accent-ink': '#6bc4cc',
    '--sf-on-accent': '#16191d',
  },
} as const;

export const CANVAS_RGB = {
  light: 'rgb(241, 243, 245)',
  dark: 'rgb(14, 17, 20)',
} as const;

export function themeOf(projectName: string): 'light' | 'dark' {
  return projectName.endsWith('dark') ? 'dark' : 'light';
}

export function isMobileProject(projectName: string): boolean {
  return projectName.startsWith('mobile');
}

/* ------------------------------------------------------------------ */
/* 本地存储：跳过 Splash / Welcome 遮罩，并固定主题（仅当未设置时）      */
/* ------------------------------------------------------------------ */

export async function installStorage(page: Page, theme: 'light' | 'dark') {
  // 注意：addInitScript 会在同一 Page 的每次导航（含 reload）执行。
  // 用「未设置才写」的写法，主题切换 + 刷新持久化用例才不会被重置。
  await page.addInitScript(({ mode }) => {
    try {
      if (!localStorage.getItem('blog-theme-mode')) {
        localStorage.setItem('blog-theme-mode', mode);
      }
      localStorage.setItem('blog-welcomed', String(Date.now()));
      localStorage.setItem('blog-splash-seen', String(Date.now()));
    } catch {
      /* ignore */
    }
  }, { mode: theme });
}

export async function openRoute(page: Page, theme: 'light' | 'dark', path: string) {
  await installStorage(page, theme);
  const res = await page.goto(path, { waitUntil: 'domcontentloaded' });
  // 启动遮罩若出现必须退出；选择器必须精确带 aria-label，避免匹配 PostList 骨架的 role=status。
  await expect(page.locator('[role="status"][aria-label="页面加载中"]')).toBeHidden({ timeout: 20_000 });
  await page.waitForFunction(() => !!document.querySelector('main#main-content'));
  return res;
}

/* ------------------------------------------------------------------ */
/* PocketBase mock（只拦 PB 源站；不发真实网络）                        */
/* ------------------------------------------------------------------ */

// 只拦 PocketBase 源站（构建期内联的 8090，或验收配置注入的 8199）。
// 注意不能放宽成「任意 host 的 /api/」：那会把同源 /api/public/* 也接住，
// 让状态卡拿到错误的 JSON（夹具假阳性）。仓库无 astro/.env，构建默认即 8090。
const PB_ROUTE = /^https?:\/\/(localhost|127\.0\.0\.1):(8090|8199)\/api\//;

const CORS_HEADERS: Record<string, string> = {
  'access-control-allow-origin': '*',
  'access-control-allow-methods': 'GET,POST,PATCH,DELETE,OPTIONS',
  'access-control-allow-headers': '*',
};

const EMPTY_LIST = () => ({ page: 1, perPage: 20, totalItems: 0, totalPages: 0, items: [] });

/**
 * 本地没有 Caddy/PocketBase，/api/public/* 是真实 404。为了让「非预期 404」保持可检出，
 * 这里给这三个状态探针返回合法空结构（只隔离环境缺失，不代表产品真实数据）。
 * 注意：/api/blog-admin/* 不 mock —— 鉴权边界用真实请求断言。
 */
export async function mockLocalPublicApis(page: Page) {
  await page.route(/\/api\/public\/status(\?.*)?$/, (route) =>
    route.fulfill({
      status: 200,
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ overall: 'unknown', services: [] }),
    }));
  await page.route(/\/api\/public\/(ping|protection)(\?.*)?$/, (route) =>
    route.fulfill({ status: 200, headers: { 'content-type': 'application/json' }, body: '{}' }));
}

export async function mockPocketBase(page: Page) {
  await mockLocalPublicApis(page);
  await page.route(PB_ROUTE, async (route) => {
    const req = route.request();
    if (req.method() === 'OPTIONS') {
      return route.fulfill({ status: 204, headers: CORS_HEADERS });
    }
    const url = new URL(req.url());
    if (url.pathname.startsWith('/api/files/')) {
      return route.fulfill({ status: 404, headers: CORS_HEADERS, body: '' });
    }
    return route.fulfill({
      status: 200,
      headers: { ...CORS_HEADERS, 'content-type': 'application/json' },
      body: JSON.stringify(EMPTY_LIST()),
    });
  });
}

/* ------------------------------------------------------------------ */
/* 控制台错误收集（区分预期 PB / network failure）                      */
/* ------------------------------------------------------------------ */

export interface ErrorBucket {
  pageErrors: string[];
  consoleErrors: string[];
}

export function collectErrors(page: Page): ErrorBucket {
  const bucket: ErrorBucket = { pageErrors: [], consoleErrors: [] };
  page.on('pageerror', (err) => bucket.pageErrors.push(err.stack || err.message));
  page.on('console', (msg) => {
    if (msg.type() === 'error') bucket.consoleErrors.push(msg.text());
  });
  return bucket;
}

/** 本地无 Caddy / 无 8090 PB 时的确定性预期错误；其余一律视为缺陷。 */
export const EXPECTED_CONSOLE_ERRORS: RegExp[] = [
  /ERR_CONNECTION_REFUSED/,
  /Failed to load resource:.*(8199|8090)/,
  /\/api\/public\/(status|ping|protection)/,
  /\/api\/blog-admin\//,
];

export function unexpectedConsoleErrors(bucket: ErrorBucket): string[] {
  return bucket.consoleErrors.filter((text) => !EXPECTED_CONSOLE_ERRORS.some((re) => re.test(text)));
}

export function expectCleanErrors(bucket: ErrorBucket, tag: string) {
  expect(bucket.pageErrors, `${tag} 出现 pageerror`).toEqual([]);
  expect(unexpectedConsoleErrors(bucket), `${tag} 出现非预期 console.error`).toEqual([]);
}

/* ------------------------------------------------------------------ */
/* 溢出探针（三段式；main 的 overflow-x: clip 不得掩蔽真实溢出）        */
/* ------------------------------------------------------------------ */

export interface OverflowReport {
  vw: number;
  doc: number;
  clipped: string[];
  offenders: string[];
}

export function overflowReport(page: Page): Promise<OverflowReport> {
  return page.evaluate(() => {
    const vw = window.innerWidth;
    const label = (el: Element) => {
      const cls = (el.getAttribute('class') || '').trim().split(/\s+/).slice(0, 3).join('.');
      return `${el.tagName.toLowerCase()}${el.id ? '#' + el.id : ''}${cls ? '.' + cls : ''}`;
    };

    // 1) 文档级
    const doc = document.documentElement.scrollWidth;

    // 2) clip/hidden 容器（跳过 sr-only / 有意 ellipsis 截断，它们不产生页面级溢出）
    const clipped: string[] = [];
    for (const el of Array.from(document.querySelectorAll('body *'))) {
      const cs = getComputedStyle(el);
      if (cs.overflowX !== 'clip' && cs.overflowX !== 'hidden') continue;
      if (el.clientWidth <= 2 || el.clientHeight <= 2) continue;
      if (cs.textOverflow === 'ellipsis') continue;
      if (el.scrollWidth > el.clientWidth + 1) {
        clipped.push(`${label(el)} scroll=${el.scrollWidth} client=${el.clientWidth}`);
      }
    }

    // 3) 元素 rect 越界：排除 fixed 子树（含其祖先）、隐藏元素、合法横向滚动区
    const offenders: string[] = [];
    for (const el of Array.from(document.querySelectorAll('body *'))) {
      const rect = el.getBoundingClientRect();
      if (rect.width <= 2 && rect.height <= 2) continue;
      const cs = getComputedStyle(el);
      if (cs.visibility === 'hidden' || cs.display === 'none') continue;
      let skip = false;
      for (let p: Element | null = el; p; p = p.parentElement) {
        const pcs = getComputedStyle(p);
        if (pcs.position === 'fixed') { skip = true; break; }
        if (p !== el && (pcs.overflowX === 'auto' || pcs.overflowX === 'scroll')) { skip = true; break; }
      }
      if (skip) continue;
      if (rect.right > vw + 1 || rect.left < -1) {
        offenders.push(`${label(el)} [${Math.round(rect.left)}..${Math.round(rect.right)}]`);
        if (offenders.length >= 8) break;
      }
    }

    return { vw, doc, clipped, offenders };
  });
}

export async function expectNoHorizontalOverflow(page: Page, tag: string) {
  const report = await overflowReport(page);
  expect(report.doc, `${tag} 文档级横向溢出 scrollWidth=${report.doc} > vw=${report.vw}`).toBeLessThanOrEqual(report.vw + 1);
  expect(report.clipped, `${tag} 被 clip/hidden 容器裁切的内容`).toEqual([]);
  expect(report.offenders, `${tag} 元素 rect 越界`).toEqual([]);
}

/* ------------------------------------------------------------------ */
/* 滚动触发 client:visible 水合，并让动效收敛                          */
/* ------------------------------------------------------------------ */

export async function scrollThrough(page: Page) {
  await page.evaluate(async () => {
    const height = document.documentElement.scrollHeight;
    for (let y = 0; y < height; y += 500) {
      window.scrollTo(0, y);
      await new Promise((resolve) => setTimeout(resolve, 50));
    }
    window.scrollTo(0, height);
  });
  await page.waitForTimeout(300);
  await page.evaluate(() => new Promise<void>((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))));
}

/** 采样颜色前禁用过渡并结束有限动画，避免读到 0.3s 颜色过渡的中间帧。 */
export async function freezeTransitions(page: Page) {
  await page.addStyleTag({
    content: '*,*::before,*::after{transition:none !important;animation-play-state:paused !important}',
  });
  await page.evaluate(() => {
    document.getAnimations().forEach((animation) => {
      try { animation.finish(); } catch { /* 无限动画忽略 */ }
    });
  });
}

/* ------------------------------------------------------------------ */
/* 对比度                                                             */
/* ------------------------------------------------------------------ */

export interface ColorTokenSnapshot {
  tokens: Record<string, string>;
  bodyBackground: string;
  htmlClasses: string;
}

export function tokenSnapshot(page: Page): Promise<ColorTokenSnapshot> {
  return page.evaluate(() => {
    const cs = getComputedStyle(document.documentElement);
    const names = Object.keys({
      '--sf-canvas': 1, '--sf-surface': 1, '--sf-ink': 1, '--sf-ink-2': 1, '--sf-ink-3': 1,
      '--sf-line-control': 1, '--sf-accent': 1, '--sf-accent-ink': 1, '--sf-on-accent': 1,
    });
    const tokens: Record<string, string> = {};
    for (const name of names) tokens[name] = cs.getPropertyValue(name).trim().toLowerCase();
    return {
      tokens,
      bodyBackground: getComputedStyle(document.body).backgroundColor,
      htmlClasses: document.documentElement.className,
    };
  });
}

export interface ContrastSample {
  selector: string;
  text: string;
  color: string;
  background: string;
  fontSize: number;
  fontWeight: number;
  ratio: number;
  need: number;
}

export interface ContrastAudit {
  samples: ContrastSample[];
  violations: ContrastSample[];
}

/**
 * 采样可见文本对比度。
 * - 有效背景：向上找首个 alpha≈1 的祖先，半透明时与页面 canvas 混合；
 * - 大字号门槛 3.0，其余 4.5（WCAG 2.x）。
 */
export function contrastAudit(page: Page, selectors: string[], maxPerSelector = 4): Promise<ContrastAudit> {
  return page.evaluate(({ sels, max }) => {
    interface RGBA { r: number; g: number; b: number; a: number }
    const parse = (value: string): RGBA | null => {
      const v = value.trim();
      const hex = v.match(/^#([0-9a-f]{3}|[0-9a-f]{6})$/i);
      if (hex) {
        const h = hex[1].length === 3 ? hex[1].split('').map((c) => c + c).join('') : hex[1];
        return { r: parseInt(h.slice(0, 2), 16), g: parseInt(h.slice(2, 4), 16), b: parseInt(h.slice(4, 6), 16), a: 1 };
      }
      const m = v.match(/rgba?\(([^)]+)\)/i);
      if (!m) return null;
      const parts = m[1].split(/[ ,/]+/).filter(Boolean).map(Number);
      return { r: parts[0], g: parts[1], b: parts[2], a: parts[3] ?? 1 };
    };
    const linear = (v: number) => {
      const n = v / 255;
      return n <= 0.03928 ? n / 12.92 : Math.pow((n + 0.055) / 1.055, 2.4);
    };
    const luminance = (c: RGBA) => 0.2126 * linear(c.r) + 0.7152 * linear(c.g) + 0.0722 * linear(c.b);
    const blend = (top: RGBA, bottom: RGBA): RGBA => ({
      r: top.r * top.a + bottom.r * (1 - top.a),
      g: top.g * top.a + bottom.g * (1 - top.a),
      b: top.b * top.a + bottom.b * (1 - top.a),
      a: 1,
    });
    const root = getComputedStyle(document.documentElement);
    const canvas = parse(root.getPropertyValue('--sf-canvas')) || { r: 255, g: 255, b: 255, a: 1 };
    // 文本的真实底色可能来自覆盖在元素背后的绝对定位子元素（例如 HomeSideNav 的
    // layoutId 高亮 pill：<a> 本身无底色，<span class="absolute inset-0 bg-accent"> 才是填充）。
    // 先检测「覆盖元素 ≥80% 面积的不透明绝对定位子元素」，否则再向上找祖先底色。
    const overlayBackground = (el: Element): RGBA | null => {
      const rect = el.getBoundingClientRect();
      for (const child of Array.from(el.querySelectorAll('*'))) {
        const cs = getComputedStyle(child);
        if (cs.position !== 'absolute' && cs.position !== 'fixed') continue;
        const r = child.getBoundingClientRect();
        if (r.width < rect.width * 0.8 || r.height < rect.height * 0.8) continue;
        const bg = parse(cs.backgroundColor);
        if (bg && bg.a >= 0.99) return bg;
      }
      return null;
    };
    const backgroundOf = (el: Element): RGBA => {
      const overlay = overlayBackground(el);
      if (overlay) return overlay;
      for (let node: Element | null = el; node; node = node.parentElement) {
        const bg = parse(getComputedStyle(node).backgroundColor);
        if (bg && bg.a >= 0.99) return bg;
        if (bg && bg.a > 0) return blend(bg, canvas);
      }
      return parse(getComputedStyle(document.body).backgroundColor) || canvas;
    };
    const ratioOf = (fg: RGBA, bg: RGBA): number => {
      const front = fg.a >= 0.99 ? fg : blend(fg, bg);
      const [hi, lo] = [luminance(front), luminance(bg)].sort((a, b) => b - a);
      return (hi + 0.05) / (lo + 0.05);
    };

    const samples: Array<{
      selector: string; text: string; color: string; background: string;
      fontSize: number; fontWeight: number; ratio: number; need: number;
    }> = [];

    for (const selector of sels) {
      let taken = 0;
      for (const el of Array.from(document.querySelectorAll(selector))) {
        if (taken >= max) break;
        const text = (el.textContent || '').replace(/\s+/g, ' ').trim();
        if (!text) continue;
        const rect = el.getBoundingClientRect();
        if (rect.width === 0 || rect.height === 0) continue;
        const cs = getComputedStyle(el);
        if (cs.visibility === 'hidden' || cs.display === 'none' || cs.opacity === '0') continue;
        const fg = parse(cs.color);
        if (!fg) continue;
        const bg = backgroundOf(el);
        const size = parseFloat(cs.fontSize);
        const weight = parseInt(cs.fontWeight, 10) || 400;
        const large = size >= 24 || (size >= 18.66 && weight >= 700);
        samples.push({
          selector,
          text: text.slice(0, 28),
          color: cs.color,
          background: `rgb(${Math.round(bg.r)}, ${Math.round(bg.g)}, ${Math.round(bg.b)})`,
          fontSize: size,
          fontWeight: weight,
          ratio: Number(ratioOf(fg, bg).toFixed(2)),
          need: large ? 3 : 4.5,
        });
        taken += 1;
      }
    }
    return { samples, violations: samples.filter((sample) => sample.ratio < sample.need) };
  }, { sels: selectors, max: maxPerSelector });
}

/** Node 侧颜色工具（用于令牌对断言）。 */
export function parseCssColor(value: string): { r: number; g: number; b: number; a: number } | null {
  const v = value.trim();
  const hex = v.match(/^#([0-9a-f]{3}|[0-9a-f]{6}|[0-9a-f]{8})$/i);
  if (hex) {
    const h = hex[1].length <= 4
      ? hex[1].split('').map((c) => c + c).join('')
      : hex[1];
    return {
      r: parseInt(h.slice(0, 2), 16),
      g: parseInt(h.slice(2, 4), 16),
      b: parseInt(h.slice(4, 6), 16),
      a: h.length === 8 ? parseInt(h.slice(6, 8), 16) / 255 : 1,
    };
  }
  const m = v.match(/rgba?\(([^)]+)\)/i);
  if (!m) return null;
  const parts = m[1].split(/[ ,/]+/).filter(Boolean).map(Number);
  return { r: parts[0], g: parts[1], b: parts[2], a: parts[3] ?? 1 };
}

export function contrastRatio(fg: { r: number; g: number; b: number; a: number }, bg: { r: number; g: number; b: number; a: number }): number {
  const linear = (v: number) => {
    const n = v / 255;
    return n <= 0.03928 ? n / 12.92 : Math.pow((n + 0.055) / 1.055, 2.4);
  };
  const lum = (c: { r: number; g: number; b: number }) => 0.2126 * linear(c.r) + 0.7152 * linear(c.g) + 0.0722 * linear(c.b);
  const blend = (top: typeof fg, bottom: typeof bg) => ({
    r: top.r * top.a + bottom.r * (1 - top.a),
    g: top.g * top.a + bottom.g * (1 - top.a),
    b: top.b * top.a + bottom.b * (1 - top.a),
    a: 1,
  });
  const front = fg.a >= 0.99 ? fg : blend(fg, bg);
  return (Math.max(lum(front), lum(bg)) + 0.05) / (Math.min(lum(front), lum(bg)) + 0.05);
}

export function normalizedHex(value: string): string {
  const color = parseCssColor(value);
  if (!color) return value.trim().toLowerCase();
  const hex = (n: number) => Math.round(n).toString(16).padStart(2, '0');
  return `#${hex(color.r)}${hex(color.g)}${hex(color.b)}`;
}
