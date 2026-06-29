import React, { useEffect, useRef } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { SITE_CONFIG } from '../../config/site';
import { useAuthStatus } from '../../hooks/useAuthStatus';

interface SideNavProps {
  id?: string;
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

const adminNavItem = { href: '/admin', label: '管理后台', icon: 'M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.066 2.573c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.573 1.066c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.066-2.573c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z M15 12a3 3 0 11-6 0 3 3 0 016 0z' };
const loginNavItem = { href: '/login', label: '登录', icon: 'M11 16l-4-4m0 0l4-4m-4 4h14m-5 4v1a3 3 0 01-3 3H6a3 3 0 01-3-3V7a3 3 0 013-3h7a3 3 0 013 3v1' };

const DRAWER_TRANSITION = { type: 'spring', damping: 28, stiffness: 260 } as const;

function getScrollbarWidth() {
  return typeof window !== 'undefined' ? window.innerWidth - document.documentElement.clientWidth : 0;
}

export default function SideNav({ id, isOpen, onClose, currentPath }: SideNavProps) {
  const drawerRef = useRef<HTMLElement>(null);
  const previousActiveElement = useRef<HTMLElement | null>(null);
  const { isAuthenticated, isLoading, canAccessAdmin } = useAuthStatus();
  const secondaryNavItems = [
    canAccessAdmin ? adminNavItem : null,
    !isLoading && !isAuthenticated ? loginNavItem : null,
  ].filter((item): item is typeof adminNavItem => Boolean(item));

  const isActive = (href: string) => {
    if (href === '/') return currentPath === '/';
    return currentPath.startsWith(href);
  };

  // 记录触发元素，关闭后归还焦点
  useEffect(() => {
    if (isOpen) {
      previousActiveElement.current = document.activeElement as HTMLElement | null;
    }
  }, [isOpen]);

  // ESC 关闭
  useEffect(() => {
    if (!isOpen) return;
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.stopPropagation();
        onClose();
      }
    };
    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [isOpen, onClose]);

  // 焦点管理：打开时移入抽屉，关闭时归还
  useEffect(() => {
    if (isOpen) {
      const timer = setTimeout(() => {
        const focusable = drawerRef.current?.querySelector<HTMLElement>(
          'a[href], button:not([disabled]), input, textarea, select, [tabindex]:not([tabindex="-1"])'
        );
        (focusable ?? drawerRef.current)?.focus({ preventScroll: true });
      }, 50);
      return () => clearTimeout(timer);
    }
    if (previousActiveElement.current) {
      previousActiveElement.current.focus({ preventScroll: true });
    }
  }, [isOpen]);

  // 滚动锁定
  useEffect(() => {
    if (!isOpen) return;
    const originalOverflow = document.body.style.overflow;
    const originalPaddingRight = document.body.style.paddingRight;
    const scrollbarWidth = getScrollbarWidth();
    document.body.style.overflow = 'hidden';
    if (scrollbarWidth > 0) {
      document.body.style.paddingRight = `${scrollbarWidth}px`;
    }
    return () => {
      document.body.style.overflow = originalOverflow;
      document.body.style.paddingRight = originalPaddingRight;
    };
  }, [isOpen]);

  // Tab 焦点循环
  const handleDrawerKeyDown = (e: React.KeyboardEvent<HTMLElement>) => {
    if (e.key !== 'Tab') return;
    const focusables = Array.from(
      drawerRef.current?.querySelectorAll<HTMLElement>(
        'a[href], button:not([disabled]), input, textarea, select, [tabindex]:not([tabindex="-1"])'
      ) ?? []
    );
    if (focusables.length === 0) return;
    const first = focusables[0];
    const last = focusables[focusables.length - 1];
    if (e.shiftKey && document.activeElement === first) {
      e.preventDefault();
      last.focus();
    } else if (!e.shiftKey && document.activeElement === last) {
      e.preventDefault();
      first.focus();
    }
  };

  const handleDrawerClick = (e: React.MouseEvent) => e.stopPropagation();
  const handleLinkClick = () => onClose();

  return (
    <AnimatePresence>
      {isOpen && (
        <>
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.3, ease: 'easeInOut' }}
            onClick={onClose}
            className="fixed inset-0 z-50 bg-stone-900/20 backdrop-blur-sm"
            aria-hidden="true"
          />
          <motion.aside
            id={id}
            ref={drawerRef}
            tabIndex={-1}
            role="dialog"
            aria-modal="true"
            aria-label="移动端侧边导航"
            initial={{ x: '-100%' }}
            animate={{ x: 0 }}
            exit={{ x: '-100%' }}
            transition={DRAWER_TRANSITION}
            onClick={handleDrawerClick}
            onKeyDown={handleDrawerKeyDown}
            className="fixed left-0 top-0 z-50 flex h-[var(--vvh,100dvh)] max-h-[var(--vvh,100dvh)] w-[min(288px,88vw)] flex-col overflow-hidden bg-white shadow-2xl outline-none dark:bg-stone-900"
          >
            <div className="flex min-h-[56px] shrink-0 items-center justify-between gap-3 border-b border-stone-200 px-3 py-2 pt-[max(env(safe-area-inset-top),0.5rem)] dark:border-stone-800 sm:px-5">
              <a href="/" className="flex min-h-[40px] min-w-0 items-center gap-2.5">
                <div className="flex h-[36px] w-[36px] shrink-0 items-center justify-center rounded-xl bg-stone-500 text-lg font-bold text-white">
                  {SITE_CONFIG.logoText}
                </div>
                <span className="min-w-0 break-words text-base font-bold leading-tight text-stone-900 dark:text-stone-100">{SITE_CONFIG.name}</span>
              </a>
              <button
                type="button"
                onClick={onClose}
                className="focus-ring flex h-[40px] min-h-[40px] w-[40px] min-w-[40px] shrink-0 items-center justify-center rounded-lg text-stone-500 transition-colors hover:bg-stone-100 hover:text-stone-900 dark:text-stone-400 dark:hover:bg-stone-800 dark:hover:text-stone-100"
                aria-label="关闭侧边导航"
              >
                <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            </div>

            <nav className="flex min-h-0 flex-1 flex-col overflow-y-auto overscroll-contain p-3 pb-[calc(1rem+env(safe-area-inset-bottom))] sm:p-4">
              <div className="space-y-1">
                <p className="mb-2 break-words px-3 text-xs font-semibold uppercase tracking-wider text-stone-400 dark:text-stone-500">主导航</p>
                {mainNavItems.map((item) => (
                  <a
                    key={item.href}
                    href={item.href}
                    onClick={handleLinkClick}
                    className={`flex min-h-[44px] min-w-0 items-center gap-3 rounded-xl px-3 py-3 text-sm font-medium leading-snug transition-colors ${
                      isActive(item.href)
                        ? 'bg-stone-100 text-stone-900 dark:bg-stone-800 dark:text-stone-100'
                        : 'text-stone-500 hover:bg-stone-100 hover:text-stone-900 dark:text-stone-400 dark:hover:bg-stone-800 dark:hover:text-stone-100'
                    }`}
                    aria-current={isActive(item.href) ? 'page' : undefined}
                  >
                    <svg className="h-5 w-5 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d={item.icon} />
                    </svg>
                    <span className="min-w-0 break-words">{item.label}</span>
                  </a>
                ))}
              </div>

              <div className="mt-6 space-y-1">
                <p className="mb-2 break-words px-3 text-xs font-semibold uppercase tracking-wider text-stone-400 dark:text-stone-500">其他</p>
                {secondaryNavItems.map((item) => (
                  <a
                    key={item.href}
                    href={item.href}
                    onClick={handleLinkClick}
                    className={`flex min-h-[44px] min-w-0 items-center gap-3 rounded-xl px-3 py-3 text-sm font-medium leading-snug transition-colors ${
                      isActive(item.href)
                        ? 'bg-stone-100 text-stone-900 dark:bg-stone-800 dark:text-stone-100'
                        : 'text-stone-500 hover:bg-stone-100 hover:text-stone-900 dark:text-stone-400 dark:hover:bg-stone-800 dark:hover:text-stone-100'
                    }`}
                    aria-current={isActive(item.href) ? 'page' : undefined}
                  >
                    <svg className="h-5 w-5 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d={item.icon} />
                    </svg>
                    <span className="min-w-0 break-words">{item.label}</span>
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
