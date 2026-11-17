/**
 * A5 组：关键令牌对比度 + 关键文本 + 主 CTA。
 * 采样前冻结过渡，避免 0.3s 颜色过渡造成中间帧假失败。
 * 三个用例由 Playwright projects 自动在 4 个视口×主题组合上各跑一次。
 */
import { test, expect } from '@playwright/test';
import {
  collectErrors,
  contrastAudit,
  contrastRatio,
  expectCleanErrors,
  freezeTransitions,
  mockPocketBase,
  openRoute,
  parseCssColor,
  scrollThrough,
  themeOf,
  tokenSnapshot,
  type ContrastSample,
} from './fixtures';

function fmt(sample: ContrastSample) {
  return `${sample.selector} "${sample.text}" ${sample.color} on ${sample.background} = ${sample.ratio}:1 (需 ${sample.need})`;
}

test(`@contrast 令牌对与关键文本对比度`, async ({ page }, testInfo) => {
  const theme = themeOf(testInfo.project.name);
  const errors = collectErrors(page);
  await mockPocketBase(page);
  await openRoute(page, theme, '/');
  await scrollThrough(page);
  await freezeTransitions(page);

  const snapshot = await tokenSnapshot(page);
  const tokenPairs: Array<[string, string, number]> = [
    ['--sf-ink', '--sf-canvas', 4.5],
    ['--sf-ink-2', '--sf-canvas', 4.5],
    ['--sf-ink-3', '--sf-canvas', 4.5],
    ['--sf-ink-3', '--sf-surface', 4.5],
    ['--sf-accent', '--sf-canvas', 4.5],
    ['--sf-accent-ink', '--sf-surface', 4.5],
    ['--sf-on-accent', '--sf-accent', 4.5],
    ['--sf-line-control', '--sf-canvas', 3.0],
  ];
  const tokenViolations: string[] = [];
  for (const [fgName, bgName, need] of tokenPairs) {
    const fg = parseCssColor(snapshot.tokens[fgName] ?? '');
    const bg = parseCssColor(snapshot.tokens[bgName] ?? '');
    expect(fg, `令牌 ${fgName} 缺失（${testInfo.project.name}）`).not.toBeNull();
    expect(bg, `令牌 ${bgName} 缺失（${testInfo.project.name}）`).not.toBeNull();
    const ratio = Number(contrastRatio(fg!, bg!).toFixed(2));
    if (ratio < need) tokenViolations.push(`${fgName}/${bgName} = ${ratio}:1 (需 ${need})`);
  }
  expect(tokenViolations, `${testInfo.project.name} 令牌对对比度不足`).toEqual([]);

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
