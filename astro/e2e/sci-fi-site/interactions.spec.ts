/**
 * C 组：交互（移动 Header / 桌面 Dock + 主题菜单 / 登录 tab / 关于展开 / 跳至内容 / 动效 / 无 JS）。
 * Playwright projects 会把每个用例在 4 个视口×主题组合各跑一次；与视口相关的用例内部跳过。
 */
import { test, expect } from '@playwright/test';
import {
  collectErrors,
  expectCleanErrors,
  expectNoHorizontalOverflow,
  freezeTransitions,
  isMobileProject,
  mockPocketBase,
  openRoute,
  themeOf,
} from './fixtures';

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

  test('减少动效：无持续动画且主文案不透明', async ({ page }, testInfo) => {
    test.skip(testInfo.project.name !== 'desktop-light', '只在一个 project 采样，避免重复');
    await mockPocketBase(page);
    await openRoute(page, 'light', '/');
    await page.waitForTimeout(600);
    await freezeTransitions(page);
    const running = await page.evaluate(() =>
      document.getAnimations().filter((a) => a.playState === 'running').length);
    const opacity = await page.locator('h1').evaluate((el) => getComputedStyle(el).opacity);
    testInfo.annotations.push({
      type: 'reduced-motion',
      description: `runningAnimations=${running}, h1Opacity=${opacity}`,
    });
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
