// @vitest-environment node
// 只读源码文本的结构契约；node 环境才能直接使用 node:fs（jsdom 会 externalize）。
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';

/**
 * 文章详情页阅读布局契约（阅读路径 · 标题/正文排版、目录与移动布局）。
 *
 * 这里只锁「阅读顺序与度量」这类结构性事实，不重复既有 sci-fi-post-detail
 * 已经覆盖的数据/安全契约：
 *   1. 移动端目录排在标题之后（先给读者标题，再给跳转工具），桌面目录为 sticky 侧栏；
 *   2. 阅读列与正文同一度量，标题使用平衡换行，正文段落做孤行优化；
 *   3. 目录锚点跳转不会把标题顶到固定页头下面（scroll-margin-top）。
 */

function readSource(relPath: string): string {
  return readFileSync(new URL(`../${relPath}`, import.meta.url), 'utf8');
}

const page = readSource('pages/posts/[slug].astro');

describe('文章详情页 · 阅读顺序', () => {
  it('移动端目录位于文章标题之后（标题优先）', () => {
    const headerEnd = page.indexOf('</header>');
    const mobileToc = page.indexOf('class="mb-8 lg:hidden"');
    const bodyLabel = page.indexOf('Body / 02');

    expect(headerEnd).toBeGreaterThan(-1);
    expect(mobileToc).toBeGreaterThan(headerEnd);
    expect(mobileToc).toBeLessThan(bodyLabel);
  });

  it('桌面目录仍是 lg 以上显示的 sticky 侧栏', () => {
    expect(page).toMatch(/<aside class="[^"]*\blg:sticky\b[^"]*\blg:block\b/);
    expect(page).toContain('--header-offset');
    expect(page).toMatch(/<aside class="[^"]*\bhidden\b[^"]*\blg:block\b/);
  });

  it('正文列与正文共用同一阅读度量，标题/导语不被侧栏挤出对齐', () => {
    expect(page).toContain('lg:max-w-[42rem]');
    // .prose 全局是 68ch + margin auto；页面覆盖为列宽，避免标题与正文左右错位
    expect(page).toMatch(/\.reveal-content\.prose\s*\{[^}]*max-width:\s*100%/);
    expect(page).toMatch(/\.reveal-content\.prose\s*\{[^}]*margin-inline:\s*0/);
  });

  it('标题使用平衡换行，正文段落做孤行优化', () => {
    expect(page).toMatch(/<h1[^>]*class="post-title[^"]*text-balance/);
    expect(page).toMatch(/text-wrap:\s*pretty/);
  });

  it('lg 以下阅读列已有最大宽度并居中，1023/1024 之间不跳变', () => {
    const readingColumn =
      page.match(/<div class="([^"]*lg:max-w-\[42rem\][^"]*)">/)?.[1] ?? '';

    expect(readingColumn).not.toBe('');
    // lg 断点两侧都必须有同一阅读度量：只在 lg: 加宽度会在 1023/1024 突变
    expect(readingColumn).toContain('max-w-[42rem]');
    expect(readingColumn).toContain('lg:max-w-[42rem]');
    // 窄屏下居中，避免正文贴左而右侧留白
    expect(readingColumn).toContain('mx-auto');
    expect(readingColumn).toContain('lg:mx-0');
  });

  it('目录锚点跳转留出页头高度', () => {
    expect(page).toMatch(/scroll-margin-top:\s*calc\(var\(--header-offset/);
  });
});

describe('文章详情页 · 阅读入口', () => {
  it('标题下方渲染摘要导语（有 excerpt 时）', () => {
    expect(page).toMatch(/\{post\.excerpt\s*&&/);
    expect(page).toContain('{post.excerpt}');
  });

  it('正文之后仍是互动与评论，评论在分享之前', () => {
    const body = page.indexOf('set:html={safeContent}');
    const actions = page.indexOf('<PostActions');
    const comments = page.indexOf('<CommentSection');
    const share = page.indexOf('<ShareButton');

    expect(body).toBeGreaterThan(-1);
    expect(actions).toBeGreaterThan(body);
    expect(comments).toBeGreaterThan(actions);
    expect(share).toBeGreaterThan(comments);
  });

  it('h1 仍然唯一且来自 post.title（404 分支不改用 h1）', () => {
    expect(page.match(/<h1\b/g)).toHaveLength(1);
    expect(page).toMatch(/<h1[^>]*>[\s\S]{0,200}?\{post\.title\}/);
  });
});
