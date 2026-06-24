const fs = require('fs');
const path = require('path');

const astroSrc = path.join('H:', '开发', '个人博客', 'astro', 'src');

// BaseLayout.astro - updated for clean design
const baseLayout = `---
import { ClientRouter } from 'astro:transitions';
import Header from '../components/layout/Header';
import Footer from '../components/layout/Footer.astro';
import '../styles/global.css';
import { SITE_CONFIG } from '../config/site';

interface Props {
  title: string;
  description?: string;
  image?: string;
}

const { title, description = SITE_CONFIG.slogan, image } = Astro.props;
const canonicalURL = new URL(Astro.url.pathname, Astro.site);
---

<!doctype html>
<html lang="zh-CN">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <link rel="icon" type="image/svg+xml" href={SITE_CONFIG.logo} />
    <meta name="generator" content={Astro.generator} />

    <title>{title} | {SITE_CONFIG.name}</title>
    <meta name="description" content={description} />
    <link rel="canonical" href={canonicalURL} />

    <meta property="og:type" content="website" />
    <meta property="og:url" content={Astro.url} />
    <meta property="og:title" content={title} />
    <meta property="og:description" content={description} />
    {image && <meta property="og:image" content={new URL(image, Astro.url)} />}

    <link rel="sitemap" href="/sitemap-index.xml" />

    <link rel="preconnect" href="https://fonts.googleapis.com" />
    <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin />
    <link
      href="https://fonts.googleapis.com/css2?family=Noto+Sans+SC:wght@400;500;600;700&display=swap"
      rel="stylesheet"
    />

    <ClientRouter />
  </head>
  <body class="min-h-screen bg-bg font-body text-text antialiased">
    <Header client:visible />
    <main class="pt-16">
      <slot />
    </main>
    <Footer />
  </body>
</html>
`;
fs.writeFileSync(path.join(astroSrc, 'layouts', 'BaseLayout.astro'), baseLayout);
console.log('Created BaseLayout.astro');

// index.astro - hero + sidebar layout
const index = `---
import BaseLayout from '../layouts/BaseLayout.astro';
import PostList from '../components/posts/PostList';
import ProfileCard from '../components/sidebar/ProfileCard';
import CheckIn from '../components/sidebar/CheckIn';
import HotArticles from '../components/sidebar/HotArticles';
import RecentComments from '../components/sidebar/RecentComments';
import FriendLinks from '../components/sidebar/FriendLinks';
import { POCKETBASE_URL } from '../lib/pocketbase';
import { SITE_CONFIG, HERO_CARDS } from '../config/site';

async function fetchCount(collection: string, filter?: string): Promise<number> {
  try {
    const qs = filter ? \`?filter=\${encodeURIComponent(filter)}&perPage=1\` : '?perPage=1';
    const res = await fetch(\`\${POCKETBASE_URL}/api/collections/\${collection}/records\${qs}\`);
    if (!res.ok) throw new Error(\`\${res.status}\`);
    const data = await res.json();
    return data.totalItems ?? 0;
  } catch {
    return 0;
  }
}

const [postsCount, tagsCount] = await Promise.all([
  fetchCount('posts', 'status = "published"'),
  fetchCount('tags'),
]);

const heroCounts: Record<string, number> = { posts: postsCount, tags: tagsCount };
---

<BaseLayout title="首页" description={SITE_CONFIG.slogan}>
  <!-- Hero Section -->
  <section class="relative flex min-h-[520px] items-center justify-center overflow-hidden bg-hero px-4 sm:min-h-[580px]">
    <div class="pointer-events-none absolute inset-0 opacity-30">
      <div class="absolute left-1/4 top-1/4 h-64 w-64 rounded-full bg-emerald-500/20 blur-[100px]"></div>
      <div class="absolute bottom-1/4 right-1/4 h-80 w-80 rounded-full bg-accent/20 blur-[120px]"></div>
    </div>

    <div class="relative z-10 mx-auto max-w-4xl text-center">
      <div class="animate-fade-up stagger-1 mx-auto mb-6 inline-flex items-center gap-2 rounded-full border border-white/10 bg-white/5 px-4 py-1.5 text-xs font-medium tracking-wider text-white/70">
        <span class="h-1.5 w-1.5 animate-pulse-soft rounded-full bg-emerald-400"></span>
        {SITE_CONFIG.badge}
      </div>

      <h1 class="animate-fade-up stagger-2 text-5xl font-bold tracking-tight text-white sm:text-6xl md:text-7xl">
        {SITE_CONFIG.name}
      </h1>

      <p class="animate-fade-up stagger-3 mx-auto mt-5 max-w-lg text-base text-white/60 sm:text-lg">
        {SITE_CONFIG.slogan}
      </p>

      <div class="animate-fade-up stagger-4 mt-10 flex items-center justify-center gap-4">
        {HERO_CARDS.map((card) => (
          <a href={card.label === 'Articles' ? '/posts' : '/tags'} class="hero-card group flex w-28 flex-col items-center gap-2 py-5 sm:w-32">
            <svg class="h-7 w-7 text-emerald-400 transition-transform group-hover:scale-110" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d={card.icon} />
            </svg>
            <span class="text-2xl font-bold text-white">{heroCounts[card.countKey] || 0}</span>
            <span class="text-xs font-medium tracking-wider text-white/50">{card.label}</span>
          </a>
        ))}
      </div>

      <div class="animate-fade-up stagger-5 mt-10">
        <a href="#latest" class="inline-flex items-center gap-2 rounded-full border border-white/20 bg-white/5 px-6 py-2.5 text-sm font-medium text-white transition-all hover:bg-white/10">
          浏览文章
          <svg class="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 14l-7 7m0 0l-7-7m7 7V3" />
          </svg>
        </a>
      </div>
    </div>
  </section>

  <!-- Main Content -->
  <section id="latest" class="mx-auto max-w-7xl px-4 py-12 sm:px-6">
    <div class="grid gap-8 lg:grid-cols-[1fr_320px]">
      <!-- Left: Post List -->
      <div>
        <div class="mb-6 flex items-center gap-2">
          <span class="h-px w-6 bg-accent"></span>
          <span class="text-sm font-medium text-text-secondary">最新文章</span>
        </div>
        <PostList client:visible perPage={6} layout="horizontal" />
      </div>

      <!-- Right: Sidebar -->
      <aside class="space-y-6">
        <ProfileCard client:load />
        <CheckIn client:load />
        <HotArticles client:load />
        <RecentComments client:load />
        <FriendLinks />
      </aside>
    </div>
  </section>
</BaseLayout>
`;
fs.writeFileSync(path.join(astroSrc, 'pages', 'index.astro'), index);
console.log('Created index.astro');

// PostList.tsx - update for new layout
const postList = `import React, { useState } from 'react';
import { motion } from 'framer-motion';
import { usePosts } from '../../hooks/usePocketBase';
import PostCard from './PostCard';

interface PostListProps {
  initialPage?: number;
  perPage?: number;
  layout?: 'horizontal' | 'vertical';
}

function cn(...classes: (string | boolean | undefined)[]) {
  return classes.filter(Boolean).join(' ');
}

function SkeletonCard({ index, layout }: { index: number; layout: 'horizontal' | 'vertical' }) {
  if (layout === 'vertical') {
    return (
      <motion.div
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: index * 0.06, duration: 0.4 }}
        className="card overflow-hidden"
        aria-hidden="true"
      >
        <div className="aspect-[16/10] bg-bg-soft" />
        <div className="space-y-3 p-4">
          <div className="h-3 w-2/3 rounded bg-bg-soft" />
          <div className="h-5 w-3/4 rounded bg-bg-soft" />
          <div className="h-3 w-full rounded bg-bg-soft" />
        </div>
      </motion.div>
    );
  }
  return (
    <motion.div
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ delay: index * 0.06, duration: 0.4 }}
      className="card overflow-hidden"
      aria-hidden="true"
    >
      <div className="flex flex-col sm:flex-row">
        <div className="h-48 bg-bg-soft sm:h-auto sm:w-56" />
        <div className="flex-1 space-y-3 p-5">
          <div className="h-3 w-1/3 rounded bg-bg-soft" />
          <div className="h-6 w-3/4 rounded bg-bg-soft" />
          <div className="h-3 w-full rounded bg-bg-soft" />
          <div className="h-3 w-2/3 rounded bg-bg-soft" />
        </div>
      </div>
    </motion.div>
  );
}

export default function PostList({ initialPage = 1, perPage = 10, layout = 'horizontal' }: PostListProps) {
  const [currentPage, setCurrentPage] = useState(initialPage);
  const { posts, loading, error, totalPages } = usePosts(currentPage, perPage);

  if (loading) {
    return (
      <div className={layout === 'vertical' ? 'grid gap-6 sm:grid-cols-2 lg:grid-cols-3' : 'space-y-4'} role="status">
        {Array.from({ length: perPage }).map((_, i) => (
          <SkeletonCard key={i} index={i} layout={layout} />
        ))}
      </div>
    );
  }

  if (error) {
    return (
      <div className="card flex flex-col items-center justify-center gap-3 px-6 py-12 text-center">
        <p className="text-sm text-text-secondary">加载失败，请稍后重试</p>
        <button onClick={() => window.location.reload()} className="btn-primary text-xs">重试</button>
      </div>
    );
  }

  if (posts.length === 0) {
    return (
      <div className="card flex flex-col items-center justify-center px-6 py-16 text-center">
        <svg className="mb-4 h-12 w-12 text-text-muted" fill="none" viewBox="0 0 24 24" stroke="currentColor">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1} d="M19.5 14.25v-2.625a3.375 3.375 0 00-3.375-3.375h-1.5A1.125 1.125 0 0113.5 7.125v-1.5a3.375 3.375 0 00-3.375-3.375H8.25m0 12.75h7.5m-7.5 3H12M10.5 2.25H5.625c-.621 0-1.125.504-1.125 1.125v17.25c0 .621.504 1.125 1.125 1.125h12.75c.621 0 1.125-.504 1.125-1.125V11.25a9 9 0 00-9-9z" />
        </svg>
        <p className="text-sm text-text-secondary">暂无文章</p>
      </div>
    );
  }

  return (
    <div className={layout === 'vertical' ? 'grid gap-6 sm:grid-cols-2 lg:grid-cols-3' : 'space-y-4'}>
      {posts.map((post, index) => (
        <PostCard key={post.id} post={post} index={index} layout={layout} />
      ))}

      {totalPages > 1 && (
        <motion.nav
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.4 }}
          className="flex items-center justify-center gap-2 pt-6"
          aria-label="文章分页"
        >
          {Array.from({ length: totalPages }, (_, i) => i + 1).map((page) => (
            <button
              key={page}
              onClick={() => setCurrentPage(page)}
              aria-current={currentPage === page ? 'page' : undefined}
              className={cn(
                'flex h-9 min-w-[36px] items-center justify-center rounded-md border px-3 text-sm font-medium transition-all',
                currentPage === page
                  ? 'border-accent bg-accent text-white'
                  : 'border-border bg-surface text-text-secondary hover:border-border-strong hover:text-text'
              )}
            >
              {page}
            </button>
          ))}
        </motion.nav>
      )}
    </div>
  );
}
`;
fs.writeFileSync(path.join(astroSrc, 'components', 'posts', 'PostList.tsx'), postList);
console.log('Created PostList.tsx');

// pages/posts/index.astro - list with sidebar
const postsIndex = `---
import BaseLayout from '../../layouts/BaseLayout.astro';
import PostList from '../../components/posts/PostList';
import ProfileCard from '../../components/sidebar/ProfileCard';
import HotArticles from '../../components/sidebar/HotArticles';
import FriendLinks from '../../components/sidebar/FriendLinks';
---

<BaseLayout title="文章列表" description="浏览所有已发布的文章">
  <div class="mx-auto max-w-7xl px-4 py-10 sm:px-6">
    <div class="mb-8">
      <div class="mb-2 flex items-center gap-2">
        <span class="h-px w-6 bg-accent"></span>
        <span class="text-sm font-medium text-text-secondary">Articles</span>
      </div>
      <h1 class="text-3xl font-bold text-text">所有文章</h1>
      <p class="mt-2 text-text-secondary">浏览所有已发布的技术文章和思考</p>
    </div>

    <div class="grid gap-8 lg:grid-cols-[1fr_320px]">
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
console.log('Created posts/index.astro');

// tags.astro
const tagsPage = `---
import BaseLayout from '../layouts/BaseLayout.astro';
import { POCKETBASE_URL } from '../lib/pocketbase';
import type { Tag } from '../types/pocketbase';

let tags: Tag[] = [];
try {
  const res = await fetch(\`\${POCKETBASE_URL}/api/collections/tags/records?sort=name&perPage=100\`);
  if (res.ok) {
    const data = await res.json();
    tags = data.items || [];
  }
} catch (err) {
  console.error('Failed to fetch tags:', err);
}
---

<BaseLayout title="标签" description="按标签筛选文章">
  <div class="mx-auto max-w-4xl px-4 py-10 sm:px-6">
    <div class="mb-8 text-center">
      <h1 class="text-3xl font-bold text-text">标签分类</h1>
      <p class="mt-2 text-text-secondary">按标签筛选感兴趣的内容</p>
    </div>

    {tags.length === 0 ? (
      <div class="card py-16 text-center">
        <p class="text-text-secondary">暂无标签</p>
      </div>
    ) : (
      <div class="card p-8">
        <div class="flex flex-wrap justify-center gap-3">
          {tags.map((tag) => (
            <a
              href={\`/tags/\${tag.slug}\`}
              class="rounded-full border border-border bg-bg-soft px-5 py-2 text-sm font-medium text-text-secondary transition-all hover:border-accent hover:text-accent"
            >
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
console.log('Created tags.astro');

// tags/[slug].astro
const tagSlug = `---
import BaseLayout from '../../layouts/BaseLayout.astro';
import PostList from '../../components/posts/PostList';
import { POCKETBASE_URL } from '../../lib/pocketbase';
import type { Tag, Post } from '../../types/pocketbase';

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
          posts.map((post, index) => (
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
console.log('Created tags/[slug].astro');

console.log('Step 6-7 complete');
