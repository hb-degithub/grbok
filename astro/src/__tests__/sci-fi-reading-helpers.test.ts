// @vitest-environment node
// 只读源码文本的静态契约测试；node 环境下才能直接使用 node:fs（jsdom 会 externalize）。
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';

/**
 * 文章详情页阅读辅助三件套（目录 / 阅读进度 / 分享）的科幻简约视觉契约。
 *
 * 这一层只锁定两类东西：
 *   1. 交互与无障碍链路没有被「纯视觉改造」顺手删掉：
 *      TOC 的 headings/active 跟踪/mobileOpen/scrollToHeading/useReducedMotion，
 *      阅读进度的 rAF 滚动监听与宽度驱动，分享的剪贴板与 nativeShare 兜底；
 *   2. 视觉语言统一：结构色走 var(--sf-*)，去掉 zinc/teal 旧调色板、玻璃模糊、
 *      渐变与发光阴影，交互控件保留 min-h-11 触控高度。
 *
 * 真实交互行为由 jsdom 组件测试覆盖，这里不用正则假装验证行为。
 */

function readSource(relPath: string): string {
  // 测试文件位于 src/__tests__/，以 src/ 为基准解析相对路径
  return readFileSync(new URL(`../${relPath}`, import.meta.url), 'utf8');
}

const toc = readSource('components/posts/TableOfContents.tsx');
const progress = readSource('components/effects/ReadingProgress.tsx');
const share = readSource('components/ui/ShareButton.tsx');

/** 改造前的冷暖撞色调色板：改造后只允许石墨 + 冷灰 + 单一青色令牌。 */
const LEGACY_PALETTE =
  /\b(?:bg|text|border|from|via|to|ring|outline|divide|placeholder|fill|stroke|shadow)-(?:zinc|neutral|stone|slate|gray|grey|teal|cyan|indigo|violet|purple|emerald|sky|blue)-\d{2,3}/;

/** 规格明确要移除的视觉手段（玻璃、渐变、重阴影、大圆角、旧按钮类）。 */
const FORBIDDEN_VISUALS: Array<{ label: string; pattern: RegExp }> = [
  { label: '玻璃拟态 backdrop-blur', pattern: /backdrop-blur/ },
  { label: '半透明白底 bg-white/', pattern: /bg-white\// },
  { label: '暗色主题手工覆写 dark:', pattern: /dark:/ },
  { label: '大面积渐变', pattern: /(?:bg-gradient-to-|linear-gradient|radial-gradient)/ },
  { label: '发光圆点 rounded-full', pattern: /\brounded-full\b/ },
  { label: 'CSS box-shadow', pattern: /box-shadow\s*:/ },
  { label: '内联 boxShadow', pattern: /boxShadow\s*:/ },
  { label: '大圆角 rounded-(lg|xl|2xl|3xl)', pattern: /\brounded-(?:lg|xl|2xl|3xl)\b/ },
  { label: '旧卡片类 card', pattern: /\bcard\b/ },
  { label: '旧按钮工具类（primary / ghost）', pattern: /\bbtn-(?:primary|ghost)\b/ },
];

describe('阅读辅助三件套 · 结构色令牌', () => {
  it('三个组件都用 var(--sf-*) 表达结构色/文字色，而不是硬编码 Tailwind 色阶', () => {
    for (const [name, source, min] of [
      ['TableOfContents', toc, 6],
      ['ReadingProgress', progress, 2],
      ['ShareButton', share, 4],
    ] as const) {
      const sfCount = (source.match(/var\(--sf-/g) ?? []).length;
      expect(sfCount, `${name} 的 --sf-* 令牌使用过少`).toBeGreaterThanOrEqual(min);
    }
  });

  it.each([
    ['TableOfContents', toc],
    ['ReadingProgress', progress],
    ['ShareButton', share],
  ])('%s 不再使用旧调色板（zinc/teal/…）', (_name, source) => {
    const hit = source.match(LEGACY_PALETTE);
    expect(hit?.[0] ?? null, `仍含旧调色板：${hit?.[0]}`).toBeNull();
  });

  it.each([
    ['TableOfContents', toc],
    ['ReadingProgress', progress],
    ['ShareButton', share],
  ])('%s 不引入玻璃/渐变/发光/大圆角/旧按钮类', (_name, source) => {
    // 一次性列出全部违规项：逐个断言会在第一个命中处中断，看不到后面还残留什么。
    const violations = FORBIDDEN_VISUALS.filter(({ pattern }) => pattern.test(source)).map(
      ({ label }) => label
    );
    expect(violations, `${_name} 仍含：${violations.join('、')}`).toEqual([]);
  });

  it('三个组件仍保持 export default', () => {
    expect(toc).toContain('export default function TableOfContents');
    expect(progress).toContain('export default function ReadingProgress');
    expect(share).toContain('export default function ShareButton');
  });
});

describe('TableOfContents · 交互与无障碍链路（不改行为）', () => {
  it('保留 headings 入参、active 跟踪与移动端折叠状态', () => {
    for (const token of [
      'interface Heading {',
      'interface TableOfContentsProps {',
      'headings: Heading[];',
      'const { isMobile } = useBreakpoint();',
      'const [activeId, setActiveId] = useState<string | null>(null);',
      'new IntersectionObserver(',
      "rootMargin: '-80px 0px -60% 0px'",
      'setActiveId(entry.target.id)',
      'const [mobileOpen, setMobileOpen] = useState(false);',
      'setMobileOpen((prev) => !prev)',
      'const scrollToHeading = useCallback((id: string) => {',
      'el.scrollIntoView({ behavior: \'smooth\' })',
      'if (isMobile) setMobileOpen(false);',
      'if (headings.length === 0) return null;',
    ]) {
      expect(toc, `TOC 交互契约丢失：${token}`).toContain(token);
    }
  });

  it('保留减少动效偏好的两条分支（动效指示条 / 静态指示条）', () => {
    expect(toc).toContain('useReducedMotion');
    expect(toc).toContain('const prefersReducedMotion = useReducedMotion();');
    expect(toc).toContain('{activeId && !prefersReducedMotion && (');
    expect(toc).toContain('{activeId && prefersReducedMotion && (');
  });

  it('保留移动端折叠按钮与面板的无障碍关联', () => {
    for (const token of [
      'aria-expanded={mobileOpen}',
      'aria-controls="toc-mobile-panel"',
      'id="toc-mobile-panel"',
      'data-heading-id={heading.id}',
      'href={`#${heading.id}`}',
      'aria-label="目录"',
    ]) {
      expect(toc, `TOC 无障碍契约丢失：${token}`).toContain(token);
    }
  });
});

describe('TableOfContents · 科幻视觉契约', () => {
  it('交互行补 min-h-11 触控高度，移动端按钮同样达标', () => {
    expect(toc).toContain('min-h-11');
    const hits = (toc.match(/min-h-11/g) ?? []).length;
    expect(hits, 'TOC 的 min-h-11 触控高度覆盖不足').toBeGreaterThanOrEqual(2);
  });

  it('移动端触发按钮为细线小圆角，不再使用白底玻璃与 dark: 覆写', () => {
    const trigger = toc.match(/className="focus-ring[^"]*"/)?.[0] ?? '';
    expect(trigger, '未找到移动端目录触发按钮').not.toBe('');
    expect(trigger).toContain('border-[var(--sf-line)]');
    expect(trigger).toContain('bg-[var(--sf-surface)]');
    expect(trigger).toContain('rounded-[4px]');
    expect(trigger).toContain('min-h-11');
  });

  it('移动端下拉面板使用细线边框 + 小圆角，无玻璃模糊', () => {
    const panel = toc.match(/<nav className="[^"]*"/)?.[0] ?? '';
    expect(panel, '未找到移动端目录面板').not.toBe('');
    expect(panel).toContain('border border-[var(--sf-line)]');
    expect(panel).toContain('rounded-[4px]');
    expect(panel).toContain('bg-[var(--sf-surface)]');
  });

  it('桌面端 active 用强调色细线指示 + 强调色文字', () => {
    expect((toc.match(/bg-\[var\(--sf-accent\)\]/g) ?? []).length).toBeGreaterThanOrEqual(2);
    expect(toc).toContain('text-[var(--sf-accent-ink)]');
  });

  it('标题链接用冷灰文字与 hover 提升，不再用 zinc 色阶', () => {
    expect(toc).toContain('text-[var(--sf-ink-3)]');
    expect(toc).toContain('hover:text-[var(--sf-ink)]');
  });
});

describe('ReadingProgress · 科幻视觉契约', () => {
  it('滚动监听与 rAF 宽度驱动保持不变', () => {
    for (const token of [
      "window.addEventListener('scroll', handler, { passive: true })",
      "window.removeEventListener('scroll', handler)",
      'cancelAnimationFrame(raf)',
      'document.documentElement.scrollTop',
      'document.documentElement.scrollHeight - document.documentElement.clientHeight',
      "style={{ width: progress * 100 + '%' }}",
      'pointer-events-none',
      'fixed top-0 left-0',
      'z-[60]',
    ]) {
      expect(progress, `阅读进度链路丢失：${token}`).toContain(token);
    }
  });

  it('进度条为强调色纯色细线，轨道用冷灰细线', () => {
    expect(progress).toContain('var(--sf-accent)');
    expect(progress).toContain('var(--sf-line');
    expect(progress).toMatch(/h-0\.5/);
    // 纯色：不允许再出现渐变方向工具类或 from-/to- 色阶
    expect(progress).not.toMatch(/\b(?:from|to|via)-\[/);
  });

  it('不再渲染发光圆点与内联阴影', () => {
    expect(progress).not.toMatch(/rgba\(20,\s*184,\s*166/);
    expect(progress).not.toMatch(/rounded-full/);
    expect(progress).not.toMatch(/boxShadow/);
  });
});

describe('ShareButton · 科幻视觉契约', () => {
  it('剪贴板与 nativeShare 逻辑保持不变', () => {
    for (const token of [
      'navigator.clipboard.writeText(window.location.href)',
      'setCopied(true)',
      'window.setTimeout(() => setCopied(false), 2000)',
      'navigator.share({ url: window.location.href, title: document.title })',
      "'share' in navigator",
      'const canNative =',
      'copiedTimerRef',
    ]) {
      expect(share, `分享逻辑丢失：${token}`).toContain(token);
    }
  });

  it('保留复制状态的可访问反馈与 aria 标签', () => {
    for (const token of [
      "aria-label={copied ? '链接已复制' : '复制链接'}",
      'aria-label="分享"',
      'aria-live="polite"',
      "copied ? '链接已复制到剪贴板' : ''",
    ]) {
      expect(share, `分享无障碍契约丢失：${token}`).toContain(token);
    }
  });

  it('复制/分享按钮共用同一套细线小圆角 + min-h-11 样式', () => {
    // 「统一文字」落在一个共享的类名常量上：复制与系统分享必须引用同一份样式，
    // 避免两个按钮各自漂移。
    const shared = share.match(/const BUTTON_CLASS =\s*'([^']+)'/s)?.[1] ?? '';
    expect(shared, '未找到统一的按钮样式常量').not.toBe('');
    expect(shared).toContain('min-h-11');
    expect(shared).toContain('rounded-[4px]');
    expect(shared).toContain('border-[var(--sf-line)]');
    const usages = (share.match(/className=\{BUTTON_CLASS\}/g) ?? []).length;
    expect(usages, '复制/分享按钮未共用统一按钮样式').toBe(2);
  });

  it('按钮文字统一为等宽小标签 + 冷灰墨色，hover 走结构线控件色', () => {
    const shared = share.match(/const BUTTON_CLASS =\s*'([^']+)'/s)?.[1] ?? '';
    expect(shared).toContain('font-mono');
    expect(shared).toContain('text-[var(--sf-ink-2)]');
    expect(shared).toContain('hover:border-[var(--sf-line-control)]');
    expect(shared).toContain('hover:text-[var(--sf-ink)]');
  });
});
