const fs = require('fs');
const path = require('path');

const astroSrc = path.join('H:', '开发', '个人博客', 'astro', 'src');

// Create SideNav.tsx
const sideNav = `import React from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { SITE_CONFIG } from '../../config/site';

interface SideNavProps {
  isOpen: boolean;
  onClose: () => void;
  currentPath: string;
}

const mainNavItems = [
  { href: '/', label: '首页', icon: 'M3 12l2-2m0 0l7-7 7 7M5 10v10a1 1 0 001 1h3m10-11l2 2m-2-2v10a1 1 0 01-1 1h-3m-6 0a1 1 0 001-1v-4a1 1 0 011-1h2a1 1 0 011 1v4a1 1 0 001 1m-6 0h6' },
  { href: '/posts', label: '文章', icon: 'M19 20H5a2 2 0 01-2-2V6a2 2 0 012-2h10a2 2 0 012 2v1m2 13a2 2 0 01-2-2V7m2 13a2 2 0 002-2V9a2 2 0 00-2-2h-2m-4-3H9M7 16h6M7 8h6v4H7V8z' },
  { href: '/tags', label: '标签', icon: 'M7 7h.01M7 3h5c.512 0 1.024.195 1.414.586l7 7a2 2 0 010 2.828l-7 7a2 2 0 01-2.828 0l-7-7A1.994 1.994 0 013 12V7a4 4 0 014-4z' },
  { href: '/about', label: '关于', icon: 'M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z' },
];

const secondaryNavItems = [
  { href: '/admin', label: '管理后台', icon: 'M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.066 2.573c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.573 1.066c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.066-2.573c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z M15 12a3 3 0 11-6 0 3 3 0 016 0z' },
  { href: '/login', label: '登录', icon: 'M11 16l-4-4m0 0l4-4m-4 4h14m-5 4v1a3 3 0 01-3 3H6a3 3 0 01-3-3V7a3 3 0 013-3h7a3 3 0 013 3v1' },
];

export default function SideNav({ isOpen, onClose, currentPath }: SideNavProps) {
  const isActive = (href: string) => {
    if (href === '/') return currentPath === '/';
    return currentPath.startsWith(href);
  };

  return (
    <AnimatePresence>
      {isOpen && (
        <>
          {/* Backdrop */}
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            onClick={onClose}
            className="fixed inset-0 z-50 bg-hero/40 backdrop-blur-sm"
          />
          {/* Drawer */}
          <motion.aside
            initial={{ x: '-100%' }}
            animate={{ x: 0 }}
            exit={{ x: '-100%' }}
            transition={{ type: 'spring', damping: 28, stiffness: 260 }}
            className="fixed left-0 top-0 z-50 h-full w-72 max-w-[85vw] bg-surface shadow-2xl"
          >
            <div className="flex h-16 items-center justify-between border-b border-border px-5">
              <a href="/" className="flex items-center gap-2.5">
                <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-accent text-lg font-bold text-white">
                  {SITE_CONFIG.logoText}
                </div>
                <span className="text-lg font-bold text-text">{SITE_CONFIG.name}</span>
              </a>
              <button
                onClick={onClose}
                className="flex h-9 w-9 items-center justify-center rounded-lg text-text-secondary transition-colors hover:bg-bg-soft hover:text-text"
                aria-label="关闭侧边导航"
              >
                <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            </div>

            <nav className="flex h-[calc(100%-4rem)] flex-col overflow-y-auto p-4">
              <div className="space-y-1">
                <p className="mb-2 px-3 text-xs font-semibold uppercase tracking-wider text-text-muted">主导航</p>
                {mainNavItems.map((item) => (
                  <a
                    key={item.href}
                    href={item.href}
                    onClick={onClose}
                    className={\`flex items-center gap-3 rounded-xl px-3 py-3 text-sm font-medium transition-colors \${
                      isActive(item.href)
                        ? 'bg-accent/10 text-accent'
                        : 'text-text-secondary hover:bg-bg-soft hover:text-text'
                    }\`}
                  >
                    <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d={item.icon} />
                    </svg>
                    {item.label}
                  </a>
                ))}
              </div>

              <div className="mt-6 space-y-1">
                <p className="mb-2 px-3 text-xs font-semibold uppercase tracking-wider text-text-muted">其他</p>
                {secondaryNavItems.map((item) => (
                  <a
                    key={item.href}
                    href={item.href}
                    onClick={onClose}
                    className={\`flex items-center gap-3 rounded-xl px-3 py-3 text-sm font-medium transition-colors \${
                      isActive(item.href)
                        ? 'bg-accent/10 text-accent'
                        : 'text-text-secondary hover:bg-bg-soft hover:text-text'
                    }\`}
                  >
                    <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d={item.icon} />
                    </svg>
                    {item.label}
                  </a>
                ))}
              </div>
            </nav>
          </motion.aside>
        </>
      )}
    </AnimatePresence>
  );
}
`;
fs.writeFileSync(path.join(astroSrc, 'components', 'layout', 'SideNav.tsx'), sideNav);
console.log('Created SideNav.tsx');

// Update Header.tsx to include hamburger menu and SideNav
const header = `import React, { useState, useEffect } from 'react';
import SearchModal from '../search/SearchModal';
import SideNav from './SideNav';
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
  const [sideNavOpen, setSideNavOpen] = useState(false);

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
    <>
      <header
        className={\`fixed inset-x-0 top-0 z-40 transition-all duration-500 \${
          scrolled
            ? 'bg-white/80 shadow-[0_4px_30px_rgba(0,0,0,0.05)] backdrop-blur-xl'
            : 'bg-transparent'
        }\`}
      >
        <div className="mx-auto flex h-16 max-w-7xl items-center justify-between px-4 sm:px-6">
          <div className="flex items-center gap-3">
            <button
              onClick={() => setSideNavOpen(true)}
              className={\`flex h-9 w-9 items-center justify-center rounded-lg transition-colors md:hidden \${
                scrolled ? 'text-text hover:bg-bg-soft' : 'text-white hover:bg-white/10'
              }\`}
              aria-label="打开侧边导航"
            >
              <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M4 6h16M4 12h16M4 18h16" />
              </svg>
            </button>

            <a href="/" className="group flex items-center gap-2.5">
              <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-accent text-lg font-bold text-white transition-transform group-hover:scale-105">
                {SITE_CONFIG.logoText}
              </div>
              <span className={\`text-lg font-bold transition-colors \${scrolled ? 'text-text' : 'text-white'}\`}>
                {SITE_CONFIG.name}
              </span>
            </a>
          </div>

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

      <SideNav isOpen={sideNavOpen} onClose={() => setSideNavOpen(false)} currentPath={currentPath} />
    </>
  );
}
`;
fs.writeFileSync(path.join(astroSrc, 'components', 'layout', 'Header.tsx'), header);
console.log('Updated Header.tsx with side nav trigger');
