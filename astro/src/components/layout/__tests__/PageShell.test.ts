// @vitest-environment node
// PageShell 是 Astro 静态原语，jsdom 里无法计算 Tailwind 布局；按仓库既有做法
// （reading-paths / orbital.test）读源码锁几何契约，运行时行为仍由页面级测试覆盖。
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';

const SOURCE = readFileSync(new URL('../PageShell.astro', import.meta.url), 'utf8');

/** 取出 <header ...> 的 class 列表。 */
function headerClasses(): string[] {
  const match = SOURCE.match(/<header class="([^"]+)"/);
  return match ? match[1].split(/\s+/) : [];
}

describe('PageShell · 移动端页头几何', () => {
  it('移动端由页头整体预留顶部空间，眉标不再右移', () => {
    // 固定菜单按钮占 top 12–56px；header 加 pt-8 后眉标与 h1 一起下移，
    // 两者保持同一条左基线，也不会被 44px 按钮遮住。
    const classes = headerClasses();
    expect(classes).toContain('orbital-shell__header');
    expect(classes).toContain('pt-8');
    expect(classes).toContain('sm:pt-0');
    expect(SOURCE).not.toContain('pl-14');
    // 眉标只消费共享 class，不再叠加左内边距
    expect(SOURCE).toContain('class={orbitalClasses.eyebrow}');
  });

  it('桌面端不带额外偏移：顶部内边距只在 <sm 生效', () => {
    const classes = headerClasses();
    expect(classes.filter((name) => /(?:^|:)(?:sm|md|lg|xl):pt-/.test(name))).toEqual(['sm:pt-0']);
    expect(classes.some((name) => /^(?:md|lg|xl):pt-/.test(name))).toBe(false);
  });

  it('仍输出唯一的 h1 与轨道日志页头样式', () => {
    expect(SOURCE.match(/<h1\b/g) ?? []).toHaveLength(1);
    expect(SOURCE).toContain('orbitalClasses.eyebrow');
    expect(SOURCE).toContain('orbital-title');
    expect(SOURCE).toContain('orbital-lede');
  });
});
