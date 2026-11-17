// @vitest-environment node
// 只读源码文本的静态契约测试；node 环境下才能直接使用 node:fs（jsdom 会 externalize）。
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';

/**
 * 文章详情页（pages/posts/[slug].astro）纳入科幻简约全站改造的静态契约。
 *
 * 这一层只锁定两类东西：
 *   1. 详情页的真实数据/安全/交互链路没有被「视觉改造」顺手删掉
 *      （fetchPost、公开作者回退、sanitizeHtml、heading id、阅读进度、
 *       TOC、评论区、分享、PostActions）；
 *   2. 设计语言统一：结构色走 var(--sf-*)，去掉旧调色板、玻璃、重阴影、
 *      大面积渐变与大圆角；正文无 JS 也可读。
 *
 * 交互行为（点赞/收藏/登录提示）由 PostActions.test.tsx 在 jsdom 中覆盖，
 * 这里不用正则假装验证行为。
 */

function readSource(relPath: string): string {
  // 测试文件位于 src/__tests__/，以 src/ 为基准解析相对路径
  return readFileSync(new URL(`../${relPath}`, import.meta.url), 'utf8');
}

const page = readSource('pages/posts/[slug].astro');
const actions = readSource('components/posts/PostActions.tsx');

/** 改造前的冷暖撞色调色板：改造后只允许石墨 + 冷灰 + 单一青色令牌。 */
const LEGACY_PALETTE =
  /\b(?:bg|text|border|from|via|to|ring|outline|divide|placeholder|fill|stroke|shadow)-(?:zinc|neutral|stone|slate|gray|grey|teal|cyan|indigo|violet|purple|emerald|sky|blue)-\d{2,3}/;

/** 规格明确要移除/避免的视觉手段。 */
const FORBIDDEN_VISUALS: Array<{ label: string; pattern: RegExp }> = [
  { label: '玻璃拟态 backdrop-blur', pattern: /backdrop-blur/ },
  { label: '玻璃工具类', pattern: /(?:class|className)="[^"]*\bglass(?:-strong|-overlay)?\b/ },
  { label: '重阴影 shadow-(xs|sm|md|lg|xl|2xl)', pattern: /\bshadow-(?:xs|sm|md|lg|xl|2xl)\b/ },
  { label: '任意值阴影 shadow-[', pattern: /shadow-\[/ },
  { label: 'CSS box-shadow', pattern: /box-shadow\s*:/ },
  { label: '大面积渐变', pattern: /(?:bg-gradient-to-|linear-gradient|radial-gradient)/ },
  { label: '大圆角 rounded-(md|lg|xl|2xl|3xl)', pattern: /\brounded-(?:md|lg|xl|2xl|3xl)\b/ },
  { label: '旧卡片类 card', pattern: /\bcard\b/ },
  { label: '旧按钮工具类（primary / ghost）', pattern: /\bbtn-(?:primary|ghost)\b/ },
  { label: '旧主题覆写 dark:', pattern: /dark:(?:bg|text|border)-/ },
];

describe('文章详情页 · 数据与安全链路', () => {
  it('保留 SSR fetchPost 与公开作者接口回退', () => {
    for (const token of [
      'async function fetchPost',
      'cachedFetchJson',
      'expand=author',
      'status="published"',
      'AbortSignal.timeout(3000)',
      '/api/public/authors/${authorId}',
      'if (post && !post.expand?.author',
      'post.expand = { author:',
    ]) {
      expect(page, `详情页数据链路丢失：${token}`).toContain(token);
    }
  });

  it('正文仍经 sanitizeHtml 后才交给 set:html', () => {
    expect(page).toContain("import { sanitizeHtml } from '../../lib/security'");
    expect(page).toContain('sanitizeHtml(post.content)');
    expect(page).toMatch(/set:html=\{safeContent\}/);
    expect(page, '不得把未净化的 post.content 直接注入').not.toMatch(/set:html=\{post\.content\}/);
  });

  it('仍为 h2/h3 注入 heading-N id 供 TOC 锚点使用', () => {
    expect(page).toContain('`heading-${headingIndex++}`');
    expect(page).toContain("const plainText = text.replace(/<[^>]+>/g, '');");
    expect(page).toContain('return `<${tag} id="${id}">${text}</${tag}>`;');
  });

  it('公开作者回退失败不影响正文（保留装饰性 try/catch）', () => {
    // 回退请求被包在 try 中，失败时正文继续渲染
    expect(page).toMatch(/\/api\/public\/authors\/[\s\S]{0,400}?catch \{/);
    expect(page).toContain('作者信息只是装饰');
  });
});

describe('文章详情页 · 结构与会话组件', () => {
  it('保留阅读进度、评论区、分享与 PostActions 交互岛', () => {
    for (const token of [
      "import ReadingProgress from '../../components/effects/ReadingProgress'",
      '<ReadingProgress client:visible />',
      "import CommentSection from '../../components/comments/CommentSection'",
      '<CommentSection postId={post.id} client:visible />',
      "import ShareButton from '../../components/ui/ShareButton'",
      '<ShareButton client:visible />',
      "import PostActions from '../../components/posts/PostActions'",
      '<PostActions postId={post.id} initialLikes={post.likes ?? 0} client:visible />',
    ]) {
      expect(page, `详情页交互岛丢失：${token}`).toContain(token);
    }
  });

  it('保留 TOC 的移动端与桌面侧栏两处渲染', () => {
    expect(page).toContain("import TableOfContents from '../../components/posts/TableOfContents'");
    expect(page.match(/<TableOfContents\b/g)).toHaveLength(2);
    expect(page.match(/headings=\{headings\}/g)).toHaveLength(2);
    expect(page).toContain('lg:hidden');
    expect(page).toMatch(/hidden[^"]*lg:block/);
  });

  it('保留滚动 reveal 接口（ScrollReveal 仍以 client:visible 使用）', () => {
    expect(page).toContain("import ScrollReveal from '../../components/ui/ScrollReveal'");
    expect(page).toMatch(/<ScrollReveal\b[^>]*client:visible/);
  });

  it('正文仍挂在 .prose 上，真实内容通过 set:html 注入', () => {
    expect(page).toContain('class="prose reveal-content');
    expect(page).toMatch(/set:html=\{safeContent\}/);
  });
});

describe('文章详情页 · 正文无 JS 可读', () => {
  it('隐藏动效由 JS 添加的 .is-reveal-ready 门控，而不是默认透明', () => {
    expect(page).toContain('.reveal-content.is-reveal-ready > div > *');
    // 不能存在不加门控、直接把正文透明度归零的规则
    expect(page).not.toMatch(/\.reveal-content\s*>\s*div\s*>\s*\*\s*\{[^}]*opacity:\s*0/);
    expect(page).not.toMatch(/class="[^"]*\bopacity-0\b/);
  });

  it('保留减少动效偏好：prefers-reduced-motion 下直接可见', () => {
    expect(page).toContain('@media (prefers-reduced-motion: reduce)');
    expect(page).toContain('.reveal-content.is-reveal-ready > div > *.revealed');
  });
});

describe('文章详情页 · 科幻视觉契约', () => {
  it('结构色统一走 --sf-* 令牌，并保留等宽短标签/编号', () => {
    const sfCount = (page.match(/var\(--sf-/g) ?? []).length;
    expect(sfCount, '详情页 --sf-* 令牌使用过少').toBeGreaterThan(20);
    for (const label of [
      'font-mono',
      'uppercase',
      'Article / 01',
      'Body / 02',
      'React / 03',
      'Comments / 04',
      'Contents / 目录',
    ]) {
      expect(page, `缺少等宽短标签/编号：${label}`).toContain(label);
    }
  });

  it.each(FORBIDDEN_VISUALS)('详情页不引入 $label', ({ pattern }) => {
    expect(page).not.toMatch(pattern);
  });

  it('详情页不再使用旧调色板（zinc/teal/…）', () => {
    const hit = page.match(LEGACY_PALETTE);
    expect(hit?.[0] ?? null, `详情页仍含旧调色板：${hit?.[0]}`).toBeNull();
  });

  it('内容主标题仍是唯一的 h1，且来自 post.title', () => {
    expect(page.match(/<h1\b/g)).toHaveLength(1);
    expect(page).toMatch(/<h1[^>]*>[\s\S]{0,200}?\{post\.title\}/);
  });

  it('封面使用细线框，无重阴影', () => {
    expect(page).toContain('post-cover');
    expect(page).toMatch(/class="post-cover[^"]*border border-\[var\(--sf-line\)\]/);
  });

  it('底部返回链接清晰：列表 + 首页入口与文章导航语义', () => {
    expect((page.match(/返回文章列表/g) ?? []).length).toBeGreaterThanOrEqual(3);
    expect(page).toContain('aria-label="文章导航"');
    expect(page).toContain('返回首页');
    expect(page).toContain('min-h-11');
  });

  it('not found 空态使用统一细线风格，不复用旧按钮令牌', () => {
    for (const token of ['Not Found / 404', '文章不存在', '该文章可能已被删除']) {
      expect(page, `空态丢失：${token}`).toContain(token);
    }
  });
});

describe('PostActions · 科幻视觉层（行为由组件测试守护）', () => {
  it('按钮只使用 --sf-* 令牌并保持 min-h-11 触控高度', () => {
    expect(actions).toContain('var(--sf-');
    expect(actions).toContain('min-h-11');
    expect(actions).not.toMatch(LEGACY_PALETTE);
    expect(actions).not.toMatch(/dark:/);
  });

  it.each(FORBIDDEN_VISUALS)('PostActions 不引入 $label', ({ pattern }) => {
    expect(actions).not.toMatch(pattern);
  });

  it('保留登录态判断、postService 调用、aria-pressed 与错误提示', () => {
    for (const token of [
      'export default function PostActions',
      'getPocketBase',
      'postService.likePost',
      'postService.unlikePost',
      'postService.bookmarkPost',
      'postService.unbookmarkPost',
      'aria-pressed={isLiked}',
      'aria-pressed={isBookmarked}',
      'role="status"',
      'role="alert"',
      '请先登录后再点赞或收藏',
      '操作过于频繁，请稍后再试',
      '点赞失败，请稍后再试',
      '收藏失败，请稍后再试',
    ]) {
      expect(actions, `PostActions 契约丢失：${token}`).toContain(token);
    }
  });
});
