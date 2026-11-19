/**
 * A5 组：关键令牌对比度 + 关键文本 + 主 CTA + 认证页/后台工作台采样。
 * 采样前冻结过渡，避免 0.3s 颜色过渡造成中间帧假失败。
 * 用例由 Playwright projects 自动在 4 个视口×主题组合上各跑一次。
 */
import { test, expect } from '@playwright/test';
import {
  collectErrors,
  contrastAudit,
  contrastRatio,
  expectCleanErrors,
  freezeTransitions,
  mockAdminSession,
  mockPocketBase,
  openAdminWorkPage,
  openRoute,
  parseCssColor,
  scrollThrough,
  themeOf,
  tokenSnapshot,
  type ColorTokenSnapshot,
  type ContrastSample,
} from './fixtures';

function fmt(sample: ContrastSample) {
  return `${sample.selector} "${sample.text}" ${sample.color} on ${sample.background} = ${sample.ratio}:1 (需 ${sample.need})`;
}

/**
 * 令牌对：正文/次级文本 4.5，控件边界 3.0，语义色（危险/成功/警告/信息）
 * 作为文本时同样 4.5。色值本身不写死，全部来自浏览器计算样式。
 */
const TOKEN_PAIRS: Array<[string, string, number]> = [
  ['--sf-ink', '--sf-canvas', 4.5],
  ['--sf-ink', '--sf-surface', 4.5],
  ['--sf-ink-2', '--sf-canvas', 4.5],
  ['--sf-ink-2', '--sf-surface', 4.5],
  ['--sf-ink-3', '--sf-canvas', 4.5],
  ['--sf-ink-3', '--sf-surface', 4.5],
  ['--sf-accent', '--sf-canvas', 4.5],
  ['--sf-accent-ink', '--sf-surface', 4.5],
  ['--sf-on-accent', '--sf-accent', 4.5],
  ['--sf-line-control', '--sf-canvas', 3.0],
  ['--sf-line-control', '--sf-surface', 3.0],
  ['--sf-danger', '--sf-canvas', 4.5],
  ['--sf-danger', '--sf-surface', 4.5],
  ['--sf-success', '--sf-canvas', 4.5],
  ['--sf-success', '--sf-surface', 4.5],
  ['--sf-warning', '--sf-canvas', 4.5],
  ['--sf-warning', '--sf-surface', 4.5],
  ['--sf-info', '--sf-canvas', 4.5],
  ['--sf-info', '--sf-surface', 4.5],
];

function tokenViolations(snapshot: ColorTokenSnapshot): string[] {
  const violations: string[] = [];
  for (const [fgName, bgName, need] of TOKEN_PAIRS) {
    const fg = parseCssColor(snapshot.tokens[fgName] ?? '');
    const bg = parseCssColor(snapshot.tokens[bgName] ?? '');
    if (!fg || !bg) {
      violations.push(`${fgName}/${bgName} 令牌缺失或不可解析`);
      continue;
    }
    const ratio = Number(contrastRatio(fg, bg).toFixed(2));
    if (ratio < need) violations.push(`${fgName}/${bgName} = ${ratio}:1 (需 ${need})`);
  }
  return violations;
}

test(`@contrast 令牌对与关键文本对比度`, async ({ page }, testInfo) => {
  const theme = themeOf(testInfo.project.name);
  const errors = collectErrors(page);
  await mockPocketBase(page);
  await openRoute(page, theme, '/');
  await scrollThrough(page);
  await freezeTransitions(page);

  const snapshot = await tokenSnapshot(page);
  expect(tokenViolations(snapshot), `${testInfo.project.name} 令牌对对比度不足`).toEqual([]);

  // 关键文本：标题 / 正文段落 / 页脚（不含链接，链接单独用例定位根因）
  const audit = await contrastAudit(page, ['h1', 'main p', 'footer p'], 4);
  expect(audit.samples.length, `${testInfo.project.name} 应采样到关键文本`).toBeGreaterThan(0);
  expect(audit.violations.map(fmt), `${testInfo.project.name} 关键文本对比度不足`).toEqual([]);

  expectCleanErrors(errors, `${testInfo.project.name} 对比度采样`);
});

test(`@contrast 主 CTA 对比度`, async ({ page }, testInfo) => {
  const theme = themeOf(testInfo.project.name);
  await mockPocketBase(page);
  await openRoute(page, theme, '/');
  await freezeTransitions(page);

  const cta = page.locator('main a[href="/posts"]').first();
  await expect(cta).toBeVisible();
  const sample = await cta.evaluate((el) => {
    const parse = (value: string) => {
      const m = value.match(/rgba?\(([^)]+)\)/i);
      if (!m) return null;
      const p = m[1].split(/[ ,/]+/).filter(Boolean).map(Number);
      return { r: p[0], g: p[1], b: p[2], a: p[3] ?? 1 };
    };
    const bgOf = (node: Element) => {
      for (let n: Element | null = node; n; n = n.parentElement) {
        const c = parse(getComputedStyle(n).backgroundColor);
        if (c && c.a >= 0.99) return c;
      }
      return parse(getComputedStyle(document.body).backgroundColor);
    };
    const cs = getComputedStyle(el);
    const bg = bgOf(el) || { r: 255, g: 255, b: 255, a: 1 };
    return {
      text: (el.textContent || '').trim(),
      color: cs.color,
      background: `rgb(${bg.r}, ${bg.g}, ${bg.b})`,
      fontSize: parseFloat(cs.fontSize),
      fontWeight: parseInt(cs.fontWeight, 10) || 400,
    };
  });
  const fg = parseCssColor(sample.color)!;
  const bg = parseCssColor(sample.background)!;
  const ratio = Number(contrastRatio(fg, bg).toFixed(2));
  const large = sample.fontSize >= 24 || (sample.fontSize >= 18.66 && sample.fontWeight >= 700);
  const need = large ? 3 : 4.5;
  expect(
    ratio,
    `主 CTA 对比度不足 @ / ${testInfo.project.name} (${theme}) selector=main a[href="/posts"] text="${sample.text}" color=${sample.color} bg=${sample.background}`,
  ).toBeGreaterThanOrEqual(need);
});

test(`@contrast 链接文本对比度（根因定位）`, async ({ page }, testInfo) => {
  const theme = themeOf(testInfo.project.name);
  await mockPocketBase(page);
  await openRoute(page, theme, '/');
  await scrollThrough(page);
  await freezeTransitions(page);

  const audit = await contrastAudit(page, ['main a', 'header a'], 6);
  expect(audit.samples.length, `${testInfo.project.name} 应至少采样到 1 个链接`).toBeGreaterThan(0);
  expect(audit.violations.map(fmt), `${testInfo.project.name} 链接文本对比度不足`).toEqual([]);
});

test(`@contrast /login 与隔离后台工作台：令牌与文本对比度`, async ({ page }, testInfo) => {
  const theme = themeOf(testInfo.project.name);
  const tag = `${testInfo.project.name} (${theme})`;
  const errors = collectErrors(page);
  await mockPocketBase(page);
  // 后注册的路由优先，必须排在通用 PB mock 之后，auth-refresh / step-up 才不会被空列表接住。
  await mockAdminSession(page);

  // 认证页：全局令牌变更同样会作用到认证布局。
  await openRoute(page, theme, '/login');
  await freezeTransitions(page);
  const loginSnapshot = await tokenSnapshot(page);
  expect(tokenViolations(loginSnapshot), `${tag} /login 令牌对对比度不足`).toEqual([]);
  const loginAudit = await contrastAudit(page, ['main h1', '[role="tab"]', 'main p'], 4);
  expect(loginAudit.samples.length, `${tag} /login 应采样到可见文本`).toBeGreaterThan(0);
  expect(loginAudit.violations.map(fmt), `${tag} /login 文本对比度不足`).toEqual([]);

  // 隔离后台工作台：已登录 author 测试替身 + mock 数据面，证明后台没有被令牌变更拖累。
  await openAdminWorkPage(page, theme);
  await freezeTransitions(page);
  const adminSnapshot = await tokenSnapshot(page);
  expect(tokenViolations(adminSnapshot), `${tag} 后台工作台令牌对对比度不足`).toEqual([]);
  const adminAudit = await contrastAudit(page, ['.admin-shell h1', '.admin-shell a', '.admin-shell p'], 4);
  expect(adminAudit.samples.length, `${tag} 后台工作台应采样到可见文本`).toBeGreaterThan(0);
  expect(adminAudit.violations.map(fmt), `${tag} 后台工作台文本对比度不足`).toEqual([]);

  expectCleanErrors(errors, `${tag} 认证页/后台采样`);
});
