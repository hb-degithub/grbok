// @vitest-environment node
// 只读 global.css 文本做令牌结构断言；node 环境避免 jsdom 对 node:fs 的 externalize。
import { describe, expect, it } from 'vitest';
import { orbitalClasses } from './orbital';

const { readFileSync } = process.getBuiltinModule('node:fs');

function readSource(relPath: string): string {
  return readFileSync(new URL(relPath, import.meta.url), 'utf8');
}

const CSS = readSource('./global.css');

/** 两个主题都必须存在的语义色令牌（值可以随设计调整，名称是契约）。 */
const COLOR_TOKENS = [
  '--sf-canvas',
  '--sf-surface',
  '--sf-ink',
  '--sf-ink-2',
  '--sf-ink-3',
  '--sf-line',
  '--sf-line-strong',
  '--sf-line-soft',
  '--sf-line-control',
  '--sf-accent',
  '--sf-accent-ink',
  '--sf-on-accent',
  '--sf-danger',
  '--sf-success',
  '--sf-warning',
  '--sf-info',
  '--sf-focus-ring',
  '--sf-scrim',
] as const;

/** 本任务新增的令牌（glow/orbit 为装饰性色值，不参与文本对比度断言）。 */
const NEW_TOKENS = ['--sf-success', '--sf-warning', '--sf-info', '--sf-glow', '--sf-orbit'] as const;

/** 从 global.css 中取出指定选择器的所有顶层声明块。 */
function cssBlocks(selector: string): string[] {
  const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const pattern = new RegExp(`(?:^|\\n)\\s*${escaped}\\s*\\{([^}]*)\\}`, 'g');
  const blocks: string[] = [];
  for (let match = pattern.exec(CSS); match; match = pattern.exec(CSS)) {
    blocks.push(match[1]);
  }
  return blocks;
}

function tokenValue(source: string, token: string): string {
  const pattern = new RegExp(`${token}\\s*:\\s*([^;]+);`);
  return (source.match(pattern)?.[1] ?? '').trim();
}

const ROOT_TOKENS = cssBlocks(':root').join('\n');
const DARK_TOKENS = cssBlocks('.dark').join('\n');

describe('orbitalClasses：跨框架 class 契约', () => {
  it('暴露稳定的四个 class 常量', () => {
    expect(orbitalClasses).toEqual({
      shell: 'orbital-shell',
      panel: 'orbital-panel',
      eyebrow: 'orbital-eyebrow',
      action: 'orbital-action',
    });
  });

  it('常量对象被冻结，避免运行时被改写', () => {
    expect(Object.isFrozen(orbitalClasses)).toBe(true);
  });

  it('四个 class 名互不重复', () => {
    expect(new Set(Object.values(orbitalClasses)).size).toBe(Object.values(orbitalClasses).length);
  });
});

describe('global.css：轨道日志令牌结构', () => {
  it(':root 与 .dark 都定义了令牌块', () => {
    expect(cssBlocks(':root').length, 'global.css 应至少有一个 :root 块').toBeGreaterThan(0);
    expect(cssBlocks('.dark').length, 'global.css 应至少有一个 .dark 块').toBeGreaterThan(0);
  });

  it.each(COLOR_TOKENS)('%s 在浅色与暗色主题都取到非空值', (token) => {
    expect(tokenValue(ROOT_TOKENS, token), `${token} 缺少 :root 定义`).not.toBe('');
    expect(tokenValue(DARK_TOKENS, token), `${token} 缺少 .dark 定义`).not.toBe('');
  });

  it.each(NEW_TOKENS)('新增令牌 %s 已提供', (token) => {
    expect(tokenValue(ROOT_TOKENS, token), `${token} 缺少 :root 定义`).not.toBe('');
    expect(tokenValue(DARK_TOKENS, token), `${token} 缺少 .dark 定义`).not.toBe('');
  });

  it('--sf-pad 仍由 :root 提供（布局节奏令牌不能丢）', () => {
    expect(tokenValue(ROOT_TOKENS, '--sf-pad')).not.toBe('');
  });

  it('浅色与暗色主题的强调色不同（主题不是同一套色值复制）', () => {
    expect(tokenValue(ROOT_TOKENS, '--sf-accent')).not.toBe(tokenValue(DARK_TOKENS, '--sf-accent'));
  });

  it.each(Object.values(orbitalClasses))('.%s 由 global.css 定义', (className) => {
    expect(CSS).toMatch(new RegExp(`\\.${className}\\s*\\{`));
  });

  it('orbital-panel 复用令牌而不是写死色值', () => {
    const block = cssBlocks('.orbital-panel')[0] ?? '';
    expect(block, '应存在 .orbital-panel 规则').not.toBe('');
    expect(block).toContain('var(--sf-surface)');
    expect(block).toContain('var(--sf-line-soft)');
    expect(block, '面板规则不应写死十六进制色值').not.toMatch(/#[0-9a-f]{3,8}/i);
  });
});

describe('静态 Astro 原语：跨框架边界', () => {
  const PRIMITIVES = ['PageShell.astro', 'SectionHeading.astro'] as const;

  it.each(PRIMITIVES)('%s 只消费共享 class，不引入 React 或请求', (file) => {
    const source = readSource(`../components/layout/${file}`);
    expect(source, '静态原语应复用 orbitalClasses').toContain('orbitalClasses');
    expect(source, '静态原语不得导入 React').not.toMatch(/from\s+['"]react['"]/);
    expect(source, '静态原语不得声明客户端水合').not.toMatch(/\bclient:/);
    expect(source, '静态原语不得发起数据请求').not.toMatch(/\bfetch\(|\$\.ajax|useQuery/);
  });

  it('PageShell 输出唯一 h1、保留 id 与默认 slot', () => {
    const source = readSource('../components/layout/PageShell.astro');
    expect(source.match(/<h1\b/g), 'PageShell 只应输出一个 h1').toHaveLength(1);
    expect(source).toContain('id={id}');
    expect(source).toContain('<slot />');
  });

  it('SectionHeading 默认 h2、保留 id 与 action slot', () => {
    const source = readSource('../components/layout/SectionHeading.astro');
    expect(source, '默认层级应为 h2').toContain("level = 'h2'");
    expect(source).toContain('id={id}');
    expect(source).toContain('<slot name="action" />');
  });
});
