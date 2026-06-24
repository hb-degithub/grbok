const fs = require('fs');
const path = require('path');

const astroSrc = path.join('H:', '开发', '个人博客', 'astro', 'src');

// 1. Create config file for easy replacement
const configDir = path.join(astroSrc, 'config');
if (!fs.existsSync(configDir)) fs.mkdirSync(configDir, { recursive: true });

const siteConfig = `/**
 * 站点配置
 * 修改此处即可替换 logo、头像、备案号、友链等
 */

export const SITE_CONFIG = {
  name: '个人博客',
  slogan: '分享技术、思考与生活',
  badge: 'PERSONAL LOG // 持续更新中',
  description: 'Joe主题专为博客、自媒体、资讯类的网站设计开发，简约优雅的设计风格，全面的前端用户功能，简单的模块化配置。',
  logo: '/favicon.svg',
  logoText: 'E',
  avatar: '/favicon.svg',
  author: 'HB',
  authorBio: '这家伙很懒，什么都没有写...',
  since: '2022',
  icp: '辽ICP备2025065723号-1',
  police: '辽公网安备 21029602001076号',
  footerLinks: [
    { label: '友链申请', href: '/friend-links' },
    { label: '免责声明', href: '/disclaimer' },
    { label: '广告合作', href: '/ads' },
    { label: '关于我们', href: '/about' },
  ],
  friendLinks: [
    { name: '易航博客', url: 'https://example.com' },
    { name: 'Joe主题', url: 'https://example.com' },
  ],
  socialLinks: [
    { name: 'github', url: 'https://github.com' },
    { name: 'twitter', url: 'https://twitter.com' },
  ],
} as const;

export const HERO_CARDS = [
  { label: 'Articles', countKey: 'posts', icon: 'M19 20H5a2 2 0 01-2-2V6a2 2 0 012-2h10a2 2 0 012 2v1m2 13a2 2 0 01-2-2V7m2 13a2 2 0 002-2V9a2 2 0 00-2-2h-2m-4-3H9M7 16h6M7 8h6v4H7V8z' },
  { label: 'Tags', countKey: 'tags', icon: 'M7 7h.01M7 3h5c.512 0 1.024.195 1.414.586l7 7a2 2 0 010 2.828l-7 7a2 2 0 01-2.828 0l-7-7A1.994 1.994 0 013 12V7a4 4 0 014-4z' },
] as const;
`;
fs.writeFileSync(path.join(configDir, 'site.ts'), siteConfig);
console.log('Created config/site.ts');

// 2. Rewrite global.css with clean light theme
const cssPath = path.join(astroSrc, 'styles', 'global.css');
const newCss = `@import "tailwindcss";

/* ===========================
   Clean Blog Design System
   =========================== */

@theme {
  --color-bg: #f5f6f8;
  --color-bg-soft: #f0f1f4;
  --color-surface: #ffffff;
  --color-surface-hover: #fafafa;
  --color-hero: #0f0f12;
  --color-hero-soft: #1a1a1f;
  --color-text: #1a1a2e;
  --color-text-secondary: #5a5a6e;
  --color-text-muted: #8a8a9a;
  --color-border: #e8e8ed;
  --color-border-strong: #d8d8e0;
  --color-accent: #4f46e5;
  --color-accent-hover: #4338ca;
  --color-accent-soft: rgba(79, 70, 229, 0.08);
  --color-success: #10b981;
  --color-warning: #f59e0b;
  --color-danger: #ef4444;

  --font-display: "Noto Sans SC", "PingFang SC", "Microsoft YaHei", sans-serif;
  --font-body: "Noto Sans SC", "PingFang SC", "Microsoft YaHei", sans-serif;
  --font-mono: "JetBrains Mono", "SF Mono", monospace;

  --radius-sm: 0.375rem;
  --radius-md: 0.5rem;
  --radius-lg: 0.75rem;
  --radius-xl: 1rem;

  --ease-out-expo: cubic-bezier(0.16, 1, 0.3, 1);
  --duration-fast: 150ms;
  --duration-normal: 250ms;
  --duration-slow: 400ms;
}

html {
  scroll-behavior: smooth;
  background-color: var(--color-bg);
}

body {
  font-family: var(--font-body);
  background-color: var(--color-bg);
  color: var(--color-text);
  line-height: 1.7;
  -webkit-font-smoothing: antialiased;
  -moz-osx-font-smoothing: grayscale;
}

::selection {
  background-color: var(--color-accent-soft);
  color: var(--color-accent);
}

a {
  color: inherit;
  text-decoration: none;
  transition: color var(--duration-fast) ease;
}

/* ===========================
   Typography
   =========================== */

.prose {
  max-width: 70ch;
  margin: 0 auto;
  font-size: 1rem;
  line-height: 1.85;
  color: var(--color-text);
}

.prose h1,
.prose h2,
.prose h3,
.prose h4 {
  font-weight: 700;
  line-height: 1.3;
  margin-top: 2em;
  margin-bottom: 0.75em;
  color: var(--color-text);
}

.prose h1 { font-size: 2rem; }
.prose h2 { font-size: 1.5rem; }
.prose h3 { font-size: 1.25rem; }
.prose h4 { font-size: 1.1rem; }

.prose p {
  margin-bottom: 1.5em;
  color: var(--color-text-secondary);
}

.prose strong {
  color: var(--color-text);
  font-weight: 600;
}

.prose ul,
.prose ol {
  margin-bottom: 1.5em;
  padding-left: 1.5em;
  color: var(--color-text-secondary);
}

.prose li::marker {
  color: var(--color-accent);
}

.prose blockquote {
  border-left: 3px solid var(--color-accent);
  background-color: var(--color-bg-soft);
  padding: 1em 1.25em;
  margin: 1.5em 0;
  border-radius: 0 var(--radius-md) var(--radius-md) 0;
  color: var(--color-text-secondary);
}

.prose code {
  font-family: var(--font-mono);
  font-size: 0.875em;
  background-color: var(--color-bg-soft);
  color: var(--color-accent);
  padding: 0.2em 0.4em;
  border-radius: var(--radius-sm);
}

.prose pre {
  background-color: var(--color-hero);
  color: #e4e4e7;
  padding: 1.25em;
  border-radius: var(--radius-lg);
  overflow-x: auto;
  font-size: 0.875rem;
}

.prose pre code {
  background: transparent;
  padding: 0;
  color: inherit;
}

.prose hr {
  border: none;
  height: 1px;
  background: var(--color-border);
  margin: 2.5em 0;
}

.prose img {
  max-width: 100%;
  border-radius: var(--radius-lg);
}

/* ===========================
   Components
   =========================== */

.btn {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 0.5rem;
  padding: 0.625rem 1.25rem;
  font-size: 0.875rem;
  font-weight: 500;
  border-radius: var(--radius-md);
  transition: all var(--duration-normal) ease;
  cursor: pointer;
  outline: none;
  border: none;
}

.btn:focus-visible {
  outline: 2px solid var(--color-accent);
  outline-offset: 2px;
}

.btn-primary {
  background-color: var(--color-accent);
  color: white;
}

.btn-primary:hover {
  background-color: var(--color-accent-hover);
}

.btn-ghost {
  background-color: transparent;
  color: var(--color-text-secondary);
  border: 1px solid var(--color-border);
}

.btn-ghost:hover {
  border-color: var(--color-border-strong);
  color: var(--color-text);
}

.btn-outline {
  background-color: transparent;
  color: var(--color-accent);
  border: 1px solid var(--color-accent);
}

.btn-outline:hover {
  background-color: var(--color-accent-soft);
}

.input {
  width: 100%;
  padding: 0.625rem 1rem;
  font-size: 0.875rem;
  background-color: var(--color-surface);
  border: 1px solid var(--color-border);
  border-radius: var(--radius-md);
  color: var(--color-text);
  outline: none;
  transition: all var(--duration-normal) ease;
}

.input::placeholder {
  color: var(--color-text-muted);
}

.input:focus {
  border-color: var(--color-accent);
  box-shadow: 0 0 0 3px var(--color-accent-soft);
}

/* 卡片 */
.card {
  background-color: var(--color-surface);
  border: 1px solid var(--color-border);
  border-radius: var(--radius-lg);
  transition: all var(--duration-normal) ease;
}

.card:hover {
  border-color: var(--color-border-strong);
  box-shadow: 0 4px 20px rgba(0, 0, 0, 0.05);
}

/* Hero 玻璃卡片 */
.hero-card {
  background: rgba(255, 255, 255, 0.06);
  border: 1px solid rgba(255, 255, 255, 0.1);
  border-radius: var(--radius-xl);
  backdrop-filter: blur(10px);
  -webkit-backdrop-filter: blur(10px);
  transition: all var(--duration-normal) ease;
}

.hero-card:hover {
  background: rgba(255, 255, 255, 0.1);
  border-color: rgba(255, 255, 255, 0.18);
}

/* 侧边栏小部件 */
.widget {
  background-color: var(--color-surface);
  border: 1px solid var(--color-border);
  border-radius: var(--radius-lg);
  padding: 1.25rem;
}

.widget-title {
  display: flex;
  align-items: center;
  gap: 0.5rem;
  font-size: 0.875rem;
  font-weight: 600;
  color: var(--color-text);
  margin-bottom: 1rem;
}

.widget-title::before {
  content: '';
  width: 3px;
  height: 16px;
  background-color: var(--color-accent);
  border-radius: 2px;
}

/* 标签 */
.tag {
  display: inline-flex;
  align-items: center;
  gap: 0.25rem;
  padding: 0.25rem 0.75rem;
  font-size: 0.75rem;
  color: var(--color-accent);
  background-color: var(--color-accent-soft);
  border-radius: 9999px;
  transition: all var(--duration-fast) ease;
}

.tag:hover {
  background-color: var(--color-accent);
  color: white;
}

/* ===========================
   Animations
   =========================== */

@keyframes fade-up {
  from {
    opacity: 0;
    transform: translateY(20px);
  }
  to {
    opacity: 1;
    transform: translateY(0);
  }
}

@keyframes pulse-soft {
  0%, 100% { opacity: 1; }
  50% { opacity: 0.6; }
}

.animate-fade-up {
  animation: fade-up 0.6s var(--ease-out-expo) forwards;
  opacity: 0;
}

.animate-pulse-soft {
  animation: pulse-soft 2s ease-in-out infinite;
}

.stagger-1 { animation-delay: 0.1s; }
.stagger-2 { animation-delay: 0.2s; }
.stagger-3 { animation-delay: 0.3s; }
.stagger-4 { animation-delay: 0.4s; }
.stagger-5 { animation-delay: 0.5s; }

/* ===========================
   Scrollbar
   =========================== */

::-webkit-scrollbar {
  width: 6px;
}

::-webkit-scrollbar-track {
  background: transparent;
}

::-webkit-scrollbar-thumb {
  background: var(--color-border-strong);
  border-radius: 3px;
}

::-webkit-scrollbar-thumb:hover {
  background: var(--color-text-muted);
}

@media (prefers-reduced-motion: reduce) {
  *,
  *::before,
  *::after {
    animation-duration: 0.01ms !important;
    animation-iteration-count: 1 !important;
    transition-duration: 0.01ms !important;
    scroll-behavior: auto !important;
  }
}
`;

fs.writeFileSync(cssPath, newCss);
console.log('Rewrote styles/global.css');

console.log('Step 1 complete');
