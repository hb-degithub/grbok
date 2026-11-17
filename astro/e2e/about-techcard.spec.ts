import { test, expect, type Locator, type Page } from '@playwright/test';

/**
 * 回归测试：关于页 →「技术栈」卡片在桌面端点击后必须真正看到内联详情，再点收起。
 *
 * 背景：旧实现的详情浮层（role="tooltip"）用 `absolute bottom-full` 定位在卡片上方，
 * 被外层 GlareHover 的 `overflow: hidden` 整块裁切；而点击展开又被
 * `(hover: none)` 媒体查询限制，桌面端无法查看详情。
 *
 * 修复契约（桌面与触屏统一「点击内联展开」）：
 *   1. 紧凑行是可访问的 button[type=button]，aria-expanded 表示状态，
 *      aria-controls 指向已挂载的内联详情容器；
 *   2. 点击后在卡片下方内联展开，详情文本真实可见、可命中、未被祖先 overflow 裁切；
 *   3. 再次点击收起（容器高度归零、aria-expanded=false），不再是悬浮 tooltip；
 *   4. 键盘 focus-visible 焦点环使用 inset 阴影，落在按钮盒内，不被
 *      GlareHover 的 overflow:hidden 裁切（补强：ring-offset 的 outset 阴影会被裁掉）；
 *   5. 触屏（375 / hasTouch）点按同样能展开与收起。
 *
 * 运行（需要先启动本地站点；默认 4321）：
 *   cd astro && PLAYWRIGHT_BASE_URL=http://127.0.0.1:4321 npx playwright test e2e/about-techcard.spec.ts
 */

const BASE_URL = process.env.PLAYWRIGHT_BASE_URL || process.env.PUBLIC_SITE_URL || 'http://127.0.0.1:4321';
const CARD_NAME = /Astro 6\.4/;
const DETAIL_TEXT = '纯静态生成（SSG）元框架';

test.use({ viewport: { width: 1205, height: 900 } });

async function openAboutPage(page: Page) {
  // 跳过首次访问欢迎引导，避免遮罩拦截鼠标/触摸事件（生命周期与本次缺陷无关）。
  await page.addInitScript(() => {
    try {
      localStorage.setItem('blog-welcomed', String(Date.now()));
    } catch {
      /* ignore */
    }
  });
  await page.goto(`${BASE_URL}/about`, { waitUntil: 'load' });
  // 显式等待启动遮罩退出，否则点击/点按会被拦截；不再用固定 sleep 代替条件等待。
  await expect(page.locator('[role="status"][aria-label="页面加载中"]')).toBeHidden({ timeout: 20_000 });
}

/**
 * 等 TechCard 的 astro-island 真正完成 React 水合：Astro 在 hydrate 成功后移除
 * 服务端渲染标记 `ssr`。不能用 `visible` 或固定 sleep 当水合信号——
 * SSR HTML 里按钮本来就可见，但事件处理器尚未挂载。
 */
async function waitForTechCardHydration(toggle: Locator) {
  const island = toggle.locator('xpath=ancestor::astro-island[1]');
  await expect(island, '紧凑行必须位于 TechCard 的 astro-island 中').toHaveCount(1);
  // client:visible 岛屿需要先进入视口，IntersectionObserver 才会触发水合。
  await toggle.scrollIntoViewIfNeeded();
  await expect
    .poll(() => island.evaluate((el) => el.hasAttribute('ssr')), {
      message: 'TechCard astro-island 必须完成水合（ssr 属性移除）后再点击',
      timeout: 30_000,
      intervals: [100, 200, 300, 500],
    })
    .toBe(false);
}

/** 把元素滚动到视口中央，避免被固定顶栏遮挡后点击失败。 */
async function centerInViewport(locator: Locator) {
  await locator.evaluate((el) => el.scrollIntoView({ block: 'center', inline: 'center' }));
  await expect(locator).toBeVisible();
}

async function panelHeight(panel: Locator) {
  return panel.evaluate((el) => el.getBoundingClientRect().height);
}

/** 等 grid-template-rows 展开/收起过渡收敛到稳定高度，避免量到中间帧。 */
async function waitForPanelSettled(panel: Locator) {
  await panel.evaluate(async (el) => {
    const read = () => el.getBoundingClientRect().height;
    let last = read();
    let stableFrames = 0;
    const deadline = performance.now() + 5000;
    while (performance.now() < deadline) {
      await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
      const current = read();
      stableFrames = Math.abs(current - last) < 0.01 ? stableFrames + 1 : 0;
      last = current;
      if (stableFrames >= 3) return;
    }
  });
}

/** 用键盘（Tab）把焦点移入按钮：只有键盘聚焦才会稳定命中 :focus-visible。 */
async function keyboardFocusToggle(page: Page, toggle: Locator) {
  await centerInViewport(toggle);
  // 移开指针：按钮 hover 时有 -translate-y-0.5，会让视觉盒上移 2px、
  // 被 GlareHover 裁到顶部；键盘焦点场景应测无 hover 的静止几何。
  await page.mouse.move(1, 1);
  // 先脚本聚焦再 Shift+Tab / Tab 往返，确保最后一次焦点落点是键盘导航。
  await toggle.focus();
  await page.keyboard.press('Shift+Tab');
  await page.keyboard.press('Tab');
  await expect(toggle).toBeFocused();
}

/**
 * 按钮带 `transition-all duration-200`：box-shadow 焦点环会从全透明过渡到最终值，
 * hover 的 -translate-y-0.5 也会影响 rect。用 rAF 轮询，直到两者连续若干帧稳定。
 */
async function waitForStableFocusRing(toggle: Locator) {
  await toggle.evaluate(async (el) => {
    const readShadow = () => getComputedStyle(el).boxShadow;
    const readTop = () => el.getBoundingClientRect().top;
    let lastShadow = readShadow();
    let lastTop = readTop();
    let stableFrames = 0;
    const deadline = performance.now() + 5000;
    while (performance.now() < deadline) {
      await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
      const shadow = readShadow();
      const top = readTop();
      const same = shadow === lastShadow && Math.abs(top - lastTop) < 0.01;
      stableFrames = same ? stableFrames + 1 : 0;
      lastShadow = shadow;
      lastTop = top;
      if (stableFrames >= 3 && shadow !== 'none') return;
    }
  });
}

/**
 * 读取焦点环的真实几何/样式：
 *   - box-shadow 中是否存在可见的 inset 环（键盘焦点样式生效）；
 *   - 非 inset 阴影的扩散半径会伸出按钮盒，逐级检查 overflow 祖先的
 *     padding box 是否把它裁掉（ring-offset 方案失败的原因）。
 */
async function readFocusRing(toggle: Locator) {
  return toggle.evaluate((el) => {
    const cs = getComputedStyle(el);
    const shadow = cs.boxShadow && cs.boxShadow !== 'none' ? cs.boxShadow : '';
    const shadows = shadow
      .split(/,(?![^(]*\))/)
      .map((part) => part.trim())
      .filter(Boolean)
      .map((raw) => {
        const inset = /(^|\s)inset(\s|$)/.test(raw);
        const spreadMatch = raw.match(/(?:^|\s)(-?\d+(?:\.\d+)?)px(?=\s*(?:inset\s*)?$)/);
        const transparent = /transparent|rgba\(\s*0,\s*0,\s*0,\s*0\s*\)|oklab\([^)]*\/\s*0(?:\.0+)?\s*\)/.test(raw);
        return {
          raw,
          inset,
          spread: spreadMatch ? Number.parseFloat(spreadMatch[1]) : 0,
          visible: !transparent,
        };
      });

    // 只有非 inset 阴影会伸出按钮盒；它必须仍落在每条 overflow 裁切线的内测。
    const outsetSpread = Math.max(0, ...shadows.filter((s) => s.visible && !s.inset).map((s) => s.spread));
    const rect = el.getBoundingClientRect();
    const required = {
      left: rect.left - outsetSpread,
      right: rect.right + outsetSpread,
      top: rect.top - outsetSpread,
      bottom: rect.bottom + outsetSpread,
    };

    const clippedBy: Array<{ selector: string; outX: boolean; outY: boolean; outsetSpread: number }> = [];
    for (let node: Element | null = el.parentElement; node; node = node.parentElement) {
      const s = getComputedStyle(node);
      const clipX = ['hidden', 'clip', 'auto', 'scroll'].includes(s.overflowX);
      const clipY = ['hidden', 'clip', 'auto', 'scroll'].includes(s.overflowY);
      if (!clipX && !clipY) continue;
      // overflow 在 padding box 裁切（含 padding，不含 border/滚动条）。
      const r = node.getBoundingClientRect();
      const box = {
        left: r.left + node.clientLeft,
        right: r.left + node.clientLeft + node.clientWidth,
        top: r.top + node.clientTop,
        bottom: r.top + node.clientTop + node.clientHeight,
      };
      // clientWidth/clientHeight 是取整值，留 1px 子像素容差；旧 ring-offset 外扩 4px 仍会被稳定命中。
      const outX = clipX && (required.left < box.left - 1 || required.right > box.right + 1);
      const outY = clipY && (required.top < box.top - 1 || required.bottom > box.bottom + 1);
      if (outX || outY) {
        clippedBy.push({
          selector: node.className ? `.${String(node.className).split(' ')[0]}` : node.tagName,
          outX,
          outY,
          outsetSpread,
        });
      }
    }

    return {
      focusVisible: el.matches(':focus-visible'),
      boxShadow: shadow,
      shadows,
      outsetSpread,
      clippedBy,
      rect: {
        left: +rect.left.toFixed(1),
        right: +rect.right.toFixed(1),
        top: +rect.top.toFixed(1),
        bottom: +rect.bottom.toFixed(1),
      },
    };
  });
}

/** 键盘焦点环必须可见且不被祖先裁切。 */
function assertFocusRingVisible(state: Awaited<ReturnType<typeof readFocusRing>>) {
  expect(state.focusVisible, `键盘焦点必须命中 :focus-visible：${JSON.stringify(state)}`).toBe(true);
  expect(state.boxShadow, '键盘焦点必须有可见的 box-shadow 焦点环').not.toBe('');

  // 关闭 ring-offset 方案后，焦点环应由 inset 阴影绘制（阴影不会伸出按钮盒）。
  const insetRing = state.shadows.find((s) => s.inset && s.visible && s.spread >= 2);
  expect(
    insetRing,
    `键盘焦点环必须是可见的 inset ring（spread ≥ 2px）：${JSON.stringify(state)}`,
  ).toBeTruthy();

  // 非 inset 阴影（旧 ring-offset 方案）会被 GlareHover overflow:hidden 裁切。
  expect(
    state.clippedBy,
    `焦点环被祖先 overflow 裁切：${JSON.stringify(state)}`,
  ).toEqual([]);
}

test('桌面端点击技术栈卡片内联展开详情，再次点击收起', async ({ page }) => {
  test.setTimeout(90_000);
  await openAboutPage(page);

  const toggle = page.getByRole('button', { name: CARD_NAME }).first();
  await centerInViewport(toggle);
  // 交互前必须等到 astro-island 水合完成（ssr 属性移除），否则点击会丢事件。
  await waitForTechCardHydration(toggle);
  await expect(toggle).toHaveAttribute('type', 'button');
  await expect(toggle).toHaveAttribute('aria-expanded', 'false');

  const panelId = await toggle.getAttribute('aria-controls');
  expect(panelId, '紧凑行必须通过 aria-controls 关联内联详情容器').toBeTruthy();
  const panel = page.locator(`[id="${panelId}"]`);
  await expect(panel).toHaveCount(1);
  // 收起时容器仍挂载（供过渡动画），但视觉高度为 0。
  await expect.poll(() => panelHeight(panel), { timeout: 5000 }).toBeLessThan(1);

  // 点击展开（修复前桌面端点击被 (hover: none) 禁用，此处会失败）。
  await centerInViewport(toggle);
  await toggle.click();

  await expect(toggle).toHaveAttribute('aria-expanded', 'true');
  await expect(panel).toHaveAttribute('aria-hidden', 'false');
  await expect.poll(() => panelHeight(panel), { timeout: 5000 }).toBeGreaterThan(20);

  const detail = panel.getByText(DETAIL_TEXT, { exact: false }).first();
  await expect(detail).toBeAttached();
  await detail.scrollIntoViewIfNeeded();
  await expect(detail).toBeVisible();
  // 等 grid-template-rows 过渡结束，再测量几何与不透明度。
  await waitForPanelSettled(panel);

  const diagnostics = await detail.evaluate((el) => {
    const rect = el.getBoundingClientRect();
    const cx = rect.left + rect.width / 2;
    const cy = rect.top + rect.height / 2;
    const hit = document.elementFromPoint(cx, cy);

    let effectiveOpacity = 1;
    for (let node: Element | null = el; node; node = node.parentElement) {
      effectiveOpacity *= Number.parseFloat(getComputedStyle(node).opacity || '1');
    }

    const clippedBy: Array<{ selector: string; outY: boolean; outX: boolean }> = [];
    for (let node: Element | null = el.parentElement; node; node = node.parentElement) {
      const s = getComputedStyle(node);
      const clipX = ['hidden', 'clip', 'auto', 'scroll'].includes(s.overflowX);
      const clipY = ['hidden', 'clip', 'auto', 'scroll'].includes(s.overflowY);
      if (!clipX && !clipY) continue;
      const r = node.getBoundingClientRect();
      const outX = clipX && (rect.left < r.left - 0.5 || rect.right > r.right + 0.5);
      const outY = clipY && (rect.top < r.top - 0.5 || rect.bottom > r.bottom + 0.5);
      if (outX || outY) {
        clippedBy.push({ selector: node.className ? `.${String(node.className).split(' ')[0]}` : node.tagName, outX, outY });
      }
    }

    return {
      rect: { top: +rect.top.toFixed(1), bottom: +rect.bottom.toFixed(1), width: +rect.width.toFixed(1) },
      effectiveOpacity: +effectiveOpacity.toFixed(3),
      hitInsideDetail: !!hit && (hit === el || el.contains(hit) || hit.contains(el)),
      hitTag: hit ? `${hit.tagName}.${String(hit.className).slice(0, 40)}` : null,
      clippedBy,
    };
  });

  // 有效不透明度：排除 opacity:0 / display:none 的「假渲染」。
  expect(diagnostics.effectiveOpacity, `详情有效不透明度不足：${JSON.stringify(diagnostics)}`).toBeGreaterThan(0.5);

  // 命中测试：详情中心的最上层元素必须属于详情自身，否则说明被裁切/被遮挡。
  expect(diagnostics.hitInsideDetail, `详情中心点命中的是 ${diagnostics.hitTag}：${JSON.stringify(diagnostics)}`).toBe(true);

  // 垂直方向不得被任何 overflow: hidden/clip 的祖先截断。
  expect(diagnostics.clippedBy, `详情被祖先裁切：${JSON.stringify(diagnostics)}`).toEqual([]);

  // 本卡片内不再有被裁切的悬浮 tooltip（页面其他组件仍可能使用 tooltip，故按卡片范围断言）。
  const tooltipCountInCard = await panel.evaluate((el) => {
    const cardRoot = el.parentElement; // TechCard 根节点（panel 的直接父元素）
    return cardRoot ? cardRoot.querySelectorAll('[role="tooltip"]').length : -1;
  });
  expect(tooltipCountInCard, '技术栈卡片不应再渲染悬浮 tooltip 浮层').toBe(0);

  // 再次点击收起。
  await centerInViewport(toggle);
  await toggle.click();

  await expect(toggle).toHaveAttribute('aria-expanded', 'false');
  await expect(panel).toHaveAttribute('aria-hidden', 'true');
  await expect.poll(() => panelHeight(panel), { timeout: 5000 }).toBeLessThan(1);
  // 始终挂载，收起只是视觉折叠。
  await expect(panel).toBeAttached();

  // 键盘可达：原生 button 的 Enter / Space 激活与点击等价。
  await keyboardFocusToggle(page, toggle);

  // 补强：键盘 focus-visible 焦点环必须可见，且不被 GlareHover 的 overflow:hidden 裁切。
  // 先等 box-shadow 过渡稳定，再读取真实渲染值（动画中间帧全是透明零扩散）。
  await waitForStableFocusRing(toggle);
  const ringState = await readFocusRing(toggle);
  assertFocusRingVisible(ringState);

  await page.keyboard.press('Enter');
  await expect(toggle).toHaveAttribute('aria-expanded', 'true');
  await expect.poll(() => panelHeight(panel), { timeout: 5000 }).toBeGreaterThan(20);
  await page.keyboard.press('Space');
  await expect(toggle).toHaveAttribute('aria-expanded', 'false');
  await expect.poll(() => panelHeight(panel), { timeout: 5000 }).toBeLessThan(1);
});

test.describe('触屏 375（hasTouch）', () => {
  test.use({
    viewport: { width: 375, height: 812 },
    hasTouch: true,
    isMobile: true,
    deviceScaleFactor: 2,
  });

  test('点按技术栈卡片内联展开详情，再次点按收起', async ({ page }) => {
    test.setTimeout(90_000);
    await openAboutPage(page);

    const toggle = page.getByRole('button', { name: CARD_NAME }).first();
    await centerInViewport(toggle);
    // 触屏同样必须显式等待 astro-island 水合完成后再点按。
    await waitForTechCardHydration(toggle);
    await expect(toggle).toHaveAttribute('aria-expanded', 'false');

    const panelId = await toggle.getAttribute('aria-controls');
    expect(panelId, '紧凑行必须通过 aria-controls 关联内联详情容器').toBeTruthy();
    const panel = page.locator(`[id="${panelId}"]`);
    await expect(panel).toHaveCount(1);
    await expect.poll(() => panelHeight(panel), { timeout: 5000 }).toBeLessThan(1);

    // 触屏点按展开（hasTouch 下 tap 走真实触摸事件序列）。
    await centerInViewport(toggle);
    await toggle.tap();

    await expect(toggle).toHaveAttribute('aria-expanded', 'true');
    await expect(panel).toHaveAttribute('aria-hidden', 'false');
    await expect.poll(() => panelHeight(panel), { timeout: 5000 }).toBeGreaterThan(20);

    const detail = panel.getByText(DETAIL_TEXT, { exact: false }).first();
    await expect(detail).toBeAttached();
    await detail.scrollIntoViewIfNeeded();
    await expect(detail).toBeVisible();
    // 等 grid-template-rows 过渡结束再测量，避免读到中间帧。
    await waitForPanelSettled(panel);
    await expect.poll(() => panelHeight(panel), { timeout: 5000 }).toBeGreaterThan(20);

    // 再次点按收起。
    await centerInViewport(toggle);
    await toggle.tap();

    await expect(toggle).toHaveAttribute('aria-expanded', 'false');
    await expect(panel).toHaveAttribute('aria-hidden', 'true');
    await expect.poll(() => panelHeight(panel), { timeout: 5000 }).toBeLessThan(1);
    await expect(panel).toBeAttached();
  });
});
