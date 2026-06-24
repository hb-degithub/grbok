const fs = require('fs');
const path = require('path');

const base = 'H:/开发/个人博客';

function read(file) {
  return fs.readFileSync(path.join(base, file), 'utf8');
}

function write(file, content) {
  fs.writeFileSync(path.join(base, file), content, 'utf8');
}

// 1. CommentSection.tsx: retry button
{
  let f = read('astro/src/components/comments/CommentSection.tsx');
  f = f.replace(/<Button[^>]*>\s*<svg[^>]*>[\s\S]*?<\/svg>\s*\?\?\s*<\/Button>/, `<Button onClick={refresh} variant="primary" size="sm">
            <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" aria-hidden="true">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
            </svg>
            重试
          </Button>`);
  write('astro/src/components/comments/CommentSection.tsx', f);
  console.log('CommentSection.tsx fixed');
}

// 2. SearchModal.tsx: empty state + dynamic footer
{
  let f = read('astro/src/components/search/SearchModal.tsx');
  f = f.replace('<div className="py-8 text-center text-sm text-dim">；</div>', '<div className="py-8 text-center text-sm text-dim">未找到相关结果</div>');
  f = f.replace(
    /<div className="border-t border-line px-4 py-3 font-mono text-\[10px\] uppercase tracking-widest text-muted">\s*<div className="flex items-center gap-4">\s*<span>未找到相关结果<\/span>\s*<span>↻ 动态加载<\/span>\s*<span>ESC 关闭<\/span>\s*<\/div>\s*<\/div>/,
    `<div className="border-t border-line px-4 py-3 font-mono text-[10px] uppercase tracking-widest text-muted">
                <div className="flex items-center justify-between">
                  <span>
                    {isLoading ? '搜索中…' : query && results.length === 0 ? '未找到相关结果' : results.length > 0 ? \`找到 \${results.length} 条结果\` : '输入关键词开始搜索'}
                  </span>
                  <div className="flex items-center gap-4">
                    <span>↵ 打开</span>
                    <span>↑↓ 选择</span>
                    <span>ESC 关闭</span>
                  </div>
                </div>
              </div>`
  );
  write('astro/src/components/search/SearchModal.tsx', f);
  console.log('SearchModal.tsx fixed');
}

// 3. BaseLayout.astro: defaults
{
  let f = read('astro/src/layouts/BaseLayout.astro');
  f = f.replace("const { title, description = '??????', image } = Astro.props;", "const { title, description = '分享技术、思考与生活', image } = Astro.props;");
  f = f.replace('<title>{title} | ??</title>', '<title>{title} | 个人博客</title>');
  f = f.replace('&copy; {new Date().getFullYear()} ?? // TERMINAL', '&copy; {new Date().getFullYear()} 个人博客 // TERMINAL');
  f = f.replace('aria-label="RSS ??"', 'aria-label="RSS 订阅"');
  write('astro/src/layouts/BaseLayout.astro', f);
  console.log('BaseLayout.astro fixed');
}

// 4. PostLayout.astro: labels
{
  let f = read('astro/src/layouts/PostLayout.astro');
  f = f.replace('{readingTime} ????', '{readingTime} 分钟阅读');
  f = f.replace('{post.views} ???', '{post.views} 次浏览');
  f = f.replace('??????\n        </a>', '返回文章列表\n        </a>');
  write('astro/src/layouts/PostLayout.astro', f);
  console.log('PostLayout.astro fixed');
}

// 5. demo.astro: demo content
{
  let f = read('astro/src/pages/posts/demo.astro');
  f = f.replace('<BaseLayout title="????" description="??????">', '<BaseLayout title="示例文章" description="一篇用于测试评论系统与科幻风格排版的示例文章">');
  f = f.replace('<span class="rounded-full bg-cyan/10 px-2.5 py-0.5 font-medium text-cyan">??</span>', '<span class="rounded-full bg-cyan/10 px-2.5 py-0.5 font-medium text-cyan">示例</span>');
  f = f.replace('<span class="text-dim">5 ????</span>', '<span class="text-dim">5 分钟阅读</span>');
  f = f.replace('<time class="text-dim" datetime="2024-01-15">2024 ? 1 ? 15 ?</time>', '<time class="text-dim" datetime="2024-01-15">2024年1月15日</time>');
  f = f.replace('<h1 class="font-display text-3xl font-black uppercase tracking-wide text-ink sm:text-4xl">\n          ??????\n        </h1>', '<h1 class="font-display text-3xl font-black uppercase tracking-wide text-ink sm:text-4xl">\n          科幻风格博客示例文章\n        </h1>');
  f = f.replace(
    /<div class="mb-12">\s*<p>\?{20,}<\/p>\s*<ul>\s*<li>\?{5,} 3 \?\?<\/li>\s*<li>Realtime \?{4}<\/li>\s*<li>\?{6}<\/li>\s*<li>3D \?{6}\?\?<\/li>\s*<\/ul>\s*<p>\?{15,}<\/p>\s*<\/div>/,
    `<div class="mb-12">
        <p>这是一篇用于演示科幻风格博客排版与评论系统的示例文章。整站采用深色太空主题、全息玻璃卡片与青色霓虹光效，旨在提供沉浸式的阅读体验。</p>
        <ul>
          <li>深色太空背景与星空动效</li>
          <li>全息玻璃卡片与扫描线动画</li>
          <li>响应式网格布局与 3D 网格地面</li>
          <li>支持评论与回复的交互系统</li>
        </ul>
        <p>你可以在本页底部尝试发表评论，观察新评论的高亮、回复表单展开以及嵌套评论的层级展示效果。</p>
      </div>`
  );
  write('astro/src/pages/posts/demo.astro', f);
  console.log('demo.astro fixed');
}

// 6. index.astro: upward stacking stats
{
  let f = read('astro/src/pages/index.astro');
  f = f.replace(
    /<div class="mt-10 flex flex-col items-center \[perspective:800px\]">\s*<div class="animate-stack-up stagger-5 holo-card animate-scan relative z-10 w-44 px-8 py-5 text-center shadow-\[0_0_30px_rgba\(34,211,238,0\.15\)\] transition-transform hover:-translate-y-1">\s*<div class="font-display text-2xl font-bold text-cyan">\{postsCount\}<\/div>\s*<div class="mt-1 font-mono text-\[10px\] uppercase tracking-widest text-muted">Articles<\/div>\s*<\/div>\s*<div class="animate-stack-up stagger-5 holo-card animate-scan relative z-20 -mt-5 w-48 px-8 py-5 text-center shadow-\[0_-10px_40px_rgba\(251,191,36,0\.2\)\] transition-transform hover:-translate-y-1" style="animation-delay: 0\.7s">\s*<div class="font-display text-2xl font-bold text-amber">\{tagsCount\}<\/div>\s*<div class="mt-1 font-mono text-\[10px\] uppercase tracking-widest text-muted">Tags<\/div>\s*<\/div>\s*<\/div>/,
    `<div class="mt-16 flex flex-col items-center [perspective:1200px]">
        <div class="relative w-56 space-y-2">
          <div class="animate-stack-up stagger-5 holo-card relative z-10 origin-bottom rounded-xl border-cyan/20 px-8 py-5 text-center shadow-[0_10px_40px_rgba(34,211,238,0.12)] transition-all duration-300 hover:[transform:rotateX(0deg)_translateY(-4px)] [transform:rotateX(8deg)]">
            <div class="font-display text-3xl font-bold text-cyan">{postsCount}</div>
            <div class="mt-1 font-mono text-[10px] uppercase tracking-widest text-muted">Articles</div>
          </div>
          <div class="animate-stack-up stagger-5 holo-card relative z-20 origin-bottom rounded-xl border-amber/20 px-8 py-5 text-center shadow-[0_10px_40px_rgba(251,191,36,0.15)] transition-all duration-300 hover:[transform:rotateX(0deg)_translateY(-4px)] [transform:rotateX(3deg)]" style="animation-delay: 0.7s">
            <div class="font-display text-3xl font-bold text-amber">{tagsCount}</div>
            <div class="mt-1 font-mono text-[10px] uppercase tracking-widest text-muted">Tags</div>
          </div>
        </div>
      </div>`
  );
  write('astro/src/pages/index.astro', f);
  console.log('index.astro stats redesigned');
}

console.log('all fixes applied');
