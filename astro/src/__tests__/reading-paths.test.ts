// @vitest-environment node
// 只读源码文本的静态契约测试；node 环境下才能直接用 node:fs（jsdom 会把 node:fs externalize）。
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';

/**
 * 阅读路径（文章列表 / 标签 / 标签详情 / 归档）的静态契约。
 *
 * 这些页面是 Astro SSR 模板，取数与 404 状态码发生在模块顶层，无法在 jsdom 里
 * 直接渲染；因此这里锁定「改造后仍必须成立」的结构与数据契约：
 *   - 页头统一由共享 PageShell 提供唯一 h1，页面不再手写 h1；
 *   - 分区标题统一由 SectionHeading 输出，页面只提供内容；
 *   - 页码状态仍走现有的 ?page= → initialPage → history.replaceState 链路；
 *   - 标签详情页在标签不存在时返回真正的 404，而不是 200 + 「暂无」文案；
 *   - 各页原有的 SSR 取数、过滤条件与字段没有被改造顺手删掉；
 *   - 组件层的真实重试 / 标签关系契约不被回退。
 *
 * 组件行为由 PostList.test.tsx、PostCard.test.tsx、hooks/__tests__/usePosts.test.ts
 * 覆盖；浏览器层由 e2e/sci-fi-site 覆盖，这里不重复。
 */

function readSource(relPath: string): string {
  // 测试文件位于 src/__tests__/，以 src/ 为基准解析相对路径
  return readFileSync(new URL(`../${relPath}`, import.meta.url), 'utf8');
}

const READING_PAGES = [
  'pages/posts/index.astro',
  'pages/tags.astro',
  'pages/tags/[slug].astro',
  'pages/archive.astro',
] as const;

describe('阅读页共享页头 · PageShell / SectionHeading', () => {
  it('PageShell 输出唯一 h1 + 轨道日志页头样式', () => {
    const shell = readSource('components/layout/PageShell.astro');
    expect(shell.match(/<h1\b/g) ?? []).toHaveLength(1);
    expect(shell).toContain('orbital-title');
    expect(shell).toContain('orbital-shell');
    expect(shell).toContain('orbital-lede');
  });

  it('SectionHeading 的标题层级由 level 决定，默认 h2', () => {
    const heading = readSource('components/layout/SectionHeading.astro');
    expect(heading).toContain("level = 'h2'");
    expect(heading).toContain('orbital-heading');
    expect(heading).toMatch(/<slot name="action" \/>/);
  });

  describe.each(READING_PAGES)('%s', (file) => {
    it('使用 PageShell 统一页头，且不再手写 h1', () => {
      const src = readSource(file);
      expect(src).toContain("components/layout/PageShell.astro");
      expect(src.match(/<PageShell\b/g) ?? []).toHaveLength(1);
      expect(src).toContain('</PageShell>');
      expect(src).not.toMatch(/<h1\b/);
    });

    it('使用 SectionHeading 建立分区标题，不回到手写页头模板', () => {
      const src = readSource(file);
      expect(src).toContain("components/layout/SectionHeading.astro");
      expect(src).toMatch(/<SectionHeading\b/);
      // 旧页头模板：手写眉标短线 + 大号 h1 组合
      expect(src).not.toContain('h-px w-8 bg-[var(--sf-line-strong)]');
    });

    it('收敛阅读行宽：外层限宽居中，gutter 仍由 PageShell 提供', () => {
      const src = readSource(file);
      expect(src).toMatch(/mx-auto w-full max-w-(?:3xl|4xl|5xl)/);
    });
  });
});

describe('文章列表页 · ?page= 页码状态', () => {
  const src = readSource('pages/posts/index.astro');

  it('从 URL 读取 page 并作为 initialPage 交给 PostList', () => {
    expect(src).toContain("Astro.url.searchParams.get('page')");
    expect(src).toMatch(/<PostList[\s\S]*initialPage=\{initialPage\}/);
  });

  it('开启 syncPageQuery，让岛内翻页用 replaceState 写回 ?page=', () => {
    expect(src).toMatch(/<PostList[\s\S]*syncPageQuery/);
  });

  it('保留既有分页参数、客户端水合与数据源', () => {
    expect(src).toContain("import PostList from '../../components/posts/PostList'");
    expect(src).toContain('<PostList');
    expect(src).toContain('client:visible');
    expect(src).toContain('perPage={12}');
    expect(src).toContain('所有文章');
  });
});

describe('标签详情页 · 标签不存在返回真 404', () => {
  const src = readSource('pages/tags/[slug].astro');

  it('取不到标签时把响应状态码设为 404（不是 200 + 软 404 文案）', () => {
    expect(src).toMatch(/if \(!tag\) \{\s*Astro\.response\.status = 404;?\s*\}/);
  });

  it('404 分支给出返回标签列表的入口，不渲染文章列表', () => {
    expect(src).toContain('标签不存在');
    expect(src).toContain('href="/tags"');
    expect(src).toMatch(/\{tag \? \(/);
  });

  it('保留 SSR 取数、标签筛选与 URL 页码', () => {
    expect(src).toContain('cachedFetchJson');
    expect(src).toContain('/api/collections/tags/records');
    expect(src).toContain('tagSlug={slug}');
    expect(src).toMatch(/<PostList[\s\S]*initialPage=\{initialPage\}/);
    expect(src).toMatch(/<PostList[\s\S]*syncPageQuery/);
  });
});

describe('标签 / 归档页 · SSR 数据与字段不丢', () => {
  it('标签页保留 tags + post_tags 聚合、真实标题与日期、标签详情链接', () => {
    const src = readSource('pages/tags.astro');
    for (const token of [
      'cachedFetchJson',
      '/api/collections/tags/records',
      '/api/collections/post_tags/records',
      'expand=post_id',
      'formatMonthDay',
      '/tags/${tag.slug}',
      '暂无标签',
    ]) {
      expect(src, `标签页丢失：${token}`).toContain(token);
    }
  });

  it('归档页保留 published 过滤、500 条上限与按年月分组', () => {
    const src = readSource('pages/archive.astro');
    for (const token of [
      'cachedFetchJson',
      'perPage=500',
      'status="published"',
      'groups',
      'months',
      '暂无归档文章',
      '文章归档',
    ]) {
      expect(src, `归档页丢失：${token}`).toContain(token);
    }
  });
});

describe('阅读路径组件 · 真实重试与标签关系', () => {
  const postList = readSource('components/posts/PostList.tsx');
  const postCard = readSource('components/posts/PostCard.tsx');

  it('PostList 用 usePosts 的 retry 重新取数，不再整页 reload', () => {
    expect(postList).toContain('usePosts');
    expect(postList).toContain('retry');
    expect(postList).not.toContain('location.reload');
  });

  it('PostList 通过 history.replaceState 同步页码，不新增历史条目', () => {
    expect(postList).toContain('replaceState');
    expect(postList).not.toContain('pushState');
    expect(postList).toContain("searchParams.set('page'");
    expect(postList).toContain("searchParams.delete('page'");
  });

  it('PostList 保留三态语义与分页可访问性', () => {
    for (const token of [
      'role="status"',
      'role="alert"',
      '加载失败，请稍后重试',
      '文章分页',
      'aria-current',
      'aria-label={`第 ${page} 页`}',
    ]) {
      expect(postList, `PostList 契约丢失：${token}`).toContain(token);
    }
  });

  it('PostCard 只消费 post_tags 关系数据，不回退到记录自身 name', () => {
    expect(postCard).toContain("'post_tags(post_id)'");
    expect(postCard).toContain('tag_id');
    expect(postCard).not.toMatch(/as unknown as \{ name/);
  });
});
