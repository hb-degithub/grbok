import React, { useEffect, useRef, useState } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { useAdminAuth, useAdminLogout, type AdminRole } from '../../hooks/useAdminAuth';
import { cn } from '../../lib/utils';

interface NavItem {
  href: string;
  label: string;
  icon: string;
  section: string;
  requiredRole: AdminRole;
  hint: string;
}

const navItems: NavItem[] = [
  { href: '/admin', label: '仪表盘', icon: 'M3 12l2-2m0 0l7-7 7 7M5 10v10a1 1 0 001 1h3m10-11l2 2m-2-2v10a1 1 0 01-1 1h-3m-6 0a1 1 0 001-1v-4a1 1 0 011-1h2a1 1 0 011 1v4a1 1 0 001 1m-6 0h6', section: '主控台', requiredRole: 'author', hint: '概览' },
  { href: '/admin/posts', label: '文章', icon: 'M19 20H5a2 2 0 01-2-2V6a2 2 0 012-2h10a2 2 0 012 2v1m2 13a2 2 0 01-2-2V7m2 13a2 2 0 002-2V9a2 2 0 00-2-2h-2m-4-3H9M7 16h6M7 8h6v4H7V8z', section: '内容', requiredRole: 'author', hint: '撰写' },
  { href: '/admin/comments', label: '评论', icon: 'M7 8h10M7 12h4m1 8l-4-4H5a2 2 0 01-2-2V6a2 2 0 012-2h14a2 2 0 012 2v8a2 2 0 01-2 2h-3l-4 4z', section: '内容', requiredRole: 'admin', hint: '审核' },
  { href: '/admin/tags', label: '标签', icon: 'M7 7h.01M7 3h5c.512 0 1.024.195 1.414.586l7 7a2 2 0 010 2.828l-7 7a2 2 0 01-2.828 0l-7-7A1.994 1.994 0 013 12V7a4 4 0 014-4z', section: '内容', requiredRole: 'author', hint: '分类' },
  { href: '/admin/users', label: '用户', icon: 'M12 4.354a4 4 0 110 5.292M15 21H3v-1a6 6 0 0112 0v1zm0 0h6v-1a6 6 0 00-9-5.197M13 7a4 4 0 11-8 0 4 4 0 018 0z', section: '系统', requiredRole: 'super_admin', hint: '权限' },
  { href: '/admin/settings', label: '设置', icon: 'M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.066 2.573c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.573 1.066c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.066-2.573c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z M15 12a3 3 0 11-6 0 3 3 0 016 0z', section: '系统', requiredRole: 'super_admin', hint: '站点' },
  { href: '/admin/security', label: '安全', icon: 'M9 12l2 2 4-4m5.618-4.016A11.955 11.955 0 0112 2.944a11.955 11.955 0 01-8.618 3.04A12.02 12.02 0 003 9c0 5.591 3.824 10.29 9 11.622 5.176-1.332 9-6.03 9-11.622 0-1.042-.133-2.052-.382-3.016z', section: '系统', requiredRole: 'super_admin', hint: '审计' },
];

const roleLabels: Record<AdminRole, string> = {
  reader: '普通用户',
  author: '作者',
  admin: '管理员',
  super_admin: '超级管理员',
};

const roleTone: Record<AdminRole, string> = {
  reader: 'border-text-muted/30 bg-text-muted/10 text-text-secondary',
  author: 'border-accent/25 bg-accent/10 text-accent',
  admin: 'border-warning/25 bg-warning/10 text-warning',
  super_admin: 'border-danger/25 bg-danger/10 text-danger',
};

function isActivePath(href: string, currentPath: string) {
  return href === '/admin' ? currentPath === '/admin' || currentPath === '/admin/' : currentPath.startsWith(href);
}

function getScrollbarWidth() {
  return typeof window !== 'undefined' ? window.innerWidth - document.documentElement.clientWidth : 0;
}

export default function AdminSidebar() {
  const [collapsed, setCollapsed] = useState(() => {
    if (typeof window === 'undefined') return false;
    const stored = window.localStorage.getItem('admin-sidebar-collapsed');
    if (stored !== null) return stored === 'true';
    return window.innerWidth < 1180;
  });
  const [drawerOpen, setDrawerOpen] = useState(false);
  const drawerRef = useRef<HTMLElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const { logout } = useAdminLogout();
  const { hasPermission, user } = useAdminAuth();
  const currentPath = typeof window !== 'undefined' ? window.location.pathname : '';
  const visibleItems = navItems.filter((item) => hasPermission(item.requiredRole));
  const sections = [...new Set(visibleItems.map((item) => item.section))];
  const width = collapsed ? 72 : 248;
  const initial = user?.name?.charAt(0)?.toUpperCase() || user?.email?.charAt(0)?.toUpperCase() || '?';
  const role = user?.role as AdminRole | undefined;

  useEffect(() => {
    const media = window.matchMedia('(min-width: 1024px)');
    const syncSidebarWidth = () => {
      if (!media.matches) {
        document.documentElement.style.setProperty('--admin-sidebar-width', '0px');
        return;
      }
      document.documentElement.style.setProperty('--admin-sidebar-width', collapsed ? '4.5rem' : '15.5rem');
      window.localStorage.setItem('admin-sidebar-collapsed', String(collapsed));
    };
    syncSidebarWidth();
    media.addEventListener?.('change', syncSidebarWidth);
    return () => media.removeEventListener?.('change', syncSidebarWidth);
  }, [collapsed]);

  useEffect(() => {
    if (!drawerOpen) return;
    const originalOverflow = document.body.style.overflow;
    const originalPaddingRight = document.body.style.paddingRight;
    const scrollbarWidth = getScrollbarWidth();
    document.body.style.overflow = 'hidden';
    if (scrollbarWidth > 0) document.body.style.paddingRight = `${scrollbarWidth}px`;
    const focusTimer = window.setTimeout(() => {
      const firstFocusable = drawerRef.current?.querySelector<HTMLElement>('a[href], button:not([disabled]), [tabindex]:not([tabindex="-1"])');
      (firstFocusable ?? drawerRef.current)?.focus({ preventScroll: true });
    }, 60);
    return () => {
      window.clearTimeout(focusTimer);
      document.body.style.overflow = originalOverflow;
      document.body.style.paddingRight = originalPaddingRight;
      triggerRef.current?.focus({ preventScroll: true });
    };
  }, [drawerOpen]);

  useEffect(() => {
    if (!drawerOpen) return;
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setDrawerOpen(false);
    };
    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [drawerOpen]);

  const handleLogout = () => {
    setDrawerOpen(false);
    logout();
  };

  const renderNav = (isCollapsed: boolean, onNavigate?: () => void) => (
    <>
      <nav className="flex-1 overflow-y-auto px-2 py-3 pb-[calc(0.75rem+env(safe-area-inset-bottom))]">
        {sections.map((section) => (
          <div key={section} className="mb-4">
            {!isCollapsed && <div className="mb-1.5 px-2 font-mono text-[10px] uppercase tracking-wide text-muted">{section}</div>}
            <div className="space-y-1">
              {visibleItems.filter((item) => item.section === section).map((item) => {
                const active = isActivePath(item.href, currentPath);
                return (
                  <a
                    key={item.href}
                    href={item.href}
                    title={isCollapsed ? item.label : undefined}
                    onClick={onNavigate}
                    className={cn(
                      'group relative flex min-h-11 items-center gap-3 rounded-md px-2.5 text-sm font-medium transition-all',
                      isCollapsed && 'justify-center px-0',
                      active ? 'bg-text text-white shadow-sm' : 'text-text-secondary hover:bg-bg-soft hover:text-text'
                    )}
                    aria-current={active ? 'page' : undefined}
                  >
                    {active && <span className="absolute left-0 top-1/2 h-5 w-0.5 -translate-y-1/2 rounded-full bg-white/80" />}
                    <svg className={cn('h-5 w-5 shrink-0', active ? 'text-white' : 'text-muted group-hover:text-text')} fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.6} d={item.icon} /></svg>
                    {!isCollapsed && (
                      <>
                        <span className="truncate">{item.label}</span>
                        <span className={cn('ml-auto rounded px-1.5 py-0.5 font-mono text-[10px]', active ? 'bg-white/12 text-white/80' : 'bg-bg-soft text-muted')}>{item.hint}</span>
                      </>
                    )}
                  </a>
                );
              })}
            </div>
          </div>
        ))}
      </nav>

      <div className="border-t border-border p-2.5 pb-[max(0.625rem,env(safe-area-inset-bottom))]">
        <a
          href="/"
          onClick={onNavigate}
          className={cn('mb-2 flex min-h-11 items-center gap-3 rounded-md border border-border bg-bg-soft px-2.5 text-sm text-text-secondary transition-colors hover:border-border-hover hover:bg-white hover:text-text', isCollapsed && 'justify-center px-0')}
          title="查看站点"
        >
          <svg className="h-5 w-5 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.6} d="M14 3h7m0 0v7m0-7L10 14m-1 7H5a2 2 0 01-2-2V5a2 2 0 012-2h4" /></svg>
          {!isCollapsed && <span>查看站点</span>}
        </a>
        <div className={cn('mb-2 rounded-md border border-border bg-white p-2 shadow-xs', isCollapsed && 'flex justify-center p-1.5')}>
          <div className="flex items-center gap-2">
            <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-md bg-text text-xs font-bold text-white">{initial}</div>
            {!isCollapsed && (
              <div className="min-w-0 flex-1">
                <div className="truncate text-xs font-semibold text-text">{user?.name || '后台用户'}</div>
                <div className="truncate font-mono text-[10px] text-muted">{user?.email || '已登录'}</div>
              </div>
            )}
          </div>
          {!isCollapsed && role && (
            <div className={cn('mt-2 inline-flex rounded-md border px-2 py-0.5 font-mono text-[10px] uppercase', roleTone[role])}>
              {roleLabels[role]}
            </div>
          )}
        </div>
        <button
          onClick={handleLogout}
          className={cn('flex min-h-11 w-full items-center gap-3 rounded-md px-2.5 text-sm text-text-secondary transition-colors hover:bg-danger/10 hover:text-danger', isCollapsed && 'justify-center px-0')}
          title="退出登录"
          aria-label="退出登录"
        >
          <svg className="h-5 w-5 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.6} d="M17 16l4-4m0 0l-4-4m4 4H7m6 4v1a3 3 0 01-3 3H6a3 3 0 01-3-3V7a3 3 0 013-3h4a3 3 0 013 3v1" /></svg>
          {!isCollapsed && <span>退出登录</span>}
        </button>
      </div>
    </>
  );

  return (
    <>
      <button
        ref={triggerRef}
        type="button"
        onClick={() => setDrawerOpen(true)}
        className="fixed left-3 top-[calc(0.75rem+env(safe-area-inset-top))] z-50 flex h-11 w-11 items-center justify-center rounded-md border border-border bg-white text-text shadow-md backdrop-blur lg:hidden"
        aria-label="打开后台菜单"
        aria-expanded={drawerOpen}
        aria-controls="admin-mobile-sidebar"
      >
        <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" aria-hidden="true"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.8} d="M4 7h16M4 12h16M4 17h16" /></svg>
      </button>

      <motion.aside
        animate={{ width }}
        transition={{ duration: 0.24, ease: [0.16, 1, 0.3, 1] }}
        className="fixed inset-y-0 left-0 z-40 hidden h-auto flex-col border-r border-border bg-white/96 shadow-[10px_0_30px_rgba(28,25,23,0.045)] backdrop-blur-xl lg:flex"
      >
        <div className="flex h-16 items-center justify-between border-b border-border px-3">
          {!collapsed && (
            <a href="/admin" className="min-w-0 text-text hover:text-text" aria-label="后台首页">
              <div className="flex items-center gap-2">
                <span className="flex h-8 w-8 items-center justify-center rounded-md bg-text text-sm font-black text-white">B</span>
                <div className="min-w-0">
                  <div className="text-sm font-black leading-tight text-text">博客后台</div>
                  <div className="font-mono text-[10px] uppercase text-muted">Operate / Publish</div>
                </div>
              </div>
            </a>
          )}
          <button
            onClick={() => setCollapsed(!collapsed)}
            className="flex h-10 w-10 shrink-0 items-center justify-center rounded-md border border-border bg-bg-soft text-text-secondary transition-colors hover:border-border-hover hover:bg-white hover:text-text"
            aria-label="切换侧边栏"
            title="切换侧边栏"
          >
            <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d={collapsed ? 'M9 5l7 7-7 7' : 'M15 19l-7-7 7-7'} /></svg>
          </button>
        </div>
        {renderNav(collapsed)}
      </motion.aside>

      <AnimatePresence>
        {drawerOpen && (
          <>
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              className="fixed inset-0 z-50 bg-zinc-950/35 backdrop-blur-sm lg:hidden"
              onClick={() => setDrawerOpen(false)}
              aria-hidden="true"
            />
            <motion.aside
              id="admin-mobile-sidebar"
              ref={drawerRef}
              tabIndex={-1}
              role="dialog"
              aria-modal="true"
              aria-label="后台菜单"
              initial={{ x: '-100%' }}
              animate={{ x: 0 }}
              exit={{ x: '-100%' }}
              transition={{ type: 'spring', damping: 28, stiffness: 260 }}
              className="fixed inset-y-0 left-0 z-50 flex h-auto max-h-none w-[min(20rem,88dvw)] max-w-[calc(100dvw-env(safe-area-inset-right))] flex-col border-r border-border bg-white shadow-2xl outline-none lg:hidden"
              onClick={(event) => event.stopPropagation()}
            >
              <div className="flex min-h-16 items-center justify-between border-b border-border px-4 pt-[max(env(safe-area-inset-top),0.5rem)]">
                <a href="/admin" onClick={() => setDrawerOpen(false)} className="min-w-0 text-text hover:text-text" aria-label="后台首页">
                  <div className="flex items-center gap-2">
                    <span className="flex h-9 w-9 items-center justify-center rounded-md bg-text text-sm font-black text-white">B</span>
                    <div className="min-w-0">
                      <div className="truncate text-sm font-black leading-tight text-text">博客后台</div>
                      <div className="font-mono text-[10px] uppercase text-muted">Mobile Console</div>
                    </div>
                  </div>
                </a>
                <button
                  type="button"
                  onClick={() => setDrawerOpen(false)}
                  className="flex h-11 w-11 shrink-0 items-center justify-center rounded-md text-text-secondary transition-colors hover:bg-bg-soft hover:text-text"
                  aria-label="关闭后台菜单"
                >
                  <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" aria-hidden="true"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" /></svg>
                </button>
              </div>
              {renderNav(false, () => setDrawerOpen(false))}
            </motion.aside>
          </>
        )}
      </AnimatePresence>
    </>
  );
}
