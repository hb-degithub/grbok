// @vitest-environment node
// 静态断言只读源码文本，用 node 环境以便直接使用 node:fs（jsdom 下会被 externalize）。
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';

/**
 * 内容页科幻简约改造的静态断言。
 *
 * 这些页面本身是 Astro 静态模板，样式改动居多，运行时测试价值有限；
 * 因此这里直接对源码做「设计语言 + 数据流未被破坏」的静态断言：
 *   - 结构色一律走共享令牌 var(--sf-*)，不再出现旧 zinc/teal 调色板；
 *   - 不引入玻璃拟态、重阴影、大面积渐变、发光卡片与装饰粒子层；
 *   - 页面仍保留原取数函数、交互组件与文案，改造没有顺手删功能。
 */

function readSource(relPath: string): string {
  // 测试文件位于 src/__tests__/，以 src/ 为基准解析相对路径
  return readFileSync(new URL(`../${relPath}`, import.meta.url), 'utf8');
}

const CONTENT_PAGES = [
  'pages/posts/index.astro',
  'pages/tags.astro',
  'pages/archive.astro',
  'pages/links.astro',
  'pages/guestbook.astro',
  'pages/gallery.astro',
  'pages/about.astro',
];

const COMPONENTS = ['components/posts/PostCard.tsx', 'components/posts/PostList.tsx'];

/** 旧调色板：改造后只允许石墨 + 冷灰 + 单一青色令牌。 */
const LEGACY_PALETTE =
  /\b(?:bg|text|border|from|via|to|ring|outline|divide|placeholder|fill|stroke)-(?:zinc|neutral|stone|slate|gray|grey|teal|cyan|indigo|violet|purple|emerald|sky|blue)-\d{2,3}/;

/** 设计约束里明确要减少/移除的视觉手段。 */
const FORBIDDEN_VISUALS: { reason: string; pattern: RegExp }[] = [
  { reason: '玻璃拟态', pattern: /backdrop-blur/ },
  { reason: '大面积渐变', pattern: /bg-gradient-to/ },
  { reason: '重阴影', pattern: /shadow-(?:xl|2xl)\b/ },
  { reason: '玻璃工具类', pattern: /(?:class|className)="[^"]*\bglass(?:-strong|-overlay)?\b/ },
  { reason: '旧卡片类', pattern: /\bcard\b/ },
  { reason: '装饰粒子层', pattern: /ParticleField/ },
  { reason: '发光卡片', pattern: /GlowCard/ },
  { reason: '旧按钮令牌（teal 强调色 + 阴影）', pattern: /\bbtn-(?:primary|ghost)\b/ },
];

describe('内容页科幻简约改造（静态断言）', () => {
  describe.each(CONTENT_PAGES)('%s', (file) => {
    it('使用共享设计令牌 var(--sf-*) 或共享 PageShell 原语', () => {
      const src = readSource(file);
      // 阅读页把页头与配色收敛到 PageShell + global.css 的 --sf-* 令牌；
      // 其余内容页仍直接使用 var(--sf-*) 类。两条路径都只有一个颜色来源。
      expect(src.includes('var(--sf-') || src.includes('<PageShell')).toBe(true);
    });

    it('不再使用旧调色板（zinc/teal/indigo…）', () => {
      const src = readSource(file);
      const hit = src.match(LEGACY_PALETTE);
      expect(hit?.[0] ?? null, `${file} 仍含旧调色板类：${hit?.[0]}`).toBeNull();
    });

    it.each(FORBIDDEN_VISUALS)('不引入 $reason', ({ pattern }) => {
      expect(readSource(file)).not.toMatch(pattern);
    });

    it('保留唯一的 h1 标题（可来自共享 PageShell）', () => {
      const src = readSource(file);
      // PageShell 自己输出唯一 h1；迁移到 PageShell 的页面不再手写 h1。
      // 两者之和仍必须恰好是 1，避免出现两个 h1 或没有 h1。
      const h1Count = src.match(/<h1\b/g)?.length ?? 0;
      const shellCount = src.match(/<PageShell\b/g)?.length ?? 0;
      expect(h1Count + shellCount, `${file} 的 h1 数量`).toBe(1);
    });
  });

  it('文章列表页保留 PostList 及其分页参数', () => {
    const src = readSource('pages/posts/index.astro');
    expect(src).toContain("import PostList from '../../components/posts/PostList'");
    expect(src).toContain('<PostList');
    expect(src).toContain('client:visible');
    expect(src).toContain('perPage={12}');
    expect(src).toContain('所有文章');
  });

  it('标签页保留 tags/post_tags 取数与标签详情链接', () => {
    const src = readSource('pages/tags.astro');
    expect(src).toContain('cachedFetchJson');
    expect(src).toContain('/api/collections/tags/records');
    expect(src).toContain('/api/collections/post_tags/records');
    expect(src).toContain('/tags/${tag.slug}');
    expect(src).toContain('暂无标签');
  });

  it('归档页保留 published 过滤、500 条上限与按月分组', () => {
    const src = readSource('pages/archive.astro');
    expect(src).toContain('cachedFetchJson');
    expect(src).toContain('perPage=500');
    expect(src).toContain('status="published"');
    expect(src).toContain('groups');
    expect(src).toContain('文章归档');
  });

  it('友链页保留友链网格、排行榜与邮件申请入口', () => {
    const src = readSource('pages/links.astro');
    expect(src).toContain('<FriendLinksGrid');
    expect(src).toContain('<FriendLinkLeaderboard');
    expect(src).toContain('mailto:670486183@qq.com');
    expect(src).toContain('友情链接');
  });

  it('留言页保留 GuestbookBoard 交互岛', () => {
    const src = readSource('pages/guestbook.astro');
    expect(src).toContain('<GuestbookBoard');
    expect(src).toContain('client:visible');
    expect(src).toContain('留言板');
  });

  it('画廊页保留 GalleryBoard 交互岛', () => {
    const src = readSource('pages/gallery.astro');
    expect(src).toContain('<GalleryBoard');
    expect(src).toContain('client:visible');
    expect(src).toContain('相册');
  });

  it('关于页保留技术栈/特性数据与联系入口', () => {
    const src = readSource('pages/about.astro');
    expect(src).toContain('<TechCard');
    expect(src).toContain('<FeatureCard');
    expect(src).toContain('const techStack');
    expect(src).toContain('const features');
    expect(src).toContain('const links');
    expect(src).toContain('关于博客');
  });
});

describe('共享设计令牌（内容页依赖的全局前提）', () => {
  // 内容页的结构色全部改成 var(--sf-*)；这些令牌由 global.css 提供，
  // 若被移除，页面会静默失去配色。这里把依赖显式锁住。
  //
  // 只断言「浅色 + 暗色两个主题都定义」，不复制具体色值：令牌真值只在
  // global.css 一处维护，E2E 由浏览器计算样式与对比度把关。
  it('global.css 在 :root 与 .dark 都定义内容页依赖的令牌', () => {
    const src = readSource('styles/global.css');
    const rootBlock = src.match(/(?:^|\n)\s*:root\s*\{([^}]*)\}/)?.[1] ?? '';
    const darkBlock = src.match(/(?:^|\n)\s*\.dark\s*\{([^}]*)\}/)?.[1] ?? '';
    expect(rootBlock, 'global.css 应有 :root 令牌块').not.toBe('');
    expect(darkBlock, 'global.css 应有 .dark 令牌块').not.toBe('');
    for (const token of ['--sf-canvas', '--sf-surface', '--sf-ink', '--sf-line', '--sf-accent']) {
      expect(rootBlock, `:root 缺少 ${token}`).toContain(`${token}:`);
      expect(darkBlock, `.dark 缺少 ${token}`).toContain(`${token}:`);
    }
  });
});

describe('文章组件（静态断言）', () => {
  describe.each(COMPONENTS)('%s', (file) => {
    it('颜色走共享令牌 var(--sf-*)', () => {
      expect(readSource(file)).toContain('var(--sf-');
    });

    it('仅使用 default export（项目约定）', () => {
      const src = readSource(file);
      expect(src).toMatch(/export default function (?:PostCard|PostList)/);
      expect(src).not.toMatch(/^\s*export\s+(?!default)/m);
    });

    it.each(FORBIDDEN_VISUALS)('不引入 $reason', ({ pattern }) => {
      expect(readSource(file)).not.toMatch(pattern);
    });
  });

  it('PostCard 仍消费封面、摘要与发布时间字段', () => {
    const src = readSource('components/posts/PostCard.tsx');
    expect(src).toContain('post.cover');
    expect(src).toContain('post.excerpt');
    expect(src).toContain('published_at');
    expect(src).toContain('post.title');
  });

  it('PostList 仍保留三态、分页与 usePosts 数据源', () => {
    const src = readSource('components/posts/PostList.tsx');
    expect(src).toContain('usePosts');
    expect(src).toContain('totalPages');
    expect(src).toContain('role="status"');
    expect(src).toContain('role="alert"');
    expect(src).toContain('文章分页');
    expect(src).toContain('暂无文章');
    expect(src).toContain('加载失败，请稍后重试');
  });
});
