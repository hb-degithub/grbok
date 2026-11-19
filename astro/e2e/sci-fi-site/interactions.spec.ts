/**
 * C 组：交互（移动 Header / 桌面 Dock + 主题菜单 / 登录 tab / 关于展开 / 跳至内容 / 动效 / 无 JS）。
 * Playwright projects 会把每个用例在 4 个视口×主题组合各跑一次；与视口相关的用例内部跳过。
 */
import { test, expect, type Page } from '@playwright/test';
import {
  collectErrors,
  expectCleanErrors,
  expectNoHorizontalOverflow,
  freezeTransitions,
  isMobileProject,
  mockPocketBase,
  normalizedHex,
  openRoute,
  parseCssColor,
  themeOf,
} from './fixtures';

/**
 * 不预置 `blog-welcomed` 的首次访问：只跳过启动条（它是展示页上的非阻断状态条），
 * 主题按 project 固定，便于焦点/注册流程断言。
 * 与 fixtures.installStorage 的区别是本函数刻意不写 welcomed。
 */
async function openFirstVisit(page: Page, theme: 'light' | 'dark', path = '/') {
  await page.addInitScript(({ mode }) => {
    try {
      localStorage.setItem('blog-splash-seen', String(Date.now()));
      if (!localStorage.getItem('blog-theme-mode')) localStorage.setItem('blog-theme-mode', mode);
    } catch {
      /* ignore */
    }
  }, { mode: theme });
  return page.goto(path, { waitUntil: 'domcontentloaded' });
}

/** 不预置 `blog-theme-mode`：用于验证「跟随系统」时的 .dark 与实际画布一致。 */
async function openWithoutThemePreset(page: Page, path = '/') {
  await page.addInitScript(() => {
    try {
      localStorage.setItem('blog-splash-seen', String(Date.now()));
      localStorage.setItem('blog-welcomed', String(Date.now()));
    } catch {
      /* ignore */
    }
  });
  return page.goto(path, { waitUntil: 'domcontentloaded' });
}

/** 相对亮度：只需区分深/浅画布，用来核对 html.dark 与真实背景是否一致。 */
function canvasLuminance(color: string): number {
  const parsed = parseCssColor(color);
  if (!parsed) throw new Error(`无法解析画布颜色: ${color}`);
  const linear = (value: number) => {
    const channel = value / 255;
    return channel <= 0.03928 ? channel / 12.92 : Math.pow((channel + 0.055) / 1.055, 2.4);
  };
  return 0.2126 * linear(parsed.r) + 0.7152 * linear(parsed.g) + 0.0722 * linear(parsed.b);
}

/** 采样主题 class / --sf-canvas / body 实际背景。 */
function sampleTheme(page: Page) {
  return page.evaluate(() => ({
    dark: document.documentElement.classList.contains('dark'),
    canvas: getComputedStyle(document.documentElement).getPropertyValue('--sf-canvas').trim(),
    bodyBackground: getComputedStyle(document.body).backgroundColor,
    overflow: document.body.style.overflow,
  }));
}

test('@interaction C1+C2 移动菜单：44px 触控目标、打开、焦点进入、Escape 关闭归还', async ({ page }, testInfo) => {
  test.skip(!isMobileProject(testInfo.project.name), '仅移动视口');
  const errors = collectErrors(page);
  await mockPocketBase(page);
  await openRoute(page, themeOf(testInfo.project.name), '/');

  const burger = page.getByRole('button', { name: '打开导航菜单' });
  await expect(burger).toBeVisible();
  await expect(burger).toHaveAttribute('aria-expanded', 'false');
  await expect(burger).toHaveAttribute('aria-controls', 'mobile-side-nav');
  const box = await burger.boundingBox();
  expect(box, '汉堡按钮应可见').not.toBeNull();
  expect(box!.width, '汉堡按钮宽度').toBeGreaterThanOrEqual(44);
  expect(box!.height, '汉堡按钮高度').toBeGreaterThanOrEqual(44);

  // 移动端不出现桌面 Dock
  await expect(page.getByRole('toolbar', { name: '站点导航工具栏' })).toBeHidden();

  await burger.click();
  const drawer = page.getByRole('dialog', { name: '移动端侧边导航' });
  await expect(drawer).toBeVisible();
  await expect(burger).toHaveAttribute('aria-expanded', 'true');

  // 焦点在 50ms setTimeout 后进入抽屉；用 poll 避免固定 sleep
  await expect.poll(() => page.evaluate(() => !!document.activeElement?.closest('[role="dialog"]')), {
    timeout: 3000,
    message: '打开抽屉后焦点应进入抽屉',
  }).toBe(true);

  await page.keyboard.press('Escape');
  await expect(drawer).toBeHidden();
  await expect(burger).toHaveAttribute('aria-expanded', 'false');
  await expect(burger).toBeFocused();

  expectCleanErrors(errors, 'C1+C2 移动菜单');
});

test('@interaction C3 移动菜单：关闭按钮 + 键盘路径（Enter/Tab/Escape）', async ({ page }, testInfo) => {
  test.skip(!isMobileProject(testInfo.project.name), '仅移动视口');
  const errors = collectErrors(page);
  await mockPocketBase(page);
  await openRoute(page, themeOf(testInfo.project.name), '/');

  const burger = page.getByRole('button', { name: '打开导航菜单' });
  await burger.focus();
  await page.keyboard.press('Enter');
  const drawer = page.getByRole('dialog', { name: '移动端侧边导航' });
  await expect(drawer).toBeVisible();

  // Tab 应在抽屉内移动
  await page.keyboard.press('Tab');
  await expect.poll(() => page.evaluate(() => !!document.activeElement?.closest('[role="dialog"]'))).toBe(true);

  // 关闭按钮可点
  await page.getByRole('button', { name: '关闭侧边导航' }).click();
  await expect(drawer).toBeHidden();

  // 键盘路径再次打开 → Escape
  await burger.focus();
  await page.keyboard.press('Enter');
  await expect(drawer).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(drawer).toBeHidden();
  await expect(burger).toBeFocused();

  expectCleanErrors(errors, 'C3 移动菜单键盘路径');
});

test('@interaction C4 桌面 Dock：可见、无汉堡、每项 ≥40px、回顶部可见', async ({ page }, testInfo) => {
  test.skip(isMobileProject(testInfo.project.name), '仅桌面视口');
  const errors = collectErrors(page);
  await mockPocketBase(page);
  await openRoute(page, themeOf(testInfo.project.name), '/');

  const toolbar = page.getByRole('toolbar', { name: '站点导航工具栏' });
  await expect(toolbar).toBeVisible();
  await expect(page.getByRole('button', { name: '打开导航菜单' })).toBeHidden();

  await page.evaluate(() => window.scrollTo(0, 0));
  await page.waitForTimeout(500);
  await expect(toolbar).toBeVisible();

  const items = page.locator('.dock-item');
  const count = await items.count();
  expect(count, 'Dock 至少包含导航/搜索/主题/更多/登录').toBeGreaterThanOrEqual(7);
  for (let i = 0; i < count; i += 1) {
    const b = await items.nth(i).boundingBox();
    expect(b, `Dock 第 ${i} 项应有尺寸`).not.toBeNull();
    expect(b!.width, `Dock 第 ${i} 项宽度`).toBeGreaterThanOrEqual(40);
    expect(b!.height, `Dock 第 ${i} 项高度`).toBeGreaterThanOrEqual(40);
  }

  expectCleanErrors(errors, 'C4 桌面 Dock');
});

test('@interaction C5 主题菜单：切换到另一主题并刷新保持', async ({ page }, testInfo) => {
  test.skip(isMobileProject(testInfo.project.name), '主题菜单在桌面 Dock 中');
  const errors = collectErrors(page);
  await mockPocketBase(page);
  await openRoute(page, themeOf(testInfo.project.name), '/');

  const button = page.getByRole('button', { name: /^主题：/ });
  await expect(button).toBeVisible();
  await button.click();
  await expect(page.getByRole('menu')).toBeVisible();
  await expect(page.getByRole('menuitemradio')).toHaveCount(4);

  const initialDark = await page.evaluate(() => document.documentElement.classList.contains('dark'));
  const targetLabel = initialDark ? /手动固定亮色/ : /手动固定暗色/;
  const expectedDark = !initialDark;
  const expectedMode = expectedDark ? 'dark' : 'light';

  await page.getByRole('menuitemradio', { name: targetLabel }).click();
  await expect
    .poll(() => page.evaluate(() => document.documentElement.classList.contains('dark')))
    .toBe(expectedDark);
  expect(await page.evaluate(() => localStorage.getItem('blog-theme-mode'))).toBe(expectedMode);

  // 刷新后保持（installStorage 只在未设置时写入，不会覆盖用户选择）
  await page.reload({ waitUntil: 'domcontentloaded' });
  await expect
    .poll(() => page.evaluate(() => document.documentElement.classList.contains('dark')))
    .toBe(expectedDark);
  expect(await page.evaluate(() => localStorage.getItem('blog-theme-mode'))).toBe(expectedMode);

  expectCleanErrors(errors, 'C5 主题菜单');
});

test('@interaction C6 登录三 tab 切换（不提交）', async ({ page }, testInfo) => {
  const errors = collectErrors(page);
  await mockPocketBase(page);
  await openRoute(page, themeOf(testInfo.project.name), '/login');

  const tabs = page.getByRole('tab');
  await expect(tabs).toHaveCount(3);
  const selected = async () => page.evaluate(() =>
    Array.from(document.querySelectorAll('[role="tab"]')).map((el) => el.getAttribute('aria-selected')));
  expect(await selected()).toEqual(['true', 'false', 'false']);

  await page.getByRole('tab', { name: '验证码' }).click();
  await expect(page.getByRole('tab', { name: '验证码' })).toHaveAttribute('aria-selected', 'true');
  expect(await selected()).toEqual(['false', 'true', 'false']);
  await expect(page.getByLabel('邮箱地址')).toBeVisible();
  await expectNoHorizontalOverflow(page, `登录-验证码 @ ${testInfo.project.name}`);

  await page.getByRole('tab', { name: '注册' }).click();
  await expect(page.getByRole('tab', { name: '注册' })).toHaveAttribute('aria-selected', 'true');
  expect(await selected()).toEqual(['false', 'false', 'true']);
  await expect(page.getByLabel('昵称')).toBeVisible();
  await expect(page.getByLabel('确认密码')).toBeVisible();
  await expectNoHorizontalOverflow(page, `登录-注册 @ ${testInfo.project.name}`);

  await page.getByRole('tab', { name: '密码登录' }).click();
  await expect(page.getByRole('tab', { name: '密码登录' })).toHaveAttribute('aria-selected', 'true');
  expect(await selected()).toEqual(['true', 'false', 'false']);
  // 注册 tab 退场动画期间「确认密码」仍在 DOM 里，getByLabel('密码') 会同时命中两个字段
  // （strict mode violation）。这里精确匹配「密码」本身，避免用例随机失败。
  await expect(page.getByLabel('密码', { exact: true })).toBeVisible();
  await expectNoHorizontalOverflow(page, `登录-密码 @ ${testInfo.project.name}`);

  expectCleanErrors(errors, 'C6 登录 tab');
});

test('@interaction C7 关于页 Tech/Feature 按钮展开/收起', async ({ page }, testInfo) => {
  const errors = collectErrors(page);
  await mockPocketBase(page);
  await openRoute(page, themeOf(testInfo.project.name), '/about');

  const tech = page.locator('button[aria-controls^="tech-detail-"]').first();
  await tech.scrollIntoViewIfNeeded();
  await tech.click();
  await expect(tech).toHaveAttribute('aria-expanded', 'true');
  const techPanelId = await tech.getAttribute('aria-controls');
  expect(techPanelId).toBeTruthy();
  await expect(page.locator(`#${techPanelId}`)).toBeVisible();
  await tech.click();
  await expect(tech).toHaveAttribute('aria-expanded', 'false');

  const feature = page.locator('button[aria-controls^="feature-detail-"]').first();
  await feature.scrollIntoViewIfNeeded();
  await feature.click();
  await expect(feature).toHaveAttribute('aria-expanded', 'true');
  const featurePanelId = await feature.getAttribute('aria-controls');
  expect(featurePanelId).toBeTruthy();
  await expect(page.locator(`#${featurePanelId}`)).toBeVisible();
  await feature.click();
  await expect(feature).toHaveAttribute('aria-expanded', 'false');

  await expectNoHorizontalOverflow(page, `关于-展开 @ ${testInfo.project.name}`);
  expectCleanErrors(errors, 'C7 关于页展开');
});

test('@interaction C8 跳至内容链接：首个 Tab 聚焦并跳转', async ({ page }, testInfo) => {
  await mockPocketBase(page);
  await openRoute(page, themeOf(testInfo.project.name), '/');

  await page.keyboard.press('Tab');
  const first = page.locator('a[href="#main-content"]').first();
  await expect(first).toBeFocused();
  await expect(first).toBeVisible();

  await page.keyboard.press('Enter');
  expect(await page.evaluate(() => location.hash)).toBe('#main-content');

  // 记录项：main 无 tabindex=-1，Enter 后焦点是否真的移动（不判失败）
  const active = await page.evaluate(() => ({
    tag: document.activeElement?.tagName ?? '',
    id: (document.activeElement as HTMLElement | null)?.id ?? '',
  }));
  testInfo.annotations.push({
    type: 'focus-after-skip-link',
    description: `${testInfo.project.name}: activeElement=${active.tag}${active.id ? '#' + active.id : ''}（main 无 tabindex，预期不移动）`,
  });
});

test.describe('@interaction C9 prefers-reduced-motion', () => {
  test.use({ reducedMotion: 'reduce' });

  test('减少动效：轨道装饰无持续动画、主文案不透明', async ({ page }, testInfo) => {
    test.skip(testInfo.project.name !== 'desktop-light', '只在一个 project 采样，避免重复');
    await mockPocketBase(page);
    await openRoute(page, 'light', '/');
    await page.waitForTimeout(600);

    // 先采样再冻结：freezeTransitions 会把动画改成 paused，否则断言会被自己伪造。
    const orbital = await page.evaluate(() => {
      const scene = document.querySelector<HTMLElement>('[data-orbital-decoration]');
      if (!scene) return null;
      const spin = scene.querySelector<HTMLElement>('.orbital-scene__spin');
      const beam = scene.querySelector<HTMLElement>('.orbital-scene__beam');
      return {
        running: scene
          .getAnimations({ subtree: true })
          .filter((animation) => animation.playState === 'running').length,
        spinAnimation: spin ? getComputedStyle(spin).animationName : '',
        beamAnimation: beam ? getComputedStyle(beam).animationName : '',
      };
    });

    expect(orbital, '首页应存在轨道装饰层').not.toBeNull();
    expect(orbital!.running, '减少动效下轨道装饰不得有运行中的动画').toBe(0);
    expect(orbital!.spinAnimation, '轨道旋转动画应被 reduced-motion 关闭').toBe('none');
    expect(orbital!.beamAnimation, '光带动画应被 reduced-motion 关闭').toBe('none');

    await freezeTransitions(page);
    const opacity = await page.locator('h1').evaluate((el) => getComputedStyle(el).opacity);
    const reducedMotionMatches = await page.evaluate(() =>
      window.matchMedia('(prefers-reduced-motion: reduce)').matches);
    testInfo.annotations.push({
      type: 'reduced-motion',
      description: `orbitalRunning=${orbital!.running}, spin=${orbital!.spinAnimation}, h1Opacity=${opacity}, media=${reducedMotionMatches}`,
    });
    expect(reducedMotionMatches, '浏览器应真的应用 reduced-motion 媒体查询').toBe(true);
    expect(Number(opacity), 'h1 在减少动效下应不透明').toBeGreaterThanOrEqual(0.99);
  });
});

test.describe('@interaction C10 禁用 JavaScript（渐进增强）', () => {
  test.use({ javaScriptEnabled: false, viewport: { width: 390, height: 844 } });

  test('无 JS：标题/主文案/备案信息可见；移动菜单不可打开（记录项）', async ({ page }, testInfo) => {
    test.skip(testInfo.project.name !== 'mobile-light', '只在一个 project 采样，避免重复');
    const response = await page.goto('/', { waitUntil: 'domcontentloaded' });
    expect(response?.status()).toBe(200);
    await expect(page.locator('h1:visible')).toHaveText('胡巴的博客');
    await expect(page.locator('main')).toContainText('分享技术、思考与生活');
    await expect(page.locator('footer')).toContainText('辽ICP备2025065723号-1');

    const burger = page.getByRole('button', { name: '打开导航菜单' });
    await expect(burger).toBeVisible();
    // 无 JS 时按钮存在但无 onClick，抽屉永远不会出现
    await burger.click();
    await page.waitForTimeout(500);
    expect(await page.getByRole('dialog', { name: '移动端侧边导航' }).count()).toBe(0);
    testInfo.annotations.push({
      type: 'no-js-mobile-nav',
      description: '无 JS 时移动端汉堡按钮存在但导航无法打开（client:load 岛未水合）',
    });
  });
});

test('@interaction C11 轨道装饰层：aria-hidden / pointer-events:none / 不遮挡主 CTA', async ({ page }, testInfo) => {
  const errors = collectErrors(page);
  await mockPocketBase(page);
  await openRoute(page, themeOf(testInfo.project.name), '/');

  const scene = page.locator('[data-orbital-decoration]');
  await expect(scene).toHaveCount(1);
  await expect(scene).toHaveAttribute('aria-hidden', 'true');

  // 纯装饰：不拦截指针，也不含任何可聚焦元素。
  const pointerEvents = await scene.evaluate((el) => getComputedStyle(el).pointerEvents);
  expect(pointerEvents, '装饰层必须 pointer-events:none').toBe('none');
  expect(await scene.locator('a, button, input, select, textarea, [tabindex]').count()).toBe(0);

  // 主 CTA 的中心点必须命中 CTA 本身，而不是上面的装饰层。
  const cta = page.locator('main a[href="/posts"]').first();
  await expect(cta).toBeVisible();
  await cta.scrollIntoViewIfNeeded();
  const hit = await cta.evaluate((el) => {
    const rect = el.getBoundingClientRect();
    const target = document.elementFromPoint(rect.left + rect.width / 2, rect.top + rect.height / 2);
    return target ? (target.closest('a') === el ? 'self' : target.tagName.toLowerCase()) : 'none';
  });
  expect(hit, '装饰层不应遮住主 CTA').toBe('self');

  // 真的可以点进去，而不是只靠 elementFromPoint 的静态判断。
  await cta.click();
  await page.waitForURL('**/posts', { timeout: 15_000 });

  expectCleanErrors(errors, 'C11 轨道装饰层');
});

test.describe('@interaction C12 320px 首页', () => {
  test.use({ viewport: { width: 320, height: 900 } });

  test('文案先于真实链路、装饰层不越界、无横向滚动', async ({ page }, testInfo) => {
    test.skip(testInfo.project.name !== 'desktop-light', '320px 只采样一次，避免 4 project 重复');
    const errors = collectErrors(page);
    await mockPocketBase(page);
    await openRoute(page, 'light', '/');

    await expectNoHorizontalOverflow(page, '首页 320px');

    const title = page.locator('h1');
    const telemetry = page.locator('main figure').first();
    await expect(title).toBeVisible();
    await expect(telemetry).toBeVisible();
    const titleBox = await title.boundingBox();
    const telemetryBox = await telemetry.boundingBox();
    expect(titleBox, 'h1 应有尺寸').not.toBeNull();
    expect(telemetryBox, '真实链路 figure 应有尺寸').not.toBeNull();
    expect(titleBox!.y, '320px 下文案应先于真实链路').toBeLessThan(telemetryBox!.y);

    const sceneBox = await page.locator('[data-orbital-decoration]').boundingBox();
    expect(sceneBox, '装饰层应有尺寸').not.toBeNull();
    expect(sceneBox!.x, '装饰层左边界不得越出视口').toBeGreaterThanOrEqual(-1);
    expect(sceneBox!.x + sceneBox!.width, '装饰层右边界不得越出视口').toBeLessThanOrEqual(321);

    const ctaBox = await page.locator('main a[href="/posts"]').first().boundingBox();
    expect(ctaBox, '主 CTA 应有尺寸').not.toBeNull();
    expect(ctaBox!.x, '320px 下 CTA 不应被裁切').toBeGreaterThanOrEqual(-1);
    expect(ctaBox!.x + ctaBox!.width, '320px 下 CTA 不应溢出').toBeLessThanOrEqual(321);

    expectCleanErrors(errors, 'C12 320px 首页');
  });
});

test('@interaction C13 首次访问展示页：欢迎 dialog 焦点/Esc 与注册、重发入口保留', async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== 'desktop-light', '首次访问流程只在一个 project 深跑，避免重复注册');
  const errors = collectErrors(page);
  await mockPocketBase(page);
  await openFirstVisit(page, themeOf(testInfo.project.name), '/');
  await page.waitForFunction(() => !!document.querySelector('main#main-content'));

  const dialog = page.getByRole('dialog', { name: '欢迎引导' });
  await expect(dialog).toBeVisible({ timeout: 20_000 });
  await expect
    .poll(() => page.evaluate(() => !!document.activeElement?.closest('[role="dialog"]')), {
      timeout: 5_000,
      message: '欢迎 dialog 打开后焦点应进入其中',
    })
    .toBe(true);

  // Tab 焦点被限制在 dialog 内（循环回到第一个）。
  for (let i = 0; i < 12; i += 1) await page.keyboard.press('Tab');
  expect(
    await page.evaluate(() => !!document.activeElement?.closest('[role="dialog"]')),
    '连续 Tab 后焦点仍应在 dialog 内',
  ).toBe(true);

  // 注册/重发入口：字段与提交按钮直接可见，不依赖额外认证页面。
  await expect(dialog.getByLabel(/昵称/)).toBeVisible();
  await expect(dialog.getByLabel(/邮箱/)).toBeVisible();
  await expect(dialog.getByLabel(/密码/)).toBeVisible();
  await expect(dialog.getByRole('button', { name: '提交注册' })).toBeVisible();

  // 走真实注册调用（PB 由 mock 接住），验证步骤与「重新发送验证邮件」必须出现。
  await dialog.getByLabel(/昵称/).fill('E2E Reader');
  await dialog.getByLabel(/邮箱/).fill('e2e-reader@example.invalid');
  await dialog.getByLabel(/密码/).fill('reader-pass-123');
  await dialog.getByRole('button', { name: '提交注册' }).click();

  const resend = dialog.getByRole('button', { name: '重新发送验证邮件' });
  await expect(resend).toBeVisible({ timeout: 15_000 });
  await expect(dialog).toContainText('验证邮件已发送至');
  await resend.click();
  await expect(dialog.getByRole('button', { name: /已重新发送/ })).toBeVisible({ timeout: 15_000 });

  // Esc 关闭，写 welcomed，且不再锁背景滚动。
  await page.keyboard.press('Escape');
  await expect(dialog).toBeHidden({ timeout: 5_000 });
  expect(await page.evaluate(() => !!localStorage.getItem('blog-welcomed'))).toBe(true);
  expect(await page.evaluate(() => document.body.style.overflow)).not.toBe('hidden');

  // 展示页以外不出现欢迎遮罩，正文可读可交互。
  await openFirstVisit(page, themeOf(testInfo.project.name), '/posts');
  await page.waitForFunction(() => !!document.querySelector('main#main-content'));
  await expect(page.getByRole('dialog', { name: '欢迎引导' })).toHaveCount(0);
  await expect(page.locator('main h1:visible')).toHaveText('所有文章');
  expect(await page.evaluate(() => document.body.style.overflow), '内页不得被遮罩锁定滚动').not.toBe('hidden');

  // 正文中心点必须命中正文自身，而不是残留遮罩。
  await page.locator('main h1').scrollIntoViewIfNeeded();
  const mainHit = await page.locator('main h1').evaluate((element) => {
    const rect = element.getBoundingClientRect();
    const target = document.elementFromPoint(rect.left + rect.width / 2, rect.top + rect.height / 2);
    return !!target && (target === element || element.contains(target));
  });
  expect(mainHit, '内页 h1 不应被遮罩层截获命中').toBe(true);

  expectCleanErrors(errors, 'C13 首次访问欢迎引导');
});

test('@interaction C14 无预置主题存储：.dark 与实际背景一致，切换后仍一致', async ({ page }, testInfo) => {
  const errors = collectErrors(page);
  await mockPocketBase(page);
  await openWithoutThemePreset(page, '/');
  await page.waitForFunction(() => !!document.querySelector('main#main-content'));
  // body 有 0.3s 的背景色过渡；先在主题切换/采样前冻结，避免读到中间帧。
  await freezeTransitions(page);

  const assertThemeMatchesCanvas = async (tag: string, expectedDark: boolean) => {
    const sample = await sampleTheme(page);
    expect(sample.dark, `${tag} html.dark 应与期望主题一致`).toBe(expectedDark);
    expect(normalizedHex(sample.bodyBackground), `${tag} body 背景应等于 --sf-canvas`)
      .toBe(normalizedHex(sample.canvas));
    const isDarkCanvas = canvasLuminance(sample.bodyBackground) < 0.15;
    expect(isDarkCanvas, `${tag} 实际画布明暗应与 html.dark 一致`).toBe(expectedDark);
    return sample;
  };

  // 没有 blog-theme-mode 时，「跟随系统」由 project 的 colorScheme 决定。
  const prefersDark = themeOf(testInfo.project.name) === 'dark';
  const initial = await assertThemeMatchesCanvas('初始主题', prefersDark);

  // 桌面 Dock 才带主题菜单；移动端只验证无预置存储时的一致性。
  if (!isMobileProject(testInfo.project.name)) {
    await page.getByRole('button', { name: /^主题：/ }).click();
    await page.getByRole('menuitemradio', { name: prefersDark ? /手动固定亮色/ : /手动固定暗色/ }).click();
    await expect
      .poll(() => page.evaluate(() => document.documentElement.classList.contains('dark')))
      .toBe(!prefersDark);

    const switched = await assertThemeMatchesCanvas('切换后', !prefersDark);
    // 修掉恒真的 `not.toBe('')`：切换主题后画布令牌本身必须变化，
    // 否则说明 --sf-canvas 根本没跟随 .dark（只断言「非空」永远成立，发现不了）。
    expect(switched.canvas, '切换后 --sf-canvas 应与初始主题不同').not.toBe(initial.canvas);
    expect(normalizedHex(switched.canvas), '切换后画布颜色应随主题变化')
      .not.toBe(normalizedHex(initial.canvas));

    // 刷新后保持用户选择，class 与实际背景仍必须一致。
    await page.reload({ waitUntil: 'domcontentloaded' });
    await page.waitForFunction(() => !!document.querySelector('main#main-content'));
    await freezeTransitions(page);
    await assertThemeMatchesCanvas('刷新后', !prefersDark);
  }

  expectCleanErrors(errors, 'C14 主题与实际背景一致性');
});
