const fs = require('fs');
const path = require('path');

const astroSrc = path.join('H:', '开发', '个人博客', 'astro', 'src');

// tags/[slug].astro with getStaticPaths
const tagSlug = `---
import BaseLayout from '../../layouts/BaseLayout.astro';
import { POCKETBASE_URL } from '../../lib/pocketbase';
import type { Tag, Post } from '../../types/pocketbase';

export async function getStaticPaths() {
  try {
    const res = await fetch(\`\${POCKETBASE_URL}/api/collections/tags/records?sort=name&perPage=100\`);
    if (!res.ok) return [];
    const data = await res.json();
    return (data.items || []).map((tag: Tag) => ({ params: { slug: tag.slug } }));
  } catch {
    return [];
  }
}

const { slug } = Astro.params;

let tag: Tag | null = null;
let posts: Post[] = [];

try {
  const tagRes = await fetch(\`\${POCKETBASE_URL}/api/collections/tags/records?filter=\${encodeURIComponent(\`slug = "\${slug}"\`)}&perPage=1\`);
  if (tagRes.ok) {
    const tagData = await tagRes.json();
    tag = tagData.items?.[0] || null;
  }

  if (tag) {
    const postsRes = await fetch(\`\${POCKETBASE_URL}/api/collections/posts/records?filter=\${encodeURIComponent(\`status = "published"\`)}&sort=-published_at&perPage=50&expand=post_tags(tag_id)\`);
    if (postsRes.ok) {
      const postsData = await postsRes.json();
      posts = (postsData.items || []).filter((post: Post) =>
        post.expand?.['post_tags(post_id)']?.some((pt) => pt.tag_id === tag?.id)
      );
    }
  }
} catch (err) {
  console.error('Failed to fetch tag posts:', err);
}

if (!tag) {
  return Astro.redirect('/404');
}
---

<BaseLayout title={\`标签：\${tag.name}\`} description={\`查看标签 \${tag.name} 下的文章\`}>
  <div class="mx-auto max-w-7xl px-4 py-10 sm:px-6">
    <div class="mb-8">
      <div class="mb-2 flex items-center gap-2">
        <span class="h-px w-6 bg-accent"></span>
        <span class="text-sm font-medium text-text-secondary">Tag</span>
      </div>
      <h1 class="text-3xl font-bold text-text">{tag.name}</h1>
      {tag.description && <p class="mt-2 text-text-secondary">{tag.description}</p>}
    </div>

    <div class="grid gap-8 lg:grid-cols-[1fr_320px]">
      <div class="grid gap-6 sm:grid-cols-2">
        {posts.length === 0 ? (
          <div class="card col-span-full py-16 text-center">
            <p class="text-text-secondary">该标签下暂无文章</p>
          </div>
        ) : (
          posts.map((post) => (
            <a href={\`/posts/\${post.slug}\`} class="card group overflow-hidden">
              <div class="aspect-[16/10] overflow-hidden bg-bg-soft">
                {post.cover ? (
                  <img src={post.cover} alt={post.title} class="h-full w-full object-cover transition-transform duration-500 group-hover:scale-105" />
                ) : (
                  <div class="flex h-full w-full items-center justify-center text-text-muted">
                    <svg class="h-10 w-10" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1} d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z" />
                    </svg>
                  </div>
                )}
              </div>
              <div class="p-4">
                <h3 class="line-clamp-2 font-semibold text-text transition-colors group-hover:text-accent">{post.title}</h3>
              </div>
            </a>
          ))
        )}
      </div>
      <aside class="space-y-6">
        <div class="widget">
          <div class="widget-title">标签信息</div>
          <p class="text-sm text-text-secondary">{posts.length} 篇文章</p>
          <a href="/tags" class="mt-3 inline-block text-sm text-accent hover:underline">查看全部标签</a>
        </div>
      </aside>
    </div>
  </div>
</BaseLayout>
`;
fs.writeFileSync(path.join(astroSrc, 'pages', 'tags', '[slug].astro'), tagSlug);
console.log('Fixed tags/[slug].astro');
