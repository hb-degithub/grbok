const fs = require('fs');
const path = require('path');

const astroSrc = path.join('H:', '开发', '个人博客', 'astro', 'src');

// Modern Header.tsx
const header = `import React, { useState, useEffect } from 'react';
import SearchModal from '../search/SearchModal';
import { SITE_CONFIG } from '../../config/site';

const navItems = [
  { href: '/', label: '首页' },
  { href: '/posts', label: '文章' },
  { href: '/tags', label: '标签' },
  { href: '/about', label: '关于' },
];

export default function Header() {
  const [scrolled, setScrolled] = useState(false);
  const [currentPath, setCurrentPath] = useState('');

  useEffect(() => {
    setCurrentPath(window.location.pathname);
    const handleScroll = () => setScrolled(window.scrollY > 20);
    window.addEventListener('scroll', handleScroll);
    return () => window.removeEventListener('scroll', handleScroll);
  }, []);

  const isActive = (href: string) => {
    if (href === '/') return currentPath === '/';
    return currentPath.startsWith(href);
  };

  return (
    <header
      className={\`fixed inset-x-0 top-0 z-50 transition-all duration-500 \${
        scrolled
          ? 'bg-white/80 shadow-[0_4px_30px_rgba(0,0,0,0.05)] backdrop-blur-xl'
          : 'bg-transparent'
      }\`}
    >
      <div className="mx-auto flex h-16 max-w-7xl items-center justify-between px-4 sm:px-6">
        <a href="/" className="group flex items-center gap-2.5">
          <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-accent text-lg font-bold text-white transition-transform group-hover:scale-105">
            {SITE_CONFIG.logoText}
          </div>
          <span className={\`text-lg font-bold transition-colors \${scrolled ? 'text-text' : 'text-white'}\`}>
            {SITE_CONFIG.name}
          </span>
        </a>

        <nav className="hidden items-center gap-8 md:flex">
          {navItems.map((item) => (
            <a
              key={item.href}
              href={item.href}
              className={\`relative text-sm font-medium transition-colors \${
                scrolled
                  ? isActive(item.href) ? 'text-accent' : 'text-text-secondary hover:text-text'
                  : isActive(item.href) ? 'text-white' : 'text-white/70 hover:text-white'
              }\`}
            >
              {item.label}
              {isActive(item.href) && (
                <span className="absolute -bottom-1 left-0 h-0.5 w-full rounded-full bg-current" />
              )}
            </a>
          ))}
        </nav>

        <div className="flex items-center gap-2">
          <div className={scrolled ? '' : '[&_button]:text-white [&_button:hover]:bg-white/10'}>
            <SearchModal />
          </div>
          <a
            href="/admin"
            className={\`hidden rounded-lg px-3 py-1.5 text-sm font-medium transition-colors sm:inline-block \${
              scrolled
                ? 'text-text-secondary hover:bg-bg-soft hover:text-text'
                : 'text-white/80 hover:bg-white/10 hover:text-white'
            }\`}
          >
            管理
          </a>
          <a
            href="/login"
            className={\`rounded-lg px-4 py-1.5 text-sm font-semibold transition-all \${
              scrolled
                ? 'bg-accent text-white hover:bg-accent-hover'
                : 'bg-white text-hero hover:bg-white/90'
            }\`}
          >
            登录
          </a>
        </div>
      </div>
    </header>
  );
}
`;
fs.writeFileSync(path.join(astroSrc, 'components', 'layout', 'Header.tsx'), header);
console.log('Updated Header.tsx');

// Modern PostCard.tsx with better hover
const postCard = `import React from 'react';
import { motion } from 'framer-motion';
import type { Post } from '../../types/pocketbase';

interface PostCardProps {
  post: Post;
  index?: number;
  layout?: 'horizontal' | 'vertical';
}

export default function PostCard({ post, index = 0, layout = 'horizontal' }: PostCardProps) {
  const formattedDate = post.published_at
    ? new Date(post.published_at).toLocaleDateString('zh-CN', { month: 'short', day: 'numeric' })
    : new Date(post.created).toLocaleDateString('zh-CN', { month: 'short', day: 'numeric' });
  const readingTime = Math.max(1, Math.ceil((post.content?.length || 0) / 300));

  if (layout === 'vertical') {
    return (
      <motion.article
        initial={{ opacity: 0, y: 24 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.5, delay: index * 0.08, ease: [0.16, 1, 0.3, 1] }}
        className="card hover-lift group overflow-hidden"
      >
        <a href={\`/posts/\${post.slug}\`} className="block">
          <div className="aspect-[16/10] overflow-hidden bg-bg-soft">
            {post.cover ? (
              <img src={post.cover} alt={post.title} className="h-full w-full object-cover transition-transform duration-700 group-hover:scale-110" loading="lazy" />
            ) : (
              <div className="flex h-full w-full items-center justify-center text-text-muted">
                <svg className="h-12 w-12" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1} d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z" /></svg>
              </div>
            )}
          </div>
          <div className="p-5">
            <div className="mb-2 flex items-center gap-2 text-xs text-text-muted">
              <span>{formattedDate}</span><span>·</span><span>{readingTime} 分钟</span>
            </div>
            <h3 className="mb-2 line-clamp-2 text-base font-semibold text-text transition-colors group-hover:text-accent">{post.title}</h3>
            {post.excerpt && <p className="line-clamp-2 text-sm text-text-secondary">{post.excerpt}</p>}
          </div>
        </a>
      </motion.article>
    );
  }

  return (
    <motion.article
      initial={{ opacity: 0, y: 24 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.5, delay: index * 0.08, ease: [0.16, 1, 0.3, 1] }}
      className="card hover-lift group overflow-hidden"
    >
      <a href={\`/posts/\${post.slug}\`} className="flex flex-col sm:flex-row">
        <div className="sm:w-52 md:w-64 flex-shrink-0 overflow-hidden bg-bg-soft">
          {post.cover ? (
            <img src={post.cover} alt={post.title} className="h-52 w-full object-cover transition-transform duration-700 group-hover:scale-110 sm:h-full" loading="lazy" />
          ) : (
            <div className="flex h-52 w-full items-center justify-center bg-bg-soft text-text-muted sm:h-full">
              <svg className="h-14 w-14" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1} d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z" /></svg>
            </div>
          )}
        </div>
        <div className="flex flex-1 flex-col justify-center p-6">
          <div className="mb-3 flex flex-wrap items-center gap-2 text-xs text-text-muted">
            <span className="tag">默认分类</span><span>·</span><span>{formattedDate}</span><span>·</span><span>{readingTime} 分钟阅读</span>
          </div>
          <h3 className="mb-2 text-lg font-semibold text-text transition-colors group-hover:text-accent sm:text-xl">{post.title}</h3>
          {post.excerpt && <p className="mb-4 line-clamp-2 text-sm leading-relaxed text-text-secondary">{post.excerpt}</p>}
          <div className="mt-auto flex items-center gap-5 text-xs text-text-muted">
            <span className="flex items-center gap-1.5"><svg className="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" /><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z" /></svg>{post.views || 0}</span>
            <span className="flex items-center gap-1.5"><svg className="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M8 12h.01M12 12h.01M16 12h.01M21 12c0 4.418-4.03 8-9 8a9.863 9.863 0 01-4.255-.949L3 20l1.395-3.72C3.512 15.042 3 13.574 3 12c0-4.418 4.03-8 9-8s9 3.582 9 8z" /></svg>0</span>
          </div>
        </div>
      </a>
    </motion.article>
  );
}
`;
fs.writeFileSync(path.join(astroSrc, 'components', 'posts', 'PostCard.tsx'), postCard);
console.log('Updated PostCard.tsx');

// Modern Footer.astro
const footer = `---
import { SITE_CONFIG } from '../../config/site';
---

<footer class="relative mt-24 overflow-hidden bg-hero text-white">
  <div class="absolute inset-0 opacity-20">
    <div class="absolute -left-20 top-0 h-72 w-72 rounded-full bg-accent/30 blur-[100px]"></div>
    <div class="absolute bottom-0 right-0 h-72 w-72 rounded-full bg-rose/20 blur-[100px]"></div>
  </div>

  <div class="relative mx-auto max-w-7xl px-4 py-16 sm:px-6">
    <div class="grid gap-12 md:grid-cols-2 lg:grid-cols-4">
      <div class="lg:col-span-2">
        <a href="/" class="flex items-center gap-2.5">
          <div class="flex h-10 w-10 items-center justify-center rounded-xl bg-accent text-xl font-bold text-white">
            {SITE_CONFIG.logoText}
          </div>
          <span class="text-xl font-bold">{SITE_CONFIG.name}</span>
        </a>
        <p class="mt-4 max-w-sm text-sm leading-relaxed text-white/50">{SITE_CONFIG.description}</p>
        <div class="mt-6 flex items-center gap-3">
          {SITE_CONFIG.socialLinks.map((link) => (
            <a key={link.name} href={link.url} target="_blank" rel="noopener noreferrer" class="flex h-10 w-10 items-center justify-center rounded-full bg-white/5 text-white/60 transition-all hover:bg-accent hover:text-white" aria-label={link.name}>
              {link.name === 'github' ? (
                <svg class="h-4 w-4" fill="currentColor" viewBox="0 0 24 24"><path d="M12 0c-6.626 0-12 5.373-12 12 0 5.302 3.438 9.8 8.207 11.387.599.111.793-.261.793-.577v-2.234c-3.338.726-4.033-1.416-4.033-1.416-.546-1.387-1.333-1.756-1.333-1.756-1.089-.745.083-.729.083-.729 1.205.084 1.839 1.237 1.839 1.237 1.07 1.834 2.807 1.304 3.492.997.107-.775.418-1.305.762-1.604-2.665-.305-5.467-1.334-5.467-5.931 0-1.311.469-2.381 1.236-3.221-.124-.303-.535-1.524.117-3.176 0 0 1.008-.322 3.301 1.23.957-.266 1.983-.399 3.003-.404 1.02.005 2.047.138 3.006.404 2.291-1.552 3.297-1.23 3.297-1.23.653 1.653.242 2.874.118 3.176.77.84 1.235 1.911 1.235 3.221 0 4.609-2.807 5.624-5.479 5.921.43.372.823 1.102.823 2.222v3.293c0 .319.192.694.801.576 4.765-1.589 8.199-6.086 8.199-11.386 0-6.627-5.373-12-12-12z"/></svg>
              ) : (
                <svg class="h-4 w-4" fill="currentColor" viewBox="0 0 24 24"><path d="M23.953 4.57a10 10 0 01-2.825.775 4.958 4.958 0 002.163-2.723c-.951.555-2.005.959-3.127 1.184a4.92 4.92 0 00-8.384 4.482C7.69 8.095 4.067 6.13 1.64 3.162a4.822 4.822 0 00-.666 2.475c0 1.71.87 3.213 2.188 4.096a4.904 4.904 0 01-2.228-.616v.06a4.923 4.923 0 003.946 4.827 4.996 4.996 0 01-2.212.085 4.936 4.936 0 004.604 3.417 9.867 9.867 0 01-6.102 2.105c-.39 0-.779-.023-1.17-.067a13.995 13.995 0 007.557 2.209c9.053 0 13.998-7.496 13.998-13.985 0-.21 0-.42-.015-.63A9.935 9.935 0 0024 4.59z"/></svg>
              )}
            </a>
          ))}
        </div>
      </div>

      <div>
        <h3 class="text-sm font-semibold uppercase tracking-wider text-white/80">快速链接</h3>
        <ul class="mt-4 space-y-3">
          {SITE_CONFIG.footerLinks.map((link) => (
            <li><a href={link.href} class="text-sm text-white/50 transition-colors hover:text-white">{link.label}</a></li>
          ))}
        </ul>
      </div>

      <div>
        <h3 class="text-sm font-semibold uppercase tracking-wider text-white/80">备案信息</h3>
        <div class="mt-4 space-y-2 text-sm text-white/50">
          <p>{SITE_CONFIG.icp}</p>
          <p>{SITE_CONFIG.police}</p>
        </div>
      </div>
    </div>

    <div class="mt-12 flex flex-col items-center justify-between gap-4 border-t border-white/10 pt-8 sm:flex-row">
      <p class="text-sm text-white/40">Copyright © {SITE_CONFIG.since} - {new Date().getFullYear()} · {SITE_CONFIG.name}</p>
      <p class="text-sm text-white/40">由 {SITE_CONFIG.name} 强力驱动</p>
    </div>
  </div>
</footer>
`;
fs.writeFileSync(path.join(astroSrc, 'components', 'layout', 'Footer.astro'), footer);
console.log('Updated Footer.astro');

// Update card hover effect in global.css
let css = fs.readFileSync(cssPath, 'utf8');
if (!css.includes('transition: transform 0.4s cubic-bezier')) {
  css = css.replace(
    '.card:hover {\n  border-color: var(--color-border-strong);\n  box-shadow: 0 4px 20px rgba(0, 0, 0, 0.05);\n}',
    '.card {\n  transition: transform 0.4s cubic-bezier(0.16, 1, 0.3, 1), box-shadow 0.4s cubic-bezier(0.16, 1, 0.3, 1), border-color 0.3s ease;\n}\n\n.card:hover {\n  border-color: var(--color-border-strong);\n  transform: translateY(-3px);\n  box-shadow: 0 24px 48px -12px rgba(0, 0, 0, 0.08);\n}'
  );
  fs.writeFileSync(cssPath, css);
  console.log('Updated card hover effects');
}

console.log('Step 2-3 complete');
