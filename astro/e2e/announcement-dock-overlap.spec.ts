import { test, expect, type Page } from '@playwright/test';

/**
 * 回归测试：顶部公告条（AnnouncementBar）不得被悬浮 Dock 导航（Header）遮挡。
 *
 * 背景（缺陷现象）：
 *   Header 的桌面 Dock 容器是 `position: fixed; top: 0; z-index: 50`；
 *   AnnouncementBar 在 BaseLayout 中渲染在 Header 之后、仍处于正常文档流，
 *   自身没有任何 top 偏移。于是在 sm+ 断点：
 *     - Dock 面板几何：top ≈ 8px，bottom ≈ 72px（1280×800、990×201 均一致）
 *     - 公告条几何：  top = 0px，bottom ≈ 45px（居中的文字在 x 轴中心）
 *   两者在纵向重叠 37px，且 Dock 的 z-index:50 把公告条整条盖住：
 *   公告文字与「关闭公告」按钮都位于 Dock 面板中心区域以内，
 *   document.elementFromPoint 命中的是 .dock-item（关于 / 更多），
 *   用户因此既看不到公告文字，也点不到关闭按钮。
 *
 * 断言只约束「结果正确」，不绑定具体修复方式（给公告条加上 Dock 高度的
 * 顶部偏移、把公告放进 Header 预留区、改成 fixed 第二行等都能通过）：
 *   1. 公告条矩形与 Dock 面板矩形在纵向上不重叠；
 *   2. 公告文字中心点命中的元素属于公告条自身（没有被 Dock 盖住）；
 *   3. 「关闭公告」按钮可正常点击并移除公告条；
 *   4. 关闭后 Dock 仍固定在顶部（它是 viewport-fixed 元素，不应随公告开合移动）。
 *
 * 2026-11-06 追加（无公告时不得预留 80px 空白）：
 *   修复公告重叠时给 BaseLayout 的容器加了恒定 `sm:mt-20`，但公告来自客户端
 *   请求、无公告时 AnnouncementBar 返回 null，容器仍占着 80px 外边距，
 *   main 被整体推下 80px，形成无法接受的空白。追加断言：
 *   5. 桌面端无公告时，容器 computed margin-top 必须为 0px、高度为 0，
 *      main 顶端保持在无公告基线（0px）；
 *   6. 桌面端关闭最后一个公告后，容器 margin-top 同样归 0，main 回到基线。
 *   断言只约束 computed 布局结果，不绑定 `:has()` 等具体实现。
 *
 * 运行（需要先启动本地站点；本仓库本地 dev 常用 4400）：
 *   cd astro
 *   PLAYWRIGHT_BASE_URL=http://127.0.0.1:4400 npx playwright test e2e/announcement-dock-overlap.spec.ts
 *
 * 注意：
 *   - 公告数据来自 PocketBase，本地未启动 PB 时用 page.route 拦截
 *     `/api/collections/announcements/records` 返回固定公告，保证可重复。
 *   - 跳过启动 Splash / 欢迎遮罩（与布局缺陷无关），避免遮挡命中测试。
 */

const BASE_URL =
  process.env.PLAYWRIGHT_BASE_URL || process.env.PUBLIC_SITE_URL || 'http://127.0.0.1:4400';

// 避免 Service Worker 缓存干扰布局/网络 mock（与缺陷无关，仅保证可重复）。
test.use({ serviceWorkers: 'block' });

const MARKER = 'E2E-DOCK-OVERLAP-公告正文';

const announcementRecord = {
  id: 'ann_e2e_dock_overlap',
  collectionId: 'pbc_announcements_e2e',
  collectionName: 'announcements',
  created: '2026-11-01 10:00:00.000Z',
  updated: '2026-11-01 10:00:00.000Z',
  title: '维护通知',
  content: MARKER,
  type: 'warning',
  enabled: true,
};

type AnnouncementItem = typeof announcementRecord;

/** 进入前台首页，注入公告 mock（items 传空数组即无公告），并等待客户端渲染稳定。 */
async function openHome(page: Page, items: AnnouncementItem[] = []) {
  let served = 0;

  await page.addInitScript(() => {
    try {
      localStorage.setItem('blog-welcomed', String(Date.now()));
      localStorage.setItem('blog-splash-seen', String(Date.now()));
      localStorage.setItem('blog-theme-mode', 'light');
    } catch {
      /* ignore */
    }
  });

  await page.route('**/api/collections/announcements/records**', (route) => {
    if (route.request().method() === 'OPTIONS') {
      return route.fulfill({
        status: 204,
        headers: {
          'access-control-allow-origin': '*',
          'access-control-allow-methods': 'GET,OPTIONS',
          'access-control-allow-headers': '*',
        },
      });
    }
    served += 1;
    return route.fulfill({
      status: 200,
      headers: {
        'content-type': 'application/json',
        'access-control-allow-origin': '*',
      },
      body: JSON.stringify({
        page: 1,
        perPage: 3,
        totalItems: items.length,
        totalPages: 1,
        items,
      }),
    });
  });

  await page.goto(`${BASE_URL}/`, { waitUntil: 'load' });

  // Vite 首次访问会做依赖预构建并整页刷新，等它稳定后再轮询，避免
  // "Execution context was destroyed, most likely because of a navigation"。
  await page.waitForLoadState('load');

  // 确认公告 mock 确实被请求过，避免「还没发请求就测量」得到假稳定。
  await expect
    .poll(() => served, { timeout: 20_000, message: '公告 mock 未被请求（检查 announcements 接口路径或客户端水合）' })
    .toBeGreaterThan(0);

  if (items.length > 0) {
    await expect
      .poll(
        async () =>
          page.evaluate((marker) => {
            const text = Array.from(document.querySelectorAll('span')).find((s) => s.textContent?.includes(marker));
            return Boolean(text) && Boolean(document.querySelector('.dock-panel'));
          }, MARKER),
        { timeout: 20_000, message: '公告条或 Dock 未完成客户端渲染（检查 announcements mock 与 client:idle 水合）' },
      )
      .toBe(true);
  }

  // 等待入口动画（Dock 从 y:-100 归位、公告从 y:-8 归位）结束再测量几何，
  // 否则得到的是动画中间帧。
  let previous = '';
  await expect
    .poll(
      async () => {
        const current = await page.evaluate(() => {
          const panel = document.querySelector('.dock-panel');
          const bar = document.querySelector('button[aria-label="关闭公告"]')?.parentElement?.parentElement;
          const p = panel?.getBoundingClientRect();
          const b = bar?.getBoundingClientRect();
          return `${p?.top}/${p?.height}/${p?.left}|${b?.top}/${b?.height}`;
        });
        const stable = current === previous;
        previous = current;
        return stable;
      },
      { timeout: 10_000, intervals: [250], message: '公告条 / Dock 几何未在 10s 内稳定' },
    )
    .toBe(true);
}

async function openHomeWithAnnouncement(page: Page) {
  await openHome(page, [announcementRecord]);
}

/** 公告条根节点：关闭按钮 → 内层 flex → 公告条（border-b）。 */
function announcementBar(page: Page) {
  return page.getByRole('button', { name: '关闭公告' }).locator('xpath=../..');
}

/**
 * 读取「公告容器」（main 前一个兄弟节点）与 main 的 computed 布局指标：
 *   - containerMarginTop：容器实际生效的 margin-top（实现无关，只认结果）；
 *   - mainTop：main 相对视口的顶端位置（无公告基线应为 0）。
 */
async function readChromeGap(page: Page) {
  return page.evaluate(() => {
    const main = document.querySelector('main#main-content') as HTMLElement | null;
    if (!main) return null;
    const container = main.previousElementSibling as HTMLElement | null;
    const bar = document.querySelector('.announcement-bar');
    return {
      containerMarginTop: container ? getComputedStyle(container).marginTop : null,
      containerPaddingTop: container ? getComputedStyle(container).paddingTop : null,
      containerHeight: container ? container.getBoundingClientRect().height : null,
      mainTop: main.getBoundingClientRect().top,
      announcementBarCount: document.querySelectorAll('.announcement-bar').length,
      barTop: bar ? bar.getBoundingClientRect().top : null,
    };
  });
}

for (const viewport of [
  { width: 1280, height: 800 },
  { width: 990, height: 201 },
]) {
  test(`桌面 ${viewport.width}×${viewport.height}：公告条不与 Dock 重叠且关闭按钮可点击`, async ({ page }) => {
    test.setTimeout(90_000);
    await page.setViewportSize(viewport);
    await openHomeWithAnnouncement(page);

    const bar = announcementBar(page);
    const dock = page.getByRole('toolbar', { name: '站点导航工具栏' });
    await expect(dock).toBeVisible();
    await expect(bar).toBeVisible();

    // 0) 公告存在时，容器在桌面端必须真的预留 Dock 高度的 top margin（80px），
    //    且公告根节点带稳定标识，供容器 :has() 条件边距命中。
    const gapWithAnnouncement = await readChromeGap(page);
    expect(gapWithAnnouncement, '应能定位公告容器与 main').not.toBeNull();
    expect(gapWithAnnouncement!.announcementBarCount, '公告根节点应带 announcement-bar 标识').toBeGreaterThan(0);
    expect(gapWithAnnouncement!.containerMarginTop, '公告存在时桌面容器应预留 80px 顶部边距').toBe('80px');
    expect(Math.round(gapWithAnnouncement!.mainTop), '公告存在时 main 应被推离视口顶端').toBeGreaterThan(0);

    const [barBox, dockBox] = await Promise.all([bar.boundingBox(), dock.boundingBox()]);
    expect(barBox, '公告条应存在几何矩形').not.toBeNull();
    expect(dockBox, 'Dock 面板应存在几何矩形').not.toBeNull();

    const barTop = barBox!.y;
    const barBottom = barBox!.y + barBox!.height;
    const dockTop = dockBox!.y;
    const dockBottom = dockBox!.y + dockBox!.height;
    const verticalOverlap = Math.min(barBottom, dockBottom) - Math.max(barTop, dockTop);

    // 1) 纵向不得重叠（公告条要么在 Dock 上方，要么在 Dock 下方）。
    expect(
      verticalOverlap,
      `公告条 [${barTop.toFixed(1)}, ${barBottom.toFixed(1)}] 与 Dock [${dockTop.toFixed(1)}, ${dockBottom.toFixed(1)}] 纵向重叠 ${verticalOverlap.toFixed(1)}px`,
    ).toBeLessThanOrEqual(0);

    // 2) 公告文字中心点必须命中公告条自身，而不是 Dock 导航项。
    const hit = await page.evaluate((marker) => {
      const text = Array.from(document.querySelectorAll('span')).find((s) => s.textContent?.includes(marker));
      if (!text) return { found: false } as const;
      const r = text.getBoundingClientRect();
      const hitEl = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2);
      return {
        found: true,
        hitTag: hitEl?.tagName ?? null,
        hitLabel: hitEl?.getAttribute('aria-label') ?? null,
        hitInDock: Boolean(hitEl?.closest('.dock-panel')),
        hitInAnnouncement: Boolean(hitEl && (hitEl === text || text.contains(hitEl))),
      } as const;
    }, MARKER);

    expect(hit.found, '公告文字未渲染').toBe(true);
    expect(
      hit.hitInAnnouncement,
      `公告文字中心被遮挡：命中 ${hit.hitTag}(aria-label=${hit.hitLabel})，hitInDock=${hit.hitInDock}`,
    ).toBe(true);

    // 3) 关闭按钮必须真的可点击（当前会被 Dock 的 .dock-item 截获）。
    await page.mouse.move(5, 300); // 移开鼠标，避免 Dock 放大态影响动作性判断
    await page.getByRole('button', { name: '关闭公告' }).click({ timeout: 5_000 });
    await expect(bar).toHaveCount(0, { timeout: 5_000 });

    // 4) Dock 是 fixed 顶部导航，关闭公告后不应发生位移（公告在其下方，不参与 Dock 布局）。
    const dockAfter = await dock.boundingBox();
    expect(dockAfter, '关闭公告后 Dock 应仍然存在').not.toBeNull();
    expect(Math.round(dockAfter!.y), '关闭公告后 Dock 顶部位置不应变化').toBe(Math.round(dockTop));

    // 5) 关闭最后一个公告后，容器不得继续预留 80px：margin 归 0、高度归 0、main 回基线。
    await expect
      .poll(async () => (await readChromeGap(page))?.containerMarginTop, {
        timeout: 5_000,
        message: '关闭最后一个公告后容器仍预留顶部边距（退出动画结束也未归 0）',
      })
      .toBe('0px');
    const gapAfterClose = await readChromeGap(page);
    expect(gapAfterClose, '关闭公告后应仍能定位 main').not.toBeNull();
    expect(gapAfterClose!.announcementBarCount, '关闭后不应残留公告根节点').toBe(0);
    expect(gapAfterClose!.containerHeight, '关闭后公告容器高度应归 0').toBe(0);
    expect(Math.round(gapAfterClose!.mainTop), '关闭最后一个公告后 main 顶端应回到 0 基线').toBe(0);
  });
}

test('桌面 1280×800：无公告时容器不预留顶部空白（margin=0、main 顶端不变）', async ({ page }) => {
  test.setTimeout(90_000);
  await page.setViewportSize({ width: 1280, height: 800 });
  await openHome(page, []);

  const gap = await readChromeGap(page);
  expect(gap, '应能定位公告容器与 main').not.toBeNull();
  expect(gap!.announcementBarCount, '无公告时不应存在公告根节点').toBe(0);
  expect(gap!.containerMarginTop, '无公告时公告容器不得预留 80px 顶部空白').toBe('0px');
  expect(gap!.containerHeight, '无公告时公告容器高度应为 0').toBe(0);
  expect(Math.round(gap!.mainTop), '无公告时 main 顶端不应被下推（保持无公告基线 0）').toBe(0);
});

test('移动端 375×812：Dock 隐藏，公告条正常渲染且可关闭（对照组）', async ({ page }) => {
  test.setTimeout(90_000);
  await page.setViewportSize({ width: 375, height: 812 });
  await openHomeWithAnnouncement(page);

  const bar = announcementBar(page);
  await expect(bar).toBeVisible();
  await expect(page.getByRole('toolbar', { name: '站点导航工具栏' })).toBeHidden();

  // 移动端保持现状：公告正常显示，容器不得出现桌面条件边距（sm 断点外）。
  const gapMobile = await readChromeGap(page);
  expect(gapMobile, '移动端应能定位公告容器与 main').not.toBeNull();
  expect(gapMobile!.containerMarginTop, '移动端公告容器不应预留桌面 80px 边距').toBe('0px');

  const mobileLayout = await page.evaluate((marker) => {
    const text = Array.from(document.querySelectorAll('.announcement-bar span')).find((el) => el.textContent?.includes(marker));
    const close = document.querySelector('button[aria-label="关闭公告"]');
    const burger = document.querySelector('button[aria-label="打开导航菜单"]');
    if (!text || !close || !burger) return null;
    const textRect = text.getBoundingClientRect();
    const burgerRect = burger.getBoundingClientRect();
    const hit = document.elementFromPoint(textRect.left + 2, textRect.top + textRect.height / 2);
    return {
      barTop: announcementBarRect(text).top,
      burgerBottom: burgerRect.bottom,
      hitInsideText: Boolean(hit && (hit === text || text.contains(hit))),
    };
    function announcementBarRect(el: Element) {
      return el.closest('.announcement-bar')!.getBoundingClientRect();
    }
  }, MARKER);
  expect(mobileLayout, '移动端公告文字、关闭按钮与汉堡按钮应存在').not.toBeNull();
  expect(mobileLayout!.barTop, '公告应在汉堡按钮下方，不能遮住公告文字').toBeGreaterThanOrEqual(mobileLayout!.burgerBottom);
  expect(mobileLayout!.hitInsideText, '公告文字起点不能被汉堡按钮截获').toBe(true);

  await page.getByRole('button', { name: '关闭公告' }).click({ timeout: 5_000 });
  await expect(bar).toHaveCount(0, { timeout: 5_000 });
  await expect.poll(async () => (await readChromeGap(page))?.containerPaddingTop).toBe('0px');
});
