import { test, expect, type Page } from '@playwright/test';
import { SITE_CONFIG } from '../src/config/site';

/**
 * 科幻简约首页 Demo（/sci-fi-demo）契约测试。
 *
 * 覆盖：品牌主标题与 meta description、主 CTA、真实站内链接、页脚 SITE_CONFIG
 * 备案信息、移动端菜单（点击 + 键盘 + Escape + 焦点归还）、390px/1440px 无横向
 * 溢出、无 JavaScript 时内容可见、prefers-reduced-motion、跳至内容链接。
 *
 * 运行（在 astro/ 目录下；临时配置存放于仓库 tmp/，不写入仓库配置）：
 *   npx playwright test --config=../tmp/sci-fi-demo-playwright.config.ts
 * 首次运行前安装浏览器：npx playwright install chromium
 *
 * 说明：这些测试只验证语义结构、交互契约与布局约束，不验证动画的视觉观感。
 */

const DEMO_PATH = '/sci-fi-demo';
const BRAND = '胡巴的博客';
const TAGLINE = '分享技术、思考与生活。把折腾过的东西写清楚。';
const ALLOWED_INTERNAL = new Set(['/', '/posts', '/tags', '/about', DEMO_PATH]);

async function openDemo(page: Page) {
  const response = await page.goto(DEMO_PATH, { waitUntil: 'load' });
  expect(response?.status(), `${DEMO_PATH} 必须返回 200`).toBe(200);
}

/** 断言页面没有横向溢出，并在失败信息里给出越界元素，便于定位。 */
async function expectNoHorizontalOverflow(page: Page, label: string) {
  const result = await page.evaluate(() => {
    const doc = document.documentElement;
    const viewport = window.innerWidth;
    const offenders: string[] = [];
    for (const el of Array.from(document.querySelectorAll('body *'))) {
      const rect = el.getBoundingClientRect();
      if (rect.width === 0 && rect.height === 0) continue;
      if (rect.right <= viewport + 1 && rect.left >= -1) continue;
      if (getComputedStyle(el).position === 'fixed') continue;
      const cls = el.getAttribute('class');
      offenders.push(
        `${el.tagName.toLowerCase()}${cls ? `.${cls.trim().split(/\s+/).join('.')}` : ''} [${Math.round(rect.left)}..${Math.round(rect.right)}]`,
      );
      if (offenders.length >= 5) break;
    }
    return { scrollWidth: doc.scrollWidth, bodyScrollWidth: document.body.scrollWidth, viewport, offenders };
  });

  expect(
    result.scrollWidth,
    `${label}: documentElement.scrollWidth=${result.scrollWidth} 超过视口 ${result.viewport}；越界元素: ${result.offenders.join(' | ') || '无'}`,
  ).toBeLessThanOrEqual(result.viewport + 1);
}

test.describe('桌面端（1440px）', () => {
  test.use({ viewport: { width: 1440, height: 900 } });

  test('主标题、品牌文案与 meta description 正确渲染', async ({ page }) => {
    await openDemo(page);

    const h1 = page.locator('h1');
    await expect(h1).toHaveCount(1);
    await expect(h1).toBeVisible();
    await expect(h1).toContainText(BRAND);

    // 品牌定位文案必须原样保留
    await expect(page.getByText(TAGLINE, { exact: false })).toBeVisible();

    const description = await page.locator('meta[name="description"]').getAttribute('content');
    expect(description?.trim().length ?? 0).toBeGreaterThan(20);
    expect(description?.trim().length ?? 0).toBeLessThanOrEqual(160);

    // 页脚/页头都应出现品牌名
    await expect(page.locator('footer')).toContainText(BRAND);
  });

  test('主 CTA 指向真实文章列表，且是足够的触控目标', async ({ page }) => {
    await openDemo(page);

    const cta = page.locator('main').getByRole('link', { name: /浏览全部文章/ }).first();
    await expect(cta).toBeVisible();
    await expect(cta).toHaveAttribute('href', '/posts');

    const box = await cta.boundingBox();
    expect(box, '主 CTA 必须有可测量盒模型').not.toBeNull();
    expect(box!.height, '主 CTA 高度需 ≥44px').toBeGreaterThanOrEqual(44);
    expect(box!.width, '主 CTA 宽度需 ≥44px').toBeGreaterThanOrEqual(44);

    await cta.click();
    await expect(page).toHaveURL(/\/posts$/);
  });

  test('所有站内链接都指向真实存在的路由', async ({ page }) => {
    await openDemo(page);

    const hrefs = await page.evaluate(() =>
      Array.from(document.querySelectorAll('header a[href], main a[href], footer a[href]')).map(
        (a) => (a as HTMLAnchorElement).getAttribute('href') ?? '',
      ),
    );
    expect(hrefs.length).toBeGreaterThan(4);

    const internal = hrefs.filter((href) => href.startsWith('/') || href.startsWith('#'));
    const external = hrefs.filter((href) => /^https?:/.test(href));

    const unknown = [...new Set(internal)]
      .filter((href) => !href.startsWith('#'))
      .filter((href) => !ALLOWED_INTERNAL.has(href.split('?')[0]));
    expect(unknown, `发现未登记的站内链接: ${unknown.join(', ')}`).toEqual([]);

    // 外链只允许出现在页脚备案区（SITE_CONFIG 提供）
    for (const href of external) {
      expect([SITE_CONFIG.icp.url, SITE_CONFIG.police.url]).toContain(href);
    }

    // 页面不依赖任何外链图片
    const remoteImages = await page.evaluate(() =>
      Array.from(document.querySelectorAll('img')).filter((img) => /^https?:/.test(img.getAttribute('src') ?? '')).length,
    );
    expect(remoteImages, 'Demo 不应依赖外链图片').toBe(0);

    // 站内路径必须真实可达（404 视为路由缺失）
    for (const path of ALLOWED_INTERNAL) {
      const response = await page.request.get(path);
      expect(response.status(), `${path} 不应返回 404`).not.toBe(404);
      expect(response.status(), `${path} 应正常响应`).toBeLessThan(500);
    }
  });

  test('页脚使用 SITE_CONFIG 的名称与备案链接', async ({ page }) => {
    await openDemo(page);

    const footer = page.locator('footer');
    await expect(footer).toContainText(SITE_CONFIG.name);
    await expect(footer).toContainText(SITE_CONFIG.icp.text);

    const icpLink = footer.getByRole('link', { name: SITE_CONFIG.icp.text });
    await expect(icpLink).toHaveAttribute('href', SITE_CONFIG.icp.url);
    await expect(icpLink).toHaveAttribute('rel', /noopener/);

    const policeLink = footer.getByRole('link', { name: SITE_CONFIG.police.text });
    await expect(policeLink).toHaveAttribute('href', SITE_CONFIG.police.url);
  });

  test('跳至内容链接位于 Tab 顺序首位，Enter 后主区域获得焦点', async ({ page }) => {
    await openDemo(page);

    const main = page.locator('main#main');
    await expect(main).toHaveCount(1);
    // tabindex="-1" 让 main 成为可聚焦的跳转目标（否则浏览器只滚动不聚焦）
    await expect(main).toHaveAttribute('tabindex', '-1');

    await page.keyboard.press('Tab');
    const skip = page.locator('a[href="#main"]').first();
    await expect(skip).toBeFocused();
    await skip.press('Enter');

    await expect(page).toHaveURL(/#main$/);
    // 本页未启用 Astro 客户端路由，hash 变化只应是同文档跳转：
    // 等两帧再确认 URL 没有被后续导航改写，避免断言与导航竞态。
    await page.evaluate(() => new Promise<void>((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))));
    await expect(page).toHaveURL(/#main$/);
    await expect(main, 'skip link 后主区域应获得焦点').toBeFocused();
  });

  test('语义结构：单一 h1、具名导航与有序内容列表', async ({ page }) => {
    await openDemo(page);

    await expect(page.locator('h1')).toHaveCount(1);
    await expect(page.getByRole('navigation', { name: '主导航' })).toBeVisible();
    await expect(page.locator('main ol li').first()).toBeVisible();

    // list-style: none 会让 Safari VoiceOver 丢失列表语义，四个列表都显式补 role="list"
    for (const selector of ['.sf-nav__list--desktop', '#sf-nav-panel', '.sf-index__list', '.sf-footer__legal']) {
      await expect(page.locator(selector), `${selector} 需保留 role="list"`).toHaveAttribute('role', 'list');
    }
    // 页面自身只声明本站字体，不请求外部资源
    const requests: string[] = [];
    page.on('request', (request) => requests.push(request.url()));
    await page.reload({ waitUntil: 'load' });
    // 用当前页面的 origin 判定站内请求，避免硬编码端口 —— 任意临时端口都能运行
    const origin = new URL(page.url()).origin;
    const external = requests.filter((url) => !url.startsWith(origin) && !url.startsWith('data:'));
    expect(external, `不应请求外部资源: ${external.join(', ')}`).toEqual([]);
  });

  test('1440px 无横向溢出', async ({ page }) => {
    await openDemo(page);
    await expectNoHorizontalOverflow(page, '1440px');
  });
});

test.describe('移动端（390px）', () => {
  test.use({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true });

  test('移动导航可点击展开、Escape 关闭并归还焦点', async ({ page }) => {
    await openDemo(page);

    // JS 正常执行时不应命中 .sf-topbar:has(.sf-nav__toggle[hidden]) 的静态回退，
    // 移动端顶栏仍是 sticky（守护「无 JS 修复不打扰正常菜单」）
    await expect(page.locator('.sf-topbar'), 'JS 正常时移动端顶栏应保持 sticky').toHaveCSS('position', 'sticky');

    const toggle = page.getByRole('button', { name: '导航菜单' });
    const panel = page.locator('#sf-nav-panel');

    await expect(toggle).toBeVisible();
    await expect(toggle).toHaveAttribute('aria-expanded', 'false');
    await expect(panel).toBeHidden();

    // 触控目标 ≥44px
    const toggleBox = await toggle.boundingBox();
    expect(toggleBox!.height).toBeGreaterThanOrEqual(44);
    expect(toggleBox!.width).toBeGreaterThanOrEqual(44);

    await toggle.click();
    await expect(toggle).toHaveAttribute('aria-expanded', 'true');
    await expect(panel).toBeVisible();

    const panelLink = panel.getByRole('link', { name: '文章', exact: true });
    await expect(panelLink).toBeVisible();
    const linkBox = await panelLink.boundingBox();
    expect(linkBox!.height, '移动菜单链接高度需 ≥44px').toBeGreaterThanOrEqual(44);

    await page.keyboard.press('Escape');
    await expect(toggle).toHaveAttribute('aria-expanded', 'false');
    await expect(panel).toBeHidden();
    await expect(toggle, 'Escape 关闭后焦点应回到触发按钮').toBeFocused();

    // 键盘路径同样可展开
    await page.keyboard.press('Enter');
    await expect(toggle).toHaveAttribute('aria-expanded', 'true');
    await expect(panel).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(panel).toBeHidden();
  });

  test('移动端主 CTA 与站内链接可用且够大', async ({ page }) => {
    await openDemo(page);

    const cta = page.locator('main').getByRole('link', { name: /浏览全部文章/ }).first();
    const box = await cta.boundingBox();
    expect(box!.height).toBeGreaterThanOrEqual(44);

    const entry = page.locator('main ol li a').first();
    await expect(entry).toBeVisible();
    const entryBox = await entry.boundingBox();
    expect(entryBox!.height, '内容入口整行可点，高度需 ≥44px').toBeGreaterThanOrEqual(44);
  });

  test('390px 无横向溢出', async ({ page }) => {
    await openDemo(page);
    await expectNoHorizontalOverflow(page, '390px');
  });
});

test.describe('典型视口横扫', () => {
  test.use({ viewport: { width: 390, height: 844 } });

  // 需求只要求 390 / 1440，这里额外覆盖极窄屏与中间断点，防止顶栏或网格溢出
  for (const width of [320, 360, 390, 768, 880, 1024, 1440, 1920]) {
    test(`${width}px 无横向溢出`, async ({ page }) => {
      await page.setViewportSize({ width, height: 900 });
      await openDemo(page);
      await expectNoHorizontalOverflow(page, `${width}px`);
    });
  }
});

test.describe('渐进增强与动效偏好', () => {
  test.use({ javaScriptEnabled: false, viewport: { width: 1440, height: 900 } });

  test('禁用 JavaScript 时主要内容仍然可见可读', async ({ page }) => {
    await page.goto(DEMO_PATH, { waitUntil: 'load' });

    await expect(page.locator('h1')).toContainText(BRAND);
    await expect(page.getByText(TAGLINE, { exact: false })).toBeVisible();
    await expect(page.locator('main').getByRole('link', { name: /浏览全部文章/ }).first()).toBeVisible();
    await expect(page.getByRole('navigation', { name: '主导航' }).getByRole('link', { name: '标签' })).toBeVisible();
    await expect(page.locator('main ol li a').first()).toBeVisible();
    await expect(page.locator('footer')).toContainText(SITE_CONFIG.icp.text);
  });
});

test.describe('渐进增强：无 JS 的移动端导航回退', () => {
  // 独立的 viewport 与 JS 设置，不能与上面的桌面端无 JS 用例共用 test.use
  test.use({ javaScriptEnabled: false, viewport: { width: 390, height: 844 } });

  test('无 JS 时菜单按钮隐藏、导航面板与「文章」链接可见', async ({ page }) => {
    await page.goto(DEMO_PATH, { waitUntil: 'load' });

    // 无 JS 时脚本没有机会移除标记上的 hidden：这既是按钮隐藏的状态来源，
    // 也是外部样式表 .sf-topbar:has(.sf-nav__toggle[hidden]) 的匹配依据
    await expect(page.locator('.sf-nav__toggle')).toHaveAttribute('hidden', '');
    await expect(page.locator('.sf-nav__toggle')).toBeHidden();

    // 展开导航后顶栏必须退出 sticky，否则展开后的内容会常驻吸顶（约 222px）。
    // 该状态由外部样式表的 :has() 规则保证，不依赖 <noscript> 内联样式的注入顺序。
    await expect(page.locator('.sf-topbar'), '无 JS 展开导航时顶栏应为 static').toHaveCSS('position', 'static');

    const panel = page.locator('#sf-nav-panel');
    await expect(panel).toBeVisible();
    await expect(panel.getByRole('link', { name: '文章', exact: true })).toBeVisible();
  });
});

test.describe('prefers-reduced-motion', () => {
  test.use({ viewport: { width: 1440, height: 900 } });

  test('减少动效时无持续动画且内容完全可见', async ({ page }) => {
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await openDemo(page);

    const runningAnimations = await page.evaluate(() =>
      document.getAnimations().filter((animation) => animation.playState === 'running').length,
    );
    expect(runningAnimations, '减少动效偏好下不应有运行中的动画').toBe(0);

    const opacities = await page.evaluate(() =>
      ['h1', '.sf-hero__lead', '.sf-instrument'].map((selector) => {
        const el = document.querySelector(selector);
        return el ? getComputedStyle(el).opacity : 'missing';
      }),
    );
    expect(opacities).toEqual(['1', '1', '1']);
  });
});
