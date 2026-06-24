const fs = require('fs');
const path = require('path');

const astroSrc = path.join('H:', '开发', '个人博客', 'astro', 'src');

// pages/posts/demo.astro - clean design
const demoPage = `---
import BaseLayout from '../../layouts/BaseLayout.astro';
import { CommentSection } from '../../components/comments/CommentSection';
---

<BaseLayout title="示例文章" description="一篇用于测试评论系统与简洁风格排版的示例文章">
  <div class="mx-auto max-w-4xl px-4 py-10 sm:px-6">
    <article class="prose">
      <header class="card not-prose mb-8 rounded-2xl p-6 sm:p-8">
        <div class="mb-4 flex flex-wrap items-center gap-2 text-xs text-text-secondary">
          <span class="tag">示例</span>
          <span>·</span>
          <time datetime="2024-01-15">2024年1月15日</time>
          <span>·</span>
          <span>5 分钟阅读</span>
        </div>
        <h1 class="text-2xl font-bold text-text sm:text-3xl">简洁风格博客示例文章</h1>
      </header>

      <div class="mb-10">
        <p>这是一篇用于演示简洁风格博客排版与评论系统的示例文章。整站采用浅色背景、干净卡片与柔和强调色，旨在提供清爽的阅读体验。</p>
        <ul>
          <li>浅色背景与清晰排版</li>
          <li>干净卡片与柔和强调色</li>
          <li>响应式网格布局</li>
          <li>支持评论与回复的交互系统</li>
        </ul>
        <p>你可以在本页底部尝试发表评论，观察新评论的高亮、回复表单展开以及嵌套评论的层级展示效果。</p>
      </div>

      <div class="not-prose mt-12">
        <CommentSection client:visible postId="example-post-id" />
      </div>
    </article>
  </div>
</BaseLayout>
`;
fs.writeFileSync(path.join(astroSrc, 'pages', 'posts', 'demo.astro'), demoPage);
console.log('Updated demo.astro');

// Read [slug].astro
const slugPath = path.join(astroSrc, 'pages', 'posts', '[slug].astro');
const slugContent = fs.readFileSync(slugPath, 'utf8');
console.log('Current [slug].astro length:', slugContent.length);
console.log('Contains old classes:', slugContent.includes('text-ink'), slugContent.includes('holo-card'));

// Replace old tokens in [slug].astro if any
const map = {
  'text-ink': 'text-text',
  'text-dim': 'text-text-secondary',
  'text-muted': 'text-text-muted',
  'bg-space': 'bg-bg',
  'border-line': 'border-border',
  'holo-card': 'card',
  'text-cyan': 'text-accent',
  'bg-cyan': 'bg-accent',
  'focus:border-cyan': 'focus:border-accent',
};
let newSlug = slugContent;
for (const [oldStr, newStr] of Object.entries(map)) {
  newSlug = newSlug.split(oldStr).join(newStr);
}
fs.writeFileSync(slugPath, newSlug);
console.log('Updated [slug].astro');
