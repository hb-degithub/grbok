const fs = require('fs');
const path = require('path');

const astroSrc = path.join('H:', '开发', '个人博客', 'astro', 'src');

// Modern index.astro with hero entrance animation
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
  <section class="relative flex min-h-[620px] items-center justify-center overflow-hidden bg-hero px-4 sm:min-h-[720px]">
    <!-- Animated gradient background -->
    <div class="absolute inset-0 animate-hero-gradient bg-gradient-to-br from-hero via-[#1a1025] to-[#0f172a]"></div>
    
    <!-- Floating gradient orbs -->
    <div class="pointer-events-none absolute inset-0 overflow-hidden">
      <div class="absolute -left-20 top-1/4 h-[500px] w-[500px] rounded-full bg-accent/20 blur-[120px] animate-gradient-shift" style="animation-duration: 25s;"></div>
      <div class="absolute -right-20 bottom-1/4 h-[400px] w-[400px] rounded-full bg-rose/15 blur-[100px] animate-gradient-shift" style="animation-duration: 30s; animation-direction: reverse;"></div>
      <div class="absolute left-1/3 top-1/2 h-[300px] w-[300px] rounded-full bg-orange/10 blur-[80px] animate-gradient-shift" style="animation-duration: 22s;"></div>
    </div>

    <!-- Grid pattern overlay -->
    <div class="pointer-events-none absolute inset-0 opacity-[0.03]" style="background-image: linear-gradient(rgba(255,255,255,0.1) 1px, transparent 1px), linear-gradient(90deg, rgba(255,255,255,0.1) 1px, transparent 1px); background-size: 60px 60px;"></div>

    <div class="relative z-10 mx-auto max-w-5xl text-center">
      <!-- Badge -->
      <div class="animate-slide-up delay-100 mx-auto mb-8 inline-flex items-center gap-2 rounded-full glass px-5 py-2 text-xs font-medium tracking-wider text-white/80">
        <span class="h-1.5 w-1.5 animate-pulse rounded-full bg-emerald-400"></span>
        {SITE_CONFIG.badge}
      </div>

      <!-- Main title with entrance animation -->
      <h1 class="animate-letter-spacing delay-200 text-6xl font-bold tracking-tight text-white sm:text-7xl md:text-8xl lg:text-9xl">
        {SITE_CONFIG.name}
      </h1>

      <!-- Subtitle -->
      <p class="animate-slide-up delay-400 mx-auto mt-8 max-w-xl text-lg font-light leading-relaxed text-white/50 sm:text-xl">
        {SITE_CONFIG.slogan}
      </p>

      <!-- Hero stat cards -->
      <div class="animate-slide-up delay-500 mt-14 flex items-center justify-center gap-4 sm:gap-6">
        {HERO_CARDS.map((card, index) => (
          <a
            href={card.label === 'Articles' ? '/posts' : '/tags'}
            class="glass hover-lift group flex flex-col items-center gap-2 rounded-2xl px-7 py-6 sm:px-10 sm:py-8"
            style={\`animation-delay: \${0.6 + index * 0.1}s\`}
          >
            <span class="text-3xl font-bold text-white sm:text-4xl">{heroCounts[card.countKey] || 0}</span>
            <span class="text-xs font-medium uppercase tracking-[0.2em] text-white/40">{card.label}</span>
          </a>
        ))}
      </div>

      <!-- CTA -->
      <div class="animate-slide-up delay-700 mt-14">
        <a href="#latest" class="group inline-flex items-center gap-3 rounded-full bg-white px-8 py-3.5 text-sm font-semibold text-hero transition-all hover:bg-white/90 hover:shadow-[0_0_40px_rgba(255,255,255,0.2)]">
          浏览文章
          <svg class="h-4 w-4 transition-transform group-hover:translate-y-1" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 14l-7 7m0 0l-7-7m7 7V3" />
          </svg>
        </a>
      </div>
    </div>

    <!-- Scroll indicator -->
    <div class="absolute bottom-8 left-1/2 -translate-x-1/2 animate-bounce text-white/30">
      <svg class="h-6 w-6" fill="none" viewBox="0 0 24 24" stroke="currentColor">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M19 14l-7 7m0 0l-7-7m7 7V3" />
      </svg>
    </div>
  </section>

  <!-- Main Content -->
  <section id="latest" class="mx-auto max-w-7xl px-4 py-20 sm:px-6">
    <div class="grid gap-10 lg:grid-cols-[1fr_340px]">
      <!-- Left: Post List -->
      <div>
        <div class="mb-8 flex items-end justify-between">
          <div>
            <span class="text-xs font-semibold uppercase tracking-[0.2em] text-accent">Latest</span>
            <h2 class="mt-2 text-2xl font-bold text-text">最新文章</h2>
          </div>
          <a href="/posts" class="group flex items-center gap-1 text-sm font-medium text-text-secondary transition-colors hover:text-accent">
            查看全部
            <svg class="h-4 w-4 transition-transform group-hover:translate-x-1" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
            </svg>
          </a>
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
console.log('Updated index.astro with modern hero animation');
