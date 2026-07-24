import React, { useEffect, useMemo, useRef, useState } from 'react';
import { motion, useScroll, useMotionValueEvent, AnimatePresence } from 'framer-motion';
import Dock from '../reactbits/Dock';
import SideNav from './SideNav';
import { useAuthStatus } from '../../hooks/useAuthStatus';
import { getUserDisplayName, getUserInitial } from '../../hooks/useAuthStatus';
import { cn } from '../../lib/utils';

type ThemeMode = 'system' | 'time' | 'light' | 'dark';

const THEME_STORAGE_KEY = 'blog-theme-mode';

const navItems = [
  { href: '/', label: '首页', icon: 'M3 12l2-2m0 0l7-7 7 7M5 10v10a1 1 0 001 1h3m10-11l2 2m-2-2v10a1 1 0 01-1 1h-3m-6 0a1 1 0 001-1v-4a1 1 0 011-1h2a1 1 0 011 1v4a1 1 0 001 1m-6 0h6' },
  { href: '/posts', label: '文章', icon: 'M19 20H5a2 2 0 01-2-2V6a2 2 0 012-2h10a2 2 0 012 2v1m2 13a2 2 0 01-2-2V7m2 13a2 2 0 002-2V9a2 2 0 00-2-2h-2m-4-3H9M7 16h6M7 8h6v4H7V8z' },
  { href: '/tags', label: '标签', icon: 'M7 7h.01M7 3h5c.512 0 1.024.195 1.414.586l7 7a2 2 0 010 2.828l-7 7a2 2 0 01-2.828 0l-7-7A1.994 1.994 0 013 12V7a4 4 0 014-4z' },
  { href: '/archive', label: '归档', icon: 'M5 8h14M5 8a2 2 0 110-4h14a2 2 0 110 4M5 8v10a2 2 0 002 2h10a2 2 0 002-2V8m-9 4h4' },
  { href: '/about', label: '关于', icon: 'M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z' },
];

// 「更多」折叠栏条目：后续子项目（友链/留言板/相册/项目/订阅）逐个追加到这里
const MORE_LINKS = [
  { href: '/stats', label: '访问统计', description: '全站访问数据与热门内容', icon: 'M3 3v18h18M7 14l4-4 3 3 5-6' },
  { href: '/links', label: '友情链接', description: '朋友们的站点', icon: 'M13.828 10.172a4 4 0 00-5.656 0l-4 4a4 4 0 105.656 5.656l1.102-1.101m-.758-4.899a4 4 0 005.656 0l4-4a4 4 0 00-5.656-5.656l-1.1 1.1' },
  { href: '/guestbook', label: '留言板', description: '留下你的足迹', icon: 'M8 12h.01M12 12h.01M16 12h.01M21 12c0 4.418-4.03 8-9 8a9.863 9.863 0 01-4.255-.949L3 20l1.395-3.72C3.512 15.042 3 13.574 3 12c0-4.418 4.03-8 9-8s9 3.582 9 8z' },
  { href: '/gallery', label: '相册', description: '照片与生活', icon: 'M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z' },
  { href: '/projects', label: '项目', description: '做过的和正在做的', icon: 'M10 20l4-16m4 4l4 4-4 4M6 16l-4-4 4-4' },
  { href: '/subscribe', label: '订阅', description: 'RSS 订阅更新', icon: 'M6 5c7.18 0 13 5.82 13 13M6 11a7 7 0 017 7m-6 0a1 1 0 11-2 0 1 1 0 012 0z' },
];

const themeOptions: Array<{ mode: ThemeMode; label: string; description: string; icon: string }> = [
  { mode: 'system', label: '跟随系统', description: '手机和电脑系统设置', icon: 'M12 3v1m0 16v1m9-9h-1M4 12H3m15.364 6.364-.707-.707M6.343 6.343l-.707-.707m12.728 0-.707.707M6.343 17.657l-.707.707M16 12a4 4 0 11-8 0 4 4 0 018 0z' },
  { mode: 'time', label: '按时间', description: '19:00 后自动暗色', icon: 'M12 6v6l4 2m5-2a9 9 0 11-18 0 9 9 0 0118 0z' },
  { mode: 'light', label: '亮色', description: '手动固定亮色', icon: 'M12 3v2m0 14v2m7.071-16.071-1.414 1.414M6.343 17.657l-1.414 1.414M21 12h-2M5 12H3m16.071 7.071-1.414-1.414M6.343 6.343 4.929 4.929M16 12a4 4 0 11-8 0 4 4 0 018 0z' },
  { mode: 'dark', label: '暗色', description: '手动固定暗色', icon: 'M21 12.79A9 9 0 1111.21 3 7 7 0 0021 12.79z' },
];

function readThemeMode(): ThemeMode {
  if (typeof window === 'undefined') return 'system';
  try {
    const saved = window.localStorage.getItem(THEME_STORAGE_KEY) as ThemeMode | null;
    return themeOptions.some((item) => item.mode === saved) ? (saved as ThemeMode) : 'system';
  } catch {
    return 'system';
  }
}

function readResolvedTheme(): 'light' | 'dark' {
  if (typeof document === 'undefined') return 'light';
  return document.documentElement.classList.contains('dark') ? 'dark' : 'light';
}

function Icon({ d, size = 22 }: { d: string; size?: number }) {
  return (
    <svg width={size} height={size} fill="none" viewBox="0 0 24 24" stroke="currentColor" aria-hidden="true">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.6} d={d} />
    </svg>
  );
}

export default function Header() {
  const [isVisible, setIsVisible] = useState(true);
  const [currentPath, setCurrentPath] = useState<string>('');
  const [themeMode, setThemeMode] = useState<ThemeMode>('system');
  const [resolvedTheme, setResolvedTheme] = useState<'light' | 'dark'>('light');
  const [themeMenuOpen, setThemeMenuOpen] = useState(false);
  const [moreMenuOpen, setMoreMenuOpen] = useState(false);
  const [sideNavOpen, setSideNavOpen] = useState(false);
  const lastScrollY = useRef(0);
  const menuRef = useRef<HTMLDivElement>(null);
  const moreMenuRef = useRef<HTMLDivElement>(null);
  const { scrollY } = useScroll();
  const { user, isAuthenticated, isLoading } = useAuthStatus();

  useEffect(() => {
    const syncTheme = () => {
      setThemeMode(readThemeMode());
      setResolvedTheme(readResolvedTheme());
    };

    setCurrentPath(window.location.pathname);
    syncTheme();

    // Header 被 transition:persist 持久化，ClientRouter 客户端导航时不会重挂载，
    // 需要监听 astro:page-load 同步当前路径，否则 Dock 激活指示不随页面切换更新。
    const syncPath = () => setCurrentPath(window.location.pathname);
    document.addEventListener('astro:page-load', syncPath);

    const observer = new MutationObserver(syncTheme);
    observer.observe(document.documentElement, { attributes: true, attributeFilter: ['class', 'data-theme-mode'] });
    window.addEventListener('storage', syncTheme);
    window.addEventListener('blog-theme-change', syncTheme);

    return () => {
      document.removeEventListener('astro:page-load', syncPath);
      observer.disconnect();
      window.removeEventListener('storage', syncTheme);
      window.removeEventListener('blog-theme-change', syncTheme);
    };
  }, []);

  useEffect(() => {
    if (!themeMenuOpen && !moreMenuOpen) return;
    const handlePointerDown = (event: PointerEvent) => {
      if (!menuRef.current?.contains(event.target as Node)) setThemeMenuOpen(false);
      if (!moreMenuRef.current?.contains(event.target as Node)) setMoreMenuOpen(false);
    };
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        setThemeMenuOpen(false);
        setMoreMenuOpen(false);
      }
    };
    document.addEventListener('pointerdown', handlePointerDown);
    document.addEventListener('keydown', handleKeyDown);
    return () => {
      document.removeEventListener('pointerdown', handlePointerDown);
      document.removeEventListener('keydown', handleKeyDown);
    };
  }, [themeMenuOpen, moreMenuOpen]);

  useMotionValueEvent(scrollY, 'change', (latest) => {
    const delta = latest - lastScrollY.current;
    if (latest < 80) setIsVisible(true);
    else if (delta > 5) setIsVisible(false);
    else if (delta < -5) setIsVisible(true);
    lastScrollY.current = latest;
  });

  const activeThemeLabel = useMemo(() => themeOptions.find((item) => item.mode === themeMode)?.label ?? '跟随系统', [themeMode]);

  const setMode = (mode: ThemeMode) => {
    try {
      window.localStorage.setItem(THEME_STORAGE_KEY, mode);
    } catch {
      // Storage blocked (Safari private mode etc.) — still apply theme for this session.
    }
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

  // Build dock items: nav links + search + theme + auth
  const dockItems = useMemo(() => {
    const items = [
      ...navItems.map((item) => ({
        icon: <Icon d={item.icon} />,
        label: item.label,
        href: item.href,
        active: isActive(item.href),
      })),
      {
        icon: <Icon d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />,
        label: '搜索',
        onClick: openSearch,
        active: false,
      },
      {
        icon: <Icon d={resolvedTheme === 'dark' ? 'M21 12.79A9 9 0 1111.21 3 7 7 0 0021 12.79z' : 'M12 3v2m0 14v2m7.071-16.071-1.414 1.414M6.343 17.657l-1.414 1.414M21 12h-2M5 12H3m16.071 7.071-1.414-1.414M6.343 6.343 4.929 4.929M16 12a4 4 0 11-8 0 4 4 0 018 0z'} />,
        label: `主题：${activeThemeLabel}`,
        onClick: () => { setThemeMenuOpen((open) => !open); setMoreMenuOpen(false); },
        hasPopup: 'menu',
        expanded: themeMenuOpen,
        active: false,
      },
      {
        icon: <Icon d="M5 12h.01M12 12h.01M19 12h.01M6 12a1 1 0 11-2 0 1 1 0 012 0zm7 0a1 1 0 11-2 0 1 1 0 012 0zm7 0a1 1 0 11-2 0 1 1 0 012 0z" />,
        label: '更多',
        onClick: () => { setMoreMenuOpen((open) => !open); setThemeMenuOpen(false); },
        hasPopup: 'menu',
        expanded: moreMenuOpen,
        active: MORE_LINKS.some((link) => isActive(link.href)),
      },
    ];

    // Add auth item
    if (!isLoading) {
      if (isAuthenticated) {
        const displayName = getUserDisplayName(user);
        const initial = getUserInitial(user);
        items.push({
          icon: (
            <div className="flex items-center justify-center rounded-full bg-zinc-700 text-xs font-bold text-white dark:bg-zinc-200 dark:text-zinc-900" style={{ width: 22, height: 22 }}>
              {initial}
            </div>
          ),
          label: displayName,
          href: '/admin',
          active: currentPath.startsWith('/admin'),
        });
      } else {
        items.push({
          icon: <Icon d="M11 16l-4-4m0 0l4-4m-4 4h14m-5 4v1a3 3 0 01-3 3H6a3 3 0 01-3-3V7a3 3 0 013-3h7a3 3 0 013 3v1" />,
          label: '登录',
          href: '/login',
          active: currentPath.startsWith('/login'),
        });
      }
    }
    return items;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentPath, openSearch, resolvedTheme, activeThemeLabel, themeMenuOpen, moreMenuOpen, isLoading, isAuthenticated, user]);

  return (
    <>
      {/* Mobile: hamburger + SideNav (hidden on desktop) */}
      <button
        type="button"
        onClick={() => setSideNavOpen(true)}
        className="focus-ring fixed left-3 top-3 z-50 inline-flex h-11 w-11 items-center justify-center rounded-lg border border-zinc-200 bg-white/80 text-zinc-600 shadow-sm backdrop-blur-xl transition-colors hover:bg-zinc-100 hover:text-zinc-950 dark:border-zinc-800 dark:bg-zinc-900/80 dark:text-zinc-300 dark:hover:bg-zinc-800 dark:hover:text-white sm:hidden"
        aria-label="打开导航菜单"
        aria-controls="mobile-side-nav"
        aria-expanded={sideNavOpen}
      >
        <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" aria-hidden="true">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.8} d="M4 7h16M4 12h16M4 17h16" />
        </svg>
      </button>

      {/* Desktop: top Dock (hidden on mobile) */}
      <motion.div
        initial={{ y: -100 }}
        animate={{ y: isVisible ? 0 : -120 }}
        transition={{ duration: 0.3, ease: [0.16, 1, 0.3, 1] }}
        className="pointer-events-none fixed inset-x-0 top-0 z-50 hidden sm:block"
        style={{ willChange: 'transform' }}
      >
        <Dock
          items={dockItems}
          panelHeight={64}
          baseItemSize={46}
          magnification={62}
          distance={180}
        />

        {/* Theme dropdown */}
        <AnimatePresence>
          {themeMenuOpen && (
            <motion.div
              ref={menuRef}
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: 10 }}
              transition={{ duration: 0.2 }}
              className="pointer-events-auto fixed top-20 left-1/2 -translate-x-1/2 w-[min(14rem,calc(100vw-2rem))] overflow-hidden rounded-xl border border-zinc-200 bg-white p-1.5 shadow-xl shadow-zinc-900/10 backdrop-blur-xl dark:border-zinc-800 dark:bg-zinc-900/95"
              role="menu"
            >
              {themeOptions.map((item) => (
                <button
                  key={item.mode}
                  type="button"
                  onClick={() => setMode(item.mode)}
                  className={cn(
                    'flex min-h-[44px] sm:min-h-[40px] w-full items-center gap-3 rounded-lg px-3 py-2 text-left leading-snug transition-colors',
                    themeMode === item.mode
                      ? 'bg-zinc-100 text-zinc-950 dark:bg-zinc-800 dark:text-white'
                      : 'text-zinc-600 hover:bg-zinc-50 hover:text-zinc-950 dark:text-zinc-300 dark:hover:bg-zinc-800/70 dark:hover:text-white'
                  )}
                  role="menuitemradio"
                  aria-checked={themeMode === item.mode}
                >
                  <svg className="h-4 w-4 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" aria-hidden="true">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.7} d={item.icon} />
                  </svg>
                  <span className="min-w-0 break-words">
                    <span className="block text-sm font-semibold leading-5">{item.label}</span>
                    <span className="block text-xs leading-4 text-zinc-400 dark:text-zinc-500">{item.description}</span>
                  </span>
                </button>
              ))}
            </motion.div>
          )}
        </AnimatePresence>

        {/* More dropdown */}
        <AnimatePresence>
          {moreMenuOpen && (
            <motion.div
              ref={moreMenuRef}
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: 10 }}
              transition={{ duration: 0.2 }}
              className="pointer-events-auto fixed top-20 left-1/2 -translate-x-1/2 w-[min(14rem,calc(100vw-2rem))] overflow-hidden rounded-xl border border-zinc-200 bg-white p-1.5 shadow-xl shadow-zinc-900/10 backdrop-blur-xl dark:border-zinc-800 dark:bg-zinc-900/95"
              role="menu"
            >
              {MORE_LINKS.map((item) => (
                <a
                  key={item.href}
                  href={item.href}
                  onClick={() => setMoreMenuOpen(false)}
                  className={cn(
                    'flex min-h-[44px] sm:min-h-[40px] w-full items-center gap-3 rounded-lg px-3 py-2 text-left leading-snug transition-colors',
                    isActive(item.href)
                      ? 'bg-zinc-100 text-zinc-950 dark:bg-zinc-800 dark:text-white'
                      : 'text-zinc-600 hover:bg-zinc-50 hover:text-zinc-950 dark:text-zinc-300 dark:hover:bg-zinc-800/70 dark:hover:text-white'
                  )}
                  role="menuitem"
                >
                  <svg className="h-4 w-4 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" aria-hidden="true">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.7} d={item.icon} />
                  </svg>
                  <span className="min-w-0 break-words">
                    <span className="block text-sm font-semibold leading-5">{item.label}</span>
                    <span className="block text-xs leading-4 text-zinc-400 dark:text-zinc-500">{item.description}</span>
                  </span>
                </a>
              ))}
            </motion.div>
          )}
        </AnimatePresence>

      </motion.div>

      <SideNav id="mobile-side-nav" isOpen={sideNavOpen} onClose={() => setSideNavOpen(false)} currentPath={currentPath} />
    </>
  );
}
