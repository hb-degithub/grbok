import React, { useEffect, useMemo, useRef, useState } from 'react';
import { motion, useScroll, useMotionValueEvent } from 'framer-motion';
import AuthStatusControl from '../auth/AuthStatusControl';
import SideNav from './SideNav';
import { cn } from '../../lib/utils';

type ThemeMode = 'system' | 'time' | 'light' | 'dark';

const THEME_STORAGE_KEY = 'blog-theme-mode';

const navItems = [
  { href: '/', label: '首页' },
  { href: '/posts', label: '文章' },
  { href: '/tags', label: '标签' },
  { href: '/archive', label: '归档' },
  { href: '/about', label: '关于' },
];

const themeOptions: Array<{ mode: ThemeMode; label: string; description: string; icon: string }> = [
  { mode: 'system', label: '跟随系统', description: '手机和电脑系统设置', icon: 'M12 3v1m0 16v1m9-9h-1M4 12H3m15.364 6.364-.707-.707M6.343 6.343l-.707-.707m12.728 0-.707.707M6.343 17.657l-.707.707M16 12a4 4 0 11-8 0 4 4 0 018 0z' },
  { mode: 'time', label: '按时间', description: '19:00 后自动暗色', icon: 'M12 6v6l4 2m5-2a9 9 0 11-18 0 9 9 0 0118 0z' },
  { mode: 'light', label: '亮色', description: '手动固定亮色', icon: 'M12 3v2m0 14v2m7.071-16.071-1.414 1.414M6.343 17.657l-1.414 1.414M21 12h-2M5 12H3m16.071 7.071-1.414-1.414M6.343 6.343 4.929 4.929M16 12a4 4 0 11-8 0 4 4 0 018 0z' },
  { mode: 'dark', label: '暗色', description: '手动固定暗色', icon: 'M21 12.79A9 9 0 1111.21 3 7 7 0 0021 12.79z' },
];

function readThemeMode(): ThemeMode {
  if (typeof window === 'undefined') return 'system';
  const saved = window.localStorage.getItem(THEME_STORAGE_KEY) as ThemeMode | null;
  return themeOptions.some((item) => item.mode === saved) ? saved : 'system';
}

function readResolvedTheme(): 'light' | 'dark' {
  if (typeof document === 'undefined') return 'light';
  return document.documentElement.classList.contains('dark') ? 'dark' : 'light';
}

export default function Header() {
  const [isVisible, setIsVisible] = useState(true);
  const [currentPath, setCurrentPath] = useState<string>('');
  const [themeMode, setThemeMode] = useState<ThemeMode>('system');
  const [resolvedTheme, setResolvedTheme] = useState<'light' | 'dark'>('light');
  const [themeMenuOpen, setThemeMenuOpen] = useState(false);
  const [sideNavOpen, setSideNavOpen] = useState(false);
  const lastScrollY = useRef(0);
  const menuRef = useRef<HTMLDivElement>(null);
  const { scrollY } = useScroll();

  useEffect(() => {
    const syncTheme = () => {
      setThemeMode(readThemeMode());
      setResolvedTheme(readResolvedTheme());
    };

    setCurrentPath(window.location.pathname);
    syncTheme();

    const observer = new MutationObserver(syncTheme);
    observer.observe(document.documentElement, { attributes: true, attributeFilter: ['class', 'data-theme-mode'] });
    window.addEventListener('storage', syncTheme);
    window.addEventListener('blog-theme-change', syncTheme);

    return () => {
      observer.disconnect();
      window.removeEventListener('storage', syncTheme);
      window.removeEventListener('blog-theme-change', syncTheme);
    };
  }, []);

  useEffect(() => {
    if (!themeMenuOpen) return;
    const handlePointerDown = (event: PointerEvent) => {
      if (!menuRef.current?.contains(event.target as Node)) setThemeMenuOpen(false);
    };
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setThemeMenuOpen(false);
    };
    document.addEventListener('pointerdown', handlePointerDown);
    document.addEventListener('keydown', handleKeyDown);
    return () => {
      document.removeEventListener('pointerdown', handlePointerDown);
      document.removeEventListener('keydown', handleKeyDown);
    };
  }, [themeMenuOpen]);

  useMotionValueEvent(scrollY, 'change', (latest) => {
    const delta = latest - lastScrollY.current;
    if (latest < 80) setIsVisible(true);
    else if (delta > 5) setIsVisible(false);
    else if (delta < -5) setIsVisible(true);
    lastScrollY.current = latest;
  });

  const activeThemeLabel = useMemo(() => themeOptions.find((item) => item.mode === themeMode)?.label ?? '跟随系统', [themeMode]);

  const setMode = (mode: ThemeMode) => {
    window.localStorage.setItem(THEME_STORAGE_KEY, mode);
    (window as unknown as { __blogApplyTheme?: () => void }).__blogApplyTheme?.();
    window.dispatchEvent(new Event('blog-theme-change'));
    setThemeMenuOpen(false);
  };

  const openSearch = () => {
    window.dispatchEvent(new Event('blog-search-open'));
  };

  const isActive = (href: string) => {
    if (href === '/') return currentPath === '/';
    return currentPath.startsWith(href);
  };

  return (
    <motion.header
      initial={{ y: 0 }}
      animate={{ y: isVisible ? 0 : '-100%' }}
      transition={{ duration: 0.3, ease: [0.16, 1, 0.3, 1] }}
      className="fixed inset-x-0 top-0 z-50 border-b border-white/40 bg-white/70 backdrop-blur-xl backdrop-saturate-150 pt-[env(safe-area-inset-top)] dark:border-white/5 dark:bg-stone-950/70"
      style={{ willChange: 'transform' }}
    >
      <div className="pointer-events-none absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-white/70 to-transparent dark:via-white/15" aria-hidden="true" />

      <nav className="mx-auto flex w-full max-w-7xl items-center justify-between gap-2 overflow-x-clip px-[var(--page-pad,1rem)] py-1.5 sm:gap-2 sm:px-6 sm:py-3.5" aria-label="主导航">
        <a href="/" className="focus-ring flex min-h-[40px] min-w-[40px] shrink-0 items-center gap-2 rounded-lg text-base font-semibold tracking-tight text-stone-900 transition-colors hover:text-stone-600 dark:text-stone-100 dark:hover:text-stone-400" aria-label="返回博客首页">
          <div className="flex h-7 w-7 items-center justify-center rounded-lg bg-gradient-to-br from-stone-500 to-stone-600 shadow-sm transition-transform duration-200 hover:scale-105">
            <span className="text-xs font-bold text-white">B</span>
          </div>
          <span className="hidden sm:inline">博客</span>
        </a>

        <div className="flex shrink-0 items-center gap-1 sm:gap-2">
          <button
            type="button"
            onClick={() => setSideNavOpen(true)}
            className="focus-ring inline-flex h-[40px] min-h-[40px] w-[40px] min-w-[40px] items-center justify-center rounded-lg border border-stone-200 bg-white/70 text-stone-600 shadow-sm transition-colors hover:bg-stone-100 hover:text-stone-950 dark:border-stone-800 dark:bg-stone-900/70 dark:text-stone-300 dark:hover:bg-stone-800 dark:hover:text-white sm:hidden"
            aria-label="打开导航菜单"
            aria-controls="mobile-side-nav"
            aria-expanded={sideNavOpen}
          >
            <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" aria-hidden="true">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.8} d="M4 7h16M4 12h16M4 17h16" />
            </svg>
          </button>

          <ul className="m-0 hidden list-none items-center gap-1 p-0 sm:flex">
            {navItems.map((item) => {
              const active = isActive(item.href);
              return (
                <li key={item.href} className="m-0 list-none p-0">
                  <a
                    href={item.href}
                    aria-current={active ? 'page' : undefined}
                    className={cn(
                      'focus-ring relative block rounded-lg px-3 py-2 text-sm leading-none no-underline transition-colors duration-200',
                      active
                        ? 'bg-stone-100 font-medium text-stone-900 shadow-sm dark:bg-white/10 dark:text-stone-100'
                        : 'text-stone-500 hover:bg-white/50 hover:text-stone-900 dark:text-stone-400 dark:hover:bg-white/5 dark:hover:text-stone-100'
                    )}
                  >
                    {item.label}
                  </a>
                </li>
              );
            })}
          </ul>

          <button
            type="button"
            onClick={openSearch}
            className="focus-ring inline-flex h-[40px] min-h-[40px] w-[40px] min-w-[40px] items-center justify-center rounded-lg border border-stone-200 bg-white/70 text-stone-600 shadow-sm transition-colors hover:bg-stone-100 hover:text-stone-950 dark:border-stone-800 dark:bg-stone-900/70 dark:text-stone-300 dark:hover:bg-stone-800 dark:hover:text-white sm:h-10 sm:w-auto sm:px-3"
            aria-label="搜索文章（快捷键 Ctrl 或 Command 加 K）"
          >
            <svg className="h-4 w-4 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" aria-hidden="true">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.8} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
            </svg>
            <span className="ml-2 hidden text-sm font-semibold sm:inline">搜索</span>
          </button>

          <div ref={menuRef} className="relative">
            <button
              type="button"
              onClick={() => setThemeMenuOpen((open) => !open)}
              className="focus-ring inline-flex h-[40px] min-h-[40px] w-[40px] min-w-[40px] items-center justify-center rounded-lg border border-stone-200 bg-white/70 text-stone-600 shadow-sm transition-colors hover:bg-stone-100 hover:text-stone-950 dark:border-stone-800 dark:bg-stone-900/70 dark:text-stone-300 dark:hover:bg-stone-800 dark:hover:text-white sm:h-10 sm:w-10"
              aria-label={`主题切换：${activeThemeLabel}，当前${resolvedTheme === 'dark' ? '暗色' : '亮色'}`}
              aria-haspopup="menu"
              aria-expanded={themeMenuOpen}
            >
              <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" aria-hidden="true">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.8} d={resolvedTheme === 'dark' ? 'M21 12.79A9 9 0 1111.21 3 7 7 0 0021 12.79z' : 'M12 3v2m0 14v2m7.071-16.071-1.414 1.414M6.343 17.657l-1.414 1.414M21 12h-2M5 12H3m16.071 7.071-1.414-1.414M6.343 6.343 4.929 4.929M16 12a4 4 0 11-8 0 4 4 0 018 0z'} />
              </svg>
            </button>

            {themeMenuOpen && (
              <div className="absolute right-0 mt-2 w-[min(14rem,calc(100vw-var(--page-pad,1rem)*2))] overflow-hidden rounded-xl border border-stone-200 bg-white/95 p-1 shadow-xl shadow-stone-900/10 backdrop-blur-xl dark:border-stone-800 dark:bg-stone-900/95 sm:p-1.5" role="menu">
                {themeOptions.map((item) => (
                  <button
                    key={item.mode}
                    type="button"
                    onClick={() => setMode(item.mode)}
                    className={cn(
                      'flex min-h-[40px] w-full items-center gap-3 rounded-lg px-3 py-2 text-left leading-snug transition-colors sm:py-2.5',
                      themeMode === item.mode
                        ? 'bg-stone-100 text-stone-950 dark:bg-stone-800 dark:text-white'
                        : 'text-stone-600 hover:bg-stone-50 hover:text-stone-950 dark:text-stone-300 dark:hover:bg-stone-800/70 dark:hover:text-white'
                    )}
                    role="menuitemradio"
                    aria-checked={themeMode === item.mode}
                  >
                    <svg className="h-4 w-4 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" aria-hidden="true">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.7} d={item.icon} />
                    </svg>
                    <span className="min-w-0 break-words">
                      <span className="block text-sm font-semibold leading-5">{item.label}</span>
                      <span className="block text-xs leading-4 text-stone-400 dark:text-stone-500">{item.description}</span>
                    </span>
                  </button>
                ))}
              </div>
            )}
          </div>

          <div className="shrink-0 [&_a]:min-h-[40px] [&_a]:min-w-[40px] [&_button]:min-h-[40px] [&_button]:min-w-[40px]">
            <AuthStatusControl />
          </div>
        </div>
      </nav>

      <SideNav id="mobile-side-nav" isOpen={sideNavOpen} onClose={() => setSideNavOpen(false)} currentPath={currentPath} />
    </motion.header>
  );
}
