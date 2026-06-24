const fs = require('fs');
const path = require('path');

const astroSrc = path.join('H:', '开发', '个人博客', 'astro', 'src');

// Header.tsx
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
    const handleScroll = () => setScrolled(window.scrollY > 10);
    window.addEventListener('scroll', handleScroll);
    return () => window.removeEventListener('scroll', handleScroll);
  }, []);

  const isActive = (href: string) => {
    if (href === '/') return currentPath === '/';
    return currentPath.startsWith(href);
  };

  return (
    <header
      className={\`fixed inset-x-0 top-0 z-50 transition-all duration-300 \${
        scrolled ? 'bg-white/90 shadow-sm backdrop-blur-md' : 'bg-transparent'
      }\`}
    >
      <div className="mx-auto flex h-16 max-w-7xl items-center justify-between px-4 sm:px-6">
        <a href="/" className="flex items-center gap-2">
          <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-emerald-500 text-lg font-bold text-white">
            {SITE_CONFIG.logoText}
          </div>
          <span className="text-lg font-bold text-text">{SITE_CONFIG.name}</span>
        </a>

        <nav className="hidden items-center gap-8 md:flex">
          {navItems.map((item) => (
            <a
              key={item.href}
              href={item.href}
              className={\`text-sm font-medium transition-colors \${
                isActive(item.href)
                  ? 'text-accent'
                  : 'text-text-secondary hover:text-text'
              }\`}
            >
              {item.label}
            </a>
          ))}
        </nav>

        <div className="flex items-center gap-3">
          <SearchModal />
          <a
            href="/admin"
            className="hidden rounded-md border border-border px-3 py-1.5 text-sm font-medium text-text-secondary transition-colors hover:border-border-strong hover:text-text sm:inline-block"
          >
            管理
          </a>
          <a
            href="/login"
            className="rounded-md bg-accent px-4 py-1.5 text-sm font-medium text-white transition-colors hover:bg-accent-hover"
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
console.log('Created Header.tsx');

// SearchModal.tsx - clean style
const searchModal = `import React, { useState, useEffect, useRef, useCallback } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import DOMPurify from 'dompurify';
import { cn } from '../../lib/utils';

interface PagefindResult {
  id: string;
  url: string;
  title: string;
  excerpt: string;
  content: string;
}

const LISTBOX_ID = 'search-listbox';

export default function SearchModal() {
  const [isOpen, setIsOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<PagefindResult[]>([]);
  const [selectedIndex, setSelectedIndex] = useState(0);
  const [isLoading, setIsLoading] = useState(false);
  const [isPagefindLoaded, setIsPagefindLoaded] = useState(false);

  const inputRef = useRef<HTMLInputElement>(null);
  const resultsRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const loadPagefind = async () => {
      try {
        if ((window as any).pagefind) {
          setIsPagefindLoaded(true);
          return;
        }
        const script = document.createElement('script');
        script.src = '/pagefind/pagefind.js';
        script.async = true;
        script.onload = () => {
          (window as any).pagefind?.init();
          setIsPagefindLoaded(true);
        };
        document.body.appendChild(script);
      } catch (err) {
        console.error('Pagefind 加载失败:', err);
      }
    };
    loadPagefind();
  }, []);

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === 'k') {
        e.preventDefault();
        setIsOpen(true);
      }
      if (e.key === 'Escape') setIsOpen(false);
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, []);

  useEffect(() => {
    if (isOpen) {
      const timer = setTimeout(() => inputRef.current?.focus(), 100);
      return () => clearTimeout(timer);
    }
    setQuery('');
    setResults([]);
    setSelectedIndex(0);
  }, [isOpen]);

  useEffect(() => {
    if (!query || !isPagefindLoaded) {
      setResults([]);
      return;
    }
    const timer = setTimeout(async () => {
      setIsLoading(true);
      try {
        const pagefind = (window as any).pagefind;
        if (!pagefind) return;
        const search = await pagefind.search(query);
        const items = await Promise.all(search.results.slice(0, 10).map((r: any) => r.data()));
        setResults(items);
        setSelectedIndex(0);
      } catch (err) {
        console.error('搜索失败:', err);
      } finally {
        setIsLoading(false);
      }
    }, 300);
    return () => clearTimeout(timer);
  }, [query, isPagefindLoaded]);

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      switch (e.key) {
        case 'ArrowDown':
          e.preventDefault();
          setSelectedIndex((prev) => Math.min(prev + 1, results.length - 1));
          break;
        case 'ArrowUp':
          e.preventDefault();
          setSelectedIndex((prev) => Math.max(prev - 1, 0));
          break;
        case 'Enter':
          e.preventDefault();
          if (results[selectedIndex]) {
            window.location.href = results[selectedIndex].url;
            setIsOpen(false);
          }
          break;
      }
    },
    [results, selectedIndex]
  );

  useEffect(() => {
    if (resultsRef.current) {
      const selectedElement = resultsRef.current.children[selectedIndex] as HTMLElement;
      if (selectedElement) selectedElement.scrollIntoView({ block: 'nearest' });
    }
  }, [selectedIndex]);

  const activeOptionId = results[selectedIndex] ? \`search-option-\${selectedIndex}\` : undefined;

  return (
    <>
      <button
        onClick={() => setIsOpen(true)}
        className="flex h-9 w-9 items-center justify-center rounded-full text-text-secondary transition-colors hover:bg-bg-soft hover:text-text"
        aria-label="搜索文章"
      >
        <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
        </svg>
      </button>

      <AnimatePresence>
        {isOpen && (
          <motion.div
            className="fixed inset-0 z-50 flex items-start justify-center pt-[18vh]"
            initial="hidden"
            animate="visible"
            exit="hidden"
          >
            <motion.div
              variants={{ hidden: { opacity: 0 }, visible: { opacity: 1 } }}
              className="absolute inset-0 bg-hero/40 backdrop-blur-sm"
              onClick={() => setIsOpen(false)}
            />
            <motion.div
              variants={{ hidden: { opacity: 0, y: 16, scale: 0.98 }, visible: { opacity: 1, y: 0, scale: 1 } }}
              transition={{ duration: 0.2 }}
              className="relative w-full max-w-2xl overflow-hidden rounded-2xl border border-border bg-surface shadow-2xl"
              onClick={(e) => e.stopPropagation()}
            >
              <div className="flex items-center border-b border-border px-4">
                <svg className="h-5 w-5 text-text-muted" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
                </svg>
                <input
                  ref={inputRef}
                  type="text"
                  role="combobox"
                  aria-expanded={results.length > 0}
                  aria-controls={LISTBOX_ID}
                  aria-activedescendant={activeOptionId}
                  aria-autocomplete="list"
                  aria-label="搜索文章"
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                  onKeyDown={handleKeyDown}
                  placeholder="搜索文章..."
                  className="flex-1 bg-transparent px-4 py-4 text-text outline-none placeholder:text-text-muted"
                />
                {isLoading && (
                  <motion.div
                    animate={{ rotate: 360 }}
                    transition={{ duration: 1, repeat: Infinity, ease: 'linear' }}
                    className="h-5 w-5 rounded-full border-2 border-border border-t-accent"
                  />
                )}
                <button
                  onClick={() => setIsOpen(false)}
                  className="ml-2 rounded-md px-2 py-1 text-xs font-medium text-text-muted transition-colors hover:text-text"
                >
                  ESC
                </button>
              </div>

              <div ref={resultsRef} id={LISTBOX_ID} role="listbox" aria-label="搜索结果" className="max-h-[60vh] overflow-y-auto p-2">
                {results.length === 0 && query && !isLoading && (
                  <div className="py-8 text-center text-sm text-text-secondary">未找到相关结果</div>
                )}
                {results.length === 0 && !query && (
                  <div className="py-8 text-center text-sm text-text-secondary">输入关键词开始搜索</div>
                )}

                <motion.div variants={{ hidden: { opacity: 0 }, visible: { opacity: 1, transition: { staggerChildren: 0.04 } } }} initial="hidden" animate="visible">
                  {results.map((result, index) => (
                    <motion.a
                      key={result.id}
                      id={\`search-option-\${index}\`}
                      variants={{ hidden: { opacity: 0, x: -8 }, visible: { opacity: 1, x: 0, transition: { duration: 0.25 } } }}
                      role="option"
                      aria-selected={index === selectedIndex}
                      href={result.url}
                      onClick={() => setIsOpen(false)}
                      className={cn(
                        'flex flex-col gap-1 rounded-lg px-4 py-3 transition-colors',
                        index === selectedIndex ? 'bg-accent-soft' : 'hover:bg-bg-soft'
                      )}
                    >
                      <div className="font-medium text-text">{result.title || '无标题'}</div>
                      <div
                        className="line-clamp-2 text-sm text-text-secondary"
                        dangerouslySetInnerHTML={{ __html: DOMPurify.sanitize(result.excerpt) }}
                      />
                      <div className="text-xs text-text-muted">{result.url}</div>
                    </motion.a>
                  ))}
                </motion.div>
              </div>

              <div className="border-t border-border bg-bg-soft px-4 py-2.5 text-xs text-text-muted">
                <div className="flex items-center justify-between">
                  <span>
                    {isLoading ? '搜索中...' : query && results.length === 0 ? '未找到相关结果' : results.length > 0 ? \`找到 \${results.length} 条结果\` : '输入关键词开始搜索'}
                  </span>
                  <div className="flex items-center gap-4">
                    <span>↓ 打开</span>
                    <span>↑↓ 选择</span>
                    <span>ESC 关闭</span>
                  </div>
                </div>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </>
  );
}
`;
fs.writeFileSync(path.join(astroSrc, 'components', 'search', 'SearchModal.tsx'), searchModal);
console.log('Created SearchModal.tsx');

// Create Footer component
const footerDir = path.join(astroSrc, 'components', 'layout');
const footer = `---
import { SITE_CONFIG } from '../../config/site';
---

<footer class="mt-16 border-t border-border bg-surface">
  <div class="mx-auto max-w-7xl px-4 py-12 sm:px-6">
    <div class="grid gap-8 md:grid-cols-2 lg:grid-cols-3">
      <!-- Logo & Description -->
      <div class="space-y-4">
        <a href="/" class="flex items-center gap-2">
          <div class="flex h-10 w-10 items-center justify-center rounded-lg bg-emerald-500 text-xl font-bold text-white">
            {SITE_CONFIG.logoText}
          </div>
          <span class="text-lg font-bold text-text">{SITE_CONFIG.name}</span>
        </a>
        <p class="max-w-xs text-sm leading-relaxed text-text-secondary">
          {SITE_CONFIG.description}
        </p>
        <div class="flex items-center gap-3">
          {SITE_CONFIG.socialLinks.map((link) => (
            <a
              key={link.name}
              href={link.url}
              target="_blank"
              rel="noopener noreferrer"
              class="flex h-9 w-9 items-center justify-center rounded-full bg-bg-soft text-text-secondary transition-colors hover:bg-accent hover:text-white"
              aria-label={link.name}
            >
              {link.name === 'github' ? (
                <svg class="h-4 w-4" fill="currentColor" viewBox="0 0 24 24"><path d="M12 0c-6.626 0-12 5.373-12 12 0 5.302 3.438 9.8 8.207 11.387.599.111.793-.261.793-.577v-2.234c-3.338.726-4.033-1.416-4.033-1.416-.546-1.387-1.333-1.756-1.333-1.756-1.089-.745.083-.729.083-.729 1.205.084 1.839 1.237 1.839 1.237 1.07 1.834 2.807 1.304 3.492.997.107-.775.418-1.305.762-1.604-2.665-.305-5.467-1.334-5.467-5.931 0-1.311.469-2.381 1.236-3.221-.124-.303-.535-1.524.117-3.176 0 0 1.008-.322 3.301 1.23.957-.266 1.983-.399 3.003-.404 1.02.005 2.047.138 3.006.404 2.291-1.552 3.297-1.23 3.297-1.23.653 1.653.242 2.874.118 3.176.77.84 1.235 1.911 1.235 3.221 0 4.609-2.807 5.624-5.479 5.921.43.372.823 1.102.823 2.222v3.293c0 .319.192.694.801.576 4.765-1.589 8.199-6.086 8.199-11.386 0-6.627-5.373-12-12-12z"/></svg>
              ) : (
                <svg class="h-4 w-4" fill="currentColor" viewBox="0 0 24 24"><path d="M23.953 4.57a10 10 0 01-2.825.775 4.958 4.958 0 002.163-2.723c-.951.555-2.005.959-3.127 1.184a4.92 4.92 0 00-8.384 4.482C7.69 8.095 4.067 6.13 1.64 3.162a4.822 4.822 0 00-.666 2.475c0 1.71.87 3.213 2.188 4.096a4.904 4.904 0 01-2.228-.616v.06a4.923 4.923 0 003.946 4.827 4.996 4.996 0 01-2.212.085 4.936 4.936 0 004.604 3.417 9.867 9.867 0 01-6.102 2.105c-.39 0-.779-.023-1.17-.067a13.995 13.995 0 007.557 2.209c9.053 0 13.998-7.496 13.998-13.985 0-.21 0-.42-.015-.63A9.935 9.935 0 0024 4.59z"/></svg>
              )}
            </a>
          ))}
        </div>
      </div>

      <!-- Quick Links -->
      <div>
        <h3 class="mb-4 text-sm font-semibold text-text">快速链接</h3>
        <ul class="space-y-2">
          {SITE_CONFIG.footerLinks.map((link) => (
            <li>
              <a href={link.href} class="text-sm text-text-secondary transition-colors hover:text-accent">
                {link.label}
              </a>
            </li>
          ))}
        </ul>
      </div>

      <!-- Contact / ICP -->
      <div>
        <h3 class="mb-4 text-sm font-semibold text-text">备案信息</h3>
        <div class="space-y-2 text-sm text-text-secondary">
          <p>{SITE_CONFIG.icp}</p>
          <p>{SITE_CONFIG.police}</p>
          <p class="pt-2">如有合作或建议，欢迎通过关于页面联系。</p>
        </div>
      </div>
    </div>

    <div class="mt-10 border-t border-border pt-6 text-center text-sm text-text-muted">
      <p>Copyright © {SITE_CONFIG.since} - {new Date().getFullYear()} · {SITE_CONFIG.name}</p>
      <p class="mt-1">由 {SITE_CONFIG.name} 强力驱动</p>
    </div>
  </div>
</footer>
`;
fs.writeFileSync(path.join(footerDir, 'Footer.astro'), footer);
console.log('Created Footer.astro');

console.log('Step 2 complete');
