// @vitest-environment node
// 展示页的静态契约：统一 PageShell/SectionHeading，且交互岛与数据入口不被删。
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';

/**
 * 展示页（留言 / 状态 / 关于 / 相册 / 友链 / 统计）统一到「轨道日志」外壳。
 *
 * 这些页面是 Astro 静态模板，运行时行为由 e2e 覆盖；这里只锁三件事：
 *   1. 页头只由 PageShell 输出（唯一 h1），页面不再手写旧眉标模板；
 *   2. 区块标题走 SectionHeading，且 id 唯一（避免默认的 section-title 冲突）；
 *   3. 原有交互岛（client:visible / client:load）、数据入口与文案仍保留。
 */

function readSource(relPath: string): string {
  return readFileSync(new URL(`../${relPath}`, import.meta.url), 'utf8');
}

const SHOWCASE_PAGES = [
  'pages/guestbook.astro',
  'pages/status.astro',
  'pages/about.astro',
  'pages/gallery.astro',
  'pages/links.astro',
  'pages/stats.astro',
] as const;

const RETAINED: Record<string, string[]> = {
  'pages/guestbook.astro': ['<GuestbookBoard', 'client:visible', '留言板'],
  'pages/status.astro': ['<StatusPanel', '<ProtectionPanel', 'client:load', '运行状态', 'id="protection"'],
  'pages/about.astro': ['<TechCard', '<FeatureCard', 'const techStack', 'const features', 'const links', '关于博客'],
  'pages/gallery.astro': ['<GalleryBoard', 'client:visible', '相册'],
  'pages/links.astro': [
    '<FriendLinksGrid',
    '<FriendLinkLeaderboard',
    'client:visible',
    'mailto:670486183@qq.com',
    '申请友链',
  ],
  'pages/stats.astro': ['<StatsDashboard', 'client:load', 'variant="public"', '访问统计'],
};

describe.each(SHOWCASE_PAGES)('%s · 轨道日志外壳', (file) => {
  it('由 PageShell 输出唯一 h1，不再手写页头', () => {
    const src = readSource(file);
    expect(src).toContain("import PageShell from '../components/layout/PageShell.astro'");
    expect(src.match(/<PageShell\b/g) ?? []).toHaveLength(1);
    // PageShell 自己渲染 h1；页面里再写 h1 会出现两个标题。
    expect(src).not.toMatch(/<h1\b/);
    // 旧的手写眉标模板（短线 + 大写 mono）已由 PageShell 接管。
    expect(src).not.toContain('h-px w-8');
  });

  it('SectionHeading 都有显式且唯一的 id', () => {
    const src = readSource(file);
    const ids = Array.from(src.matchAll(/<SectionHeading[\s\S]*?\bid="([^"]+)"/g)).map((m) => m[1]);
    expect(new Set(ids).size).toBe(ids.length);
    for (const id of ids) expect(id.length).toBeGreaterThan(0);
  });

  it('保留原有交互岛、数据入口与关键文案', () => {
    const src = readSource(file);
    for (const contract of RETAINED[file]) {
      expect(src, `${file} 缺少 ${contract}`).toContain(contract);
    }
  });
});

describe('展示页 · 具体约定', () => {
  it('关于页四个区块都有对应的 SectionHeading 锚点', () => {
    const src = readSource('pages/about.astro');
    for (const id of ['about-site', 'about-stack', 'about-features', 'about-contact']) {
      expect(src).toContain(`id="${id}"`);
    }
    expect(src.match(/<h2\b/g) ?? []).toHaveLength(0);
  });

  it('相册页给出灯箱键盘操作说明', () => {
    const src = readSource('pages/gallery.astro');
    expect(src).toContain('Esc');
    expect(src).toContain('←/→');
  });

  it('统计页不再挂装饰粒子层，页头由静态原语输出', () => {
    const src = readSource('pages/stats.astro');
    expect(src).not.toContain('ParticleField');
    expect(src).not.toContain('ScrollReveal');
    expect(src).toContain('数据概览');
  });

  it('友链页申请区块使用轨道面板并保留三项申请格式', () => {
    const src = readSource('pages/links.astro');
    expect(src).toContain('orbital-panel');
    expect(src).toContain('站名');
    expect(src).toContain('地址');
    expect(src).toContain('简介');
  });
});
