// @vitest-environment node
// 只读源码文本的静态契约；node 环境才能直接用 node:fs（jsdom 会 externalize）。
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';

/**
 * 主题切换的 View Transition 安全性（生产移动端实测回归）。
 *
 * 现象：Chromium 移动模拟下首页与全部展示页都会出现页面级未捕获异常
 *   "Transition was aborted because of invalid state. Prepaint layout check failed"
 * 定位：BaseLayout 的内联主题脚本调用 document.startViewTransition(...) 后
 *   没有处理 ready / finished 的拒绝；预绘制校验失败时该 Promise 拒绝，
 *   冒泡成 pageerror（消融实验：同一个 API 置空后异常消失）。
 *
 * 这里锁三件事：
 *   1. 三个 View Transition Promise 都挂了 catch，不再产生未处理拒绝；
 *   2. 调用仍在 try/catch 内，浏览器拒绝调用时会回退到直接切类；
 *   3. 主题切换本身仍 toggle .dark 并写 dataset，行为没有退化。
 */

const layout = readFileSync(new URL('../layouts/BaseLayout.astro', import.meta.url), 'utf8');

function themeScript(): string {
  const start = layout.indexOf('const applyTheme = () => {');
  expect(start, '未找到主题切换脚本').toBeGreaterThan(-1);
  const end = layout.indexOf('window.__blogApplyTheme = applyTheme;', start);
  expect(end, '主题脚本结构变化，需同步更新本契约').toBeGreaterThan(start);
  return layout.slice(start, end);
}

describe('BaseLayout · 主题切换的 View Transition', () => {
  it('startViewTransition 的 ready/finished/updateCallbackDone 都处理了拒绝', () => {
    const script = themeScript();

    expect(script).toContain('document.startViewTransition(paint)');
    for (const promise of ['transition.ready', 'transition.finished', 'transition.updateCallbackDone']) {
      expect(script, `${promise} 未捕获拒绝，会冒泡成 pageerror`).toContain(`${promise}?.catch(`);
    }
  });

  it('调用被拒或浏览器不支持时回退为直接切换主题类', () => {
    const script = themeScript();

    // try/catch 兜住同步抛错，catch 分支重新执行 paint()
    expect(script).toMatch(/try\s*\{[\s\S]*startViewTransition[\s\S]*\}\s*catch\s*\{[\s\S]*paint\(\);[\s\S]*\}/);
    // 不支持该 API 时同样直接 paint()
    expect(script).toMatch(/else\s*\{\s*paint\(\);\s*\}/);
  });

  it('主题切换行为保持不变：toggle .dark 并写 dataset', () => {
    const script = themeScript();

    expect(script).toContain("document.documentElement.classList.toggle('dark', theme === 'dark')");
    expect(layout).toContain('document.documentElement.dataset.theme = theme;');
    expect(layout).toContain('document.documentElement.dataset.themeMode = mode;');
    // 主题状态仍由既有存储键驱动，没有新增状态源
    expect(layout).toContain("const storageKey = 'blog-theme-mode';");
  });
});
