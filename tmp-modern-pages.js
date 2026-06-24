const fs = require('fs');
const path = require('path');

const astroSrc = path.join('H:', '开发', '个人博客', 'astro', 'src');

// Modern posts/index.astro
const postsIndex = `---
import BaseLayout from '../../layouts/BaseLayout.astro';
import PostList from '../../components/posts/PostList';
import ProfileCard from '../../components/sidebar/ProfileCard';
import HotArticles from '../../components/sidebar/HotArticles';
import FriendLinks from '../../components/sidebar/FriendLinks';
---

<BaseLayout title="文章列表" description="浏览所有已发布的文章">
  <div class="mx-auto max-w-7xl px-4 py-12 sm:px-6">
    <div class="mb-10">
      <span class="text-xs font-semibold uppercase tracking-[0.2em] text-accent">Articles</span>
      <h1 class="mt-2 text-3xl font-bold text-text sm:text-4xl">所有文章</h1>
      <p class="mt-2 text-text-secondary">浏览所有已发布的技术文章和思考</p>
    </div>

    <div class="grid gap-10 lg:grid-cols-[1fr_340px]">
      <PostList client:visible perPage={10} />
      <aside class="space-y-6">
        <ProfileCard client:load />
        <HotArticles client:load />
        <FriendLinks />
      </aside>
    </div>
  </div>
</BaseLayout>
`;
fs.writeFileSync(path.join(astroSrc, 'pages', 'posts', 'index.astro'), postsIndex);

// Modern tags.astro
const tagsPage = `---
import BaseLayout from '../layouts/BaseLayout.astro';
import { POCKETBASE_URL } from '../lib/pocketbase';
import type { Tag } from '../types/pocketbase';

let tags: Tag[] = [];
try {
  const res = await fetch(\`\${POCKETBASE_URL}/api/collections/tags/records?sort=name&perPage=100\`);
  if (res.ok) { const data = await res.json(); tags = data.items || []; }
} catch (err) { console.error('Failed to fetch tags:', err); }
---

<BaseLayout title="标签" description="按标签筛选文章">
  <div class="mx-auto max-w-4xl px-4 py-12 sm:px-6">
    <div class="mb-10 text-center">
      <span class="text-xs font-semibold uppercase tracking-[0.2em] text-accent">Tags</span>
      <h1 class="mt-2 text-3xl font-bold text-text sm:text-4xl">标签分类</h1>
      <p class="mt-2 text-text-secondary">按标签筛选感兴趣的内容</p>
    </div>

    {tags.length === 0 ? (
      <div class="card py-16 text-center"><p class="text-text-secondary">暂无标签</p></div>
    ) : (
      <div class="card p-8 sm:p-10">
        <div class="flex flex-wrap justify-center gap-3">
          {tags.map((tag) => (
            <a href={\`/tags/\${tag.slug}\`} class="rounded-full border border-border bg-bg-soft px-5 py-2.5 text-sm font-medium text-text-secondary transition-all hover:border-accent hover:bg-accent hover:text-white hover:shadow-lg hover:shadow-accent/20">
              {tag.name}
            </a>
          ))}
        </div>
      </div>
    )}
  </div>
</BaseLayout>
`;
fs.writeFileSync(path.join(astroSrc, 'pages', 'tags.astro'), tagsPage);

// Modern tags/[slug].astro
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
  } catch { return []; }
}

const { slug } = Astro.params;
let tag: Tag | null = null;
let posts: Post[] = [];

try {
  const tagRes = await fetch(\`\${POCKETBASE_URL}/api/collections/tags/records?filter=\${encodeURIComponent(\`slug = "\${slug}"\`)}&perPage=1\`);
  if (tagRes.ok) { const tagData = await tagRes.json(); tag = tagData.items?.[0] || null; }
  if (tag) {
    const postsRes = await fetch(\`\${POCKETBASE_URL}/api/collections/posts/records?filter=\${encodeURIComponent(\`status = "published"\`)}&sort=-published_at&perPage=50&expand=post_tags(tag_id)\`);
    if (postsRes.ok) {
      const postsData = await postsRes.json();
      posts = (postsData.items || []).filter((post: Post) => post.expand?.['post_tags(post_id)']?.some((pt) => pt.tag_id === tag?.id));
    }
  }
} catch (err) { console.error('Failed to fetch tag posts:', err); }

if (!tag) return Astro.redirect('/404');
---

<BaseLayout title={\`标签：\${tag.name}\`} description={\`查看标签 \${tag.name} 下的文章\`}>
  <div class="mx-auto max-w-7xl px-4 py-12 sm:px-6">
    <div class="mb-10">
      <span class="text-xs font-semibold uppercase tracking-[0.2em] text-accent">Tag</span>
      <h1 class="mt-2 text-3xl font-bold text-text sm:text-4xl">{tag.name}</h1>
      {tag.description && <p class="mt-2 text-text-secondary">{tag.description}</p>}
    </div>

    <div class="grid gap-10 lg:grid-cols-[1fr_340px]">
      <div class="grid gap-6 sm:grid-cols-2">
        {posts.length === 0 ? (
          <div class="card col-span-full py-16 text-center"><p class="text-text-secondary">该标签下暂无文章</p></div>
        ) : (
          posts.map((post) => (
            <a href={\`/posts/\${post.slug}\`} class="card hover-lift group overflow-hidden">
              <div class="aspect-[16/10] overflow-hidden bg-bg-soft">
                {post.cover ? (
                  <img src={post.cover} alt={post.title} class="h-full w-full object-cover transition-transform duration-700 group-hover:scale-110" />
                ) : (
                  <div class="flex h-full w-full items-center justify-center text-text-muted">
                    <svg class="h-10 w-10" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1} d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z" /></svg>
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
          <a href="/tags" class="mt-3 inline-block text-sm font-medium text-accent hover:underline">查看全部标签</a>
        </div>
      </aside>
    </div>
  </div>
</BaseLayout>
`;
fs.writeFileSync(path.join(astroSrc, 'pages', 'tags', '[slug].astro'), tagSlug);

console.log('Updated list/tag pages');
